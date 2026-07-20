import type { EnrollmentRow, Section, Student } from '../types'
import { balancedTargetSize } from './capacity'

/**
 * Edge-aware sectioning — batch students with identical *other-course* fingerprints
 * so cross-section edges stay sparse, while keeping section loads near a balanced target.
 */
export function assignStudentsToSections(
  students: Record<string, Student>,
  courseSections: Record<string, Section[]>,
  enrollmentRows: EnrollmentRow[],
): Record<string, Section[]> {
  const courseProgramStudents = new Map<string, Map<string, Set<string>>>()

  for (const row of enrollmentRows) {
    if (!courseProgramStudents.has(row.course_code)) {
      courseProgramStudents.set(row.course_code, new Map())
    }
    const m = courseProgramStudents.get(row.course_code)!
    if (!m.has(row.program)) m.set(row.program, new Set())
    m.get(row.program)!.add(row.register_number)
  }

  const studentOtherCourses = (reg: string, currentCourse: string): string[] => {
    const st = students[reg]
    if (!st) return []
    return st.enrolled_courses.filter((c) => c !== currentCourse).sort()
  }

  for (const [courseCode, sections] of Object.entries(courseSections)) {
    const byProgram = courseProgramStudents.get(courseCode)
    if (!byProgram) continue

    if (sections.length === 1) {
      for (const [program, idSet] of byProgram) {
        const programStudents = [...idSet].sort()
        sections[0]!.enrolled_students.push(...programStudents)
        if (!sections[0]!.programs.includes(program)) {
          sections[0]!.programs.push(program)
        }
      }
      continue
    }

    type Cohort = { students: string[]; program: string }
    const cohorts: Cohort[] = []
    let totalEnrollment = 0

    for (const [program, idSet] of byProgram) {
      const programStudents = [...idSet].sort()
      totalEnrollment += programStudents.length
      const byFingerprint = new Map<string, string[]>()
      for (const reg of programStudents) {
        const fp = studentOtherCourses(reg, courseCode).join(',')
        if (!byFingerprint.has(fp)) byFingerprint.set(fp, [])
        byFingerprint.get(fp)!.push(reg)
      }
      for (const ids of byFingerprint.values()) {
        cohorts.push({ students: ids, program })
      }
    }

    const target = balancedTargetSize(totalEnrollment, sections.length)
    // Soft balance band: prefer staying at/under target; hard capacity remains section.capacity.
    const balancePenaltyWeight = 50

    cohorts.sort((a, b) => b.students.length - a.students.length)

    const sectionLoads = sections.map(() => 0)

    function crossEdgeScore(secIdx: number, ids: string[]): number {
      const sec = sections[secIdx]!
      let crossEdges = 0
      const setOther = new Set<string>()
      for (const oid of sec.enrolled_students) {
        for (const oc of studentOtherCourses(oid, courseCode)) setOther.add(oc)
      }
      for (const reg of ids) {
        for (const oc of studentOtherCourses(reg, courseCode)) {
          if (setOther.has(oc)) crossEdges++
        }
      }
      return crossEdges
    }

    function balancePenalty(secIdx: number, addCount: number): number {
      const next = (sectionLoads[secIdx] ?? 0) + addCount
      // Prefer filling emptier sections first; heavily penalize going past the balanced target.
      const over = Math.max(0, next - target)
      const underFillBonus = Math.max(0, target - (sectionLoads[secIdx] ?? 0)) * 0.01
      return over * over * balancePenaltyWeight - underFillBonus
    }

    function pushChunk(program: string, secIdx: number, chunk: string[]): void {
      if (!chunk.length) return
      const sec = sections[secIdx]!
      sec.enrolled_students.push(...chunk)
      sectionLoads[secIdx] = (sectionLoads[secIdx] ?? 0) + chunk.length
      if (!sec.programs.includes(program)) sec.programs.push(program)
    }

    for (const cohort of cohorts) {
      const remaining = [...cohort.students]
      while (remaining.length) {
        let bestSi = -1
        let bestScore = Number.POSITIVE_INFINITY
        for (let si = 0; si < sections.length; si++) {
          const space = sections[si]!.capacity - (sectionLoads[si] ?? 0)
          if (space <= 0) continue
          // Prefer taking a chunk that keeps us near target when possible.
          const roomToTarget = Math.max(1, target - (sectionLoads[si] ?? 0))
          const takeIdeal = Math.min(space, remaining.length, Math.max(1, roomToTarget))
          const chunk = remaining.slice(0, takeIdeal)
          const cross = crossEdgeScore(si, chunk)
          const bal = balancePenalty(si, chunk.length)
          const score = cross * 1000 + bal
          if (score < bestScore) {
            bestScore = score
            bestSi = si
          }
        }
        if (bestSi < 0) {
          let pick = 0
          let bestSlack = -1
          for (let i = 0; i < sections.length; i++) {
            const slack = sections[i]!.capacity - (sectionLoads[i] ?? 0)
            if (slack > bestSlack) {
              bestSlack = slack
              pick = i
            }
          }
          if (bestSlack <= 0) {
            if (remaining.length > 0) {
              throw new Error(
                `Cannot assign all students to sections for course ${courseCode}: capacity exhausted with ${remaining.length} student(s) remaining.`,
              )
            }
            break
          }
          const take = Math.min(remaining.length, bestSlack)
          pushChunk(cohort.program, pick, remaining.splice(0, take))
          continue
        }
        const space = sections[bestSi]!.capacity - (sectionLoads[bestSi] ?? 0)
        const roomToTarget = Math.max(1, target - (sectionLoads[bestSi] ?? 0))
        const take = remaining.splice(0, Math.min(space, remaining.length, Math.max(1, roomToTarget)))
        pushChunk(cohort.program, bestSi, take)
      }
    }

    // Final pass: if any section is empty while another is oversized vs target, leave as-is —
    // capacity and exclusivity matter more than perfect ±1 when cohorts cannot split.
  }

  return courseSections
}

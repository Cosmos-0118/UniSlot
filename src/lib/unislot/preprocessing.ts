import type { Course, EnrollmentRow, Section, Student } from './types'
import type { ConflictEdge, ConflictGraph } from './types'

const DEFAULT_MAX_CAPACITY = 65

export function computeSectionSplits(
  courses: Record<string, Course>,
  maxCapacity: number = DEFAULT_MAX_CAPACITY,
): Record<string, Section[]> {
  const courseSections: Record<string, Section[]> = {}

  for (const [code, course] of Object.entries(courses)) {
    const numSections =
      course.enrollment_count > 0
        ? Math.ceil(course.enrollment_count / maxCapacity)
        : 1
    course.section_count = numSections

    const sections: Section[] = []
    for (let i = 0; i < numSections; i++) {
      const sectionId = numSections > 1 ? `${code}_S${i + 1}` : code
      sections.push({
        section_id: sectionId,
        course_code: code,
        course_title: course.title,
        section_number: i + 1,
        faculty: course.faculty,
        capacity: maxCapacity,
        enrolled_students: [],
        programs: [],
      })
    }
    courseSections[code] = sections
  }

  return courseSections
}

export function assignStudentsToSections(
  _students: Record<string, Student>,
  courseSections: Record<string, Section[]>,
  enrollmentRows: EnrollmentRow[],
): Record<string, Section[]> {
  const courseProgramStudents = new Map<string, Map<string, string[]>>()

  for (const row of enrollmentRows) {
    if (!courseProgramStudents.has(row.course_code)) {
      courseProgramStudents.set(row.course_code, new Map())
    }
    const m = courseProgramStudents.get(row.course_code)!
    if (!m.has(row.program)) m.set(row.program, [])
    m.get(row.program)!.push(row.register_number)
  }

  for (const [courseCode, sections] of Object.entries(courseSections)) {
    const byProgram = courseProgramStudents.get(courseCode)
    if (!byProgram) continue

    if (sections.length === 1) {
      for (const [program, programStudents] of byProgram) {
        sections[0].enrolled_students.push(...programStudents)
        if (!sections[0].programs.includes(program)) {
          sections[0].programs.push(program)
        }
      }
    } else {
      const programGroups = [...byProgram.entries()].sort((a, b) => b[1].length - a[1].length)
      const sectionLoads = sections.map(() => 0)

      for (const [program, studentIds] of programGroups) {
        let minIdx = sectionLoads.indexOf(Math.min(...sectionLoads))

        if (sectionLoads[minIdx] + studentIds.length <= sections[minIdx].capacity) {
          sections[minIdx].enrolled_students.push(...studentIds)
          sectionLoads[minIdx] += studentIds.length
          if (!sections[minIdx].programs.includes(program)) {
            sections[minIdx].programs.push(program)
          }
        } else {
          let remaining = [...studentIds]
          while (remaining.length) {
            minIdx = sectionLoads.indexOf(Math.min(...sectionLoads))
            let space = sections[minIdx].capacity - sectionLoads[minIdx]
            if (space <= 0) {
              minIdx = sectionLoads.indexOf(Math.min(...sectionLoads))
              space = remaining.length
            }
            const toAssign = remaining.slice(0, space)
            sections[minIdx].enrolled_students.push(...toAssign)
            sectionLoads[minIdx] += toAssign.length
            if (!sections[minIdx].programs.includes(program)) {
              sections[minIdx].programs.push(program)
            }
            remaining = remaining.slice(space)
          }
        }
      }
    }
  }

  return courseSections
}

export function buildConflictGraph(
  _students: Record<string, Student>,
  courseSections: Record<string, Section[]>,
): ConflictGraph {
  const studentSections = new Map<string, string[]>()
  const allSections: string[] = []

  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      allSections.push(section.section_id)
      for (const studentId of section.enrolled_students) {
        if (!studentSections.has(studentId)) studentSections.set(studentId, [])
        studentSections.get(studentId)!.push(section.section_id)
      }
    }
  }

  const edgeWeights = new Map<string, string[]>()

  for (const [studentId, sectionIds] of studentSections) {
    for (let i = 0; i < sectionIds.length; i++) {
      for (let j = i + 1; j < sectionIds.length; j++) {
        const a = sectionIds[i]
        const b = sectionIds[j]
        const s1 = a < b ? a : b
        const s2 = a < b ? b : a
        const key = `${s1}|${s2}`
        if (!edgeWeights.has(key)) edgeWeights.set(key, [])
        edgeWeights.get(key)!.push(studentId)
      }
    }
  }

  const edges: ConflictEdge[] = []
  for (const [key, shared] of edgeWeights) {
    const [s1, s2] = key.split('|')
    const unique = [...new Set(shared)]
    edges.push({
      section_a: s1,
      section_b: s2,
      weight: unique.length,
      shared_students: unique,
    })
  }

  return { sections: allSections, edges }
}

export function extractFacultyConstraints(
  courseSections: Record<string, Section[]>,
): Record<string, string[]> {
  const facultySections: Record<string, string[]> = {}
  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      if (section.faculty) {
        if (!facultySections[section.faculty]) facultySections[section.faculty] = []
        facultySections[section.faculty].push(section.section_id)
      }
    }
  }
  return facultySections
}

export function getAllSections(courseSections: Record<string, Section[]>): Section[] {
  return Object.values(courseSections).flat()
}

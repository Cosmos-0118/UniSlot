import type {
  ClashReport,
  DayName,
  Schedule,
  ScheduleEntry,
  Section,
  Student,
  StudentClashReport,
} from '../types'
import { INDEX_TO_DAY, WEEKDAY_ORDER, formatSlotTime } from './timeModel'

const PROGRAM_ABBREVIATIONS: [string, string][] = [
  ['computer science and engineering', 'CSE'],
  ['computer science', 'CS'],
  ['artificial intelligence and machine learning', 'AIML'],
  ['artificial intelligence', 'AI'],
  ['machine learning', 'ML'],
  ['data science', 'DS'],
  ['information technology', 'IT'],
  ['electronics and communication engineering', 'ECE'],
  ['electronics and communication', 'ECE'],
  ['electrical and electronics engineering', 'EEE'],
  ['mechanical engineering', 'MECH'],
  ['civil engineering', 'CIVIL'],
]

function normalizeProgramForNomenclature(s: string): string {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\.\s*/g, '.')
}

function compactProgramKey(s: string): string {
  return s.replace(/[^a-z0-9]+/g, '')
}

function stripLeadingDegreePrefix(s: string): string {
  return s
    .replace(
      /^(b\.?tech|m\.?tech(\(integrated\))?|b\.?arch|b\.?des|int\.?\s*m\.?tech)\.?-?/i,
      '',
    )
    .trim()
}

function resolveNomenclature(
  program: string,
  programNomenclature: Record<string, string>,
): string | null {
  const base = normalizeProgramForNomenclature(program)
  const baseNoDots = base.replace(/\./g, '')
  const stripped = stripLeadingDegreePrefix(base)
  const strippedNoDots = stripped.replace(/\./g, '')

  const candidates = [
    base,
    baseNoDots,
    compactProgramKey(base),
    stripped,
    strippedNoDots,
    compactProgramKey(stripped),
  ].filter(Boolean)

  for (const key of candidates) {
    const v = programNomenclature[key]
    if (v) return v
  }

  // Final tolerant fallback: compare punctuation-free forms.
  const compactCandidates = new Set(candidates.map((c) => compactProgramKey(c)).filter(Boolean))
  if (compactCandidates.size) {
    for (const [k, v] of Object.entries(programNomenclature)) {
      if (compactCandidates.has(compactProgramKey(k))) return v
    }
  }

  return null
}

function abbreviateProgram(
  program: string,
  programNomenclature?: Record<string, string>,
): string {
  if (!program) return ''
  if (programNomenclature && Object.keys(programNomenclature).length) {
    const v = resolveNomenclature(program, programNomenclature)
    if (v) return v
  }
  let lower = program.trim().toLowerCase()
  for (const prefix of ['b.tech.-', 'b.tech-', 'b.tech.', 'b.tech ']) {
    if (lower.startsWith(prefix)) {
      lower = lower.slice(prefix.length)
      break
    }
  }
  const sorted = [...PROGRAM_ABBREVIATIONS].sort((a, b) => b[0].length - a[0].length)
  for (const [key, abbr] of sorted) {
    if (lower.includes(key)) return abbr
  }
  const words = lower.split(/\s+/).filter(Boolean)
  const skip = new Set(['b', 'tech', 'm', 'of', 'and', 'in', 'the', 'with', 'engineering'])
  const caps = words
    .filter((w) => !skip.has(w) && w.length > 1 && /^[a-z]/i.test(w))
    .map((w) => w[0]!.toUpperCase())
  if (caps.length) return caps.slice(0, 4).join('')
  return program.slice(0, 6).toUpperCase() || 'UNK'
}

function formatPrograms(programs: string[], programNomenclature?: Record<string, string>): string {
  const abbrs: string[] = []
  const seen = new Set<string>()
  for (const p of programs) {
    const a = abbreviateProgram(p, programNomenclature)
    if (!seen.has(a)) {
      seen.add(a)
      abbrs.push(a)
    }
  }
  return abbrs.join(', ')
}

export function buildSchedule(
  courseSections: Record<string, Section[]>,
  slotAssignments: Record<string, number>,
  solverMeta: {
    solver_used: string
    solver_time_seconds: number
    hard_constraints_feasible?: boolean
    hard_constraint_violations?: string[]
    solver_primary_metrics_zero?: boolean
    min_red_students_lower_bound?: number
    min_clash_weight_lower_bound?: number
    zero_clash_structurally_impossible?: boolean
    lower_bound_notes?: string[]
  },
  opts?: {
    programNomenclature?: Record<string, string>
    /** Previous parallel lane numbers — preserve them so late/rectify inserts do not renumber. */
    previousLanes?: Record<string, number>
  },
): Schedule {
  const entries: ScheduleEntry[] = []

  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      const slotIdx = slotAssignments[section.section_id] ?? 0
      const day = INDEX_TO_DAY[slotIdx] ?? 'Monday'
      entries.push({
        section_id: section.section_id,
        course_code: section.course_code,
        course_title: section.course_title,
        section_number: section.section_number,
        day,
        time: formatSlotTime(),
        slot_index: slotIdx,
        slot_band: 0,
        parallel_lane_count: 0,
        faculty: section.faculty,
        enrollment_count: section.enrolled_students.length,
        programs: formatPrograms(section.programs, opts?.programNomenclature),
      })
    }
  }

  entries.sort(
    (a, b) =>
      (a.slot_index ?? 0) - (b.slot_index ?? 0) ||
      a.course_code.localeCompare(b.course_code) ||
      a.section_number - b.section_number,
  )
  const entriesByDay = new Map<DayName, ScheduleEntry[]>()
  for (const entry of entries) {
    if (!entriesByDay.has(entry.day)) entriesByDay.set(entry.day, [])
    entriesByDay.get(entry.day)!.push(entry)
  }
  const previousLanes = opts?.previousLanes
  for (const dayEntries of entriesByDay.values()) {
    if (previousLanes && Object.keys(previousLanes).length > 0) {
      // Stable order: keep prior lane numbers, append new sections at the end.
      dayEntries.sort((a, b) => {
        const la = previousLanes[a.section_id]
        const lb = previousLanes[b.section_id]
        if (la != null && lb != null) return la - lb
        if (la != null) return -1
        if (lb != null) return 1
        return (
          a.course_code.localeCompare(b.course_code) ||
          a.section_number - b.section_number
        )
      })
      let nextNew = Math.max(0, ...dayEntries.map((e) => previousLanes[e.section_id] ?? 0)) + 1
      for (const entry of dayEntries) {
        const prev = previousLanes[entry.section_id]
        entry.slot_band = prev ?? nextNew++
        entry.parallel_lane_count = dayEntries.length
      }
    } else {
      for (let i = 0; i < dayEntries.length; i++) {
        dayEntries[i]!.slot_band = i + 1
        dayEntries[i]!.parallel_lane_count = dayEntries.length
      }
    }
  }

  return {
    entries,
    total_sections: entries.length,
    solver_used: solverMeta.solver_used,
    solver_time_seconds: solverMeta.solver_time_seconds,
    total_clashes: 0,
    hard_constraints_feasible: solverMeta.hard_constraints_feasible,
    hard_constraint_violations: solverMeta.hard_constraint_violations,
    solver_primary_metrics_zero: solverMeta.solver_primary_metrics_zero,
    min_red_students_lower_bound: solverMeta.min_red_students_lower_bound,
    min_clash_weight_lower_bound: solverMeta.min_clash_weight_lower_bound,
    zero_clash_structurally_impossible: solverMeta.zero_clash_structurally_impossible,
    lower_bound_notes: solverMeta.lower_bound_notes,
  }
}

export function computeClashReport(
  students: Record<string, Student>,
  courseSections: Record<string, Section[]>,
  slotAssignments: Record<string, number>,
): ClashReport {
  const sectionToCourse = new Map<string, string>()
  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      sectionToCourse.set(section.section_id, section.course_code)
    }
  }

  const studentSectionsMap = new Map<string, string[]>()

  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      for (const studentId of section.enrolled_students) {
        if (!studentSectionsMap.has(studentId)) studentSectionsMap.set(studentId, [])
        studentSectionsMap.get(studentId)!.push(section.section_id)
      }
    }
  }

  const reports: StudentClashReport[] = []
  let studentsWithClashes = 0

  for (const [studentId, student] of Object.entries(students)) {
    const sectionIds = studentSectionsMap.get(studentId) ?? []
    const daySections = new Map<number, string[]>()
    for (const sid of sectionIds) {
      const slot = slotAssignments[sid] ?? -1
      if (slot < 0) continue
      const day = slot
      if (!daySections.has(day)) daySections.set(day, [])
      daySections.get(day)!.push(sid)
    }

    const clashingPairs: [string, string][] = []
    const clashingDayIndices: number[] = []
    const pairKeys = new Set<string>()

    const sortedDayEntries = [...daySections.entries()].sort((a, b) => a[0] - b[0])
    for (const [day, sids] of sortedDayEntries) {
      if (sids.length > 1) {
        clashingDayIndices.push(day)
        const courseCodes = sids.map((id) => sectionToCourse.get(id) ?? id)
        for (let i = 0; i < courseCodes.length; i++) {
          for (let j = i + 1; j < courseCodes.length; j++) {
            let a = courseCodes[i]!
            let b = courseCodes[j]!
            if (a === b) continue
            if (a > b) [a, b] = [b, a]
            const key = `${a}\t${b}`
            if (pairKeys.has(key)) continue
            pairKeys.add(key)
            clashingPairs.push([a, b])
          }
        }
      }
    }

    const dayRank = new Map<DayName, number>(WEEKDAY_ORDER.map((d, i) => [d, i] as [DayName, number]))
    const clashing_days: DayName[] = [
      ...new Set(clashingDayIndices.map((d) => INDEX_TO_DAY[d]!).filter(Boolean)),
    ].sort((x, y) => (dayRank.get(x) ?? 99) - (dayRank.get(y) ?? 99))
    const clashing_day: DayName | null = clashing_days[0] ?? null

    const status = clashingPairs.length ? 'Red' : 'Green'
    if (status === 'Red') studentsWithClashes++

    reports.push({
      register_number: studentId,
      student_name: student.name,
      program: student.program,
      enrolled_courses: student.enrolled_courses,
      status,
      clashing_courses: clashingPairs,
      clashing_day,
      clashing_days: status === 'Red' ? clashing_days : [],
    })
  }

  reports.sort(
    (a, b) =>
      (a.status === 'Red' ? 0 : 1) - (b.status === 'Red' ? 0 : 1) ||
      a.register_number.localeCompare(b.register_number),
  )

  const total = reports.length
  return {
    total_students: total,
    students_with_clashes: studentsWithClashes,
    clash_free_students: total - studentsWithClashes,
    clash_percentage: total ? Math.round((studentsWithClashes / total) * 10000) / 100 : 0,
    reports,
  }
}

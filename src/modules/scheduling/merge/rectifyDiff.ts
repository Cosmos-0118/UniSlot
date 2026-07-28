import type { ClashReport, DayName, Section } from '../types'
import { slotIndexToDay } from '../solver/timeModel'

export type ClashEntry = {
  register_number: string
  student_name: string
  day: DayName
  courses: string[]
}

export type ClashDiff = {
  /** Clashes on a (student, weekday) pair that was not clashing in the previous run. */
  introduced: ClashEntry[]
  /** Clashes that already existed before the rectification. */
  carried_over: ClashEntry[]
  /** Previously clashing (student, weekday) pairs that are now clash-free. */
  resolved: ClashEntry[]
}

function clashKey(registerNumber: string, day: DayName): string {
  return `${registerNumber}\t${day}`
}

function toEntries(report: ClashReport): Map<string, ClashEntry> {
  const entries = new Map<string, ClashEntry>()
  for (const r of report.reports) {
    if (r.status !== 'Red') continue
    for (const day of r.clashing_days) {
      const courses = new Set<string>()
      for (const [a, b] of r.clashing_courses) {
        courses.add(a)
        courses.add(b)
      }
      entries.set(clashKey(r.register_number, day), {
        register_number: r.register_number,
        student_name: r.student_name,
        day,
        courses: [...courses].sort(),
      })
    }
  }
  return entries
}

/** Compare two clash reports so rectify can surface only what the change actually caused. */
export function diffClashReports(previous: ClashReport, next: ClashReport): ClashDiff {
  const before = toEntries(previous)
  const after = toEntries(next)

  const introduced: ClashEntry[] = []
  const carried_over: ClashEntry[] = []
  const resolved: ClashEntry[] = []

  for (const [key, entry] of after) {
    if (before.has(key)) carried_over.push(entry)
    else introduced.push(entry)
  }
  for (const [key, entry] of before) {
    if (!after.has(key)) resolved.push(entry)
  }

  const byStudent = (a: ClashEntry, b: ClashEntry) =>
    a.register_number.localeCompare(b.register_number) || a.day.localeCompare(b.day)

  return {
    introduced: introduced.sort(byStudent),
    carried_over: carried_over.sort(byStudent),
    resolved: resolved.sort(byStudent),
  }
}

export type SectionCountChange = {
  course_code: string
  before: number
  after: number
}

/** Courses whose split count changed because enrollment crossed a capacity threshold. */
export function diffSectionCounts(
  previous: Record<string, Section[]>,
  next: Record<string, Section[]>,
): SectionCountChange[] {
  const changes: SectionCountChange[] = []
  for (const [code, sections] of Object.entries(next)) {
    const before = previous[code]?.length ?? 0
    if (before === 0) continue
    if (before !== sections.length) {
      changes.push({ course_code: code, before, after: sections.length })
    }
  }
  return changes.sort((a, b) => a.course_code.localeCompare(b.course_code))
}

export type CoursePlacement = {
  course_code: string
  course_title: string
  slot_index: number
  day: DayName
  section_count: number
  enrollment: number
}

export function describePlacements(
  codes: string[],
  courseSections: Record<string, Section[]>,
  slotByCourse: Record<string, number>,
): CoursePlacement[] {
  const out: CoursePlacement[] = []
  for (const code of codes) {
    const sections = courseSections[code]
    const slot = slotByCourse[code]
    if (!sections?.length || slot === undefined) continue
    out.push({
      course_code: code,
      course_title: sections[0]!.course_title,
      slot_index: slot,
      day: slotIndexToDay(slot),
      section_count: sections.length,
      enrollment: sections.reduce((n, s) => n + s.enrolled_students.length, 0),
    })
  }
  return out.sort((a, b) => a.course_code.localeCompare(b.course_code))
}

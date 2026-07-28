import type { ConflictGraph, Section } from '../types'
import { computeClashWeight } from '../solver/conflictGraph'
import { sectionSlotsFromCourseSlots } from '../solver/cpsatInstance'
import { maxSlotIndexForCourse } from '../solver/timeModel'

export type PlaceFreeCoursesResult = {
  slot_by_course: Record<string, number>
  clash_weight: number
} | null

/**
 * Greedy weekday placement for new courses while respecting pinned weekdays and faculty.
 * Returns null when no feasible day exists (faculty blocked every weekday).
 */
export function placeFreeCourseWeekdays(
  freeCodes: string[],
  fixedDays: Record<string, number>,
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  allowSaturdayForMath: boolean,
): PlaceFreeCoursesResult | null {
  if (freeCodes.length === 0) {
    return { slot_by_course: { ...fixedDays }, clash_weight: 0 }
  }

  const facultyByCourse = new Map<string, string>()
  for (const [faculty, sectionIds] of Object.entries(facultyConstraints)) {
    for (const sid of sectionIds) {
      for (const secs of Object.values(courseSections)) {
        const sec = secs.find((s) => s.section_id === sid)
        if (sec) facultyByCourse.set(sec.course_code, faculty)
      }
    }
  }

  const assignment: Record<string, number> = { ...fixedDays }
  const facultyOnDay = new Map<string, Set<number>>()
  for (const [code, day] of Object.entries(fixedDays)) {
    const faculty = facultyByCourse.get(code)
    if (!faculty) continue
    if (!facultyOnDay.has(faculty)) facultyOnDay.set(faculty, new Set())
    facultyOnDay.get(faculty)!.add(day)
  }

  const remaining = new Set(freeCodes)
  const placeholderDay = 0

  for (const code of freeCodes) {
    const maxDay = maxSlotIndexForCourse(code, allowSaturdayForMath)
    const faculty = facultyByCourse.get(code)
    let bestDay = -1
    let bestCost = Infinity

    for (let d = 0; d <= maxDay; d++) {
      if (faculty && facultyOnDay.get(faculty)?.has(d)) continue

      const trial: Record<string, number> = { ...assignment }
      trial[code] = d
      for (const other of remaining) {
        if (other === code) continue
        if (!(other in trial)) trial[other] = placeholderDay
      }
      for (const [c, secs] of Object.entries(courseSections)) {
        if (!(c in trial)) trial[c] = placeholderDay
      }

      const slots = sectionSlotsFromCourseSlots(courseSections, trial)
      const cost = computeClashWeight(conflictGraph, slots)
      if (cost < bestCost) {
        bestCost = cost
        bestDay = d
      }
    }

    if (bestDay < 0) return null

    assignment[code] = bestDay
    remaining.delete(code)
    if (faculty) {
      if (!facultyOnDay.has(faculty)) facultyOnDay.set(faculty, new Set())
      facultyOnDay.get(faculty)!.add(bestDay)
    }
  }

  const finalSlots = sectionSlotsFromCourseSlots(courseSections, assignment)
  return {
    slot_by_course: assignment,
    clash_weight: computeClashWeight(conflictGraph, finalSlots),
  }
}

export function explainFacultyBlocking(
  freeCodes: string[],
  fixedDays: Record<string, number>,
  courseSections: Record<string, Section[]>,
  facultyConstraints: Record<string, string[]>,
  allowSaturdayForMath: boolean,
): string[] {
  const facultyByCourse = new Map<string, string>()
  for (const [faculty, sectionIds] of Object.entries(facultyConstraints)) {
    for (const sid of sectionIds) {
      for (const secs of Object.values(courseSections)) {
        const sec = secs.find((s) => s.section_id === sid)
        if (sec) facultyByCourse.set(sec.course_code, faculty)
      }
    }
  }
  const facultyOnDay = new Map<string, Set<number>>()
  for (const [code, day] of Object.entries(fixedDays)) {
    const faculty = facultyByCourse.get(code)
    if (!faculty) continue
    if (!facultyOnDay.has(faculty)) facultyOnDay.set(faculty, new Set())
    facultyOnDay.get(faculty)!.add(day)
  }

  const notes: string[] = []
  for (const code of freeCodes) {
    const faculty = facultyByCourse.get(code)
    if (!faculty) continue
    const maxDay = maxSlotIndexForCourse(code, allowSaturdayForMath)
    const blocked = facultyOnDay.get(faculty) ?? new Set()
    const feasible = []
    for (let d = 0; d <= maxDay; d++) {
      if (!blocked.has(d)) feasible.push(d)
    }
    if (feasible.length === 0) {
      notes.push(
        `Course ${code}: faculty "${faculty}" already teaches on every feasible weekday (Mon–Fri blocked).`,
      )
    }
  }
  return notes
}

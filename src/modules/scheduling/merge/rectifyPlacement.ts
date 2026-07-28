import type { ConflictGraph, Section } from '../types'
import { computeClashWeight } from '../solver/conflictGraph'
import { sectionSlotsFromCourseSlots } from '../solver/cpsatInstance'
import {
  activeWeekdayCount,
  isMathCourse,
  maxSlotIndexForCourse,
  SATURDAY_SLOT_INDEX,
  slotIndexToDay,
} from '../solver/timeModel'

/** course_code -> faculty label, built once from the faculty map. */
export function buildFacultyByCourse(
  courseSections: Record<string, Section[]>,
  facultyConstraints: Record<string, string[]>,
): Map<string, string> {
  const courseBySection = new Map<string, string>()
  for (const sections of Object.values(courseSections)) {
    for (const sec of sections) courseBySection.set(sec.section_id, sec.course_code)
  }
  const facultyByCourse = new Map<string, string>()
  for (const [faculty, sectionIds] of Object.entries(facultyConstraints)) {
    for (const sid of sectionIds) {
      const code = courseBySection.get(sid)
      if (code) facultyByCourse.set(code, faculty)
    }
  }
  return facultyByCourse
}

function facultyDaysFromPinned(
  fixedDays: Record<string, number>,
  facultyByCourse: Map<string, string>,
): Map<string, Set<number>> {
  const facultyOnDay = new Map<string, Set<number>>()
  for (const [code, day] of Object.entries(fixedDays)) {
    const faculty = facultyByCourse.get(code)
    if (!faculty) continue
    if (!facultyOnDay.has(faculty)) facultyOnDay.set(faculty, new Set())
    facultyOnDay.get(faculty)!.add(day)
  }
  return facultyOnDay
}

export type RectifyPreflight = {
  ok: boolean
  /** Reasons the pinned model can never be satisfied — reported instead of a solver crash. */
  blockers: string[]
}

/**
 * Validates the pinned model before spawning CP-SAT so infeasibility is explained precisely
 * rather than surfacing as a non-zero solver exit.
 */
export function preflightRectify(args: {
  fixedDays: Record<string, number>
  freeCourses: string[]
  courseSections: Record<string, Section[]>
  facultyConstraints: Record<string, string[]>
  allowSaturdayForMath: boolean
}): RectifyPreflight {
  const { fixedDays, freeCourses, courseSections, facultyConstraints, allowSaturdayForMath } = args
  const blockers: string[] = []
  const weekdays = activeWeekdayCount(allowSaturdayForMath)
  const facultyByCourse = buildFacultyByCourse(courseSections, facultyConstraints)

  for (const [code, day] of Object.entries(fixedDays)) {
    if (!Number.isInteger(day) || day < 0 || day >= weekdays) {
      blockers.push(
        `Course ${code} is pinned to slot ${day}, outside the ${weekdays} active weekday(s)` +
          (day === SATURDAY_SLOT_INDEX && !allowSaturdayForMath
            ? ' — the previous run used Saturday but Saturday is now blocked.'
            : '.'),
      )
      continue
    }
    if (day === SATURDAY_SLOT_INDEX && !isMathCourse(code)) {
      blockers.push(
        `Course ${code} is pinned to Saturday but is not a mathematics course; Saturday is maths-only.`,
      )
    }
  }

  const pinnedByFacultyDay = new Map<string, string>()
  for (const [code, day] of Object.entries(fixedDays)) {
    const faculty = facultyByCourse.get(code)
    if (!faculty) continue
    const key = `${faculty}\t${day}`
    const prev = pinnedByFacultyDay.get(key)
    if (prev !== undefined && prev !== code) {
      blockers.push(
        `Faculty "${faculty}" is pinned to ${slotIndexToDay(day)} for both ${prev} and ${code}.`,
      )
    } else {
      pinnedByFacultyDay.set(key, code)
    }
  }

  const facultyOnDay = facultyDaysFromPinned(fixedDays, facultyByCourse)
  for (const code of freeCourses) {
    const maxDay = Math.min(maxSlotIndexForCourse(code, allowSaturdayForMath), weekdays - 1)
    if (maxDay < 0) {
      blockers.push(`Course ${code} has no available weekday under the current Saturday policy.`)
      continue
    }
    const faculty = facultyByCourse.get(code)
    if (!faculty) continue
    const blocked = facultyOnDay.get(faculty) ?? new Set<number>()
    let feasibleDays = 0
    for (let d = 0; d <= maxDay; d++) {
      if (!blocked.has(d)) feasibleDays++
    }
    if (feasibleDays === 0) {
      blockers.push(
        `Course ${code}: faculty "${faculty}" already teaches on every available weekday, so it cannot be placed without moving an existing course.`,
      )
    }
  }

  return { ok: blockers.length === 0, blockers }
}

export type PlaceFreeCoursesResult = {
  slot_by_course: Record<string, number>
  clash_weight: number
}

/**
 * Last-resort weekday placement for new courses when CP-SAT is unavailable or returns nothing.
 * Minimizes clash weight only, so it does not preserve weekday balance the way CP-SAT does.
 * Returns null when no feasible day exists for a course.
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

  const weekdays = activeWeekdayCount(allowSaturdayForMath)
  const facultyByCourse = buildFacultyByCourse(courseSections, facultyConstraints)
  const facultyOnDay = facultyDaysFromPinned(fixedDays, facultyByCourse)

  const assignment: Record<string, number> = { ...fixedDays }
  // Score only against courses that already have a day so unplaced peers cannot skew the cost.
  const placedSections: Record<string, Section[]> = {}
  for (const [code, secs] of Object.entries(courseSections)) {
    if (code in assignment) placedSections[code] = secs
  }

  for (const code of freeCodes) {
    const maxDay = Math.min(maxSlotIndexForCourse(code, allowSaturdayForMath), weekdays - 1)
    const faculty = facultyByCourse.get(code)
    const sections = courseSections[code]
    if (!sections) continue

    let bestDay = -1
    let bestCost = Infinity

    for (let d = 0; d <= maxDay; d++) {
      if (faculty && facultyOnDay.get(faculty)?.has(d)) continue

      const trial = { ...assignment, [code]: d }
      const trialSections = { ...placedSections, [code]: sections }
      const slots = sectionSlotsFromCourseSlots(trialSections, trial)
      const cost = computeClashWeight(conflictGraph, slots)
      if (cost < bestCost) {
        bestCost = cost
        bestDay = d
      }
    }

    if (bestDay < 0) return null

    assignment[code] = bestDay
    placedSections[code] = sections
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

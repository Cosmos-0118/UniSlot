import type { Section } from '../types'
import { SATURDAY_SLOT_INDEX, TOTAL_WEEKLY_SLOTS, isMathCourse, slotIndexToDay } from './timeModel'

/**
 * Parallel load is a soft comfort target (~11), not a hard fence.
 * Returns total section count so callers that still pass a "cap" never block clash-reducing moves.
 */
export function parallelHardCap(totalSections: number): number {
  return totalSections
}

/** True iff no faculty teaches two sections in the same slot. */
export function facultySlotsFeasible(
  sections: Section[],
  slotByCourse: Record<string, number>,
): boolean {
  const keyToSection = new Map<string, string>()
  for (const sec of sections) {
    if (!sec.faculty) continue
    const slot = slotByCourse[sec.course_code] ?? 0
    const key = `${sec.faculty}\t${slot}`
    const prev = keyToSection.get(key)
    if (prev !== undefined && prev !== sec.section_id) return false
    keyToSection.set(key, sec.section_id)
  }
  return true
}

/**
 * Post-solve audit for Constraints.md hard rules (bundle weekday, faculty, capacity, range, Saturday maths).
 * Student same-day overlaps are reported here for diagnostics; clash weight remains the soft primary objective.
 */
export function auditScheduleHardConstraints(
  courseSections: Record<string, Section[]>,
  slotAssignments: Record<string, number>,
  _parallelCap: number,
  facultyConstraints: Record<string, string[]>,
  options?: { allowSaturdayForMath?: boolean },
): { feasible: boolean; violations: string[] } {
  const allowSaturdayForMath = options?.allowSaturdayForMath !== false
  const violations: string[] = []
  const sections = Object.values(courseSections).flat()

  for (const [code, secs] of Object.entries(courseSections)) {
    if (secs.length <= 1) continue
    const slots = new Set(secs.map((s) => slotAssignments[s.section_id] ?? -1))
    if (slots.size > 1) {
      violations.push(
        `Course ${code}: split sections must share one slot; found ${[...slots].join(', ')}`,
      )
    }
  }

  for (const sec of sections) {
    const sl = slotAssignments[sec.section_id]
    if (sl === undefined || sl < 0 || sl >= TOTAL_WEEKLY_SLOTS) {
      violations.push(`Section ${sec.section_id}: invalid slot ${String(sl)}`)
    }
    if (sec.enrolled_students.length > sec.capacity) {
      violations.push(
        `Section ${sec.section_id}: enrollment ${sec.enrolled_students.length} > capacity ${sec.capacity}`,
      )
    }
  }

  const studentDayCourses = new Map<string, Map<number, Set<string>>>()
  for (const sec of sections) {
    const slot = slotAssignments[sec.section_id]
    if (slot === undefined || slot < 0 || slot >= TOTAL_WEEKLY_SLOTS) continue
    const day = slot
    for (const studentId of sec.enrolled_students) {
      if (!studentDayCourses.has(studentId)) studentDayCourses.set(studentId, new Map())
      const coursesByDay = studentDayCourses.get(studentId)!
      if (!coursesByDay.has(day)) coursesByDay.set(day, new Set())
      coursesByDay.get(day)!.add(sec.course_code)
    }
  }
  for (const [studentId, coursesByDay] of studentDayCourses) {
    for (const [day, courses] of coursesByDay) {
      if (courses.size > 1) {
        violations.push(
          `Student ${studentId}: ${[...courses].sort().join(', ')} scheduled on ${slotIndexToDay(day)}; maximum one course per weekday`,
        )
      }
    }
  }

  const slotByCourse: Record<string, number> = {}
  for (const sec of sections) {
    slotByCourse[sec.course_code] = slotAssignments[sec.section_id] ?? 0
  }
  if (!facultySlotsFeasible(sections, slotByCourse)) {
    violations.push('Faculty overlap: same faculty in multiple sections on one weekday')
  }

  for (const [code, slot] of Object.entries(slotByCourse)) {
    if (slot !== SATURDAY_SLOT_INDEX) continue
    if (!allowSaturdayForMath) {
      violations.push(
        `Course ${code}: assigned to Saturday (slot ${SATURDAY_SLOT_INDEX}); Saturday is temporarily blocked`,
      )
    } else if (!isMathCourse(code)) {
      violations.push(
        `Course ${code}: non-mathematics course assigned to Saturday (slot ${SATURDAY_SLOT_INDEX}); Saturday is reserved for mathematics courses`,
      )
    }
  }

  for (const [facLabel, secIds] of Object.entries(facultyConstraints)) {
    for (const id of secIds) {
      const sec = sections.find((x) => x.section_id === id)
      if (!sec) violations.push(`Faculty map references unknown section ${id}`)
      else if (sec.faculty !== facLabel) {
        violations.push(
          `Faculty map mismatch for ${id}: map "${facLabel}" vs section "${sec.faculty ?? ''}"`,
        )
      }
    }
  }

  return { feasible: violations.length === 0, violations }
}

import type { EnrollmentRow, Section, Student } from '../types'

/** Serializable state needed to attach late registrations without re-solving slots. */
export type SchedulingSnapshot = {
  slot_assignments: Record<string, number>
  courseSections: Record<string, Section[]>
  students: Record<string, Student>
  enrollmentRows: EnrollmentRow[]
  /** Real faculty names keyed by section_id (applied onto sections after solve). */
  facultyOverrides?: Record<string, string>
}

export function cloneStudents(students: Record<string, Student>): Record<string, Student> {
  const out: Record<string, Student> = {}
  for (const [k, v] of Object.entries(students)) {
    out[k] = { ...v, enrolled_courses: [...v.enrolled_courses] }
  }
  return out
}

export function deepCloneCourseSections(cs: Record<string, Section[]>): Record<string, Section[]> {
  const out: Record<string, Section[]> = {}
  for (const [k, arr] of Object.entries(cs)) {
    out[k] = arr.map((s) => ({
      ...s,
      enrolled_students: [...s.enrolled_students],
      programs: [...s.programs],
    }))
  }
  return out
}

export function cloneSchedulingSnapshot(s: SchedulingSnapshot): SchedulingSnapshot {
  return {
    slot_assignments: { ...s.slot_assignments },
    courseSections: deepCloneCourseSections(s.courseSections),
    students: cloneStudents(s.students),
    enrollmentRows: s.enrollmentRows.map((r) => ({ ...r })),
    facultyOverrides: s.facultyOverrides ? { ...s.facultyOverrides } : undefined,
  }
}

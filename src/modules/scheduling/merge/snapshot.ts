import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { EnrollmentRow, Section, Student } from '../types'
import { legacySlotToWeekday } from '../solver/timeModel'

export const WEEKDAY_SLOT_MODEL = 'weekday-v2'

/** Serializable state needed to attach late registrations without re-solving slots. */
export type SchedulingSnapshot = {
  /** Absent on saved runs created before weekdays replaced intra-day time bands. */
  slot_model?: typeof WEEKDAY_SLOT_MODEL
  slot_assignments: Record<string, number>
  courseSections: Record<string, Section[]>
  students: Record<string, Student>
  enrollmentRows: EnrollmentRow[]
  /** Real faculty names keyed by section_id (applied onto sections after solve). */
  facultyOverrides?: Record<string, string>
  /** Run seed for reproducing solver + export bytes. */
  seed?: number
  /** CP-SAT workers used for this run (match on rerun for reproducibility). */
  workers?: number
  /** Portfolio race size used (0 = off). */
  portfolio?: number
  /** Whether Saturday evening was available for maths courses in this run. */
  allowSaturdayForMath?: boolean
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
  const legacy = s.slot_model !== WEEKDAY_SLOT_MODEL
  const slotAssignments: Record<string, number> = {}
  for (const [sectionId, slot] of Object.entries(s.slot_assignments)) {
    slotAssignments[sectionId] = legacy ? legacySlotToWeekday(slot) : slot
  }
  return {
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: slotAssignments,
    courseSections: deepCloneCourseSections(s.courseSections),
    students: cloneStudents(s.students),
    enrollmentRows: s.enrollmentRows.map((r) => ({ ...r })),
    facultyOverrides: s.facultyOverrides ? { ...s.facultyOverrides } : undefined,
    seed: s.seed,
    workers: s.workers,
    portfolio: s.portfolio,
    allowSaturdayForMath: s.allowSaturdayForMath,
  }
}

/** Load and clone a snapshot from a directory (snapshot.json) or direct file path. */
export async function loadSchedulingSnapshot(dirOrPath: string): Promise<SchedulingSnapshot> {
  const direct = dirOrPath.endsWith('.json') ? dirOrPath : path.join(dirOrPath, 'snapshot.json')
  const raw = await readFile(direct, 'utf8')
  const parsed = JSON.parse(raw) as SchedulingSnapshot
  if (!parsed.slot_assignments || !parsed.courseSections) {
    throw new Error(`Invalid snapshot at ${direct}: missing slot_assignments or courseSections`)
  }
  return cloneSchedulingSnapshot(parsed)
}

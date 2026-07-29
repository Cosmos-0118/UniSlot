import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { EnrollmentRow, Section, Student } from '../types'
import { legacySlotToWeekday } from '../solver/timeModel'
import {
  cloneClashProvenance,
  type ClashProvenanceMap,
} from './clashProvenance'
import { cloneRunLog, type RunLogEntry } from './runLog'

export const WEEKDAY_SLOT_MODEL = 'weekday-v2'

export type LateEnrollmentRecord = {
  register_number: string
  course_code: string
  batch: number
  section_id?: string
}

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
  /** OR-Tools version used for this run (match on rerun for cross-device repro). */
  ortools_version?: string
  /** Python version used for this run (match on rerun for cross-device repro). */
  python_version?: string
  /** Whether Saturday evening was available for maths courses in this run. */
  allowSaturdayForMath?: boolean
  /** Accumulated late enrollments across batches. */
  late_enrollments?: LateEnrollmentRecord[]
  /** Append-only run trail (solve → rectify/late…). */
  run_log?: RunLogEntry[]
  /** Clash origins keyed by register_number\\tday. */
  clash_provenance?: ClashProvenanceMap
  /** Parallel lane numbers keyed by section_id (stable across late/rectify). */
  section_lanes?: Record<string, number>
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
    ortools_version: s.ortools_version,
    python_version: s.python_version,
    allowSaturdayForMath: s.allowSaturdayForMath,
    late_enrollments: s.late_enrollments?.map((r) => ({ ...r })),
    run_log: cloneRunLog(s.run_log),
    clash_provenance: cloneClashProvenance(s.clash_provenance),
    section_lanes: s.section_lanes ? { ...s.section_lanes } : undefined,
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

/** Extract parallel lane numbers from a schedule's entries. */
export function sectionLanesFromEntries(
  entries: { section_id: string; slot_band: number }[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of entries) out[e.section_id] = e.slot_band
  return out
}

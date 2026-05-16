import { auditScheduleHardConstraints, parallelHardCap } from './scheduler'
import { buildSchedule } from './engines/scheduleOutput'
import { extractFacultyConstraints } from './preprocessing'
import { cloneSchedulingSnapshot, type SchedulingSnapshot } from './schedulingSnapshot'
import type { Schedule, Section } from './types'

export const PLANNING_FACULTY_PREFIX = 'Planning:'

/** True when the label is empty or a synthetic planning placeholder from {@link applyDistinctFacultyPerSection}. */
export function isPlanningFacultyLabel(faculty: string | null | undefined): boolean {
  const s = faculty?.trim()
  if (!s) return true
  return s.startsWith(PLANNING_FACULTY_PREFIX)
}

export function countPlanningFacultySections(courseSections: Record<string, Section[]>): number {
  let n = 0
  for (const secs of Object.values(courseSections)) {
    for (const s of secs) {
      if (isPlanningFacultyLabel(s.faculty)) n++
    }
  }
  return n
}

export type FacultyMappingRow = {
  section_id: string
  course_code: string
  section_number: number
  daySlotLabel: string
  current_faculty: string
  slot_index: number
}

export function listFacultyMappingRows(snapshot: SchedulingSnapshot): FacultyMappingRow[] {
  const rows: FacultyMappingRow[] = []
  for (const secs of Object.values(snapshot.courseSections)) {
    for (const sec of secs) {
      if (!isPlanningFacultyLabel(sec.faculty)) continue
      const slot = snapshot.slot_assignments[sec.section_id] ?? 0
      rows.push({
        section_id: sec.section_id,
        course_code: sec.course_code,
        section_number: sec.section_number,
        daySlotLabel: `slot ${slot}`,
        current_faculty: sec.faculty ?? '',
        slot_index: slot,
      })
    }
  }
  return rows.sort(
    (a, b) =>
      a.slot_index - b.slot_index ||
      a.course_code.localeCompare(b.course_code) ||
      a.section_number - b.section_number,
  )
}

export function applyFacultyOverridesToSnapshot(
  snapshot: SchedulingSnapshot,
  newOverrides: Record<string, string>,
): SchedulingSnapshot {
  const next = cloneSchedulingSnapshot(snapshot)
  const merged: Record<string, string> = { ...(next.facultyOverrides ?? {}) }
  for (const [id, name] of Object.entries(newOverrides)) {
    const trimmed = name.trim()
    if (!trimmed) continue
    merged[id] = trimmed
  }
  next.facultyOverrides = merged
  for (const arr of Object.values(next.courseSections)) {
    for (const sec of arr) {
      const assigned = merged[sec.section_id]
      if (assigned) sec.faculty = assigned
    }
  }
  return next
}

export function auditSnapshotSchedule(snapshot: SchedulingSnapshot): {
  feasible: boolean
  violations: string[]
} {
  const flat = Object.values(snapshot.courseSections).flat()
  const facultyConstraints = extractFacultyConstraints(snapshot.courseSections)
  return auditScheduleHardConstraints(
    snapshot.courseSections,
    snapshot.slot_assignments,
    parallelHardCap(flat.length),
    facultyConstraints,
  )
}

export function buildScheduleFromSnapshot(
  snapshot: SchedulingSnapshot,
  solverUsed = 'faculty-reconciled',
): {
  schedule: Schedule
  audit: { feasible: boolean; violations: string[] }
  planningCount: number
} {
  const audit = auditSnapshotSchedule(snapshot)
  const schedule = buildSchedule(snapshot.courseSections, snapshot.slot_assignments, {
    solver_used: solverUsed,
    solver_time_seconds: 0,
    hard_constraints_feasible: audit.feasible,
    hard_constraint_violations: audit.violations,
    solver_primary_metrics_zero: false,
  })
  return {
    schedule,
    audit,
    planningCount: countPlanningFacultySections(snapshot.courseSections),
  }
}

export type ParseFacultyMappingResult = {
  overrides: Record<string, string>
  errors: string[]
  warnings: string[]
}

/** Parse CSV/TSV: section_id + faculty name (header row optional). */
export function parseFacultyMappingTable(text: string): ParseFacultyMappingResult {
  const errors: string[] = []
  const warnings: string[] = []
  const overrides: Record<string, string> = {}
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) {
    return { overrides, errors: ['No rows found.'], warnings }
  }

  let start = 0
  const firstCells = splitRow(lines[0]!)
  const headerLike =
    firstCells.length >= 2 &&
    /section|sec.*id|id/i.test(firstCells[0]!) &&
    /faculty|instructor|name|teacher/i.test(firstCells[1]!)
  if (headerLike) start = 1

  const knownIds = new Set<string>()

  for (let i = start; i < lines.length; i++) {
    const cells = splitRow(lines[i]!)
    if (cells.length < 2) {
      warnings.push(`Line ${i + 1}: skipped (need section_id and faculty name).`)
      continue
    }
    const sectionId = cells[0]!.trim()
    const faculty = cells.slice(1).join(' ').trim()
    if (!sectionId) {
      errors.push(`Line ${i + 1}: empty section_id.`)
      continue
    }
    if (!faculty) {
      warnings.push(`Line ${i + 1}: empty faculty for ${sectionId}.`)
      continue
    }
    if (isPlanningFacultyLabel(faculty)) {
      warnings.push(`Line ${i + 1}: "${faculty}" looks like a planning placeholder; use a real name.`)
    }
    overrides[sectionId] = faculty
    knownIds.add(sectionId)
  }

  if (!knownIds.size && !errors.length) {
    errors.push('No valid section_id → faculty rows parsed.')
  }

  return { overrides, errors, warnings }
}

function splitRow(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim())
  if (line.includes(',')) return line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
  return line.split(/\s{2,}/).map((c) => c.trim())
}

export function facultyMappingTemplateCsv(snapshot: SchedulingSnapshot): string {
  const rows = listFacultyMappingRows(snapshot)
  const header = 'section_id,faculty_name'
  const body = rows.map((r) => `${r.section_id},`)
  return [header, ...body].join('\n')
}

/** Apply overrides and validate section ids exist in snapshot. */
export function applyAndValidateFacultyMapping(
  snapshot: SchedulingSnapshot,
  overrides: Record<string, string>,
): {
  snapshot: SchedulingSnapshot
  schedule: Schedule
  audit: { feasible: boolean; violations: string[] }
  planningCount: number
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []
  const allIds = new Set(
    Object.values(snapshot.courseSections)
      .flat()
      .map((s) => s.section_id),
  )
  for (const id of Object.keys(overrides)) {
    if (!allIds.has(id)) errors.push(`Unknown section_id: ${id}`)
  }
  if (errors.length) {
    const audit = auditSnapshotSchedule(snapshot)
    const { schedule } = buildScheduleFromSnapshot(snapshot)
    return {
      snapshot,
      schedule,
      audit,
      planningCount: countPlanningFacultySections(snapshot.courseSections),
      errors,
      warnings,
    }
  }
  const next = applyFacultyOverridesToSnapshot(snapshot, overrides)
  const built = buildScheduleFromSnapshot(next)
  const remaining = built.planningCount
  if (remaining > 0) {
    warnings.push(
      `${remaining} section(s) still use planning placeholders. Assign all listed sections before treating the timetable as faculty-certified.`,
    )
  }
  if (!built.audit.feasible) {
    warnings.push(
      'Hard-constraint audit failed after applying faculty names. Resolve violations before publishing (e.g. faculty double-booking in the same slot).',
    )
  }
  return {
    snapshot: next,
    schedule: built.schedule,
    audit: built.audit,
    planningCount: remaining,
    errors,
    warnings,
  }
}

export function snapshotWithAppliedOverrides(snapshot: SchedulingSnapshot): SchedulingSnapshot {
  if (!snapshot.facultyOverrides || !Object.keys(snapshot.facultyOverrides).length) {
    return snapshot
  }
  const next = cloneSchedulingSnapshot(snapshot)
  for (const arr of Object.values(next.courseSections)) {
    for (const sec of arr) {
      const assigned = next.facultyOverrides?.[sec.section_id]
      if (assigned) sec.faculty = assigned
    }
  }
  return next
}

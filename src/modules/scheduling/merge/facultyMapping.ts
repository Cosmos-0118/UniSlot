import {
  auditScheduleHardConstraints,
  parallelHardCap,
  tryRepairFacultyBundleOverlaps,
} from '../solver/scheduler'
import { createRng } from '../solver/rng'
import { buildSchedule } from '../solver/scheduleOutput'
import { INDEX_TO_DAY } from '../solver/timeModel'
import { extractFacultyConstraints } from '../preprocess/preprocessing'
import { cloneSchedulingSnapshot, type SchedulingSnapshot } from './snapshot'
import type { Schedule, Section } from '../types'

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
  const normalized = cloneSchedulingSnapshot(snapshot)
  const rows: FacultyMappingRow[] = []
  for (const secs of Object.values(normalized.courseSections)) {
    for (const sec of secs) {
      if (!isPlanningFacultyLabel(sec.faculty)) continue
      const slot = normalized.slot_assignments[sec.section_id] ?? 0
      rows.push({
        section_id: sec.section_id,
        course_code: sec.course_code,
        section_number: sec.section_number,
        daySlotLabel: INDEX_TO_DAY[slot] ?? `weekday ${slot}`,
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
  const normalized = cloneSchedulingSnapshot(snapshot)
  const flat = Object.values(normalized.courseSections).flat()
  const facultyConstraints = extractFacultyConstraints(normalized.courseSections)
  return auditScheduleHardConstraints(
    normalized.courseSections,
    normalized.slot_assignments,
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
  const normalized = cloneSchedulingSnapshot(snapshot)
  const audit = auditSnapshotSchedule(normalized)
  const schedule = buildSchedule(normalized.courseSections, normalized.slot_assignments, {
    solver_used: solverUsed,
    solver_time_seconds: 0,
    hard_constraints_feasible: audit.feasible,
    hard_constraint_violations: audit.violations,
    solver_primary_metrics_zero: false,
  })
  return {
    schedule,
    audit,
    planningCount: countPlanningFacultySections(normalized.courseSections),
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

/**
 * When faculty remapping creates same-weekday double-booking, try minimal course-bundle
 * moves to clear collisions while keeping Saturday maths-only. Updates slot_assignments
 * on the snapshot when repair succeeds.
 */
export function repairFacultyCollisionsInSnapshot(
  snapshot: SchedulingSnapshot,
  options?: { maxIterations?: number; randomSeed?: number },
): {
  snapshot: SchedulingSnapshot
  repaired: boolean
  audit: { feasible: boolean; violations: string[] }
} {
  const next = cloneSchedulingSnapshot(snapshot)
  const sections = Object.values(next.courseSections).flat()
  const courseCodes = Object.keys(next.courseSections)
  const sectionCountByCourse = new Map<string, number>()
  for (const c of courseCodes) {
    sectionCountByCourse.set(c, next.courseSections[c]!.length)
  }

  const slotByCourse: Record<string, number> = {}
  for (const sec of sections) {
    slotByCourse[sec.course_code] = next.slot_assignments[sec.section_id] ?? 0
  }

  const rng = createRng(options?.randomSeed)
  const fixed = tryRepairFacultyBundleOverlaps(
    courseCodes,
    sections,
    slotByCourse,
    sectionCountByCourse,
    rng,
    options?.maxIterations ?? 800,
  )

  if (!fixed) {
    return { snapshot: next, repaired: false, audit: auditSnapshotSchedule(next) }
  }

  for (const sec of sections) {
    next.slot_assignments[sec.section_id] = fixed[sec.course_code] ?? 0
  }
  const audit = auditSnapshotSchedule(next)
  return { snapshot: next, repaired: audit.feasible, audit }
}

/** Apply overrides and validate section ids exist in snapshot. */
export function applyAndValidateFacultyMapping(
  snapshot: SchedulingSnapshot,
  overrides: Record<string, string>,
  options?: { autoRepairSlots?: boolean },
): {
  snapshot: SchedulingSnapshot
  schedule: Schedule
  audit: { feasible: boolean; violations: string[] }
  planningCount: number
  errors: string[]
  warnings: string[]
  repairedSlots?: boolean
} {
  const errors: string[] = []
  const warnings: string[] = []
  const autoRepair = options?.autoRepairSlots !== false
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
  let next = applyFacultyOverridesToSnapshot(snapshot, overrides)
  let built = buildScheduleFromSnapshot(next)
  let repairedSlots = false

  if (!built.audit.feasible && autoRepair) {
    const facultyFail = built.audit.violations.some((v) => /faculty overlap/i.test(v))
    if (facultyFail) {
      const repaired = repairFacultyCollisionsInSnapshot(next)
      if (repaired.repaired) {
        next = repaired.snapshot
        built = buildScheduleFromSnapshot(next)
        repairedSlots = true
        warnings.push(
          'Faculty double-booking was cleared by moving one or more course bundles to another weekday (minimal repair). Review the updated timetable before publishing.',
        )
      }
    }
  }

  const remaining = built.planningCount
  if (remaining > 0) {
    warnings.push(
      `${remaining} section(s) still use planning placeholders. Assign all listed sections before treating the timetable as faculty-certified.`,
    )
  }
  if (!built.audit.feasible) {
    warnings.push(
      'Hard-constraint audit failed after applying faculty names. Resolve violations before publishing (e.g. faculty double-booking on the same weekday).',
    )
  }
  return {
    snapshot: next,
    schedule: built.schedule,
    audit: built.audit,
    planningCount: remaining,
    errors,
    warnings,
    repairedSlots,
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

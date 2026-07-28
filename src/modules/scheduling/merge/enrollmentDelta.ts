import type { EnrollmentRow } from '../types'
import { isMathCourse, SATURDAY_SLOT_INDEX } from '../solver/timeModel'
import type { SchedulingSnapshot } from './snapshot'

export type StudentEnrollmentChange = {
  register_number: string
  student_name: string
  before: string[]
  after: string[]
  added: string[]
  dropped: string[]
}

export type EnrollmentDelta = {
  changed_students: StudentEnrollmentChange[]
  new_course_codes: string[]
  removed_course_codes: string[]
}

function enrollmentKey(row: EnrollmentRow): string {
  return `${row.register_number}:${row.course_code}`
}

function coursesByStudent(rows: EnrollmentRow[]): Map<string, { name: string; courses: Set<string> }> {
  const map = new Map<string, { name: string; courses: Set<string> }>()
  for (const row of rows) {
    if (!row.register_number || !row.course_code) continue
    let entry = map.get(row.register_number)
    if (!entry) {
      entry = { name: row.student_name || row.register_number, courses: new Set() }
      map.set(row.register_number, entry)
    }
    entry.courses.add(row.course_code)
    if (row.student_name) entry.name = row.student_name
  }
  return map
}

function courseCodesFromRows(rows: EnrollmentRow[]): Set<string> {
  const codes = new Set<string>()
  for (const row of rows) {
    if (row.course_code) codes.add(row.course_code)
  }
  return codes
}

/** Compare baseline vs rectified enrollment rows. */
export function computeEnrollmentDelta(
  oldRows: EnrollmentRow[],
  newRows: EnrollmentRow[],
): EnrollmentDelta {
  const oldByStudent = coursesByStudent(oldRows)
  const newByStudent = coursesByStudent(newRows)
  const allStudents = new Set([...oldByStudent.keys(), ...newByStudent.keys()])

  const changed_students: StudentEnrollmentChange[] = []
  for (const reg of [...allStudents].sort()) {
    const before = [...(oldByStudent.get(reg)?.courses ?? [])].sort()
    const after = [...(newByStudent.get(reg)?.courses ?? [])].sort()
    const beforeSet = new Set(before)
    const afterSet = new Set(after)
    const added = after.filter((c) => !beforeSet.has(c))
    const dropped = before.filter((c) => !afterSet.has(c))
    if (added.length === 0 && dropped.length === 0) continue
    changed_students.push({
      register_number: reg,
      student_name: newByStudent.get(reg)?.name ?? oldByStudent.get(reg)?.name ?? reg,
      before,
      after,
      added,
      dropped,
    })
  }

  const oldCourses = courseCodesFromRows(oldRows)
  const newCourses = courseCodesFromRows(newRows)
  const new_course_codes = [...newCourses].filter((c) => !oldCourses.has(c)).sort()
  const removed_course_codes = [...oldCourses].filter((c) => !newCourses.has(c)).sort()

  return { changed_students, new_course_codes, removed_course_codes }
}

/** Derive course→weekday from section-level snapshot assignments. */
export function extractCourseSlotsFromSnapshot(snapshot: SchedulingSnapshot): Record<string, number> {
  const slotByCourse: Record<string, number> = {}
  for (const [sectionId, slot] of Object.entries(snapshot.slot_assignments)) {
    const sections = Object.values(snapshot.courseSections).flat()
    const sec = sections.find((s) => s.section_id === sectionId)
    if (sec) slotByCourse[sec.course_code] = slot
  }
  // Fallback: parse section_id as course code for single-section courses
  for (const [code, secs] of Object.entries(snapshot.courseSections)) {
    if (code in slotByCourse) continue
    const first = secs[0]
    if (first && snapshot.slot_assignments[first.section_id] !== undefined) {
      slotByCourse[code] = snapshot.slot_assignments[first.section_id]!
    }
  }
  return slotByCourse
}

/** Infer Saturday-maths policy from snapshot metadata or slot usage. */
export function inferAllowSaturdayFromSnapshot(snapshot: SchedulingSnapshot): boolean {
  if (typeof snapshot.allowSaturdayForMath === 'boolean') {
    return snapshot.allowSaturdayForMath
  }
  const slotByCourse = extractCourseSlotsFromSnapshot(snapshot)
  for (const [code, slot] of Object.entries(slotByCourse)) {
    if (slot === SATURDAY_SLOT_INDEX && isMathCourse(code)) return true
  }
  return false
}

export type BaselineValidationWarning = {
  field: string
  message: string
}

/** Soft checks that baseline enrollment matches snapshot rows (warn only). */
export function validateBaselineMatchesSnapshot(
  oldRows: EnrollmentRow[],
  snapshot: SchedulingSnapshot,
): BaselineValidationWarning[] {
  const warnings: BaselineValidationWarning[] = []
  const snapshotKeys = new Set(snapshot.enrollmentRows.map(enrollmentKey))
  const baselineKeys = new Set(oldRows.map(enrollmentKey))

  if (snapshotKeys.size !== baselineKeys.size) {
    warnings.push({
      field: 'row_count',
      message: `Baseline workbook has ${baselineKeys.size} registration row(s); snapshot has ${snapshotKeys.size}.`,
    })
  }

  let mismatch = 0
  for (const key of baselineKeys) {
    if (!snapshotKeys.has(key)) mismatch++
  }
  if (mismatch > 0) {
    warnings.push({
      field: 'registrations',
      message: `${mismatch} baseline registration row(s) not found in snapshot.enrollmentRows.`,
    })
  }

  return warnings
}

/** Courses in snapshot that still appear in new enrollment — pin their weekdays. */
export function buildFixedDays(
  snapshot: SchedulingSnapshot,
  newCourseCodes: Set<string>,
): Record<string, number> {
  const pinned = extractCourseSlotsFromSnapshot(snapshot)
  const fixed: Record<string, number> = {}
  for (const code of newCourseCodes) {
    if (code in pinned) fixed[code] = pinned[code]!
  }
  return fixed
}

/** Course codes in new enrollment without a pinned slot from the prior run. */
export function freeCourseCodes(
  newCourseCodes: Set<string>,
  fixedDays: Record<string, number>,
): string[] {
  return [...newCourseCodes].filter((c) => !(c in fixedDays)).sort()
}

/** Human-readable summary for CLI preview before rectify runs. */
export function formatEnrollmentDeltaSummary(
  delta: EnrollmentDelta,
  freeCourses: string[],
  pinnedCount: number,
): string {
  const lines: string[] = []
  lines.push(
    `${delta.changed_students.length} student(s) changed · ${pinnedCount} course weekday(s) pinned`,
  )
  if (delta.new_course_codes.length > 0) {
    lines.push(`New courses (${delta.new_course_codes.length}): ${delta.new_course_codes.join(', ')}`)
  }
  if (delta.removed_course_codes.length > 0) {
    lines.push(
      `Removed courses (${delta.removed_course_codes.length}): ${delta.removed_course_codes.join(', ')}`,
    )
  }
  if (freeCourses.length > 0) {
    lines.push(`Need weekday assignment: ${freeCourses.join(', ')}`)
  } else {
    lines.push('No new course codes — re-sectioning only (no CP-SAT)')
  }

  const show = delta.changed_students.slice(0, 12)
  if (show.length > 0) {
    lines.push('')
    for (const s of show) {
      lines.push(`${s.register_number} · ${s.student_name}`)
      if (s.dropped.length) lines.push(`  dropped: ${s.dropped.join(', ')}`)
      if (s.added.length) lines.push(`  added:   ${s.added.join(', ')}`)
    }
    if (delta.changed_students.length > show.length) {
      lines.push(`… and ${delta.changed_students.length - show.length} more student(s)`)
    }
  }
  return lines.join('\n')
}

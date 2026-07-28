import type { SectionAssignment, ParkedRegistration } from '../merge/lateEnrollment'
import type { LateEnrollmentRecord } from '../merge/snapshot'
import type { ClashReport, Student } from '../types'

/**
 * Optional late-enrollment metadata threaded into Excel writers.
 * When absent, solve output is unchanged.
 */
export type LateMarking = {
  lateStudents: Set<string>
  /** Keys: register_number:course_code */
  latePairs: Set<string>
  lateSectionIds: Set<string>
  movedStudents: Set<string>
  /** Current late batch, or 0 when only carrying history forward (rectify). */
  batch: number
  /** Per section_id: counts per batch index (0-based). */
  lateAddsBySection: Record<string, number[]>
  /** Per course_code: counts per batch index (0-based). */
  lateAddsByCourse: Record<string, number[]>
  assignments: SectionAssignment[]
  parked: ParkedRegistration[]
  moved: { register_number: string; course_code: string; from: string; to: string }[]
  /** Display name/program per register number, for the Late Enrollments sheet. */
  studentInfo: Record<string, { name: string; program: string }>
  /** Post-merge clash status ('Green' | 'Red') per register number. */
  statusByStudent: Record<string, string>
  /** Human-readable clash detail per register number ('' when clash-free). */
  clashByStudent: Record<string, string>
}

/** Format batch chain: [5] → "5"; [5,3] → "5 +3"; [5,3,2] → "5 +3 +2". */
export function formatLateAddsChain(counts: number[] | undefined): string {
  if (!counts?.length) return ''
  const parts: string[] = []
  for (const raw of counts) {
    const n = raw || 0
    if (n === 0) continue
    parts.push(parts.length === 0 ? String(n) : `+${n}`)
  }
  return parts.join(' ')
}

/** True when `batch` contributed to this chain, i.e. the trailing "+n" is this run's. */
export function lateAddsIncludesBatch(counts: number[] | undefined, batch: number): boolean {
  if (!counts?.length || batch < 1) return false
  return (counts[batch - 1] ?? 0) > 0
}

/** Bold amber emphasis for a `Late Adds` cell the current batch just changed. */
export function lateAddsFont(
  counts: number[] | undefined,
  batch: number,
  colorArgb: string,
): { bold: true; color: { argb: string } } | undefined {
  return lateAddsIncludesBatch(counts, batch)
    ? { bold: true, color: { argb: colorArgb } }
    : undefined
}

function accumulateChains(
  records: LateEnrollmentRecord[],
  key: (r: LateEnrollmentRecord) => string | undefined,
): Record<string, number[]> {
  const maxBatch = records.reduce((m, r) => Math.max(m, r.batch), 0)
  const out: Record<string, number[]> = {}
  for (const r of records) {
    const k = key(r)
    if (!k) continue
    const chain = (out[k] ??= new Array<number>(maxBatch).fill(0))
    if (r.batch >= 1 && r.batch <= maxBatch) chain[r.batch - 1]! += 1
  }
  return out
}

/**
 * Assemble the marking used by the Excel writers.
 * `current` is supplied by a late run; rectify passes only the accumulated history so the
 * `Late Adds` column and amber tinting survive without inventing a new batch.
 */
export function buildLateMarking(args: {
  records: LateEnrollmentRecord[]
  batch: number
  students: Record<string, Student>
  clashReport: ClashReport
  current?: {
    assignments: SectionAssignment[]
    parked: ParkedRegistration[]
    moved: { register_number: string; course_code: string; from: string; to: string }[]
    newSectionIds: string[]
    /** Fallback names for registrations that were parked and so never became students. */
    names?: { register_number: string; student_name: string; program: string }[]
  }
}): LateMarking {
  const { records, batch, students, clashReport, current } = args

  const lateStudents = new Set(records.map((r) => r.register_number))
  const latePairs = new Set(records.map((r) => `${r.register_number}:${r.course_code}`))

  const studentInfo: Record<string, { name: string; program: string }> = {}
  for (const n of current?.names ?? []) {
    studentInfo[n.register_number] = { name: n.student_name, program: n.program }
  }
  for (const reg of lateStudents) {
    const st = students[reg]
    if (st) studentInfo[reg] = { name: st.name, program: st.program }
  }

  const statusByStudent: Record<string, string> = {}
  const clashByStudent: Record<string, string> = {}
  for (const r of clashReport.reports) {
    if (!lateStudents.has(r.register_number)) continue
    statusByStudent[r.register_number] = r.status
    if (r.status === 'Red') {
      const pairs = r.clashing_courses.map(([a, b]) => `${a}+${b}`).join(', ')
      clashByStudent[r.register_number] = r.clashing_days.map((d) => `${d}: ${pairs}`).join(' · ')
    }
  }

  return {
    lateStudents,
    latePairs,
    lateSectionIds: new Set(current?.newSectionIds ?? []),
    movedStudents: new Set((current?.moved ?? []).map((m) => m.register_number)),
    batch,
    lateAddsBySection: accumulateChains(records, (r) => r.section_id),
    lateAddsByCourse: accumulateChains(records, (r) => r.course_code),
    assignments: current?.assignments ?? [],
    parked: current?.parked ?? [],
    moved: current?.moved ?? [],
    studentInfo,
    statusByStudent,
    clashByStudent,
  }
}

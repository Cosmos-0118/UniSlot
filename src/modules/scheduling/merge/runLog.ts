/** How a UniSlot run was started. */
export type RunMode = 'solve' | 'rectify' | 'late'

export type RunLogDecision = {
  kind: 'capacity' | 'clash' | 'parse' | 'other'
  subject: string
  choice: string
  detail?: string
}

/**
 * One append-only trail entry. Seeded by the initial solve as seq 1, then
 * appended by every rectify and late merge so the chain is never missing its first link.
 */
export type RunLogEntry = {
  seq: number
  at: string
  mode: RunMode
  /** Late-enrollment batch number (only for mode === 'late'). */
  batch?: number
  inputs: {
    enrollment?: string
    baseline?: string
    rectified?: string
    late?: string
    previous_dir?: string
  }
  output_dir?: string
  seed?: number
  solver_status?: string
  students_before: number
  students_after: number
  students_added: number
  registrations_added: number
  courses_added: number
  sections_created: string[]
  students_moved_between_sections: number
  capacity_waivers: { section_id: string; enrollment: number; capacity: number }[]
  parked: { register_number: string; course_code: string; reason: string }[]
  red_before: number
  red_after: number
  clashes_introduced: number
  clashes_resolved: number
  decisions: RunLogDecision[]
  notes: string[]
}

export type RunLogClock = () => Date

const defaultClock: RunLogClock = () => new Date()

/** Next sequence number given an existing trail (empty → 1). */
export function nextRunSeq(log: RunLogEntry[]): number {
  if (log.length === 0) return 1
  return Math.max(...log.map((e) => e.seq)) + 1
}

/** Next late-enrollment batch number (empty or no late entries → 1). */
export function nextLateBatch(log: RunLogEntry[]): number {
  const late = log.filter((e) => e.mode === 'late' && e.batch != null)
  if (late.length === 0) return 1
  return Math.max(...late.map((e) => e.batch!)) + 1
}

export function createRunLogEntry(
  partial: Omit<RunLogEntry, 'at'> & { at?: string },
  clock: RunLogClock = defaultClock,
): RunLogEntry {
  return {
    ...partial,
    at: partial.at ?? clock().toISOString(),
    sections_created: [...(partial.sections_created ?? [])],
    capacity_waivers: [...(partial.capacity_waivers ?? [])],
    parked: [...(partial.parked ?? [])],
    decisions: [...(partial.decisions ?? [])],
    notes: [...(partial.notes ?? [])],
    inputs: { ...partial.inputs },
  }
}

export function appendRunLog(log: RunLogEntry[], entry: RunLogEntry): RunLogEntry[] {
  return [...log, entry].sort((a, b) => a.seq - b.seq)
}

export function cloneRunLog(log: RunLogEntry[] | undefined): RunLogEntry[] {
  if (!log?.length) return []
  return log.map((e) => ({
    ...e,
    inputs: { ...e.inputs },
    sections_created: [...e.sections_created],
    capacity_waivers: e.capacity_waivers.map((w) => ({ ...w })),
    parked: e.parked.map((p) => ({ ...p })),
    decisions: e.decisions.map((d) => ({ ...d })),
    notes: [...e.notes],
  }))
}

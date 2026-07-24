/**
 * Legacy local-search effort params.
 *
 * The supported product path is terminal CP-SAT (`npm run unislot`), which always
 * uses all CPUs and proves clash optimality — no Fast/Balanced/Max dial.
 *
 * Browser local-search still accepts EffortLevel for API compatibility, but
 * {@link resolveEffort} always returns maximum search parameters.
 */

export type EffortLevel = 'auto' | 'fast' | 'balanced' | 'max' | 'extreme' | 'unlimited'

export type EffortParams = {
  effort: EffortLevel
  /** Cap on multi-start seed count. */
  runCountCap: number
  /** Cap on Phase-2 refine pool size. */
  poolSizeCap: number
  /** Multiplier on SA maxIter for Phase-2 refine. */
  phase2IterFactor: number
  /** Hard ceiling on SA iterations per improve call. */
  maxIterCap: number
  /** Soft per-task wall-clock budget (ms) for a single seed/refine. */
  perTaskMs: number
  /** Elite restart rounds after Phase-2 (0 = none). */
  eliteRestartRounds: number
  /** Stop elite restarts after this many consecutive non-improving rounds. */
  eliteStagnationStop: number
  /** Soft overall solve deadline multiplier vs a fast baseline (size-scaled elsewhere). */
  overallDeadlineMul: number
  /** Probability of picking a conflict-contributing course (min-conflict bias). */
  focusProb: number
  /** Candidate slots sampled for min-conflict move evaluation. */
  minConflictSlotSample: number
  /** Probability of attempting a Kempe-chain move each SA iteration. */
  kempeProb: number
}

/** Always-on maximum local-search budget (legacy browser path only). */
const MAX_EFFORT: EffortParams = {
  effort: 'unlimited',
  runCountCap: 800,
  poolSizeCap: 48,
  phase2IterFactor: 10.0,
  maxIterCap: 12_000_000,
  perTaskMs: 240_000,
  eliteRestartRounds: 32,
  eliteStagnationStop: 4,
  overallDeadlineMul: 40,
  focusProb: 0.85,
  minConflictSlotSample: 48,
  kempeProb: 0.2,
}

/**
 * Resolve effort parameters. Dial values are ignored — always maximum search.
 * Prefer the CP-SAT CLI for proven optimality.
 */
export function resolveEffort(_effort?: EffortLevel | null): EffortParams {
  let hc = 4
  if (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number') {
    hc = navigator.hardwareConcurrency
  }

  const params = { ...MAX_EFFORT }
  const coreFactor = Math.max(1, Math.sqrt(hc / 4))
  params.perTaskMs = Math.max(240_000, Math.round(params.perTaskMs * coreFactor))
  return params
}

export const EFFORT_LEVELS: EffortLevel[] = ['unlimited']

export function effortLabel(_level: EffortLevel): string {
  return 'Maximum'
}

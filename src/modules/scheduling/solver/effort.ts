/** Search effort dial — Fast / Balanced / Max. Default: balanced. */
export type EffortLevel = 'fast' | 'balanced' | 'max'

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

const TABLE: Record<EffortLevel, EffortParams> = {
  fast: {
    effort: 'fast',
    runCountCap: 48,
    poolSizeCap: 10,
    phase2IterFactor: 1.6,
    maxIterCap: 200_000,
    perTaskMs: 2_000,
    eliteRestartRounds: 0,
    eliteStagnationStop: 1,
    overallDeadlineMul: 1,
    focusProb: 0.65,
    minConflictSlotSample: 12,
    kempeProb: 0.04,
  },
  balanced: {
    effort: 'balanced',
    runCountCap: 96,
    poolSizeCap: 16,
    phase2IterFactor: 2.1,
    maxIterCap: 400_000,
    perTaskMs: 5_000,
    eliteRestartRounds: 2,
    eliteStagnationStop: 2,
    overallDeadlineMul: 3,
    focusProb: 0.7,
    minConflictSlotSample: 18,
    kempeProb: 0.08,
  },
  max: {
    effort: 'max',
    runCountCap: 160,
    poolSizeCap: 24,
    phase2IterFactor: 3.0,
    maxIterCap: 1_200_000,
    perTaskMs: 20_000,
    eliteRestartRounds: 8,
    eliteStagnationStop: 3,
    overallDeadlineMul: 10,
    focusProb: 0.75,
    minConflictSlotSample: 28,
    kempeProb: 0.12,
  },
}

export function resolveEffort(effort?: EffortLevel | null): EffortParams {
  if (effort === 'fast' || effort === 'balanced' || effort === 'max') return TABLE[effort]
  return TABLE.balanced
}

export const EFFORT_LEVELS: EffortLevel[] = ['fast', 'balanced', 'max']

export function effortLabel(level: EffortLevel): string {
  switch (level) {
    case 'fast':
      return 'Fast'
    case 'balanced':
      return 'Balanced'
    case 'max':
      return 'Max'
  }
}

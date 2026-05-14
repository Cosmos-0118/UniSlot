import { blendSamples, easeInOutCubic } from './blend'
import { ALL_CUBE_PATTERNS } from './patterns'
import type { CubePattern, PatternContext, PatternSample } from './types'

/** Full time on one pattern before easing into the next (seconds). */
export const PATTERN_SEGMENT_SEC = 25
/** Portion of each segment used for crossfade to the next pattern (seconds). */
export const PATTERN_BLEND_SEC = 6.0

/** Seconds spent fully inside the outgoing pattern before blend begins. */
export const PATTERN_HOLD_SEC = PATTERN_SEGMENT_SEC - PATTERN_BLEND_SEC

function shufflePatterns(patterns: readonly CubePattern[]): CubePattern[] {
  const out = patterns.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i]!
    out[i] = out[j]!
    out[j] = a
  }
  return out
}

const _patternCount = ALL_CUBE_PATTERNS.length

/**
 * New order on every page load / refresh (Fisher–Yates).
 * Source gallery order is defined in `./patterns` (`ALL_CUBE_PATTERNS`).
 */
export const CUBE_PATTERNS: readonly CubePattern[] = shufflePatterns(ALL_CUBE_PATTERNS)

/** Where we sit inside the global cycle at t=0 (random segment + phase). */
const PATTERN_FLOW_TIME_OFFSET_SEC = Math.random() * PATTERN_SEGMENT_SEC * _patternCount

/** Shifts all pattern wave math on each load so motion doesn’t replay the same phase. */
const PATTERN_ANIM_PHASE_SEC = Math.random() * 400

/**
 * Returns blended sample between pattern `i` and `i+1`, with eased crossfade
 * in the last `PATTERN_BLEND_SEC` of each segment.
 */
export function sampleCubePatterns(
  col: number,
  row: number,
  cols: number,
  rows: number,
  timeSec: number,
  reduced: boolean
): PatternSample {
  const n = CUBE_PATTERNS.length
  const seg = PATTERN_SEGMENT_SEC
  const blendDur = PATTERN_BLEND_SEC

  const tFlow = timeSec + PATTERN_FLOW_TIME_OFFSET_SEC
  const cycle = tFlow / seg
  const idx = Math.floor(cycle) % n
  const local = cycle - Math.floor(cycle) // [0,1)
  const u = local * seg // seconds within segment [0, seg)

  const next = (idx + 1) % n
  const ctx = (): PatternContext => ({
    col,
    row,
    cols,
    rows,
    t: timeSec + PATTERN_ANIM_PHASE_SEC,
    reduced,
  })

  const a = CUBE_PATTERNS[idx].sample(ctx())
  if (u <= PATTERN_HOLD_SEC) return a

  const w = easeInOutCubic((u - PATTERN_HOLD_SEC) / blendDur)
  const b = CUBE_PATTERNS[next].sample(ctx())
  return blendSamples(a, b, w)
}

export type { CubePattern, PatternContext, PatternSample } from './types'
export { blendHue, blendSamples, easeInOutCubic, smoothstep01 } from './blend'

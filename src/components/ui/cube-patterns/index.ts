import { blendSamples, easeInOutCubic } from './blend'
import {
  patternArcticBreath,
  patternCopperMesh,
  patternForestPulse,
  patternLilacNebula,
  patternMossCathedral,
  patternObsidianFault,
  patternRoseQuartz,
  patternSandstoneTide,
  patternSapphireLattice,
  patternTwilightMeridian,
} from './patterns'
import type { CubePattern, PatternContext, PatternSample } from './types'

/**
 * Curated sequence: each pattern has a distinct palette + motion language.
 * Order is intentional (cool → warm → cool…) for gentler perceived jumps even during blend.
 */
export const CUBE_PATTERNS: readonly CubePattern[] = [
  patternTwilightMeridian,
  patternCopperMesh,
  patternArcticBreath,
  patternMossCathedral,
  patternLilacNebula,
  patternObsidianFault,
  patternSandstoneTide,
  patternSapphireLattice,
  patternRoseQuartz,
  patternForestPulse,
] as const

/** Full time on one pattern before easing into the next (seconds). */
export const PATTERN_SEGMENT_SEC = 22
/** Portion of each segment used for crossfade to the next pattern (seconds). */
export const PATTERN_BLEND_SEC = 5.5

/** Seconds spent fully inside the outgoing pattern before blend begins. */
export const PATTERN_HOLD_SEC = PATTERN_SEGMENT_SEC - PATTERN_BLEND_SEC

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

  const cycle = timeSec / seg
  const idx = Math.floor(cycle) % n
  const local = cycle - Math.floor(cycle) // [0,1)
  const u = local * seg // seconds within segment [0, seg)

  const next = (idx + 1) % n
  const ctx = (): PatternContext => ({
    col,
    row,
    cols,
    rows,
    t: timeSec,
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

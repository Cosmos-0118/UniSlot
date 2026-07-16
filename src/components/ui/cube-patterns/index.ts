import { blendSamples, easeInOutCubic } from './blend'
import {
  patternMidnightSky,
  patternAurora,
  patternQuartzCavern,
  patternEtherealGlass,
  patternAbyssalGlow,
  patternWhaleSongDepth,
  patternSwanLakeMist,
  patternArcticIce,
  patternJellyfishBloom,
  patternCherryBlossom,
} from './patterns'
import type { CubePattern, PatternContext, PatternSample } from './types'

/**
 * Curated sequence of 10 calm, cohesive patterns.
 * Dark cool → purple/magenta → soft pink — matches the landing nebula look.
 */
export const CUBE_PATTERNS: readonly CubePattern[] = [
  patternMidnightSky,
  patternAurora,
  patternQuartzCavern,
  patternEtherealGlass,
  patternAbyssalGlow,
  patternWhaleSongDepth,
  patternSwanLakeMist,
  patternArcticIce,
  patternJellyfishBloom,
  patternCherryBlossom,
] as const

/** Full time on one pattern before easing into the next (seconds). */
export const PATTERN_SEGMENT_SEC = 35
/** Portion of each segment used for crossfade to the next pattern (seconds). */
export const PATTERN_BLEND_SEC = 8.0

/** Seconds spent fully inside the outgoing pattern before blend begins. */
export const PATTERN_HOLD_SEC = PATTERN_SEGMENT_SEC - PATTERN_BLEND_SEC

// Create a single shared context to avoid massive object allocation per frame
const SHARED_CTX: PatternContext = { col: 0, row: 0, cols: 0, rows: 0, t: 0, reduced: false }

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
  
  SHARED_CTX.col = col
  SHARED_CTX.row = row
  SHARED_CTX.cols = cols
  SHARED_CTX.rows = rows
  SHARED_CTX.t = timeSec
  SHARED_CTX.reduced = reduced

  const a = CUBE_PATTERNS[idx].sample(SHARED_CTX)
  if (u <= PATTERN_HOLD_SEC) return a

  const w = easeInOutCubic((u - PATTERN_HOLD_SEC) / blendDur)
  const b = CUBE_PATTERNS[next].sample(SHARED_CTX)
  return blendSamples(a, b, w)
}

export type { CubePattern, PatternContext, PatternSample } from './types'
export { blendHue, blendSamples, easeInOutCubic, smoothstep01 } from './blend'

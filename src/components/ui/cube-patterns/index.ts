import { blendSamples, easeInOutCubic } from './blend'
import {
  patternStarlingMurmuration,
  patternArcticTernArc,
  patternHummingbirdJewel,
  patternMonarchRiver,
  patternFireflyMeadow,
  patternPhoenixEmber,
  patternDragonflyWetland,
  patternSwanLakeMist,
  patternKiteFestival,
  patternRavenStorm,
  patternAurora,
  patternGoldenHour,
  patternAbyssalGlow,
  patternCherryBlossom,
  patternForestCanopy,
  patternDesertDunes,
  patternCoralReef,
  patternVolcanicEmber,
  patternArcticIce,
  patternMidnightSky,
  patternWhaleSongDepth,
  patternJellyfishBloom,
  patternKelpCathedral,
  patternBiolumTide,
  patternMantaBallet,
  patternOctopusGarden,
  patternSeaTurtleGlide,
  patternHydrothermalShimmer,
  patternSunkenTreasure,
  patternNarwhalIcefjord,
  patternCyberNeon,
  patternEtherealGlass,
  patternSynthwaveSunset,
  patternHoloFracture,
  patternMatrixCascade,
  patternNeonNoirRain,
  patternAcidChrome,
  patternLaserArena,
  patternQuartzCavern,
  patternDatamoshTide,
} from './patterns'
import type { CubePattern, PatternContext, PatternSample } from './types'

/**
 * Curated sequence of 40 patterns. Alternating collections for maximum visual variety.
 */
export const CUBE_PATTERNS: readonly CubePattern[] = [
  // Block 1
  patternAurora,
  patternCyberNeon,
  patternWhaleSongDepth,
  patternStarlingMurmuration,
  // Block 2
  patternGoldenHour,
  patternEtherealGlass,
  patternJellyfishBloom,
  patternArcticTernArc,
  // Block 3
  patternAbyssalGlow,
  patternSynthwaveSunset,
  patternKelpCathedral,
  patternHummingbirdJewel,
  // Block 4
  patternCherryBlossom,
  patternHoloFracture,
  patternBiolumTide,
  patternMonarchRiver,
  // Block 5
  patternForestCanopy,
  patternMatrixCascade,
  patternMantaBallet,
  patternFireflyMeadow,
  // Block 6
  patternDesertDunes,
  patternNeonNoirRain,
  patternOctopusGarden,
  patternPhoenixEmber,
  // Block 7
  patternCoralReef,
  patternAcidChrome,
  patternSeaTurtleGlide,
  patternDragonflyWetland,
  // Block 8
  patternVolcanicEmber,
  patternLaserArena,
  patternHydrothermalShimmer,
  patternSwanLakeMist,
  // Block 9
  patternArcticIce,
  patternQuartzCavern,
  patternSunkenTreasure,
  patternKiteFestival,
  // Block 10
  patternMidnightSky,
  patternDatamoshTide,
  patternNarwhalIcefjord,
  patternRavenStorm,
] as const

/** Full time on one pattern before easing into the next (seconds). */
export const PATTERN_SEGMENT_SEC = 25
/** Portion of each segment used for crossfade to the next pattern (seconds). */
export const PATTERN_BLEND_SEC = 6.0

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

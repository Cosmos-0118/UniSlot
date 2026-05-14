import type { CubePattern } from '../types'
import { CREATURES_FLIGHT_PATTERNS } from './collections/collection-creatures-flight'
import { NATURE_LAND_SKY_PATTERNS } from './collections/collection-nature-land-sky'
import { OCEAN_LIFE_PATTERNS } from './collections/collection-ocean-life'
import { SYNTH_DREAMSCAPE_PATTERNS } from './collections/collection-synth-dreamscape'

export * from './collections/collection-creatures-flight'
export * from './collections/collection-nature-land-sky'
export * from './collections/collection-ocean-life'
export * from './collections/collection-synth-dreamscape'

/** Round-robin merge so adjacent segments jump across biomes (wilder show). */
function interleaveByIndex(...groups: readonly (readonly CubePattern[])[]): CubePattern[] {
  const n = Math.max(...groups.map((g) => g.length), 0)
  const out: CubePattern[] = []
  for (let i = 0; i < n; i++) {
    for (const g of groups) {
      if (i < g.length) out.push(g[i]!)
    }
  }
  return out
}

export const ALL_CUBE_PATTERNS: readonly CubePattern[] = interleaveByIndex(
  NATURE_LAND_SKY_PATTERNS,
  OCEAN_LIFE_PATTERNS,
  CREATURES_FLIGHT_PATTERNS,
  SYNTH_DREAMSCAPE_PATTERNS,
)

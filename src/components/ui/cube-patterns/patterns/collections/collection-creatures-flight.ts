import type { CubePattern, PatternContext } from '../../types'
import {
  clamp01, fbm,
  lerp, speed, wrapHue
} from '../_shared'

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION: Creatures & Flight (curated keepers)
// ═══════════════════════════════════════════════════════════════════════════

/** Peaceful misty lake with soft reflections — low contrast, dreamy. */
export const patternSwanLakeMist: CubePattern = {
  id: 'swan-lake-mist',
  title: 'Swan Lake Mist',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.25, 0.08)

    // Mist layers — multiple fBm at different scales
    const clouds = fbm(nx * 12 + T * 0.1, ny * 6, 4)
    const smoke = fbm(nx * 8 - T * 0.2, ny * 8 - T * 0.4, 3)
    const mist = clamp01(clouds * 0.6 + smoke * 0.4 + 0.4)

    // Water surface with gentle ripples
    const waterLine = 0.55
    const isWater = ny > waterLine
    const ripple = fbm(nx * 12 + T * 0.2, (ny - waterLine) * 20, 2) * (isWater ? 0.1 : 0)

    // Reflection (mirror of mist, dimmer)
    const reflectNy = waterLine - (ny - waterLine)
    const reflection = isWater ? fbm(nx * 3 + T * 0.1, reflectNy * 2, 3) * 0.3 + 0.3 : 0

    return {
      lift: (mist * 2 + ripple * 1.5 + reflection) * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(205, 220, mist) + ripple * 15),
      sat: lerp(10, 30, mist),
      light: lerp(60, 88, mist),
    }
  },
}

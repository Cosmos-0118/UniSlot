import type { CubePattern, PatternContext } from '../../types'
import {
  clamp01, fbm, warpedFbm, ridgedFbm, voronoi,
  smoothstep, lerp, speed, wrapHue, hash2i
} from '../_shared'

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION: Synth & Dreamscape (curated keepers)
// ═══════════════════════════════════════════════════════════════════════════

/** Frosted glass with prismatic light refraction and caustic sparkle. */
export const patternEtherealGlass: CubePattern = {
  id: 'ethereal-glass',
  title: 'Ethereal Glass',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.4, 0.12)

    // Glass surface — Voronoi facets
    const v = voronoi(nx * 6 + T * 0.05, ny * 5)
    const facet = smoothstep(0.3, 0.08, v.dist1)
    const edge = smoothstep(0.1, 0.02, v.dist2 - v.dist1)

    // Prismatic rainbow through glass
    const prism = fbm(nx * 4 + T * 0.15, ny * 3, 3)
    // Caustic sparkle
    const caustic = ridgedFbm(nx * 10 + T * 0.3, ny * 8 - T * 0.2, 3)
    const sparkle = smoothstep(0.3, 0.8, caustic) * facet

    return {
      lift: (facet * 2.5 + edge * 1.5 + sparkle) * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(190, 280, clamp01(prism + 0.5)) + edge * 30),
      sat: lerp(12, 55, clamp01(sparkle + edge * 0.5)),
      light: lerp(65, 95, clamp01(facet + sparkle * 0.4)),
    }
  },
}

/** Crystal cave with glowing facets and deep amethyst/quartz tones. */
export const patternQuartzCavern: CubePattern = {
  id: 'quartz-cavern',
  title: 'Quartz Cavern',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.3, 0.09)

    // Crystal facets — Voronoi with angular edges
    const v = voronoi(nx * 7 + T * 0.05, ny * 6)
    const facet = smoothstep(0.3, 0.05, v.dist1)
    const edge = smoothstep(0.1, 0.02, v.dist2 - v.dist1)

    // Internal glow — warm light from within
    const innerGlow = warpedFbm(nx * 3, ny * 2.5, T * 0.2, 1.2) * facet

    // Sparkle points
    const sparkle = smoothstep(0.04, 0.0, v.dist1) * (Math.sin(T * 4 + v.dist1 * 30) * 0.5 + 0.5)

    // Crystal color — amethyst to rose quartz
    const crystalHue = hash2i(Math.floor(nx * 7 + T * 0.05), Math.floor(ny * 6))

    return {
      lift: (facet * 3 + edge * 2 + sparkle * 2) * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(270, 330, crystalHue) + innerGlow * 20),
      sat: lerp(35, 70, clamp01(facet + sparkle)),
      light: lerp(18, 75, clamp01(facet * 0.5 + sparkle * 0.8 + innerGlow * 0.3)),
    }
  },
}

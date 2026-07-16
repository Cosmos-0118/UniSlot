import type { CubePattern, PatternContext } from '../../types'
import {
  clamp01, fbm, warpedFbm, voronoi,
  smoothstep, lerp, speed, wrapHue, hash2i
} from '../_shared'

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION: Nature — Land & Sky (curated keepers)
// ═══════════════════════════════════════════════════════════════════════════

export const patternAurora: CubePattern = {
  id: 'aurora',
  title: 'Aurora Borealis',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.4, 0.12)

    // Domain-warped vertical curtains
    const curtain = warpedFbm(nx * 3, ny * 1.5 + T * 0.08, T * 0.6, 2.0)
    // Fine shimmer detail
    const shimmer = fbm(nx * 8 + T * 0.3, ny * 4 - T * 0.15, 3) * 0.3

    // Vertical fade — aurora is strongest at top
    const vertFade = smoothstep(0.9, 0.15, ny)
    const intensity = clamp01((curtain + shimmer + 0.3) * vertFade)

    return {
      lift: intensity * 4.5 * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(280, 140, clamp01(curtain * 0.8 + 0.5)) + shimmer * 30),
      sat: lerp(30, 88, intensity),
      light: lerp(8, 65, intensity),
    }
  },
}

export const patternAbyssalGlow: CubePattern = {
  id: 'abyssal-glow',
  title: 'Abyssal Glow',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.4, 0.12)

    // Deep water pressure
    const deep = ny * 0.85
    const flow = warpedFbm(nx * 4, ny * 4, T * 0.4, 1.5)

    // Bioluminescent sparkles (Voronoi)
    const v = voronoi(nx * 10 + T * 0.1, ny * 10 - T * 0.05)
    const sparkle = smoothstep(0.08, 0.01, v.dist1) * clamp01(flow + 0.2)

    return {
      lift: (flow * 2.5 + sparkle * 3 + deep * 0.5) * (reduced ? 0.4 : 1),
      hue: wrapHue(lerp(200, 170, sparkle) - deep * 15),
      sat: lerp(30, 95, sparkle),
      light: lerp(5, 75, clamp01(sparkle + flow * 0.3)),
    }
  },
}

export const patternCherryBlossom: CubePattern = {
  id: 'cherry-blossom',
  title: 'Cherry Blossom',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.4, 0.15)

    // Branch structure
    const branch = Math.sin(nx * 3.2 + T * 0.2) * 0.12 + 0.38
    const wood = smoothstep(0.08, 0.0, Math.abs(ny - branch))

    // Wind-blown petals
    const wind = warpedFbm(nx * 5 + T * 0.5, ny * 5, T * 0.2, 1.2)
    const bloom = clamp01(wind * 0.6 + 0.4) * (1 - wood)

    return {
      lift: (wood * 2 + bloom * 3) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(340, 355, bloom) + wind * 8),
      sat: lerp(10, 80, bloom),
      light: wood > 0.1 ? 25 : lerp(20, 85, bloom),
    }
  },
}

export const patternArcticIce: CubePattern = {
  id: 'arctic-ice',
  title: 'Arctic Ice',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.2, 0.05)

    // Large jagged ice plates
    const v = voronoi(nx * 4 - T * 0.05, ny * 3)
    const fracture = smoothstep(0.04, 0.01, v.dist2 - v.dist1)
    const plate = smoothstep(0.4, 0.1, v.dist1)

    // Sub-surface frozen texture
    const iceSubTex = fbm(nx * 18 + T * 0.05, ny * 18, 3) * 0.5 + 0.5

    // Deep blue glow from within
    const underGlow = clamp01(plate * 0.6 + iceSubTex * 0.4)

    return {
      lift: (plate * 2.5 + fracture * 1.5 + iceSubTex) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(195, 210, underGlow) + fracture * 10),
      sat: lerp(15, 45, clamp01(underGlow + fracture)),
      light: lerp(30, 95, clamp01(underGlow + fracture * 0.8)),
    }
  },
}

export const patternMidnightSky: CubePattern = {
  id: 'midnight-sky',
  title: 'Midnight Sky',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.15, 0.05)

    // Nebula dust — domain warped
    const nebula = warpedFbm(nx * 4 + T * 0.1, ny * 3, T * 0.05, 1.5)
    
    // Milky way band across the middle
    const band = smoothstep(0.4, 0.0, Math.abs(ny - 0.5 + Math.sin(nx * 3) * 0.2)) * 0.5

    // Stars — Voronoi points
    const v = voronoi(nx * 12 + T * 0.02, ny * 12)
    const starDist = v.dist1
    // Filter stars randomly so they aren't perfectly uniform
    const isStar = hash2i(Math.floor((nx + T * 0.02) * 12), Math.floor(ny * 12)) > 0.7
    const star = isStar ? smoothstep(0.05, 0.0, starDist) : 0

    // Twinkle effect
    const twinkle = star > 0 ? Math.sin(T * 5 + nx * 100) * 0.5 + 0.5 : 0

    return {
      lift: (nebula * 2 + band * 2 + star * 3) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(230, 270, nebula + 0.5) + twinkle * 40),
      sat: lerp(40, 85, clamp01(nebula + band)),
      light: lerp(5, 80, clamp01((nebula + 0.2) * 0.5 + band + star * twinkle)),
    }
  },
}

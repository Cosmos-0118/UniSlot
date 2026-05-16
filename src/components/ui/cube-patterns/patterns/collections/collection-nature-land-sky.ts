import type { CubePattern, PatternContext } from '../../types'
import {
  clamp01, fbm, warpedFbm, ridgedFbm, voronoi,
  smoothstep, lerp, speed, wrapHue, hash2i
} from '../_shared'

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION: Nature — Land & Sky (10 patterns)
// Earth, weather, open sky, and elemental forces.
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

export const patternGoldenHour: CubePattern = {
  id: 'golden-hour',
  title: 'Golden Hour',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.3, 0.1)

    // Sun disk
    const sunX = 0.5, sunY = 0.6
    const radius = Math.sqrt((nx - sunX) ** 2 + ((ny - sunY) * 1.5) ** 2)
    const sunGlow = smoothstep(0.6, 0.0, radius)

    // Layered cloud bands
    const cloud1 = fbm(nx * 5 + T * 0.2, ny * 2 + T * 0.05, 4) * 0.5 + 0.5
    const cloud2 = fbm(nx * 3 - T * 0.15, ny * 3.5, 3) * 0.4 + 0.5

    // Warm-to-cool gradient (sky is cooler at top)
    const warmth = clamp01(sunGlow * 0.7 + cloud1 * 0.3)
    const skyGrad = smoothstep(0.0, 0.8, ny)

    return {
      lift: (sunGlow * 3 + cloud1 * 2 + cloud2) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(15, 45, warmth) + skyGrad * 20),
      sat: lerp(70, 95, warmth),
      light: lerp(20, 70, clamp01(sunGlow + cloud1 * 0.4)),
    }
  },
}

export const patternAbyssalGlow: CubePattern = {
  id: 'abyssal-glow',
  title: 'Abyssal Glow',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.5, 0.15)

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

export const patternForestCanopy: CubePattern = {
  id: 'forest-canopy',
  title: 'Forest Canopy',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.4, 0.12)

    // Dense canopy — domain warped
    const canopy = warpedFbm(nx * 6, ny * 4, T * 0.3, 1.5)
    // Dappled sunlight breaking through (ridged noise)
    const dapple = clamp01(ridgedFbm(nx * 8 + T * 0.2, ny * 6, 3) * 0.7 + 0.3)
    const lightShaft = smoothstep(-0.2, 0.5, canopy) * dapple

    // Trunk silhouettes
    const trunkPhase = Math.abs(nx - (0.3 + (row % 5) * 0.08))
    const trunk = smoothstep(0.05, 0.01, trunkPhase) * ny

    return {
      lift: (canopy * 2 + lightShaft * 3 + trunk * 1.5) * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(100, 140, clamp01(canopy * 0.5 + 0.5)) + lightShaft * 20),
      sat: lerp(35, 85, clamp01(canopy + lightShaft)),
      light: lerp(12, 75, clamp01(lightShaft + trunk * 0.2)),
    }
  },
}

export const patternDesertDunes: CubePattern = {
  id: 'desert-dunes',
  title: 'Desert Dunes',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.2, 0.05)

    // Sharp dune crests using ridged noise
    const ridge = ridgedFbm(nx * 3 + T * 0.1, ny * 4, 3)
    const dune = smoothstep(-0.4, 0.6, ridge)

    // Fine sand ripples across the surface
    const sand = fbm(nx * 10 + Math.sin(ny * 5) * 0.1, ny * 8 + T * 0.05, 3) * 0.5 + 0.5
    
    // Heat shimmer
    const shimmer = Math.sin(nx * 20 + ny * 15 - T * 2) * 0.05

    return {
      lift: (dune * 4 + sand * 1.5) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(30, 45, ridge) + shimmer * 15),
      sat: lerp(55, 80, dune),
      light: lerp(20, 68, clamp01(dune + sand * 0.3)),
    }
  },
}

export const patternCoralReef: CubePattern = {
  id: 'coral-reef',
  title: 'Coral Reef',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.3, 0.1)

    // Coral structures — Voronoi cells
    const v = voronoi(nx * 7, ny * 5 - T * 0.05)
    const coral = smoothstep(0.4, 0.0, v.dist1)
    
    // Water caustics above the coral
    const caustic = clamp01(ridgedFbm(nx * 10 + T * 0.4, ny * 8 - T * 0.2, 3) + 0.2)

    // Each cell gets a slight color variation
    const cellColor = hash2i(Math.floor(nx * 7), Math.floor(ny * 5 - T * 0.05))

    return {
      lift: (coral * 3 + caustic * 1.5) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(330, 30, cellColor) + caustic * 20 + coral * 15),
      sat: lerp(45, 95, coral),
      light: lerp(15, 75, clamp01(coral + caustic * 0.5)),
    }
  },
}

export const patternVolcanicEmber: CubePattern = {
  id: 'volcanic-ember',
  title: 'Volcanic Ember',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.7, 0.22)

    // Voronoi cracks in cooled lava
    const v = voronoi(nx * 12 + T * 0.02, ny * 12 - T * 0.01)
    const cracks = smoothstep(0.12, 0.02, v.dist2 - v.dist1)

    // Lava glow beneath — domain warped for organic flow
    const lava = warpedFbm(nx * 4, ny * 4, T * 0.5, 1.8)
    const hotSpot = smoothstep(-0.2, 0.4, lava)

    // Ember particles floating upward
    const sparkle = clamp01(fbm(nx * 10 - T * 0.5, ny * 10 - T * 0.4, 2) - 0.55) * 2 * smoothstep(1.0, 0.4, ny)
    const heat = clamp01(cracks * 0.7 + hotSpot * 0.5 + sparkle * 0.3)

    return {
      lift: (heat * 5 + cracks * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(0, 40, heat)),
      sat: lerp(75, 100, heat),
      light: lerp(5, 65, heat),
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

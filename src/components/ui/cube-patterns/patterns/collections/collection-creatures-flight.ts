import type { CubePattern, PatternContext } from '../../types'
import {
  clamp01, fbm, warpedFbm, ridgedFbm, voronoi,
  smoothstep, lerp, speed, wrapHue, polar, hash2i, fract01
} from '../_shared'

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION: Creatures & Flight — 10 patterns
// Organic motion, flocking, bioluminescence, and elemental creatures.
// ═══════════════════════════════════════════════════════════════════════════

/** Murmuration flock — swirling, dense cloud of coordinated particles. */
export const patternStarlingMurmuration: CubePattern = {
  id: 'starling-murmuration',
  title: 'Starling Murmuration',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.6, 0.18)

    // Swirling flock shape — heavily domain-warped noise forms organic cloud
    const flock = warpedFbm(nx * 4, ny * 3, T * 0.5, 2.2)
    // Second warp layer for internal turbulence
    const turbulence = warpedFbm(nx * 6 + flock, ny * 5 - flock * 0.5, T * 0.3, 1.5)

    // Dense center, fading edges
    const density = smoothstep(-0.1, 0.5, flock) * smoothstep(-0.3, 0.3, turbulence)

    // Individual bird flicker
    const flicker = hash2i(col, row) > 0.4 ? 1 : 0.7
    const birdDot = clamp01(fbm(nx * 12 + T * 0.8, ny * 10, 2) + turbulence * 0.6) * density * flicker

    // Sunset sky behind
    const sky = smoothstep(1.0, 0.0, ny) * (1 - density * 0.8)

    return {
      lift: (density * 3.5 + birdDot * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(20, 220, density) + sky * 15),
      sat: lerp(60, 30, density),
      light: lerp(55, 12, density),
    }
  },
}

/** Long migration arc with rippling wing motion along a curved path. */
export const patternArcticTernArc: CubePattern = {
  id: 'arctic-tern-arc',
  title: 'Arctic Tern Migration',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.4, 0.12)

    // Migration path — curved S-shape across screen
    const pathY = 0.5 + Math.sin(nx * 3 + T * 0.3) * 0.15
    const pathDist = Math.abs(ny - pathY)
    const path = smoothstep(0.12, 0.0, pathDist)

    // V-formation dots along path
    const formationPhase = fract01(nx * 8 - T * 0.5)
    const vShape = smoothstep(0.06, 0.0, pathDist - Math.abs(formationPhase - 0.5) * 0.08)

    // Wing beat ripple


    // Open sky
    const mist = fbm(nx * 6 + T * 0.1, ny * 3, 4) * 0.6 + 0.25
    const clouds = clamp01(fbm(nx * 5 + T * 0.1, ny * 3, 4) - 0.2)

    return {
      lift: (path * 3 + vShape * 2 + clouds) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(200, 215, mist) + path * 10),
      sat: lerp(40, 65, clamp01(path + clouds)),
      light: lerp(65, 85, mist) * (1 - path * 0.6),
    }
  },
}

/** Rapid iridescent shimmer with rainbow color cycling — jewel-like. */
export const patternHummingbirdJewel: CubePattern = {
  id: 'hummingbird-jewel',
  title: 'Hummingbird Iridescence',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 1.0, 0.3)

    // Iridescent surface — angle-dependent color shift
    const { angle, radius } = polar(nx, ny)
    const iridescentWave = ridgedFbm(angle * 2 / Math.PI + T * 0.5, radius * 5, 3)

    // Feather texture — fine layered structure
    const featherTex = fbm(nx * 10 + T * 0.5, ny * 10, 3) * 0.2
    const feather = smoothstep(-0.2, 0.5, featherTex)

    // Rapid color cycling like real iridescence
    const colorShift = (iridescentWave + nx * 2 + ny + T * 0.8) * 2

    // Central jewel glow
    const jewel = smoothstep(0.4, 0.0, radius) * 0.5

    return {
      lift: (feather * 3 + iridescentWave * 2 + jewel * 2) * (reduced ? 0.45 : 1),
      hue: wrapHue(140 + Math.sin(colorShift) * 60),
      sat: lerp(70, 100, clamp01(feather + iridescentWave * 0.5)),
      light: lerp(20, 65, clamp01(feather + jewel)),
    }
  },
}

/** Flowing stream of warm orange bodies with wing patterns. */
export const patternMonarchRiver: CubePattern = {
  id: 'monarch-river',
  title: 'Monarch River',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.5, 0.15)

    // River-like flow with domain warping
    const flow = warpedFbm(nx * 3, ny * 5 - T * 0.4, T * 0.3, 1.8)
    const stream = smoothstep(-0.1, 0.4, flow)

    // Wing patterns — Voronoi with warm veins
    const v = voronoi(nx * 8 + T * 0.05, ny * 8 - T * 0.02)
    const wingVeins = smoothstep(0.12, 0.03, v.dist2 - v.dist1) * stream
    const wingCell = smoothstep(0.25, 0.08, v.dist1) * stream

    // Green canopy background


    return {
      lift: (stream * 3.5 + wingVeins * 2 + wingCell) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(120, 25, stream) + wingVeins * 10),
      sat: lerp(45, 90, stream),
      light: lerp(18, 60, clamp01(stream + wingCell * 0.3)),
    }
  },
}

/** Twinkling fireflies emerging from dark grass — scattered bright points. */
export const patternFireflyMeadow: CubePattern = {
  id: 'firefly-meadow',
  title: 'Firefly Meadow',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 1.0, 0.3)

    // Meadow ground — dark grass texture
    const grass = fbm(nx * 10, ny * 8 + T * 0.05, 4)
    const meadow = lerp(0.08, 0.18, clamp01(grass * 0.5 + 0.5))

    // Firefly positions — Voronoi cell centers as potential fireflies
    const v = voronoi(nx * 12 + Math.sin(T * 0.3) * 0.5, ny * 10 - Math.cos(T * 0.25) * 0.3)
    const flyDot = smoothstep(0.06, 0.0, v.dist1)

    // Only some cells have active fireflies (filtered by hash)
    const cellId = hash2i(Math.floor((nx + Math.sin(T * 0.3) * 0.5) * 12), Math.floor((ny - Math.cos(T * 0.25) * 0.3) * 10))
    const isActive = cellId > 0.55

    // Blink pattern — each firefly blinks at its own rate
    const blink = Math.sin(T * (2 + cellId * 3) + cellId * 10)
    const glowing = blink > 0.3 && isActive

    const firefly = flyDot * (glowing ? 1 : 0)
    const glow = firefly * 0.3 * smoothstep(0.15, 0.0, v.dist1)  // soft halo

    return {
      lift: (firefly * 4 + glow * 2 + grass * 0.3) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(130, 55, firefly) + grass * 10),
      sat: lerp(40, 100, firefly),
      light: lerp(meadow * 100, 90, clamp01(firefly + glow)),
    }
  },
}

/** Rising phoenix — upward flowing embers and wing-shaped heat distortion. */
export const patternPhoenixEmber: CubePattern = {
  id: 'phoenix-ember',
  title: 'Phoenix Ember Rise',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.7, 0.2)

    // Rising heat distortion — domain warped upward
    const heat = warpedFbm(nx * 4, ny * 2 + T * 0.6, T * 0.4, 2.0)

    // Wing shape — mirrored ridged noise
    const mirrorX = Math.abs(nx - 0.5) * 2
    const wing = ridgedFbm(mirrorX * 3 + T * 0.2, ny * 4 - T * 0.5, 3)
    const wingShape = smoothstep(-0.2, 0.6, wing) * smoothstep(0.9, 0.3, ny)

    // Ember particles rising
    const embers = clamp01(fbm(nx * 15 - T * 0.3, ny * 10 + T * 2, 2) - 0.55) * 2
    const emberGlow = embers * smoothstep(0.8, 0.1, ny)

    const fire = clamp01(wingShape * 0.6 + heat * 0.3 + emberGlow * 0.4)

    return {
      lift: (fire * 5 + emberGlow * 3) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(0, 50, fire)),
      sat: lerp(80, 100, fire),
      light: lerp(5, 70, fire),
    }
  },
}

/** Dragonfly wings with iridescent sheen over a wetland surface. */
export const patternDragonflyWetland: CubePattern = {
  id: 'dragonfly-wetland',
  title: 'Dragonfly Wetland',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.5, 0.15)

    // Water surface
    const surface = 0.55
    const isWater = ny > surface

    // Reeds and lily pads (above water)
    const reeds = ridgedFbm(nx * 8 + T * 0.1, ny * 2, 2) * smoothstep(surface + 0.05, surface - 0.1, ny)

    // Water caustics and ripples
    const caustics = ridgedFbm(nx * 8 + T * 0.3, ny * 6 - T * 0.2, 3) * (isWater ? 1 : 0)

    // Dragonfly wing shimmer — Voronoi veined wings
    const v = voronoi(nx * 14 + Math.sin(T * 2) * 0.3, ny * 12)
    const wingVein = smoothstep(0.08, 0.02, v.dist2 - v.dist1)
    const wingArea = smoothstep(0.45, 0.35, ny) * smoothstep(0.25, 0.45, ny)
    const wing = wingVein * wingArea

    // Iridescent wing color
    const iriPhase = nx * 5 + ny * 3 + T * 2

    return {
      lift: (wing * 3 + reeds * 2 + caustics * 1.5) * (reduced ? 0.5 : 1),
      hue: wrapHue(wing > 0.1 ? iriPhase * 60 + 120 : lerp(140, 200, isWater ? 1 : 0)),
      sat: lerp(35, 80, clamp01(wing + caustics * 0.3)),
      light: lerp(isWater ? 15 : 30, 65, clamp01(wing + reeds * 0.3 + caustics * 0.4)),
    }
  },
}

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

/** Colorful kites scattered across a bright sky — Voronoi cells with varied hues. */
export const patternKiteFestival: CubePattern = {
  id: 'kite-festival',
  title: 'Kite Festival',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.35, 0.1)

    // Kites as Voronoi cells, each with unique color
    const drift = Math.sin(T * 0.4) * 0.15
    const v = voronoi(nx * 5 + drift, ny * 4 - T * 0.1)
    const kiteBody = smoothstep(0.2, 0.05, v.dist1)

    // Kite tail — trailing ribbon from each cell
    const tailPhase = fract01(ny * 6 + nx * 2 - T * 0.8)
    const tail = smoothstep(0.08, 0.0, Math.abs(tailPhase - 0.5) - 0.3) * (1 - kiteBody) * smoothstep(0.3, 0.7, ny)

    // Each kite gets a unique vibrant color
    const kiteColor = hash2i(Math.floor((nx + drift) * 5), Math.floor((ny - T * 0.1) * 4))

    // Blue sky behind
    const sky = smoothstep(1.0, 0.0, ny) * 0.4

    // Wind effect
    const wind = fbm(nx * 3 + T * 0.3, ny * 2, 2) * 0.1

    return {
      lift: (kiteBody * 4 + tail * 2 + wind) * (reduced ? 0.5 : 1),
      hue: wrapHue(340 + kiteColor * 80),
      sat: lerp(50, 95, clamp01(kiteBody + tail)),
      light: lerp(65, 75, sky) * (1 - kiteBody * 0.15) + kiteBody * 20 + tail * 10,
    }
  },
}

/** Dark storm with dramatic lightning bolt flashes and brooding clouds. */
export const patternRavenStorm: CubePattern = {
  id: 'raven-storm',
  title: 'Raven Storm',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.6, 0.18)

    // Storm clouds — dark, turbulent fBm
    const clouds = warpedFbm(nx * 3, ny * 2, T * 0.3, 1.8)
    const stormDark = smoothstep(0.3, -0.3, clouds)

    // Lightning bolt — ridged noise concentrated in vertical bands
    const boltPhase = Math.sin(T * 0.8) * 0.3
    const boltX = 0.5 + boltPhase
    const bolt = ridgedFbm((nx - boltX) * 15 + T * 5, ny * 8, 3)
    const boltVisible = smoothstep(0.6, 0.95, bolt) * smoothstep(0.1, 0.0, Math.abs(nx - boltX) - 0.15)

    // Lightning flash — illuminates clouds periodically
    const flash = smoothstep(0.8, 1.0, Math.sin(T * 3 + Math.sin(T * 7) * 2)) * 0.4

    // Rain texture
    const rain = clamp01(fbm(nx * 12, ny * 5 + T * 6, 2) - 0.6) * 0.3

    return {
      lift: (boltVisible * 5 + stormDark * 2 + rain) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(240, 280, clouds * 0.5 + 0.5) + boltVisible * 40),
      sat: lerp(25, 70, clamp01(boltVisible + flash)),
      light: lerp(6, 90, clamp01(boltVisible + flash + rain * 0.2)),
    }
  },
}

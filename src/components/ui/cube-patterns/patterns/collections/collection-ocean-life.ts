import type { CubePattern, PatternContext } from '../../types'
import {
  clamp01, fbm, warpedFbm, ridgedFbm, voronoi,
  smoothstep, lerp, speed, wrapHue, polar, hash2i, fract01
} from '../_shared'

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION: Ocean Life — 10 patterns
// Undersea environments: currents, bioluminescence, Voronoi coral, caustics.
// ═══════════════════════════════════════════════════════════════════════════

/** Deep ocean with a slow-moving pressure wave and distant whale song pulses. */
export const patternWhaleSongDepth: CubePattern = {
  id: 'whale-song-depth',
  title: 'Whale Song Depth',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.35, 0.1)

    // Deep pressure waves
    const pressure = warpedFbm(nx * 2.5, ny * 2 + T * 0.1, T * 0.4, 1.8)
    // Sound wave ripples — concentric expanding rings
    const cx = 0.5 + Math.sin(T * 0.3) * 0.2, cy = 0.5
    const dist = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2)
    const songPulse = smoothstep(0.02, 0.0, Math.abs(fract01(dist * 8 - T * 0.6) - 0.5) - 0.4)

    // Depth gradient
    const depth = smoothstep(0.0, 1.0, ny)
    const intensity = clamp01(pressure * 0.4 + songPulse * 0.6 + 0.1)

    return {
      lift: (intensity * 3.5 + songPulse * 2) * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(220, 195, depth) - pressure * 15),
      sat: lerp(45, 75, intensity),
      light: lerp(6, 40, intensity),
    }
  },
}

/** Translucent jellyfish bells pulsing with Voronoi-based body structure. */
export const patternJellyfishBloom: CubePattern = {
  id: 'jellyfish-bloom',
  title: 'Jellyfish Bloom',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.6, 0.18)

    // Multiple jellyfish as Voronoi cells
    const v = voronoi(nx * 4 + Math.sin(T * 0.3) * 0.3, ny * 3 - T * 0.15)
    const bell = smoothstep(0.35, 0.08, v.dist1)
    // Inner bell translucency
    const inner = smoothstep(0.2, 0.05, v.dist1)

    // Pulsing motion
    const pulse = Math.sin(T * 2.5 + v.dist1 * 10) * 0.5 + 0.5
    // Tentacle trails below each bell
    const tentacle = clamp01(fbm(nx * 8 + T * 0.4, ny * 8 - T * 0.6, 3)) * (1 - bell) * smoothstep(0.2, 0.5, ny)

    const glow = clamp01(bell * pulse + inner * 0.3 + tentacle * 0.5)

    return {
      lift: (glow * 4 + tentacle * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(270, 310, bell) + pulse * 15),
      sat: lerp(50, 85, glow),
      light: lerp(15, 65, glow),
    }
  },
}

/** Tall kelp forest swaying in current with vertical light shafts. */
export const patternKelpCathedral: CubePattern = {
  id: 'kelp-cathedral',
  title: 'Kelp Cathedral',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.5, 0.15)

    // Kelp strands — vertical ridged noise swaying
    const sway = Math.sin(T * 0.8 + nx * 4) * 0.06
    const kelpBody = smoothstep(0.12, 0.0, Math.abs(ridgedFbm((nx + sway) * 8, ny * 4, 3)))

    // Light shafts from above
    const lightShaft = smoothstep(0.3, 0.9, fbm(nx * 10 - T * 0.3, ny * 2 + T * 0.1, 2)) * smoothstep(1.0, 0.0, ny)

    // Particulate in water
    const particles = clamp01(fbm(nx * 10 + T * 0.3, ny * 10 - T * 0.5, 2) - 0.5) * 0.5

    return {
      lift: (kelpBody * 3 + lightShaft * 2 + particles) * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(120, 150, kelpBody) + lightShaft * 30),
      sat: lerp(40, 70, kelpBody),
      light: lerp(12, 55, clamp01(kelpBody * 0.4 + lightShaft * 0.6 + particles * 0.2)),
    }
  },
}

/** Bioluminescent wave breaking on shore — bright crests, dark troughs. */
export const patternBiolumTide: CubePattern = {
  id: 'biolum-tide',
  title: 'Bioluminescent Tide',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.7, 0.2)

    // Shore waves
    const wavePhase = nx * 6 - T * 0.8 + fbm(ny * 4, T * 0.1, 2) * 0.5
    const wave = smoothstep(-0.1, 0.3, Math.sin(wavePhase))
    // Foam/crest line
    const crest = smoothstep(0.85, 0.95, Math.sin(wavePhase))

    // Bioluminescent plankton — concentrated near shore
    const shoreProx = smoothstep(0.8, 0.3, ny)
    const ocean = fbm(nx * 8 + T * 0.1, ny * 8 - T * 0.2, 3)
    const glow = clamp01(ocean + 0.2) * shoreProx * wave

    return {
      lift: (glow * 4 + crest * 3 + wave) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(180, 150, glow) + crest * 30),
      sat: lerp(60, 100, glow),
      light: lerp(5, 65, clamp01(glow + crest * 0.5)),
    }
  },
}

/** Graceful manta rays gliding — domain warped wing shapes. */
export const patternMantaBallet: CubePattern = {
  id: 'manta-ballet',
  title: 'Manta Ray Ballet',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.4, 0.12)

    // Ocean background
    const ocean = warpedFbm(nx * 3, ny * 2.5, T * 0.2, 1.2) * 0.3

    // Two manta silhouettes as warped blobs
    const m1x = 0.35 + Math.sin(T * 0.5) * 0.15
    const m1y = 0.45 + Math.cos(T * 0.35) * 0.1
    const m2x = 0.65 - Math.sin(T * 0.4) * 0.12
    const m2y = 0.55 + Math.sin(T * 0.45) * 0.08

    // Wing-like warp — stretch horizontally and compress vertically
    const warp1 = fbm((nx - m1x) * 8 + T * 0.3, (ny - m1y) * 16, 2)
    const body1 = smoothstep(0.25, 0.0, Math.sqrt(((nx - m1x + warp1 * 0.03) * 2.5) ** 2 + ((ny - m1y) * 5) ** 2))

    const warp2 = fbm((nx - m2x) * 8 - T * 0.2, (ny - m2y) * 16, 2)
    const body2 = smoothstep(0.25, 0.0, Math.sqrt(((nx - m2x + warp2 * 0.03) * 2.5) ** 2 + ((ny - m2y) * 5) ** 2))

    const manta = Math.max(body1, body2)
    const intensity = clamp01(manta + ocean)

    return {
      lift: (manta * 4 + ocean * 1.5) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(210, 190, manta) + ocean * 15),
      sat: lerp(40, 70, intensity),
      light: lerp(15, 50, intensity),
    }
  },
}

/** Spiral tentacle garden with shifting colors — Voronoi + polar coords. */
export const patternOctopusGarden: CubePattern = {
  id: 'octopus-garden',
  title: 'Octopus Garden',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.5, 0.15)

    const { angle, radius } = polar(nx, ny)

    // Spiral arms with ridged noise
    const spiral = ridgedFbm(
      angle * 2 / Math.PI + radius * 6 - T * 0.4,
      radius * 4,
      3
    )
    const arms = smoothstep(-0.3, 0.6, spiral) * smoothstep(0.6, 0.1, radius)

    // Color-shifting chromatophores
    const chromo = warpedFbm(nx * 6, ny * 6, T * 0.6, 1.5)
    // Suction cups — small Voronoi dots
    const v = voronoi(nx * 8 + T * 0.1, ny * 8 + T * 0.05)
    const cups = smoothstep(0.08, 0.02, v.dist1) * arms

    return {
      lift: (arms * 3.5 + cups * 2 + chromo * 0.5) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(260, 320, clamp01(chromo + 0.5)) + arms * 20),
      sat: lerp(45, 85, arms),
      light: lerp(12, 55, clamp01(arms + cups * 0.3)),
    }
  },
}

/** Sea turtle gliding through caustic-dappled water. */
export const patternSeaTurtleGlide: CubePattern = {
  id: 'sea-turtle-glide',
  title: 'Sea Turtle Glide',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.35, 0.1)

    // Caustic light pattern — the iconic underwater dappled light
    const caustic = ridgedFbm(nx * 8 + T * 0.3, ny * 6 - T * 0.2, 3)
    const causticGlow = smoothstep(-0.3, 0.5, caustic) * 0.5

    // Turtle shell — hexagonal Voronoi pattern on a moving blob
    const tx = 0.5 + Math.sin(T * 0.3) * 0.2
    const ty = 0.5 + Math.cos(T * 0.25) * 0.1
    const shellDist = Math.sqrt(((nx - tx) * 2) ** 2 + ((ny - ty) * 3) ** 2)
    const shell = smoothstep(0.3, 0.0, shellDist)

    const v = voronoi((nx - tx) * 8 + 0.5, (ny - ty) * 8 + 0.5)
    const scutes = smoothstep(0.12, 0.04, v.dist2 - v.dist1) * shell

    return {
      lift: (shell * 3.5 + causticGlow * 2 + scutes) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(160, 130, shell) + caustic * 15),
      sat: lerp(35, 65, clamp01(shell + causticGlow)),
      light: lerp(20, 55, clamp01(causticGlow + shell * 0.5 + scutes * 0.3)),
    }
  },
}

/** Hydrothermal vent — rising hot plume with mineral-rich particles. */
export const patternHydrothermalShimmer: CubePattern = {
  id: 'hydrothermal-shimmer',
  title: 'Hydrothermal Shimmer',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.6, 0.18)

    // Rising plume — domain warped upward-biased noise
    const plumeX = nx - 0.5
    const plumeY = ny - 0.8
    const plumeDist = Math.sqrt(plumeX * plumeX * 4 + plumeY * plumeY)
    const plumeShape = smoothstep(0.4, 0.0, plumeDist) * smoothstep(0.9, 0.2, ny)

    // Turbulent upward motion
    const turbulence = warpedFbm(nx * 5 + T * 0.2, ny * 3 + T * 0.8, T * 0.5, 2.0) * plumeShape

    // Mineral particles
    const minerals = clamp01(fbm(nx * 10, ny * 10 + T * 3, 2) - 0.6) * 2 * smoothstep(0.8, 0.2, Math.abs(nx - 0.5))
    const heat = clamp01(turbulence + minerals * 0.3)

    return {
      lift: (heat * 5 + plumeShape * 2) * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(15, 50, heat) - plumeShape * 10),
      sat: lerp(50, 95, heat),
      light: lerp(6, 60, heat),
    }
  },
}

/** Golden treasure gleams scattered across dark seabed. */
export const patternSunkenTreasure: CubePattern = {
  id: 'sunken-treasure',
  title: 'Sunken Treasure Gleam',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.4, 0.12)

    // Sandy seabed
    const sand = fbm(nx * 8, ny * 8 + T * 0.05, 4) * 0.3 + 0.5

    // Treasure glint points — Voronoi cell centers
    const v = voronoi(nx * 8 - T * 0.05, ny * 8)
    const glint = smoothstep(0.06, 0.0, v.dist1)
    // Only some cells glint (use hash to filter)
    const isGold = hash2i(Math.floor(nx * 12 + T * 0.05), Math.floor(ny * 10)) > 0.65
    const goldGlint = glint * (isGold ? 1 : 0)

    // Twinkle animation
    const sparkle = (Math.sin(T * 5 + v.dist1 * 50) * 0.5 + 0.5) * goldGlint

    // Slow current
    const current = fbm(nx * 3 + T * 0.15, ny * 2, 3) * 0.2

    return {
      lift: (sparkle * 4 + sand + current * 0.5) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(200, 45, sparkle) + sand * 10),
      sat: lerp(30, 85, sparkle),
      light: lerp(15, 80, clamp01(sparkle * 0.7 + sand * 0.3)),
    }
  },
}

/** Icy fjord water with floating ice plates and deep blue depth. */
export const patternNarwhalIcefjord: CubePattern = {
  id: 'narwhal-icefjord',
  title: 'Narwhal Icefjord',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.3, 0.09)

    // Ice floes — Voronoi plates
    const v = voronoi(nx * 5 + T * 0.08, ny * 4)
    const icePlate = smoothstep(0.35, 0.1, v.dist1)
    const iceEdge = smoothstep(0.12, 0.03, v.dist2 - v.dist1)

    // Deep cold water underneath
    const deepWater = warpedFbm(nx * 3, ny * 2, T * 0.2, 1.3) * 0.3

    // Surface frost shimmer
    const frost = fbm(nx * 10 + T * 0.2, ny * 10, 3) * 0.3 * icePlate * 0.3

    const icy = clamp01(icePlate + iceEdge * 0.5 + frost)

    return {
      lift: (icy * 3 + deepWater + iceEdge * 1.5) * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(210, 195, icy) + deepWater * 10),
      sat: lerp(35, 55, clamp01(1 - icy)),
      light: lerp(20, 88, icy),
    }
  },
}

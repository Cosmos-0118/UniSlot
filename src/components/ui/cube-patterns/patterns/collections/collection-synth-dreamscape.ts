import type { CubePattern, PatternContext } from '../../types'
import {
  clamp01, fbm, warpedFbm, ridgedFbm, voronoi,
  smoothstep, lerp, speed, wrapHue, hash2i, fract01
} from '../_shared'

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION: Synth & Dreamscape — 10 patterns
// Digital, retro-futuristic, and abstract — heavy on structure and color.
// ═══════════════════════════════════════════════════════════════════════════

/** Neon grid city with scanning beams and holographic color shifts. */
export const patternCyberNeon: CubePattern = {
  id: 'cyber-neon',
  title: 'Cyber Neon Grid',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 1.0, 0.3)

    // Perspective grid — lines converge toward vanishing point
    const gridX = smoothstep(0.03, 0.0, Math.abs(fract01(nx * 12 + T * 0.1) - 0.5) - 0.42)
    const gridY = smoothstep(0.03, 0.0, Math.abs(fract01(ny * 8 + T * 0.05) - 0.5) - 0.42)
    const grid = Math.max(gridX, gridY)

    // Scanning beam
    const scanY = fract01(T * 0.3)
    const scan = smoothstep(0.04, 0.0, Math.abs(ny - scanY))

    // Neon glow — domain warped color
    const glow = warpedFbm(nx * 3, ny * 2, T * 0.4, 1.2) * 0.4

    const intensity = clamp01(grid * 0.6 + scan * 0.8 + glow)

    return {
      lift: (intensity * 4 + scan * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(280, 190, clamp01(nx + glow)) + scan * 60),
      sat: lerp(70, 100, intensity),
      light: lerp(8, 65, intensity),
    }
  },
}

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

/** Retro synthwave horizon with sun disk and perspective grid floor. */
export const patternSynthwaveSunset: CubePattern = {
  id: 'synthwave-sunset',
  title: 'Synthwave Sunset',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.5, 0.15)

    // Sun disk
    const sunDist = Math.sqrt((nx - 0.5) ** 2 + (ny - 0.3) ** 2 * 2)
    const sun = smoothstep(0.22, 0.0, sunDist)
    // Horizontal scan lines through sun
    const scanlines = Math.sin(ny * 80) * 0.5 + 0.5
    const sunWithLines = sun * lerp(0.7, 1.0, scanlines)

    // Sky gradient
    const sky = smoothstep(0.7, 0.0, ny) * (1 - sun)

    // Perspective floor grid (below horizon at ny > 0.55)
    const floorZone = smoothstep(0.52, 0.65, ny)
    const floorY = 1 / (ny - 0.5 + 0.01)
    const gridX = smoothstep(0.06, 0.0, Math.abs(fract01(nx * 8) - 0.5) - 0.4)
    const gridZ = smoothstep(0.06, 0.0, Math.abs(fract01(floorY * 0.3 - T * 0.5) - 0.5) - 0.4)
    const floor = Math.max(gridX, gridZ) * floorZone

    return {
      lift: (sunWithLines * 4 + floor * 3 + sky) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(310, 30, clamp01(ny * 1.5)) + floor * 20),
      sat: lerp(80, 100, clamp01(sunWithLines + floor)),
      light: lerp(10, 70, clamp01(sunWithLines + sky * 0.3 + floor * 0.5)),
    }
  },
}

/** Shattered holographic surface with rapid color cycling. */
export const patternHoloFracture: CubePattern = {
  id: 'holo-fracture',
  title: 'Holographic Fracture',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.8, 0.25)

    // Shatter pattern — Voronoi with animated movement
    const v = voronoi(nx * 8 + Math.sin(T * 0.5) * 0.5, ny * 7 - Math.cos(T * 0.4) * 0.3)
    const shard = smoothstep(0.3, 0.05, v.dist1)
    const crack = smoothstep(0.08, 0.01, v.dist2 - v.dist1)

    // Holographic shift — tight palette of cyan, blue, magenta
    const shardId = hash2i(Math.floor((nx + Math.sin(T * 0.5) * 0.5) * 8), Math.floor((ny - Math.cos(T * 0.4) * 0.3) * 7))

    // Glitch flicker
    const glitch = Math.sin(T * 15 + shardId * 20) > 0.85 ? 0.5 : 0

    return {
      lift: (shard * 3 + crack * 2.5 + glitch * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(180 + shardId * 120 + T * 10),
      sat: lerp(60, 100, clamp01(shard + crack)),
      light: lerp(20, 70, clamp01(shard + crack * 0.5 + glitch)),
    }
  },
}

/** Digital rain / falling code with bright leading drops and fading trails. */
export const patternMatrixCascade: CubePattern = {
  id: 'matrix-cascade',
  title: 'Matrix Cascade',
  sample({ col, row, rows, t, reduced }: PatternContext) {
    const ny = row / rows
    const T = t * speed(reduced, 0.6, 0.18)

    // Each column has its own speed and phase
    const colPhase = hash2i(col, 0)
    const colSpeed = 0.3 + colPhase * 0.4

    // Falling drop position
    const dropPos = fract01(T * colSpeed + colPhase * 3)
    const distToDrop = ny - dropPos
    const normalDist = ((distToDrop % 1) + 1) % 1

    // Bright head
    const head = smoothstep(0.04, 0.0, normalDist)
    // Fading trail behind
    const trail = smoothstep(0.4, 0.0, normalDist) * (1 - head)

    // Glyph shimmer
    const glyph = hash2i(col, Math.floor(ny * rows + T * 3)) > 0.5 ? 1 : 0.7

    const intensity = clamp01(head + trail * 0.6) * glyph

    return {
      lift: (head * 4 + trail * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(120, 140, trail) + head * 30),
      sat: lerp(50, 100, intensity),
      light: lerp(4, 85, intensity),
    }
  },
}

/** Dark rainy city with reflected neon puddle glows. */
export const patternNeonNoirRain: CubePattern = {
  id: 'neon-noir-rain',
  title: 'Neon Noir Rain',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.7, 0.2)

    // Rain streaks
    const rain = clamp01(fbm(nx * 12, ny * 3 + T * 4, 2) - 0.5) * smoothstep(0.5, 0.0, ny)

    // Neon sign glow — bright patches with color
    const sign1 = smoothstep(0.15, 0.0, Math.sqrt((nx - 0.3) ** 2 * 4 + (ny - 0.25) ** 2 * 8))
    const sign2 = smoothstep(0.12, 0.0, Math.sqrt((nx - 0.75) ** 2 * 5 + (ny - 0.35) ** 2 * 6))

    // Wet ground reflections (bottom half mirrors top)
    const wetGround = smoothstep(0.55, 0.75, ny)
    const reflection = (sign1 + sign2) * wetGround * 0.5
    const puddle = warpedFbm(nx * 6, ny * 2, T * 0.3, 1.0) * wetGround * 0.3

    const neon = clamp01(sign1 + sign2 + reflection + rain * 0.3 + puddle)

    return {
      lift: (neon * 4 + rain * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(330, 200, clamp01(sign2 - sign1 + 0.5)) + puddle * 30),
      sat: lerp(20, 95, neon),
      light: lerp(5, 65, neon),
    }
  },
}

/** Morphing liquid chrome with impossible iridescent reflections. */
export const patternAcidChrome: CubePattern = {
  id: 'acid-chrome',
  title: 'Acid Chrome',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.6, 0.18)

    // Chrome surface — heavily domain-warped for liquid metal
    const chrome = warpedFbm(nx * 4, ny * 3, T * 0.5, 2.5)
    // Secondary warp layer for extra richness
    const warp2 = warpedFbm(nx * 3 + chrome * 0.5, ny * 2.5 - chrome * 0.3, T * 0.3, 1.8)

    // Iridescent color cycling based on surface normal
    const iridescentPhase = chrome * 3 + warp2 * 2 + T * 0.5

    return {
      lift: (clamp01(chrome + 0.5) * 4 + warp2) * (reduced ? 0.5 : 1),
      hue: wrapHue(220 + Math.sin(iridescentPhase) * 60),
      sat: lerp(75, 100, clamp01(Math.abs(chrome))),
      light: lerp(25, 70, clamp01(chrome * 0.5 + warp2 * 0.3 + 0.5)),
    }
  },
}

/** Crossing laser beams sweeping across a dark arena. */
export const patternLaserArena: CubePattern = {
  id: 'laser-arena',
  title: 'Laser Arena',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 1.2, 0.35)

    // Multiple rotating laser beams from different origins
    const a1 = Math.atan2(ny - 0.0, nx - 0.0) + T * 0.8
    const beam1 = smoothstep(0.03, 0.0, Math.abs(Math.sin(a1 * 3)))

    const a2 = Math.atan2(ny - 0.0, nx - 1.0) - T * 0.6
    const beam2 = smoothstep(0.03, 0.0, Math.abs(Math.sin(a2 * 2.5)))

    const a3 = Math.atan2(ny - 1.0, nx - 0.5) + T * 1.1
    const beam3 = smoothstep(0.03, 0.0, Math.abs(Math.sin(a3 * 2)))

    // Intersection glow
    const beamSum = beam1 + beam2 + beam3
    const intersection = smoothstep(1.0, 2.0, beamSum) * 0.5

    // Smoke haze
    const smoke = fbm(nx * 5 + T * 0.2, ny * 4 - T * 0.1, 3) * 0.15

    const intensity = clamp01(beamSum * 0.5 + intersection + smoke)

    return {
      lift: (beamSum * 2.5 + intersection * 4) * (reduced ? 0.5 : 1),
      hue: wrapHue(320 + beam1 * 20 - beam2 * 40 + beam3 * 60),
      sat: lerp(80, 100, intensity),
      light: lerp(3, 70, intensity),
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

/** Glitchy data corruption — tearing, color separation, block artifacts. */
export const patternDatamoshTide: CubePattern = {
  id: 'datamosh-tide',
  title: 'Datamosh Tide',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.8, 0.25)

    // Block corruption — quantized regions
    const blockX = Math.floor(nx * 10 + Math.sin(T * 0.5) * 2) / 10
    const blockY = Math.floor(ny * 8 + Math.cos(T * 0.4) * 1.5) / 8

    // Tear lines — horizontal displacement
    const tearStrength = clamp01(Math.sin(T * 3 + ny * 5) - 0.7) * 3
    const tornNx = nx + tearStrength * 0.15

    // RGB channel split
    const rCh = warpedFbm(tornNx * 4 + 0.1, ny * 3, T * 0.4, 1.5)
    const gCh = warpedFbm(tornNx * 4 - 0.1, ny * 3, T * 0.4, 1.5)
    const bCh = warpedFbm(blockX * 4, blockY * 3, T * 0.3, 1.2)

    // Glitch blocks
    const glitchBlock = hash2i(Math.floor(blockX * 10), Math.floor(blockY * 8 + T * 2))
    const isGlitched = glitchBlock > 0.75

    const intensity = clamp01(Math.abs(rCh) + Math.abs(gCh) * 0.5 + (isGlitched ? 0.5 : 0))

    return {
      lift: (intensity * 3.5 + tearStrength * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(isGlitched ? 0 : lerp(180, 300, clamp01(bCh + 0.5))),
      sat: lerp(60, 100, intensity),
      light: lerp(8, 65, intensity),
    }
  },
}

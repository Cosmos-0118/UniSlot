import type { CubePattern, PatternContext } from '../../types'
import { clamp01, hash2i, noise2D, speed, wrapHue } from '../_shared'

/** Earth, weather, and open sky — ten cohesive “places”. */
export const patternAurora: CubePattern = {
  id: 'aurora',
  title: 'Aurora Borealis',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const noise = noise2D(nx, ny, t * speed(reduced, 1.0, 0.4), 1.2)
    return {
      lift: (noise + 1) * 2.5 * (reduced ? 0.4 : 1),
      hue: 210 + noise * 70,
      sat: 85 + Math.sin(t * 0.5 + nx) * 15,
      light: 25 + (noise + 1) * 20,
    }
  },
}

export const patternGoldenHour: CubePattern = {
  id: 'golden-hour',
  title: 'Golden Hour',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const dx = (col - cols / 2) / cols
    const dy = (row - rows / 2) / rows
    const dist = Math.sqrt(dx * dx + dy * dy)
    const ripple = Math.sin(dist * 12 - t * speed(reduced, 0.7, 0.3))
    const sweep = Math.cos(dx * 5 + t * speed(reduced, 0.4, 0.2))
    const noise = ripple * 0.6 + sweep * 0.4
    return {
      lift: (noise + 1) * 2.0 * (reduced ? 0.5 : 1),
      hue: 20 + noise * 20,
      sat: 85,
      light: 40 + (noise + 1) * 15,
    }
  },
}

export const patternAbyssalGlow: CubePattern = {
  id: 'abyssal-glow',
  title: 'Abyssal Glow',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const depth = ny * 0.85
    const wave1 = Math.sin(nx * 3 + ny * 3 + t * speed(reduced, 0.3, 0.1))
    const wave2 = Math.cos(nx * -2 + ny * 4 - t * speed(reduced, 0.25, 0.15))
    const noise = (wave1 + wave2) / 2
    const bio = Math.sin(nx * 31 + row * 0.9 + t * speed(reduced, 0.55, 0.15)) * Math.sin(ny * 24 - t * speed(reduced, 0.4, 0.12))
    const pin = bio > 0.82 ? 1 : 0
    return {
      lift: ((noise + 1) * 1.35 + pin * 0.9 + depth * 0.25) * (reduced ? 0.35 : 1),
      hue: wrapHue(198 - noise * 22 - depth * 12 + pin * 25),
      sat: 55 + depth * 25 + noise * 12 + pin * 30,
      light: 6 + (1 - depth) * 14 + (noise + 1) * 9 + pin * 28,
    }
  },
}

export const patternCherryBlossom: CubePattern = {
  id: 'cherry-blossom',
  title: 'Cherry Blossom',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const wind = t * speed(reduced, 0.35, 0.12)
    const branch = Math.sin(nx * 3.2 + wind * 0.4) * 0.12 + 0.38
    const along = Math.abs(ny - branch)
    const wood = clamp01(1 - along * 55)
    const petal = noise2D(nx * 1.2, ny * 1.2, t * speed(reduced, 0.85, 0.28), 2.4)
    const bloom = clamp01(petal * 0.55 + 0.45) * (1 - wood * 0.85)
    return {
      lift: (wood * 1.8 + bloom * 2.8) * (reduced ? 0.5 : 1),
      hue: wrapHue(32 + wood * 18 + bloom * 310),
      sat: 22 + wood * 35 + bloom * 55,
      light: 38 + wood * 25 + bloom * 38,
    }
  },
}

export const patternForestCanopy: CubePattern = {
  id: 'forest-canopy',
  title: 'Forest Canopy',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const canopy = Math.exp(-((nx - 0.5 + Math.sin(t * speed(reduced, 0.12, 0.04)) * 0.08) ** 2) * 14) * (1 - ny * 0.35)
    const dapple = noise2D(nx, ny, t * speed(reduced, 0.45, 0.16), 1.6)
    const trunk = Math.exp(-Math.abs(nx - (0.28 + (row % 5) * 0.09)) * 120) * ny
    const noise = noise2D(ny, nx, t * speed(reduced, 0.5, 0.2), 1.5)
    return {
      lift: ((noise + 1) * 1.45 + canopy * 0.9 + trunk * 1.2) * (reduced ? 0.42 : 1),
      hue: wrapHue(118 + noise * 28 + dapple * 12),
      sat: 48 + noise * 18 + canopy * 22,
      light: 12 + dapple * 22 + canopy * 35 + ny * 18,
    }
  },
}

export const patternDesertDunes: CubePattern = {
  id: 'desert-dunes',
  title: 'Desert Dunes',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const wave = Math.sin(nx * 10 + ny * 2 - t * speed(reduced, 0.6, 0.2))
    const sub = Math.cos(ny * 8 + t * speed(reduced, 0.3, 0.1))
    const noise = wave * 0.7 + sub * 0.3
    return {
      lift: (noise + 1) * 2.8 * (reduced ? 0.5 : 1),
      hue: 35 + noise * 10,
      sat: 70,
      light: 50 + noise * 20,
    }
  },
}

export const patternCoralReef: CubePattern = {
  id: 'coral-reef',
  title: 'Coral Reef',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const noise = noise2D(nx, ny, t * speed(reduced, 0.9, 0.3), 3.0)
    const caustic = Math.sin(nx * 28 + ny * 22 - t * speed(reduced, 0.7, 0.2)) * 0.5 + 0.5
    const depth = clamp01(0.35 + ny * 0.5)
    return {
      lift: (Math.abs(noise) * 3.6 + caustic * 0.6) * (reduced ? 0.5 : 1),
      hue: wrapHue(348 + Math.sin(t * speed(reduced, 0.4, 0.12) + nx * 5) * 42 + ny * 8),
      sat: clamp01(0.72 + Math.abs(noise) * 0.22) * 100,
      light: clamp01(0.42 + noise * 0.22 + caustic * 0.12 - depth * 0.08) * 100,
    }
  },
}

export const patternVolcanicEmber: CubePattern = {
  id: 'volcanic-ember',
  title: 'Volcanic Ember',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const noise = noise2D(nx, ny, t * speed(reduced, 1.2, 0.4), 2.5)
    const lava = noise2D(nx * 0.7, ny * 0.7, t * speed(reduced, 0.18, 0.06), 1.2)
    const ridge = Math.sin(nx * 9 + ny * 4 - t * speed(reduced, 0.22, 0.07)) * 0.5 + 0.5
    const ember = noise > 0.52
    const heat = clamp01((noise - 0.2) * 1.8) * (lava * 0.5 + 0.5)
    return {
      lift: (ember ? 3.6 : 0.85) * (reduced ? 0.55 : 1) + ridge * 0.5 + heat * 0.4,
      hue: wrapHue(ember ? 18 + noise * 15 : 12 + lava * 25 + ridge * 8),
      sat: ember ? 96 : 18 + heat * 45 + ridge * 20,
      light: ember ? 58 + noise * 12 : 8 + heat * 28 + ridge * 15 + lava * 10,
    }
  },
}

export const patternArcticIce: CubePattern = {
  id: 'arctic-ice',
  title: 'Arctic Ice',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const crack = Math.cos(nx * 15 - ny * 15 + t * speed(reduced, 0.3, 0.1))
    const drift = Math.sin(nx * 3 + t * speed(reduced, 0.5, 0.2))
    const noise = crack * 0.4 + drift * 0.6
    return {
      lift: (noise + 1) * 2.0 * (reduced ? 0.4 : 1),
      hue: 190 + noise * 10,
      sat: 30,
      light: 85 + noise * 10,
    }
  },
}

export const patternMidnightSky: CubePattern = {
  id: 'midnight-sky',
  title: 'Midnight Sky',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const scale = Math.max(18, Math.min(48, (cols + rows) * 0.02))
    const starPhase = hash2i(col, row)
    const twinkle = Math.sin(nx * scale * 8 + ny * scale * 10 + t * speed(reduced, 5, 1.2) + starPhase * 6)
    const cloud = noise2D(nx, ny, t * speed(reduced, 0.12, 0.04), 1.0)
    const milky = Math.sin(nx * 2.5 + ny * 1.2 + t * speed(reduced, 0.08, 0.025)) * 0.15
    const isStar = twinkle > 0.93 && cloud < 0.15 && starPhase > 0.72
    return {
      lift: isStar ? 3 * (reduced ? 0.5 : 1) : (cloud + 1) * 0.55 + milky * 0.8,
      hue: wrapHue(238 + milky * 25 + (isStar ? starPhase * 40 : cloud * 8)),
      sat: isStar ? 35 : 38 + cloud * 15,
      light: isStar ? 88 : 10 + cloud * 8 + milky * 25,
    }
  },
}

export const NATURE_LAND_SKY_PATTERNS: readonly CubePattern[] = [
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
]

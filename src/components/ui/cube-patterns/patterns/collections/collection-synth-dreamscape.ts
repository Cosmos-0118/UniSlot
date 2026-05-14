import type { CubePattern, PatternContext } from '../../types'
import { fract01, noise2D, speed, wrapHue } from '../_shared'

export const patternCyberNeon: CubePattern = {
  id: 'cyber-neon',
  title: 'Cyber Neon Grid',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const grid = Math.sin(nx * cols * 0.45 + t * speed(reduced, 1.2, 0.35)) * Math.cos(ny * rows * 0.35 - t * speed(reduced, 0.9, 0.25))
    const scan = Math.sin(ny * 20 - t * speed(reduced, 4, 1))
    const pulse = (grid + 1) * 0.5 + scan * 0.15
    return {
      lift: (pulse * 2.8 + 0.4) * (reduced ? 0.5 : 1),
      hue: wrapHue(nx * 120 + ny * 80 + t * speed(reduced, 35, 8)),
      sat: 92,
      light: 22 + pulse * 35,
    }
  },
}

export const patternEtherealGlass: CubePattern = {
  id: 'ethereal-glass',
  title: 'Ethereal Glass',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const parallax = (ny - 0.5) * 0.35
    const prism = Math.sin(nx * 6 + ny * 4 + t * speed(reduced, 0.35, 0.1) + parallax * 3)
    const caustic = Math.cos(nx * 22 - ny * 18 + t * speed(reduced, 0.6, 0.18) + col * 0.02)
    const glass = (prism + caustic) * 0.5
    const edge = Math.exp(-Math.abs(nx - 0.5) * 5) * (1 - Math.abs(ny - 0.5) * 1.2)
    return {
      lift: (glass + 1.2) * 2.0 * (0.92 + edge * 0.12) * (reduced ? 0.45 : 1),
      hue: wrapHue(198 + prism * 52 + parallax * 40),
      sat: 28 + Math.abs(caustic) * 48 + edge * 15,
      light: 70 + glass * 24 + edge * 10,
    }
  },
}

export const patternSynthwaveSunset: CubePattern = {
  id: 'synthwave-sunset',
  title: 'Synthwave Sunset',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const sun = Math.exp(-((nx - 0.5) ** 2 * 3 + (ny - 0.35) ** 2) * 6)
    const grid = Math.sin(ny * 25 + t * speed(reduced, 1.5, 0.4)) * Math.sin(nx * 40 + t * speed(reduced, 0.8, 0.2))
    return {
      lift: (sun * 2.5 + (grid + 1) * 0.9) * (reduced ? 0.5 : 1),
      hue: wrapHue(318 + nx * 42 - sun * 75 + ny * 6),
      sat: Math.min(100, 85 - sun * 20),
      light: Math.min(100, 25 + sun * 50 + ny * 30),
    }
  },
}

export const patternHoloFracture: CubePattern = {
  id: 'holo-fracture',
  title: 'Holographic Fracture',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const frac = Math.abs(Math.sin(nx * 50 + t * speed(reduced, 2, 0.5))) * Math.abs(Math.cos(ny * 50 - t * speed(reduced, 1.7, 0.45)))
    const chroma = Math.sin(nx * 12 + ny * 10 + t * speed(reduced, 3, 0.8))
    return {
      lift: (frac * 2.8 + 0.5) * (reduced ? 0.5 : 1),
      hue: wrapHue(200 + chroma * 160),
      sat: 55 + frac * 40,
      light: 45 + frac * 35,
    }
  },
}

export const patternMatrixCascade: CubePattern = {
  id: 'matrix-cascade',
  title: 'Matrix Cascade',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const colPhase = fract01(col * 0.17 + row * 0.03)
    const drop = fract01(ny * 3 + t * speed(reduced, 0.5, 0.15) + colPhase)
    const head = drop < 0.08 ? 1 : 0
    const trail = Math.sin(drop * 50) * (1 - ny) * 0.5
    const glyph = Math.sin(col * 3.1 + row * 2.7 + drop * 20) * 0.5 + 0.5
    return {
      lift: (head * 2.5 + trail + 0.55 + nx * 0.35) * (reduced ? 0.5 : 1),
      hue: wrapHue(108 + head * 22 + glyph * 12),
      sat: 62 + head * 28 + glyph * 10,
      light: head ? 82 + glyph * 12 : 8 + trail * 42 + glyph * 8,
    }
  },
}

export const patternNeonNoirRain: CubePattern = {
  id: 'neon-noir-rain',
  title: 'Neon Noir Rain',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const wet = noise2D(nx, ny, t * speed(reduced, 0.2, 0.06), 2)
    const sign = Math.sin(nx * 8 + t * speed(reduced, 0.5, 0.12)) > 0.7 ? 1 : 0
    const streak = Math.sin(nx * 100 + ny * 30 - t * speed(reduced, 6, 1.5)) * (1 - ny)
    return {
      lift: ((wet + 1) * 0.5 + sign * 1.8 + streak * 0.8) * (reduced ? 0.5 : 1),
      hue: wrapHue(sign ? 330 : 250 + wet * 20),
      sat: sign ? 95 : 25,
      light: sign ? 55 : 8 + wet * 15,
    }
  },
}

export const patternAcidChrome: CubePattern = {
  id: 'acid-chrome',
  title: 'Acid Chrome',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const swirl = Math.sin(nx * 8 + Math.cos(ny * 9 + t * speed(reduced, 0.4, 0.1)) * 3)
    const drip = Math.cos(nx * 25 - ny * 20 + t * speed(reduced, 1.2, 0.3))
    const acid = (swirl + drip) * 0.5
    return {
      lift: (acid + 1.3) * 2.4 * (reduced ? 0.5 : 1),
      hue: wrapHue(140 + acid * 100 + t * speed(reduced, 18, 4)),
      sat: 88,
      light: 35 + Math.abs(acid) * 40,
    }
  },
}

export const patternLaserArena: CubePattern = {
  id: 'laser-arena',
  title: 'Laser Arena',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const beam = Math.abs(Math.sin(nx * 3 + ny * 40 - t * speed(reduced, 3, 0.8)))
    const sweep = Math.abs(Math.cos(nx * 30 + ny * 3 + t * speed(reduced, 2.5, 0.6)))
    const hit = beam * sweep
    return {
      lift: (hit * 3.2 + 0.5) * (reduced ? 0.5 : 1),
      hue: wrapHue((hit > 0.85 ? 318 : 188) + nx * 32),
      sat: 90,
      light: 12 + hit * 70,
    }
  },
}

export const patternQuartzCavern: CubePattern = {
  id: 'quartz-cavern',
  title: 'Quartz Cavern',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const facet = Math.cos(nx * 18 + ny * 14 + t * speed(reduced, 0.25, 0.08))
    const sparkle = noise2D(nx * 4, ny * 4, t * speed(reduced, 2, 0.5), 3)
    const gem = sparkle > 0.55 ? 1 : 0
    return {
      lift: ((facet + 1) * 1.2 + gem * 2) * (reduced ? 0.45 : 1),
      hue: wrapHue(280 + facet * 40),
      sat: 40 + gem * 50,
      light: 55 + facet * 25 + gem * 30,
    }
  },
}

export const patternDatamoshTide: CubePattern = {
  id: 'datamosh-tide',
  title: 'Datamosh Tide',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const block = Math.floor(nx * 12 + t * speed(reduced, 0.3, 0.08)) % 3
    const tear = Math.sin(ny * 60 + block * 10 - t * speed(reduced, 5, 1.2))
    const rgb = noise2D(nx + block * 0.1, ny, t * speed(reduced, 1.5, 0.4), 1.5)
    return {
      lift: ((tear + 1) * 1.1 + (rgb + 1) * 0.6) * (reduced ? 0.5 : 1),
      hue: wrapHue(block * 120 + rgb * 80 + t * speed(reduced, 50, 10)),
      sat: 75,
      light: 30 + rgb * 40,
    }
  },
}

export const SYNTH_DREAMSCAPE_PATTERNS: readonly CubePattern[] = [
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
]

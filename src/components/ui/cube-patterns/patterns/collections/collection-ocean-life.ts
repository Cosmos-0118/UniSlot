import type { CubePattern, PatternContext } from '../../types'
import { clamp01, fract01, noise2D, softBlob, speed, wrapHue } from '../_shared'

export const patternWhaleSongDepth: CubePattern = {
  id: 'whale-song-depth',
  title: 'Whale Song Depth',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const slow = t * speed(reduced, 0.12, 0.04)
    const body = softBlob(nx, ny, 0.5 + Math.sin(slow) * 0.15, 0.45 + Math.cos(slow * 0.7) * 0.08, 0.22, 0.5)
    const fluke = Math.sin(nx * 20 + ny * 3 - slow * 2) * 0.15
    const ripple = Math.sin(nx * 14 + ny * 2.5 - slow * 3 + col * 0.04) * 0.08
    const deep = noise2D(nx, ny, slow, 0.8)
    return {
      lift: (body * 3.2 + (deep + 1) * 0.6 + fluke + ripple + 1) * (reduced ? 0.55 : 1),
      hue: 215 + body * 25,
      sat: 55 + body * 35,
      light: 8 + body * 35 + deep * 8,
    }
  },
}

export const patternJellyfishBloom: CubePattern = {
  id: 'jellyfish-bloom',
  title: 'Jellyfish Bloom',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const cx = 0.5 + Math.sin(t * speed(reduced, 0.35, 0.1)) * 0.25
    const bell = softBlob(nx, ny, cx, 0.25, 0.18, 0.55)
    const pulse = Math.sin(t * speed(reduced, 2.2, 0.6) + ny * 10) * 0.5 + 0.5
    const tent = Math.abs(Math.sin(nx * Math.min(48, cols * 0.35) + t * speed(reduced, 1.5, 0.4))) * (1 - ny) * pulse
    return {
      lift: (bell * 3 + tent * 2) * (reduced ? 0.5 : 1),
      hue: 285 + bell * 40,
      sat: 70 + tent * 25,
      light: 35 + bell * 40 + tent * 15,
    }
  },
}

export const patternKelpCathedral: CubePattern = {
  id: 'kelp-cathedral',
  title: 'Kelp Cathedral',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const sway = Math.sin(nx * 8 + t * speed(reduced, 0.9, 0.25)) * (1 - ny)
    const strand = Math.sin(nx * 25 + ny * 6 - t * speed(reduced, 0.5, 0.15))
    const lightShaft = Math.exp(-Math.abs(nx - 0.52) * 18) * (1 - ny * 0.3)
    return {
      lift: ((sway + strand) * 0.5 + 1) * 2.2 * (reduced ? 0.45 : 1),
      hue: 145 + strand * 15,
      sat: 50 + lightShaft * 30,
      light: 18 + lightShaft * 45 + ny * 25,
    }
  },
}

export const patternBiolumTide: CubePattern = {
  id: 'biolum-tide',
  title: 'Bioluminescent Tide',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const wave = Math.sin(nx * 6 - t * speed(reduced, 0.8, 0.25))
    const shore = clamp01(1 - ny * 1.4 + wave * 0.15)
    const spark = noise2D(nx * 3, ny * 3, t * speed(reduced, 2.5, 0.7), 2.2)
    const bloom = shore * clamp01((spark + 0.35) * 1.1) * 1.65
    return {
      lift: (1 + bloom) * 2.4 * (reduced ? 0.5 : 1),
      hue: 175 + spark * 60,
      sat: 75 + bloom * 20,
      light: 12 + bloom * 55 + shore * 15,
    }
  },
}

export const patternMantaBallet: CubePattern = {
  id: 'manta-ballet',
  title: 'Manta Ray Ballet',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const u = t * speed(reduced, 0.45, 0.12)
    const wingL = softBlob(nx, ny, 0.35 + Math.sin(u) * 0.1, 0.5, 0.2, 0.45)
    const wingR = softBlob(nx, ny, 0.65 - Math.sin(u * 1.1) * 0.1, 0.5, 0.2, 0.45)
    const spots = Math.sin(nx * 50 + ny * 40 + u * 3) > 0.85 ? 1 : 0
    const m = Math.max(wingL, wingR)
    return {
      lift: (m * 2.8 + spots * 1.2 + 0.4) * (reduced ? 0.55 : 1),
      hue: 200 + spots * 25,
      sat: 35 + m * 40,
      light: 22 + m * 35,
    }
  },
}

export const patternOctopusGarden: CubePattern = {
  id: 'octopus-garden',
  title: 'Octopus Garden',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const cx = 0.5
    const cy = 0.5
    const ang = Math.atan2(ny - cy, nx - cx)
    const rad = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2)
    const spiral = Math.sin(ang * 5 + rad * 22 - t * speed(reduced, 1.1, 0.3))
    const ink = noise2D(nx, ny, t * speed(reduced, 0.25, 0.08), 1.2)
    return {
      lift: ((spiral + 1) * 1.2 + (ink + 1) * 0.8) * (reduced ? 0.5 : 1),
      hue: 265 + spiral * 30,
      sat: 45 + Math.abs(spiral) * 40,
      light: 15 + (spiral + 1) * 18 + ink * 10,
    }
  },
}

export const patternSeaTurtleGlide: CubePattern = {
  id: 'sea-turtle-glide',
  title: 'Sea Turtle Glide',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const swim = fract01(t * speed(reduced, 0.045, 0.015))
    const cx = 0.1 + swim * 0.72
    const path = ny - Math.sin(nx * 3 + t * speed(reduced, 0.35, 0.1)) * 0.1 - 0.02 * Math.sin(swim * Math.PI * 2)
    const shell = softBlob(nx, ny, cx, path, 0.13, 0.48)
    const flip = Math.sin(nx * 40 - t * speed(reduced, 2, 0.5)) * 0.12 * shell
    const caust = Math.sin(nx * 22 + ny * 18 - t * speed(reduced, 0.55, 0.15)) * 0.5 + 0.5
    return {
      lift: (shell * 2.8 + flip + 0.85 + caust * shell * 0.35) * (reduced ? 0.5 : 1),
      hue: wrapHue(148 + shell * 35 + caust * 12),
      sat: 38 + shell * 42 + caust * 15,
      light: 22 + shell * 38 + caust * 22,
    }
  },
}

export const patternHydrothermalShimmer: CubePattern = {
  id: 'hydrothermal-shimmer',
  title: 'Hydrothermal Shimmer',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const plume = Math.exp(-((nx - 0.48) ** 2 + (ny - 0.75) ** 2) * 80)
    const rise = Math.sin(nx * 15 + t * speed(reduced, 1.4, 0.35)) * plume
    const mineral = noise2D(nx, ny * 2, t * speed(reduced, 0.2, 0.06), 2)
    return {
      lift: (plume * 3 + (mineral + 1)) * (reduced ? 0.45 : 1),
      hue: 15 + rise * 25 + mineral * 20,
      sat: 60 + plume * 35,
      light: 10 + plume * 50 + mineral * 12,
    }
  },
}

export const patternSunkenTreasure: CubePattern = {
  id: 'sunken-treasure',
  title: 'Sunken Treasure Gleam',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const drift = t * speed(reduced, 0.04, 0.012)
    const chest = softBlob(nx, ny, 0.62 + Math.sin(drift) * 0.03, 0.55, 0.12, 0.35)
    const glint = Math.sin(nx * 80 + ny * 80 + t * speed(reduced, 4, 1)) > 0.92 ? 1 : 0
    const sand = noise2D(nx + drift * 0.08, ny + drift * 0.05, drift * 0.3, 1.5)
    const partic = noise2D(nx * 2, ny * 2, t * speed(reduced, 0.6, 0.18), 2.5)
    return {
      lift: (chest * 2.1 + glint * 2.6 + (sand + 1) * 0.45 + partic * 0.25) * (reduced ? 0.5 : 1),
      hue: wrapHue(42 + glint * 18 + chest * 8 + partic * 25),
      sat: 50 + chest * 32 + glint * 42,
      light: 16 + chest * 38 + glint * 55 + sand * 10 + ny * 6,
    }
  },
}

export const patternNarwhalIcefjord: CubePattern = {
  id: 'narwhal-icefjord',
  title: 'Narwhal Icefjord',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const ice = Math.cos(nx * 12 + ny * 8 + t * speed(reduced, 0.15, 0.05))
    const slot = Math.exp(-((ny - 0.55) ** 2) * 40)
    const hornX = 0.28 + fract01(t * speed(reduced, 0.055, 0.018)) * 0.44
    const horn = Math.exp(-((nx - hornX) ** 2 * 900 + (ny - 0.52) ** 2 * 220))
    const blow = Math.exp(-((nx - hornX - 0.04) ** 2 + (ny - 0.42) ** 2) * 200) * Math.sin(t * speed(reduced, 2.2, 0.5)) * 0.5 + 0.5
    return {
      lift: ((ice + 1) * 0.85 + slot * 1.15 + horn * 2.8 + blow * 0.6) * (reduced ? 0.5 : 1),
      hue: wrapHue(198 + ice * 14 + horn * 12),
      sat: 22 + horn * 58 + slot * 22 + blow * 25,
      light: 52 + ice * 22 + horn * 28 + blow * 18,
    }
  },
}

export const OCEAN_LIFE_PATTERNS: readonly CubePattern[] = [
  patternWhaleSongDepth,
  patternJellyfishBloom,
  patternKelpCathedral,
  patternBiolumTide,
  patternMantaBallet,
  patternOctopusGarden,
  patternSeaTurtleGlide,
  patternHydrothermalShimmer,
  patternSunkenTreasure,
  patternNarwhalIcefjord,
]

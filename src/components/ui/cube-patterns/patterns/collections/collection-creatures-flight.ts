import type { CubePattern, PatternContext } from '../../types'
import { clamp01, fract01, hash2i, noise2D, softBlob, speed, wrapHue } from '../_shared'

export const patternStarlingMurmuration: CubePattern = {
  id: 'starling-murmuration',
  title: 'Starling Murmuration',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const u = t * speed(reduced, 0.55, 0.15) + col * 0.008 - row * 0.005
    const curl =
      Math.sin(nx * 9 + u + Math.cos(ny * 7 + u * 0.5) * 2) +
      Math.cos(ny * 11 - u * 0.8 + Math.sin(nx * 5) * 1.5)
    const band = clamp01(1 - Math.abs(ny - 0.45 - Math.sin(nx * 4 + u) * 0.12) * 14)
    return {
      lift: ((curl + 2) * 0.7 + band) * (reduced ? 0.5 : 1),
      hue: 230 + curl * 25,
      sat: 35 + band * 45,
      light: 18 + band * 35 + curl * 8,
    }
  },
}

export const patternArcticTernArc: CubePattern = {
  id: 'arctic-tern-arc',
  title: 'Arctic Tern Migration',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const arc = Math.sin((nx + ny) * 4 - t * speed(reduced, 0.4, 0.12))
    const coast = Math.sin(nx * 2.1 + t * speed(reduced, 0.08, 0.025)) * 0.06
    const ribbon = clamp01(
      1 -
        Math.abs(nx * 0.72 + ny - 0.88 - Math.sin(t * speed(reduced, 0.25, 0.08) + nx * 1.5) * 0.08 - coast) *
          9
    )
    const wing = Math.sin(nx * 60 - t * speed(reduced, 3.5, 0.9)) * ribbon * 0.5 + 0.5
    return {
      lift: ((arc + 1) * 1.05 + ribbon * 2.4 + wing * 0.35) * (reduced ? 0.5 : 1),
      hue: wrapHue(202 + arc * 18 + ribbon * 12),
      sat: 48 + ribbon * 38 + wing * 12,
      light: 68 + ribbon * 25 - arc * 8 + wing * 10,
    }
  },
}

export const patternHummingbirdJewel: CubePattern = {
  id: 'hummingbird-jewel',
  title: 'Hummingbird Iridescence',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const core = softBlob(nx, ny, 0.5 + Math.sin(t * speed(reduced, 2.5, 0.6)) * 0.2, 0.48, 0.08, 0.4)
    const irid = Math.sin(nx * 30 + ny * 25 + t * speed(reduced, 6, 1.5))
    return {
      lift: (core * 3.5 + (irid + 1) * 0.5) * (reduced ? 0.45 : 1),
      hue: wrapHue(280 + irid * 120 + t * speed(reduced, 40, 8)),
      sat: 75 + core * 20,
      light: 40 + core * 35 + irid * 15,
    }
  },
}

export const patternMonarchRiver: CubePattern = {
  id: 'monarch-river',
  title: 'Monarch River',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const flow = ny - t * speed(reduced, 0.14, 0.048) + Math.sin(nx * 8 + col * 0.02) * 0.045
    const fract = fract01(flow)
    const wing = Math.sin(fract * 50 + nx * 22) * 0.5 + 0.5
    const vein = Math.sin(nx * 90 + fract * 30) * 0.08
    const sky = clamp01(1 - ny * 1.15)
    const breeze = noise2D(nx * 1.5, ny, t * speed(reduced, 0.25, 0.08), 1.4)
    return {
      lift: (wing * 2.1 + 0.75 + sky * 0.35 + Math.abs(vein) * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(24 + wing * 14 + breeze * 8 + sky * 8),
      sat: 72 + wing * 18 + sky * 10,
      light: 36 + wing * 28 + sky * 22 + breeze * 6,
    }
  },
}

export const patternFireflyMeadow: CubePattern = {
  id: 'firefly-meadow',
  title: 'Firefly Meadow',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const h = hash2i(col, row)
    const blink = Math.sin(t * speed(reduced, 3 + h * 2, 0.8 + h * 0.3) + h * 6)
    const grass = noise2D(nx, ny, t * speed(reduced, 0.15, 0.05), 1.8)
    const meadow = clamp01(0.35 + grass * 0.4)
    const fly = blink > 0.88 && meadow > 0.25 && meadow < 0.82
    return {
      lift: fly ? 3.2 * (reduced ? 0.55 : 1) : (grass + 1) * 0.7,
      hue: fly ? 58 : 125,
      sat: fly ? 100 : 45,
      light: fly ? 88 : 12 + grass * 20,
    }
  },
}

export const patternPhoenixEmber: CubePattern = {
  id: 'phoenix-ember',
  title: 'Phoenix Ember Rise',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const rise = Math.sin(nx * 14 + t * speed(reduced, 1.8, 0.45)) * (1 - ny)
    const heat = Math.exp(-((nx - 0.5) ** 2 + (ny - 0.85) ** 2) * 30)
    const ash = noise2D(nx, ny * 2, t * speed(reduced, 0.5, 0.15), 2)
    return {
      lift: (rise * 1.5 + heat * 3 + (ash + 1) * 0.4) * (reduced ? 0.5 : 1),
      hue: wrapHue(12 + rise * 25 + heat * 20),
      sat: 80 + heat * 15,
      light: 15 + rise * 30 + heat * 55,
    }
  },
}

export const patternDragonflyWetland: CubePattern = {
  id: 'dragonfly-wetland',
  title: 'Dragonfly Wetland',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const surface = 0.58 + Math.sin(nx * 4 + t * speed(reduced, 0.28, 0.09)) * 0.04
    const underwater = ny > surface
    const shoreBand = clamp01(1 - Math.abs(ny - surface) * 55)
    const reed = Math.sin(nx * 35 + t * speed(reduced, 0.42, 0.12)) * shoreBand * (underwater ? 0 : 1)
    const caust = underwater ? Math.sin(nx * 32 + ny * 28 - t * speed(reduced, 0.65, 0.18)) * 0.5 + 0.5 : 0
    const body = softBlob(nx, ny, 0.48 + Math.sin(t * speed(reduced, 0.9, 0.25)) * 0.12, surface - 0.08, 0.06, 0.42)
    const uWater = underwater ? 1 : 0
    const wing = Math.abs(Math.sin(nx * 62 + ny * 52 - t * speed(reduced, 8, 2))) * (1 - uWater * 0.35)
    return {
      lift: (reed * 1.4 + wing * 2.1 + body * 2.2 + caust * 0.9 + 0.55) * (reduced ? 0.5 : 1),
      hue: wrapHue(168 + wing * 45 + caust * 25 + uWater * 15),
      sat: 42 + reed * 28 + body * 25,
      light: underwater ? 22 + caust * 35 : 48 + wing * 28 + reed * 12,
    }
  },
}

export const patternSwanLakeMist: CubePattern = {
  id: 'swan-lake-mist',
  title: 'Swan Lake Mist',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const mist = noise2D(nx * 2, ny, t * speed(reduced, 0.12, 0.04), 1.0)
    const swan = softBlob(nx, ny, 0.5, 0.52 + Math.sin(t * speed(reduced, 0.2, 0.06)) * 0.05, 0.2, 0.55)
    const reflect = softBlob(nx, ny, 0.5, 0.58 - Math.sin(t * speed(reduced, 0.2, 0.06)) * 0.04, 0.16, 0.5) * 0.55
    const ripple = Math.sin(nx * 30 + t * speed(reduced, 1.1, 0.3)) * (1 - ny) * 0.15
    return {
      lift: ((mist + 1) * 0.6 + swan * 2 + reflect * 0.9 + ripple) * (reduced ? 0.45 : 1),
      hue: wrapHue(208 + mist * 18 + reflect * 25),
      sat: 14 + swan * 28 + reflect * 12,
      light: 76 + mist * 14 - swan * 8 + reflect * 8,
    }
  },
}

export const patternKiteFestival: CubePattern = {
  id: 'kite-festival',
  title: 'Kite Festival',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const h = hash2i(col + 3, row + 7)
    const h2 = hash2i(col + 11, row - 5)
    const drift = fract01(nx * 0.22 + ny * 0.18 + t * speed(reduced, 0.1, 0.032) + h * 0.37)
    const lane = Math.floor(h2 * 4)
    const cx = 0.06 + fract01(lane * 0.17 + drift * 0.73 + h * 0.19) * 0.78
    const cy = fract01(0.08 + lane * 0.22 + drift * 0.55 + h * 0.11)
    const kite = softBlob(nx, ny, cx, cy, 0.07 + h * 0.04, 0.38)
    const tail = Math.sin(nx * 25 - ny * 18 + t * speed(reduced, 1.8, 0.45)) * kite * 0.4
    return {
      lift: (kite * 3.2 + tail + 0.45) * (reduced ? 0.5 : 1),
      hue: wrapHue(h * 280 + lane * 22 + t * speed(reduced, 22, 5.5)),
      sat: 65 + kite * 30,
      light: 48 + kite * 32 + tail * 15,
    }
  },
}

export const patternRavenStorm: CubePattern = {
  id: 'raven-storm',
  title: 'Raven Storm',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const jitter = hash2i(col, row) * 0.04
    const bolt =
      Math.sin(nx * 88 + ny * 11 + t * speed(reduced, 12, 3)) > 0.97 - jitter ? 1 : 0
    const cloud = noise2D(nx, ny, t * speed(reduced, 0.35, 0.1), 1.4)
    const flock = Math.sin(nx * 22 + ny * 18 - t * speed(reduced, 1.2, 0.3))
    return {
      lift: (bolt * 4 + (flock + 1) * 0.9 + (cloud + 1) * 0.35) * (reduced ? 0.5 : 1),
      hue: 265 + bolt * 40,
      sat: 25 + bolt * 70 + flock * 15,
      light: 12 + bolt * 80 + cloud * 10,
    }
  },
}

export const CREATURES_FLIGHT_PATTERNS: readonly CubePattern[] = [
  patternStarlingMurmuration,
  patternArcticTernArc,
  patternHummingbirdJewel,
  patternMonarchRiver,
  patternFireflyMeadow,
  patternPhoenixEmber,
  patternDragonflyWetland,
  patternSwanLakeMist,
  patternKiteFestival,
  patternRavenStorm,
]

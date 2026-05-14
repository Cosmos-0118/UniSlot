import type { PatternSample } from './types'

/** Smooth 0..1, zero 1st/2nd deriv at ends (pleasant crossfades). */
export function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Shortest-path hue blend in degrees. */
export function blendHue(a: number, b: number, w: number): number {
  let d = (((b - a) % 360) + 360) % 360
  if (d > 180) d -= 360
  return (a + d * w + 360) % 360
}

export function blendSamples(a: PatternSample, b: PatternSample, w: number): PatternSample {
  const t = Math.min(1, Math.max(0, w))
  return {
    lift: a.lift * (1 - t) + b.lift * t,
    hue: blendHue(a.hue, b.hue, t),
    sat: a.sat * (1 - t) + b.sat * t,
    light: a.light * (1 - t) + b.light * t,
  }
}

// ─── Fast pseudo-random hash (deterministic, no seed state) ───────────────
/** Integer-pair → float in [0,1). Bitwise hash for incredible performance (10-50x faster than Math.sin). */
export function hash2i(x: number, y: number): number {
  let h = Math.imul(x | 0, 3266489917) + Math.imul(y | 0, 668265261) | 0
  h ^= h >>> 15
  h = Math.imul(h, 2246822519)
  h ^= h >>> 13
  h = Math.imul(h, 3266489917)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296.0
}

/** 1D hash: float → float in [0,1). Fast bitwise implementation. */
export function hash1(n: number): number {
  let h = Math.imul(n | 0, 3266489917)
  h ^= h >>> 15
  h = Math.imul(h, 2246822519)
  h ^= h >>> 13
  h = Math.imul(h, 3266489917)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296.0
}

// ─── Value noise (smooth, interpolated) ───────────────────────────────────
/** Hermite interpolation (same as GLSL smoothstep). */
function hermite(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Lattice-based 2D value noise, range roughly [-1, 1]. */
function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const sx = hermite(fx), sy = hermite(fy)
  const n00 = hash2i(ix, iy) * 2 - 1
  const n10 = hash2i(ix + 1, iy) * 2 - 1
  const n01 = hash2i(ix, iy + 1) * 2 - 1
  const n11 = hash2i(ix + 1, iy + 1) * 2 - 1
  return n00 * (1 - sx) * (1 - sy) + n10 * sx * (1 - sy) + n01 * (1 - sx) * sy + n11 * sx * sy
}

const BASE_SCALE = 2.5

// ─── Fractal Brownian Motion ──────────────────────────────────────────────
/**
 * fBm with configurable octaves. Returns range roughly [-1, 1].
 * This is the CORE noise function — produces rich, cloud-like organic textures.
 */
export function fbm(x: number, y: number, octaves: number = 4): number {
  x *= BASE_SCALE; y *= BASE_SCALE;
  let value = 0, amplitude = 0.5, frequency = 1, maxAmp = 0
  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise(x * frequency, y * frequency)
    maxAmp += amplitude
    amplitude *= 0.5
    frequency *= 2.0
  }
  return value / maxAmp
}

/**
 * Domain-warped fBm: feeds the noise back into itself for incredibly organic,
 * swirling, fluid-like motion. This is what makes patterns look PREMIUM.
 */
export function warpedFbm(x: number, y: number, t: number, intensity: number = 1.5): number {
  // BASE_SCALE is applied inside fbm() calls
  const q0 = fbm(x + t * 0.15, y + t * 0.12, 3)
  const q1 = fbm(x + 1.7 + t * 0.1, y + 9.2 - t * 0.08, 3)
  return fbm(x + intensity * q0, y + intensity * q1, 4)
}

/**
 * Ridged noise — creates dramatic mountain-ridge / vein / lightning textures.
 * Sharper, more dramatic than plain fBm.
 */
export function ridgedFbm(x: number, y: number, octaves: number = 4): number {
  x *= BASE_SCALE; y *= BASE_SCALE;
  let value = 0, amplitude = 0.5, frequency = 1, maxAmp = 0
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * frequency, y * frequency))
    value += amplitude * n * n
    maxAmp += amplitude
    amplitude *= 0.5
    frequency *= 2.0
  }
  return value / maxAmp * 2 - 1
}

// ─── Voronoi / Cellular noise ─────────────────────────────────────────────
/**
 * Cellular (Worley) noise — produces organic cell-like structures.
 * Returns { dist1, dist2 } — the two nearest cell distances.
 * `dist2 - dist1` gives beautiful vein / cracked-earth / stained-glass patterns.
 */
export function voronoi(x: number, y: number): { dist1: number; dist2: number } {
  x *= BASE_SCALE; y *= BASE_SCALE;
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  let d1 = 8, d2 = 8
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = hash2i(ix + dx, iy + dy)
      const py = hash2i(ix + dx + 17, iy + dy + 31)
      const vx = dx + px - fx
      const vy = dy + py - fy
      const d = vx * vx + vy * vy
      if (d < d1) { d2 = d1; d1 = d }
      else if (d < d2) { d2 = d }
    }
  }
  return { dist1: Math.sqrt(d1), dist2: Math.sqrt(d2) }
}

// ─── Utility math ─────────────────────────────────────────────────────────
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function remap(value: number, inLow: number, inHigh: number, outLow: number, outHigh: number): number {
  return outLow + (outHigh - outLow) * clamp01((value - inLow) / (inHigh - inLow))
}

/** Fractional part in [0, 1). */
export function fract01(x: number): number {
  return ((x % 1) + 1) % 1
}

/** Hue in degrees, always in [0, 360). */
export function wrapHue(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Reduced-motion speed helper. */
export function speed(reduced: boolean, full: number, gentle: number): number {
  return reduced ? gentle : full
}

/** Soft gaussian blob at (cx, cy). Returns 0..1. */
export function softBlob(nx: number, ny: number, cx: number, cy: number, radius: number, feather: number): number {
  const dx = nx - cx, dy = ny - cy
  const d = Math.sqrt(dx * dx + dy * dy)
  return clamp01(1 - (d - radius * (1 - feather)) / (radius * feather + 1e-6))
}

/** Polar coordinates from center (0.5, 0.5). */
export function polar(nx: number, ny: number): { angle: number; radius: number } {
  const dx = nx - 0.5, dy = ny - 0.5
  return { angle: Math.atan2(dy, dx), radius: Math.sqrt(dx * dx + dy * dy) }
}

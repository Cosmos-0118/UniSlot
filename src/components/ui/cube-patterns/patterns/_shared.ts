/** Cheap layered waves — good organic texture without heavy cost. */
export function noise2D(nx: number, ny: number, t: number, scale: number = 1) {
  return (
    Math.sin(nx * 4 * scale + ny * 2 * scale + t * 0.5) +
    Math.sin(nx * -2 * scale + ny * 5 * scale - t * 0.3) +
    Math.cos(nx * 6 * scale - ny * 1 * scale + t * 0.7)
  ) / 3
}

export function speed(reduced: boolean, full: number, gentle: number) {
  return reduced ? gentle : full
}

export function clamp01(x: number) {
  return Math.min(1, Math.max(0, x))
}

/** Fractional part in [0, 1) — fixes JS `%` on negative / mixed sums. */
export function fract01(x: number) {
  return ((x % 1) + 1) % 1
}

/** Hue in degrees, always in [0, 360). */
export function wrapHue(deg: number) {
  return ((deg % 360) + 360) % 360
}

/** 0..1 bell around center (cx,cy) in 0..1 space. */
export function softBlob(
  nx: number,
  ny: number,
  cx: number,
  cy: number,
  radius: number,
  feather: number
) {
  const dx = nx - cx
  const dy = ny - cy
  const d = Math.sqrt(dx * dx + dy * dy)
  return clamp01(1 - (d - radius * (1 - feather)) / (radius * feather + 1e-6))
}

export function hash2i(col: number, row: number) {
  const x = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453
  return x - Math.floor(x)
}

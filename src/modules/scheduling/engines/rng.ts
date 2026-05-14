/** Float in [0, 1). Mulberry32 — deterministic when `seed` is fixed (audit: reproducible runs). */
export type Rng = () => number

export function createRng(seed?: number): Rng {
  if (seed === undefined) return Math.random
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

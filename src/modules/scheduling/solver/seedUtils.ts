/** Mulberry32 step — same family as greedy hint RNG. */
function mulberry32Step(state: number): { value: number; next: number } {
  let t = state >>> 0
  t += 0x6d2b79f5
  let r = Math.imul(t ^ (t >>> 15), 1 | t)
  r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
  return { value: (r ^ (r >>> 14)) >>> 0, next: t >>> 0 }
}

/**
 * Derive `k` distinct CP-SAT portfolio race seeds from a user-provided base seed.
 * Same base seed always yields the same lane seeds.
 */
export function derivePortfolioSeeds(baseSeed: number, k: number): number[] {
  const n = Math.max(1, Math.floor(k))
  const out: number[] = []
  let state = baseSeed >>> 0
  for (let i = 0; i < n; i++) {
    const step = mulberry32Step(state ^ (i * 0x9e3779b9))
    state = step.next
    out.push(step.value % 2_000_000_000)
  }
  return out
}

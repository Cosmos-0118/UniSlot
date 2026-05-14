import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/modules/scheduling/engines/rng'

describe('createRng', () => {
  it('returns Math.random-compatible floats in [0,1) when unseeded', () => {
    const rng = createRng()
    for (let i = 0; i < 20; i++) {
      const x = rng()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('is deterministic for the same integer seed', () => {
    const a = createRng(20260514)
    const b = createRng(20260514)
    for (let i = 0; i < 30; i++) {
      expect(a()).toBe(b())
    }
  })

  it('differs across seeds (first draw)', () => {
    const x = createRng(1)()
    const y = createRng(2)()
    expect(x).not.toBe(y)
  })
})

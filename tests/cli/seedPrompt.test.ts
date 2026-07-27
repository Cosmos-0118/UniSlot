import { describe, expect, it } from 'vitest'
import { generateRunSeed } from '../../cli/seedPrompt'

describe('generateRunSeed', () => {
  it('returns a positive integer in CP-SAT-safe range', () => {
    for (let i = 0; i < 20; i++) {
      const seed = generateRunSeed()
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(1)
      expect(seed).toBeLessThan(2 ** 31)
    }
  })

  it('usually produces distinct values', () => {
    const seeds = new Set(Array.from({ length: 10 }, () => generateRunSeed()))
    expect(seeds.size).toBeGreaterThan(1)
  })
})

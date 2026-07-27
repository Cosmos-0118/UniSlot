import { describe, expect, it } from 'vitest'
import { generateRunSeed, parseSeedInput } from '../../cli/seedPrompt'

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

describe('parseSeedInput', () => {
  it('accepts non-negative integers', () => {
    expect(parseSeedInput('0')).toBe(0)
    expect(parseSeedInput('42')).toBe(42)
    expect(parseSeedInput(' 99 ')).toBe(99)
  })

  it('rejects invalid input', () => {
    expect(parseSeedInput('')).toBeUndefined()
    expect(parseSeedInput('-1')).toBeUndefined()
    expect(parseSeedInput('3.5')).toBeUndefined()
    expect(parseSeedInput('abc')).toBeUndefined()
  })
})

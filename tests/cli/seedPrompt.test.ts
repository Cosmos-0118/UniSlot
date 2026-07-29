import { describe, expect, it } from 'vitest'
import {
  formatReproToken,
  generateRunSeed,
  parseReproToken,
  parseSeedInput,
} from '../../cli/seedPrompt'

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

describe('formatReproToken / parseReproToken', () => {
  it('round-trips a full token', () => {
    const token = {
      seed: 77,
      workers: 8,
      portfolio: 0,
      allowSaturdayForMath: false,
    }
    const raw = formatReproToken(token)
    expect(raw).toBe('77/8/0/0')
    expect(parseReproToken(raw)).toEqual(token)
  })

  it('round-trips with Saturday enabled', () => {
    const token = {
      seed: 12345,
      workers: 4,
      portfolio: 0,
      allowSaturdayForMath: true,
    }
    expect(formatReproToken(token)).toBe('12345/4/0/1')
    expect(parseReproToken(formatReproToken(token))).toEqual(token)
  })

  it('accepts a plain seed number as plainSeedOnly fallback', () => {
    expect(parseReproToken('77')).toEqual({ plainSeed: 77 })
    expect(parseReproToken(' 42 ')).toEqual({ plainSeed: 42 })
  })

  it('rejects invalid tokens', () => {
    expect(parseReproToken('')).toBeUndefined()
    expect(parseReproToken('77/8')).toBeUndefined()
    expect(parseReproToken('77/8/0')).toBeUndefined()
    expect(parseReproToken('77/0/0/0')).toBeUndefined() // workers < 1
    expect(parseReproToken('77/8/0/2')).toBeUndefined() // sat not 0/1
    expect(parseReproToken('abc/8/0/0')).toBeUndefined()
    expect(parseReproToken('-1')).toBeUndefined()
  })

  it('accepts portfolio > 0 in a token', () => {
    expect(parseReproToken('99/16/3/0')).toEqual({
      seed: 99,
      workers: 16,
      portfolio: 3,
      allowSaturdayForMath: false,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { betterSolution } from '../../src/modules/scheduling/solver/cpsatBridge'
import type { CpsatSolution } from '../../src/modules/scheduling/solver/cpsatInstance'

function candidate(red: number, pairs: number): CpsatSolution {
  return { status: 'FEASIBLE', proven_optimal: false, slot_by_course: {},
    clash_weight: pairs, red_students: red, solver_time_seconds: 0, num_workers: 1 }
}

describe('portfolio and final-solve ranking', () => {
  it('keeps pair cost primary in explicitly clash-only diagnostic results', () => {
    const fewerStudents = { ...candidate(1, 6), objective_policy: 'clash-only' as const }
    const fewerPairs = { ...candidate(3, 5), objective_policy: 'clash-only' as const }
    expect(betterSolution(fewerStudents, fewerPairs)).toBe(fewerPairs)
    expect(betterSolution(fewerPairs, fewerStudents)).toBe(fewerPairs)
  })

  it('prefers fewer affected students even at higher pair cost, in either arrival order', () => {
    const fewerStudents = candidate(1, 6)
    const fewerPairs = candidate(3, 5)
    expect(betterSolution(fewerStudents, fewerPairs)).toBe(fewerStudents)
    expect(betterSolution(fewerPairs, fewerStudents)).toBe(fewerStudents)
  })

  it('uses pair cost to break ties on affected students', () => {
    const low = candidate(1, 3)
    const high = candidate(1, 6)
    expect(betterSolution(high, low)).toBe(low)
  })

  it('retains the primary certificate when a different candidate improves the tie-breakers', () => {
    const proven = { ...candidate(1, 6), proven_optimal: true,
      proven_levels: ['red_students'], red_bound: 1, red_gap: 0 }
    const improved = { ...candidate(1, 5), slot_by_course: { X: 1 } }
    const result = betterSolution(proven, improved)
    expect(result.slot_by_course).toEqual(improved.slot_by_course)
    expect(result.clash_weight).toBe(5)
    expect(result.proven_optimal).toBe(true)
    expect(result.proven_levels).toEqual(['red_students'])
    expect(result.red_bound).toBe(1)
    expect(result.red_gap).toBe(0)
  })
})

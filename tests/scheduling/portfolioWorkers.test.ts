import { describe, expect, it } from 'vitest'
import { portfolioMemberWorkers } from '../../src/modules/scheduling/solver/cpsatBridge'

describe('portfolioMemberWorkers', () => {
  it('keeps k × workers within the CPU budget', () => {
    expect(portfolioMemberWorkers(12, 4)).toBe(3)
    expect(4 * portfolioMemberWorkers(12, 4)).toBeLessThanOrEqual(12)
    expect(portfolioMemberWorkers(12, 10)).toBe(1)
    expect(10 * portfolioMemberWorkers(12, 10)).toBeLessThanOrEqual(12)
  })

  it('allows a single worker per member on large races', () => {
    expect(portfolioMemberWorkers(8, 8)).toBe(1)
    expect(portfolioMemberWorkers(3, 10)).toBe(1)
  })
})

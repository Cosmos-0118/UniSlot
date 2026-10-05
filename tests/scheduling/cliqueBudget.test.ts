import { describe, expect, it } from 'vitest'
import { searchCliqueOnCore } from '../../src/modules/scheduling/solver/lowerBounds'

function multipartite(parts: number, size: number): Map<string, Set<string>> {
  const ids = Array.from({ length: parts * size }, (_, i) => String(i))
  return new Map(ids.map((id, i) => [id, new Set(ids.filter((_, j) =>
    Math.floor(i / size) !== Math.floor(j / size)))]))
}

describe('bounded clique search', () => {
  it('stops after its node budget and returns an actual clique', () => {
    const graph = multipartite(16, 4)
    const result = searchCliqueOnCore(graph, { nodeBudget: 5 })
    expect(result.nodes_visited).toBeLessThanOrEqual(5)
    expect(result.budget_exhausted).toBe(true)
    expect(result.clique.length).toBeGreaterThan(0)
    for (const a of result.clique) for (const b of result.clique) {
      if (a !== b) expect(graph.get(a)?.has(b)).toBe(true)
    }
    expect(searchCliqueOnCore(graph, { nodeBudget: 5 })).toEqual(result)
  })

  it('finishes exact search on small graphs when the budget suffices', () => {
    const result = searchCliqueOnCore(multipartite(3, 2), { nodeBudget: 1000 })
    expect(result.clique).toHaveLength(3)
    expect(result.budget_exhausted).toBe(false)
  })
})

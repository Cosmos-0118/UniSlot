import { describe, expect, it } from 'vitest'
import {
  computeSchedulingLowerBounds,
  minMonochromePairs,
  weightedCliquePigeonholeLb,
} from '../../src/modules/scheduling/solver/lowerBounds'
import type { ConflictGraph, Section } from '../../src/modules/scheduling/types'

describe('weighted clash lower bounds', () => {
  it('minMonochromePairs matches balanced pigeonhole', () => {
    expect(minMonochromePairs(6, 6)).toBe(0)
    expect(minMonochromePairs(7, 6)).toBe(1)
    expect(minMonochromePairs(12, 6)).toBe(6)
  })

  it('weightedCliquePigeonholeLb uses lightest forced mono edges', () => {
    const weights = new Map<string, number>()
    // K7 with mixed weights — at least 1 mono edge; LB = lightest edge
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const key = nodes[i]! < nodes[j]! ? `${nodes[i]}\0${nodes[j]}` : `${nodes[j]}\0${nodes[i]}`
        weights.set(key, i === 0 && j === 1 ? 3 : 10)
      }
    }
    expect(weightedCliquePigeonholeLb(nodes, weights, 6)).toBe(3)
  })

  it('computeSchedulingLowerBounds raises LB above unit pigeonhole on heavy clique', () => {
    const courseSections: Record<string, Section[]> = {}
    const codes = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    for (const code of codes) {
      courseSections[code] = [
        {
          section_id: `${code}1`,
          course_code: code,
          course_title: code,
          section_number: 1,
          faculty: `F:${code}`,
          capacity: 100,
          enrolled_students: ['s1'],
          programs: ['CS'],
        },
      ]
    }
    const edges = []
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        edges.push({
          section_a: `${codes[i]}1`,
          section_b: `${codes[j]}1`,
          weight: 5,
          shared_students: [],
        })
      }
    }
    const conflictGraph: ConflictGraph = {
      sections: codes.map((c) => `${c}1`),
      edges,
    }
    const lb = computeSchedulingLowerBounds(courseSections, conflictGraph)
    // Unit pigeonhole for K7/6 = 1; weighted = 5
    expect(lb.min_clash_weight_lower_bound).toBeGreaterThanOrEqual(5)
    expect(lb.zero_clash_structurally_impossible).toBe(true)
  })
})

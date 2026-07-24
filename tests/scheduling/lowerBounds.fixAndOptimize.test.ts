import { describe, expect, it } from 'vitest'
import {
  computeSchedulingLowerBounds,
  minMonochromePairs,
} from '../../src/modules/scheduling/solver/lowerBounds'
import { fixAndOptimizeConflictedCourses } from '../../src/modules/scheduling/solver/fixAndOptimize'
import type { ConflictGraph, Section, Student } from '../../src/modules/scheduling/types'

describe('lowerBounds', () => {
  it('computes monochrome pair lower bound for cliques larger than colors', () => {
    expect(minMonochromePairs(6, 6)).toBe(0)
    expect(minMonochromePairs(7, 6)).toBe(1)
    expect(minMonochromePairs(8, 6)).toBe(2)
  })

  it('flags structural impossibility for a 7-course conflict clique', () => {
    const codes = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']
    const courseSections: Record<string, Section[]> = {}
    for (const code of codes) {
      courseSections[code] = [
        {
          section_id: `${code}_S1`,
          course_code: code,
          course_title: code,
          section_number: 1,
          faculty: `F_${code}`,
          capacity: 60,
          enrolled_students: ['ST1'],
          programs: [],
        },
      ]
    }
    const edges = []
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        edges.push({
          section_a: `${codes[i]!}_S1`,
          section_b: `${codes[j]!}_S1`,
          weight: 1,
          shared_students: ['ST1'],
        })
      }
    }
    const graph: ConflictGraph = {
      sections: codes.map((c) => `${c}_S1`),
      edges,
    }
    const students: Record<string, Student> = {
      ST1: {
        register_number: 'ST1',
        name: 'Test',
        program: 'CSE',
        email: null,
        mobile: null,
        enrolled_courses: codes,
      },
    }
    const lb = computeSchedulingLowerBounds(courseSections, graph, students)
    expect(lb.max_clique_size).toBeGreaterThanOrEqual(7)
    expect(lb.zero_clash_structurally_impossible).toBe(true)
    expect(lb.min_clash_weight_lower_bound).toBeGreaterThanOrEqual(1)
    expect(lb.min_red_students_lower_bound).toBeGreaterThanOrEqual(1)
  })
})

describe('fixAndOptimizeConflictedCourses', () => {
  it('separates two conflicting courses onto different weekdays', () => {
    const courseSections: Record<string, Section[]> = {
      A: [
        {
          section_id: 'A1',
          course_code: 'A',
          course_title: 'A',
          section_number: 1,
          faculty: 'FA',
          capacity: 60,
          enrolled_students: ['S1'],
          programs: [],
        },
      ],
      B: [
        {
          section_id: 'B1',
          course_code: 'B',
          course_title: 'B',
          section_number: 1,
          faculty: 'FB',
          capacity: 60,
          enrolled_students: ['S1'],
          programs: [],
        },
      ],
    }
    const sections = Object.values(courseSections).flat()
    const graph: ConflictGraph = {
      sections: ['A1', 'B1'],
      edges: [
        {
          section_a: 'A1',
          section_b: 'B1',
          weight: 1,
          shared_students: ['S1'],
        },
      ],
    }
    const out = fixAndOptimizeConflictedCourses(
      { A: 0, B: 0 },
      ['A', 'B'],
      sections,
      graph,
      { windowSize: 2 },
    )
    expect(out.improved).toBe(true)
    expect(out.students).toBe(0)
    expect(out.slotByCourse.A).not.toBe(out.slotByCourse.B)
  })
})

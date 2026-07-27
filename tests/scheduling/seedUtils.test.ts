import { describe, expect, it } from 'vitest'
import { derivePortfolioSeeds } from '../../src/modules/scheduling/solver/seedUtils'
import { buildGreedyHint } from '../../src/modules/scheduling/solver/greedyHint'
import { buildConflictGraph } from '../../src/modules/scheduling/preprocess/preprocessing'
import type { Section } from '../../src/modules/scheduling/types'

function section(id: string, code: string, students: string[]): Section {
  return {
    section_id: id,
    course_code: code,
    course_title: code,
    section_number: 1,
    faculty: `Planning:${id}`,
    capacity: 100,
    enrolled_students: students,
    programs: ['B.Tech.-Computer Science and Engineering'],
  }
}

describe('derivePortfolioSeeds', () => {
  it('is stable for the same base seed', () => {
    expect(derivePortfolioSeeds(123, 5)).toEqual(derivePortfolioSeeds(123, 5))
  })

  it('varies across different base seeds', () => {
    const a = derivePortfolioSeeds(1, 5)
    const b = derivePortfolioSeeds(2, 5)
    expect(a).not.toEqual(b)
  })
})

describe('buildGreedyHint seeding', () => {
  it('produces identical hints for the same seed', () => {
    const courseSections: Record<string, Section[]> = {
      A: [section('A1', 'A', ['s1', 's2'])],
      B: [section('B1', 'B', ['s2', 's3'])],
      C: [section('C1', 'C', ['s4'])],
    }
    const students = {
      s1: {
        register_number: 's1',
        name: 'S1',
        program: 'B.Tech.-Computer Science and Engineering',
        email: null,
        mobile: null,
        enrolled_courses: ['A'],
      },
      s2: {
        register_number: 's2',
        name: 'S2',
        program: 'B.Tech.-Computer Science and Engineering',
        email: null,
        mobile: null,
        enrolled_courses: ['A', 'B'],
      },
      s3: {
        register_number: 's3',
        name: 'S3',
        program: 'B.Tech.-Computer Science and Engineering',
        email: null,
        mobile: null,
        enrolled_courses: ['B'],
      },
      s4: {
        register_number: 's4',
        name: 'S4',
        program: 'B.Tech.-Computer Science and Engineering',
        email: null,
        mobile: null,
        enrolled_courses: ['C'],
      },
    }
    const graph = buildConflictGraph(students, courseSections)
    const input = {
      courseSections,
      conflictGraph: graph,
      facultyConstraints: {},
      students,
      seed: 99,
      polishIters: 800,
    }
    const a = buildGreedyHint(input)
    const b = buildGreedyHint(input)
    expect(a.hint).toEqual(b.hint)
    expect(a.clash_weight).toBe(b.clash_weight)
    expect(a.red_students).toBe(b.red_students)
  })
})

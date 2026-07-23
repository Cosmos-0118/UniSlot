import { describe, expect, it } from 'vitest'
import { buildConflictGraph } from '../../src/modules/scheduling/preprocess/preprocessing'
import {
  reduceSeedRuns,
  runScheduler,
  type SeedRunResult,
} from '../../src/modules/scheduling/solver/scheduler'
import type { Section } from '../../src/modules/scheduling/types'

function section(
  id: string,
  code: string,
  students: string[],
  faculty: string | null = `Planning:${id}`,
): Section {
  return {
    section_id: id,
    course_code: code,
    course_title: code,
    section_number: 1,
    faculty,
    capacity: 100,
    enrolled_students: students,
    programs: ['CS'],
  }
}

function tinyInstance() {
  const courseSections: Record<string, Section[]> = {
    A: [section('A1', 'A', ['s1', 's2'])],
    B: [section('B1', 'B', ['s2', 's3'])],
  }
  const students = {
    s1: {
      register_number: 's1',
      name: 'S1',
      program: 'CS',
      email: null,
      mobile: null,
      enrolled_courses: ['A'],
    },
    s2: {
      register_number: 's2',
      name: 'S2',
      program: 'CS',
      email: null,
      mobile: null,
      enrolled_courses: ['A', 'B'],
    },
    s3: {
      register_number: 's3',
      name: 'S3',
      program: 'CS',
      email: null,
      mobile: null,
      enrolled_courses: ['B'],
    },
  }
  const conflictGraph = buildConflictGraph(students, courseSections)
  const facultyConstraints = {
    'Planning:A1': ['A1'],
    'Planning:B1': ['B1'],
  }
  return { courseSections, conflictGraph, facultyConstraints }
}

describe('runScheduler smoke', () => {
  it('returns slot assignments for a tiny two-course instance with fixed seed (poolWorkers=1)', () => {
    const { courseSections, conflictGraph, facultyConstraints } = tinyInstance()

    const a = runScheduler(courseSections, conflictGraph, facultyConstraints, undefined, {
      randomSeed: 42,
      poolWorkers: 1,
    })
    const b = runScheduler(courseSections, conflictGraph, facultyConstraints, undefined, {
      randomSeed: 42,
      poolWorkers: 1,
    })

    expect(Object.keys(a.slot_assignments).length).toBeGreaterThan(0)
    expect(a.slot_assignments).toEqual(b.slot_assignments)
    expect(a.slot_assignments.A1).toBeDefined()
    expect(a.slot_assignments.B1).toBeDefined()
    expect(a.slot_assignments.A1).not.toBe(a.slot_assignments.B1)
  })

  it('assigns a three-course student to three different weekdays', () => {
    const courseSections: Record<string, Section[]> = {
      A: [section('A1', 'A', ['s1'])],
      B: [section('B1', 'B', ['s1'])],
      C: [section('C1', 'C', ['s1'])],
    }
    const students = {
      s1: {
        register_number: 's1',
        name: 'S1',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['A', 'B', 'C'],
      },
    }
    const conflictGraph = buildConflictGraph(students, courseSections)
    const facultyConstraints = {
      'Planning:A1': ['A1'],
      'Planning:B1': ['B1'],
      'Planning:C1': ['C1'],
    }

    const a = runScheduler(courseSections, conflictGraph, facultyConstraints, undefined, {
      randomSeed: 42,
      poolWorkers: 1,
    })
    const b = runScheduler(courseSections, conflictGraph, facultyConstraints, undefined, {
      randomSeed: 42,
      poolWorkers: 1,
    })
    const days = new Set(Object.values(a.slot_assignments))

    expect(a.slot_assignments).toEqual(b.slot_assignments)
    expect(days.size).toBe(3)
    expect(a.feasible).toBe(true)
    expect(a.total_clash_weight).toBe(0)
  })

  it('can escape a conflicted seed toward a conflict-free weekday coloring', () => {
    // Shared-student clique of size 3 must use 3 distinct weekdays.
    const courseSections: Record<string, Section[]> = {
      A: [section('A1', 'A', ['s1', 's2'])],
      B: [section('B1', 'B', ['s1', 's3'])],
      C: [section('C1', 'C', ['s1', 's4'])],
      D: [section('D1', 'D', ['s2', 's3', 's4'])],
    }
    const students = {
      s1: {
        register_number: 's1',
        name: 'S1',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['A', 'B', 'C'],
      },
      s2: {
        register_number: 's2',
        name: 'S2',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['A', 'D'],
      },
      s3: {
        register_number: 's3',
        name: 'S3',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['B', 'D'],
      },
      s4: {
        register_number: 's4',
        name: 'S4',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['C', 'D'],
      },
    }
    const conflictGraph = buildConflictGraph(students, courseSections)
    const facultyConstraints = {
      'Planning:A1': ['A1'],
      'Planning:B1': ['B1'],
      'Planning:C1': ['C1'],
      'Planning:D1': ['D1'],
    }

    const result = runScheduler(courseSections, conflictGraph, facultyConstraints, undefined, {
      randomSeed: 7,
      poolWorkers: 1,
      effort: 'fast',
    })

    expect(result.feasible).toBe(true)
    expect(result.total_clash_weight).toBe(0)
    const days = Object.values(result.slot_assignments)
    expect(new Set(days).size).toBe(4)
  })
})

describe('reduceSeedRuns', () => {
  it('ranks by students then clashWeight then seedIndex (completion-order independent)', () => {
    const outOfOrder: SeedRunResult[] = [
      { seedIndex: 2, slotByCourse: { A: 1 }, clashWeight: 5, students: 1 },
      { seedIndex: 0, slotByCourse: { A: 0 }, clashWeight: 10, students: 2 },
      { seedIndex: 1, slotByCourse: { A: 2 }, clashWeight: 5, students: 1 },
    ]
    const ranked = reduceSeedRuns(outOfOrder)
    expect(ranked.map((r) => r.seedIndex)).toEqual([1, 2, 0])
    // Same students+weight → lower seedIndex wins
    expect(ranked[0]!.seedIndex).toBe(1)
  })
})

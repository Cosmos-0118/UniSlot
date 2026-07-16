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

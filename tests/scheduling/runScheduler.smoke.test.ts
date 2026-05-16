import { describe, expect, it } from 'vitest'
import { buildConflictGraph } from '../../src/modules/scheduling/preprocess/preprocessing'
import { runScheduler } from '../../src/modules/scheduling/solver/scheduler'
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

describe('runScheduler smoke', () => {
  it('returns slot assignments for a tiny two-course instance with fixed seed', () => {
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

    const a = runScheduler(courseSections, conflictGraph, facultyConstraints, undefined, {
      randomSeed: 42,
    })
    const b = runScheduler(courseSections, conflictGraph, facultyConstraints, undefined, {
      randomSeed: 42,
    })

    expect(Object.keys(a.slot_assignments).length).toBeGreaterThan(0)
    expect(a.slot_assignments).toEqual(b.slot_assignments)
    expect(a.slot_assignments.A1).toBeDefined()
    expect(a.slot_assignments.B1).toBeDefined()
    expect(a.slot_assignments.A1).not.toBe(a.slot_assignments.B1)
  })
})

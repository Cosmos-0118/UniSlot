import { describe, expect, it } from 'vitest'
import { buildConflictGraph } from '../../src/modules/scheduling/preprocess/preprocessing'
import {
  aggregateCourseConflictEdges,
  buildCpsatInstance,
  sectionSlotsFromCourseSlots,
} from '../../src/modules/scheduling/solver/cpsatInstance'
import { computeClashWeight } from '../../src/modules/scheduling/solver/conflictGraph'
import { runCpsatScheduler } from '../../src/modules/scheduling/solver/cpsatBridge'
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
    C: [section('C1', 'C', ['s4'])],
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
    s4: {
      register_number: 's4',
      name: 'S4',
      program: 'CS',
      email: null,
      mobile: null,
      enrolled_courses: ['C'],
    },
  }
  const conflictGraph = buildConflictGraph(students, courseSections)
  const facultyConstraints = {
    'Planning:A1': ['A1'],
    'Planning:B1': ['B1'],
    'Planning:C1': ['C1'],
  }
  return { courseSections, conflictGraph, facultyConstraints, students }
}

describe('CP-SAT instance + clash parity', () => {
  it('aggregates section conflict edges to course pairs', () => {
    const { conflictGraph, courseSections } = tinyInstance()
    const sectionToCourse = new Map<string, string>()
    for (const secs of Object.values(courseSections)) {
      for (const s of secs) sectionToCourse.set(s.section_id, s.course_code)
    }
    const edges = aggregateCourseConflictEdges(conflictGraph, sectionToCourse)
    const ab = edges.find(
      (e) =>
        (e.course_a === 'A' && e.course_b === 'B') ||
        (e.course_a === 'B' && e.course_b === 'A'),
    )
    expect(ab?.weight).toBe(1)
  })

  it('sectionSlotsFromCourseSlots mirrors course days onto all sections', () => {
    const { courseSections } = tinyInstance()
    const slots = sectionSlotsFromCourseSlots(courseSections, { A: 2, B: 4, C: 0 })
    expect(slots.A1).toBe(2)
    expect(slots.B1).toBe(4)
    expect(slots.C1).toBe(0)
  })

  it('buildCpsatInstance includes math flag and students', () => {
    const courseSections: Record<string, Section[]> = {
      '21MAB101T': [section('M1', '21MAB101T', ['s1'])],
      CS101: [section('C1', 'CS101', ['s1'])],
    }
    const students = {
      s1: {
        register_number: 's1',
        name: 'S1',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['21MAB101T', 'CS101'],
      },
    }
    const graph = buildConflictGraph(students, courseSections)
    const inst = buildCpsatInstance(courseSections, graph, {}, students)
    expect(inst.courses.find((c) => c.code === '21MAB101T')?.is_math).toBe(true)
    expect(inst.courses.find((c) => c.code === 'CS101')?.is_math).toBe(false)
    expect(inst.students[0]?.courses).toContain('CS101')
  })
})

describe('CP-SAT solver smoke', () => {
  it(
    'proves zero clash weight on a tiny separable instance',
    async () => {
      const { courseSections, conflictGraph, facultyConstraints, students } = tinyInstance()
      const result = await runCpsatScheduler(
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        { workers: 2 },
      )

      expect(result.proven_optimal).toBe(true)
      expect(result.total_clash_weight).toBe(0)
      expect(result.red_students).toBe(0)

      const tsWeight = computeClashWeight(conflictGraph, result.slot_assignments)
      expect(tsWeight).toBe(result.total_clash_weight)
      expect(tsWeight).toBe(0)

      // A and B share a student — must be on different days
      expect(result.slot_by_course.A).not.toBe(result.slot_by_course.B)
    },
    60_000,
  )
})

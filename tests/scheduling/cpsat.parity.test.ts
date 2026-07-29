import { describe, expect, it } from 'vitest'
import { buildConflictGraph } from '../../src/modules/scheduling/preprocess/preprocessing'
import {
  aggregateCourseConflictEdges,
  buildCpsatInstance,
  sectionSlotsFromCourseSlots,
} from '../../src/modules/scheduling/solver/cpsatInstance'
import { computeClashWeight } from '../../src/modules/scheduling/solver/conflictGraph'
import { runCpsatScheduler } from '../../src/modules/scheduling/solver/cpsatBridge'
import { buildGreedyHint } from '../../src/modules/scheduling/solver/greedyHint'
import { computeSchedulingLowerBounds } from '../../src/modules/scheduling/solver/lowerBounds'
import {
  isMathCourse,
  NON_MATH_WEEKDAY_COUNT,
  TOTAL_WEEKLY_SLOTS,
} from '../../src/modules/scheduling/solver/timeModel'
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

  it('buildCpsatInstance includes math flag, students, and optional LB cuts', () => {
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
    const inst = buildCpsatInstance(courseSections, graph, {}, students, {
      min_clash_weight_lower_bound: 0,
      min_red_students_lower_bound: 0,
      hint: { CS101: 1 },
    })
    expect(inst.courses.find((c) => c.code === '21MAB101T')?.is_math).toBe(true)
    expect(inst.courses.find((c) => c.code === 'CS101')?.is_math).toBe(false)
    expect(inst.students[0]?.courses).toContain('CS101')
    expect(inst.hint?.CS101).toBe(1)
    expect(inst.allow_saturday).toBe(true)
    expect(inst.num_weekdays).toBe(6)

    const pinned = buildCpsatInstance(courseSections, graph, {}, students, {
      fixed_days: { CS101: 3 },
    })
    expect(pinned.fixed_days?.CS101).toBe(3)

    const blocked = buildCpsatInstance(courseSections, graph, {}, students, {
      allowSaturdayForMath: false,
      hint: { '21MAB101T': 5, CS101: 1 },
    })
    expect(blocked.allow_saturday).toBe(false)
    expect(blocked.num_weekdays).toBe(5)
    expect(blocked.hint?.['21MAB101T']).toBe(4)
  })
})

describe('greedy warm-start hint', () => {
  it('produces a feasible course→day map with clash parity', () => {
    const { courseSections, conflictGraph, facultyConstraints, students } = tinyInstance()
    const warm = buildGreedyHint({
      courseSections,
      conflictGraph,
      facultyConstraints,
      students,
      polishIters: 200,
    })
    expect(Object.keys(warm.hint).sort()).toEqual(['A', 'B', 'C'])
    for (const [code, day] of Object.entries(warm.hint)) {
      const max = isMathCourse(code) ? TOTAL_WEEKLY_SLOTS - 1 : NON_MATH_WEEKDAY_COUNT - 1
      expect(day).toBeGreaterThanOrEqual(0)
      expect(day).toBeLessThanOrEqual(max)
    }
    expect(warm.clash_weight).toBe(0)
    expect(warm.hint.A).not.toBe(warm.hint.B)

    const sectionSlots = sectionSlotsFromCourseSlots(courseSections, warm.hint)
    expect(computeClashWeight(conflictGraph, sectionSlots)).toBe(warm.clash_weight)
  })

  it('respects faculty same-day exclusion', () => {
    const courseSections: Record<string, Section[]> = {
      A: [section('A1', 'A', ['s1'], 'DrX')],
      B: [section('B1', 'B', ['s2'], 'DrX')],
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
        enrolled_courses: ['B'],
      },
    }
    const conflictGraph = buildConflictGraph(students, courseSections)
    const facultyConstraints = { DrX: ['A1', 'B1'] }
    const warm = buildGreedyHint({
      courseSections,
      conflictGraph,
      facultyConstraints,
      students,
      polishIters: 100,
    })
    expect(warm.hint.A).not.toBe(warm.hint.B)
  })
})

describe('CP-SAT solver smoke', () => {
  it(
    'proves zero clash weight on a tiny separable instance (with warm hint, no portfolio)',
    async () => {
      const { courseSections, conflictGraph, facultyConstraints, students } = tinyInstance()
      const warm = buildGreedyHint({
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        polishIters: 100,
      })
      const lb = computeSchedulingLowerBounds(courseSections, conflictGraph, students)
      const result = await runCpsatScheduler(
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        {
          workers: 2,
          portfolio: 0,
          hint: warm.hint,
          minClashWeightLowerBound: lb.min_clash_weight_lower_bound,
          minRedStudentsLowerBound: lb.min_red_students_lower_bound,
        },
      )

      expect(result.proven_optimal).toBe(true)
      expect(result.total_clash_weight).toBe(0)
      expect(result.red_students).toBe(0)

      const tsWeight = computeClashWeight(conflictGraph, result.slot_assignments)
      expect(tsWeight).toBe(result.total_clash_weight)
      expect(tsWeight).toBe(0)

      expect(result.slot_by_course.A).not.toBe(result.slot_by_course.B)
    },
    60_000,
  )

  it(
    'accepts structural LB cuts without becoming infeasible',
    async () => {
      const { courseSections, conflictGraph, facultyConstraints, students } = tinyInstance()
      const result = await runCpsatScheduler(
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        {
          workers: 2,
          portfolio: 0,
          minClashWeightLowerBound: 0,
          minRedStudentsLowerBound: 0,
        },
      )
      expect(result.total_clash_weight).toBe(0)
      expect(['OPTIMAL', 'FEASIBLE']).toContain(result.status)
    },
    60_000,
  )

  it(
    'respects fixed_days pinning for rectification',
    async () => {
      const courseSections: Record<string, Section[]> = {
        A: [section('A1', 'A', ['s1'])],
        B: [section('B1', 'B', ['s2'])],
        D: [section('D1', 'D', ['s1'])],
      }
      const students = {
        s1: {
          register_number: 's1',
          name: 'S1',
          program: 'CS',
          email: null,
          mobile: null,
          enrolled_courses: ['A', 'D'],
        },
        s2: {
          register_number: 's2',
          name: 'S2',
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
        'Planning:D1': ['D1'],
      }
      const result = await runCpsatScheduler(
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        {
          workers: 2,
          portfolio: 0,
          fixedDays: { A: 2, B: 4 },
        },
      )
      expect(result.slot_by_course.A).toBe(2)
      expect(result.slot_by_course.B).toBe(4)
      expect(result.slot_by_course.D).not.toBe(2)
      // Rectify relies on the full lex run, so balance must still be proven under pinning.
      expect(result.proven_levels).toContain('clash_weight')
      expect(result.proven_levels).toContain('balance_and_parallel')
    },
    60_000,
  )

  it(
    'returns identical assignments when rerun with the same seed',
    async () => {
      const { courseSections, conflictGraph, facultyConstraints, students } = tinyInstance()
      const warm = buildGreedyHint({
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        seed: 77,
        polishIters: 100,
      })
      const lb = computeSchedulingLowerBounds(courseSections, conflictGraph, students)
      const opts = {
        workers: 2,
        portfolio: 0,
        seed: 77,
        hint: warm.hint,
        minClashWeightLowerBound: lb.min_clash_weight_lower_bound,
        minRedStudentsLowerBound: lb.min_red_students_lower_bound,
      }
      const first = await runCpsatScheduler(
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        opts,
      )
      const second = await runCpsatScheduler(
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        opts,
      )
      expect(first.slot_by_course).toEqual(second.slot_by_course)
      expect(first.total_clash_weight).toBe(second.total_clash_weight)
      expect(first.red_students).toBe(second.red_students)
      expect(first.ortools_version).toMatch(/^\d+\.\d+/)
      expect(first.python_version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(first.ortools_version).toBe(second.ortools_version)
      expect(first.python_version).toBe(second.python_version)
    },
    180_000,
  )

  it(
    'returns identical assignments with multi-worker interleaved search',
    async () => {
      const { courseSections, conflictGraph, facultyConstraints, students } = tinyInstance()
      const warm = buildGreedyHint({
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        seed: 91,
        polishIters: 100,
      })
      const lb = computeSchedulingLowerBounds(courseSections, conflictGraph, students)
      const opts = {
        workers: 4,
        portfolio: 0,
        seed: 91,
        hint: warm.hint,
        minClashWeightLowerBound: lb.min_clash_weight_lower_bound,
        minRedStudentsLowerBound: lb.min_red_students_lower_bound,
      }
      const first = await runCpsatScheduler(
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        opts,
      )
      const second = await runCpsatScheduler(
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        opts,
      )
      expect(first.slot_by_course).toEqual(second.slot_by_course)
      expect(first.total_clash_weight).toBe(second.total_clash_weight)
      expect(first.red_students).toBe(second.red_students)
    },
    180_000,
  )
})

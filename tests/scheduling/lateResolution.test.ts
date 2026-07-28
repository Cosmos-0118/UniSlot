import { describe, expect, it } from 'vitest'
import {
  buildCapacityOptions,
  buildClashPanel,
  formatProjectedLoads,
  predictLateClashes,
} from '../../src/modules/scheduling/merge/lateResolution'
import type {
  CapacityConflict,
  LateAddition,
} from '../../src/modules/scheduling/merge/lateEnrollment'
import { buildLateMarking } from '../../src/modules/scheduling/io/excelLateMarking'
import type { ClashReport, Section, Student } from '../../src/modules/scheduling/types'

function section(id: string, code: string, num: number, cap: number, n: number): Section {
  return {
    section_id: id,
    course_code: code,
    course_title: code,
    section_number: num,
    faculty: `f${num}`,
    capacity: cap,
    enrolled_students: Array.from({ length: n }, (_, i) => `${id}-${i}`),
    programs: ['CSE'],
  }
}

/** The plan's worked example: 21MAB101T at 118/120 with 7 late students. */
const conflict: CapacityConflict = {
  course_code: '21MAB101T',
  course_title: 'CALCULUS',
  frozen_day_index: 1,
  sections: [
    { section_id: '21MAB101T_S1', enrollment: 60, capacity: 60 },
    { section_id: '21MAB101T_S2', enrollment: 58, capacity: 60 },
  ],
  seats_free: 2,
  late_demand: 7,
  shortfall: 5,
  late_register_numbers: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
}

describe('buildCapacityOptions', () => {
  const existing = [
    section('21MAB101T_S1', '21MAB101T', 1, 60, 60),
    section('21MAB101T_S2', '21MAB101T', 2, 60, 58),
  ]
  const options = buildCapacityOptions(conflict, existing, 2)
  const byStrategy = Object.fromEntries(options.map((o) => [o.strategy, o]))

  it('offers all five strategies with the new section id following the split shape', () => {
    expect(options.map((o) => o.strategy)).toEqual([
      'new-section',
      'equalize',
      'fit',
      'buffer',
      'park',
    ])
    expect(byStrategy['new-section']!.projected.at(-1)!.section_id).toBe('21MAB101T_S3')
  })

  it('every option accounts for all 125 seats after the merge', () => {
    for (const opt of options) {
      const placed = opt.projected.reduce((n, l) => n + l.enrollment, 0)
      expect(placed + opt.parked_count).toBe(125)
    }
  })

  it('new-section leaves existing loads untouched and equalize levels them', () => {
    expect(formatProjectedLoads(byStrategy['new-section']!.projected)).toBe('60 / 60 / 5')
    expect(byStrategy['new-section']!.students_moved).toBe(0)
    expect(formatProjectedLoads(byStrategy['equalize']!.projected)).toBe('42 / 42 / 41')
    expect(byStrategy['equalize']!.students_moved).toBeGreaterThan(0)
  })

  it('fit reports the exact overflow and adds no section', () => {
    expect(formatProjectedLoads(byStrategy['fit']!.projected)).toBe('63 / 62')
    expect(byStrategy['fit']!.overflow_seats).toBe(5)
  })

  it('buffer caps soft overflow at the buffer and parks nothing', () => {
    expect(formatProjectedLoads(byStrategy['buffer']!.projected)).toBe('62 / 62 / 1')
    expect(byStrategy['buffer']!.overflow_seats).toBe(4)
    expect(byStrategy['buffer']!.buffer_per_section).toBe(2)
  })

  it('park places only what fits', () => {
    expect(formatProjectedLoads(byStrategy['park']!.projected)).toBe('60 / 60')
    expect(byStrategy['park']!.parked_count).toBe(5)
  })
})

describe('predictLateClashes', () => {
  const students: Record<string, Student> = {
    R1: {
      register_number: 'R1',
      name: 'Alice',
      program: 'CSE',
      email: null,
      mobile: null,
      enrolled_courses: ['A'],
    },
  }
  const courseSections = {
    A: [section('A', 'A', 1, 64, 10)],
    B: [section('B', 'B', 1, 64, 20)],
    C: [section('C', 'C', 1, 64, 5)],
  }

  it('flags a late course landing on a weekday the student already holds', () => {
    const additions: LateAddition[] = [
      {
        register_number: 'R1',
        student_name: 'Alice',
        program: 'CSE',
        course_code: 'B',
        course_title: 'B',
        mobile_number: null,
        email_id: null,
        faculty: null,
        is_new_student: false,
      },
    ]
    const predicted = predictLateClashes({
      additions,
      students,
      slotByCourse: { A: 0, B: 0, C: 3 },
      courseSections,
    })
    expect(predicted).toHaveLength(1)
    expect(predicted[0]!.clashing_courses).toEqual(['A', 'B'])
    expect(predicted[0]!.day).toBe('Monday')
    expect(predicted[0]!.course_enrollments).toEqual({ A: 10, B: 20 })
  })

  it('stays silent when the late course lands on a free weekday', () => {
    const additions: LateAddition[] = [
      {
        register_number: 'R1',
        student_name: 'Alice',
        program: 'CSE',
        course_code: 'C',
        course_title: 'C',
        mobile_number: null,
        email_id: null,
        faculty: null,
        is_new_student: false,
      },
    ]
    expect(
      predictLateClashes({
        additions,
        students,
        slotByCourse: { A: 0, B: 0, C: 3 },
        courseSections,
      }),
    ).toHaveLength(0)
  })

  it('only offers to drop the late course, never the frozen one', () => {
    const panel = buildClashPanel({
      register_number: 'R1',
      student_name: 'Alice',
      program: 'CSE',
      late_courses: ['B'],
      day: 'Monday',
      day_index: 0,
      clashing_courses: ['A', 'B'],
      course_enrollments: { A: 10, B: 20 },
    })
    expect(panel.options.map((o) => o.choice)).toEqual(['accept', 'drop-course', 'park-student'])
    expect(panel.options[1]!.drop_course_code).toBe('B')
  })
})

describe('buildLateMarking', () => {
  const emptyClash: ClashReport = {
    total_students: 0,
    students_with_clashes: 0,
    clash_free_students: 0,
    clash_percentage: 0,
    reports: [],
  }

  it('builds a per-batch chain, leaving gaps as zero', () => {
    const marking = buildLateMarking({
      records: [
        { register_number: 'R1', course_code: 'A', batch: 1, section_id: 'A' },
        { register_number: 'R2', course_code: 'A', batch: 1, section_id: 'A' },
        { register_number: 'R3', course_code: 'A', batch: 3, section_id: 'A' },
        { register_number: 'R4', course_code: 'B', batch: 2, section_id: 'B' },
      ],
      batch: 3,
      students: {},
      clashReport: emptyClash,
    })
    expect(marking.lateAddsBySection.A).toEqual([2, 0, 1])
    expect(marking.lateAddsByCourse.B).toEqual([0, 1, 0])
    expect(marking.batch).toBe(3)
    // No current-batch payload means no detail sheet and no new-section tinting.
    expect(marking.assignments).toEqual([])
    expect(marking.lateSectionIds.size).toBe(0)
  })

  it('carries names and clash status for late students only', () => {
    const marking = buildLateMarking({
      records: [{ register_number: 'R1', course_code: 'A', batch: 1, section_id: 'A' }],
      batch: 1,
      students: {
        R1: {
          register_number: 'R1',
          name: 'Alice',
          program: 'CSE',
          email: null,
          mobile: null,
          enrolled_courses: ['A', 'B'],
        },
      },
      clashReport: {
        total_students: 2,
        students_with_clashes: 2,
        clash_free_students: 0,
        clash_percentage: 100,
        reports: [
          {
            register_number: 'R1',
            student_name: 'Alice',
            program: 'CSE',
            enrolled_courses: ['A', 'B'],
            status: 'Red',
            clashing_courses: [['A', 'B']],
            clashing_day: 'Monday',
            clashing_days: ['Monday'],
          },
          {
            register_number: 'R9',
            student_name: 'Untouched',
            program: 'CSE',
            enrolled_courses: ['C', 'D'],
            status: 'Red',
            clashing_courses: [['C', 'D']],
            clashing_day: 'Friday',
            clashing_days: ['Friday'],
          },
        ],
      },
    })
    expect(marking.studentInfo.R1).toEqual({ name: 'Alice', program: 'CSE' })
    expect(marking.statusByStudent.R1).toBe('Red')
    expect(marking.clashByStudent.R1).toBe('Monday: A+B')
    expect(marking.statusByStudent.R9).toBeUndefined()
  })
})

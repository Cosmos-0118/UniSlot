import { describe, expect, it } from 'vitest'
import { buildSchedule, computeClashReport } from '../../src/modules/scheduling/solver/scheduleOutput'
import type { Section, Student } from '../../src/modules/scheduling/types'

const students: Record<string, Student> = {
  s1: {
    register_number: 's1',
    name: 'Student One',
    program: 'CS',
    email: null,
    mobile: null,
    enrolled_courses: ['A', 'B'],
  },
}

const courseSections: Record<string, Section[]> = {
  A: [
    {
      section_id: 'A1',
      course_code: 'A',
      course_title: 'A',
      section_number: 1,
      faculty: 'Planning:A1',
      capacity: 60,
      enrolled_students: ['s1'],
      programs: ['CS'],
    },
  ],
  B: [
    {
      section_id: 'B1',
      course_code: 'B',
      course_title: 'B',
      section_number: 1,
      faculty: 'Planning:B1',
      capacity: 60,
      enrolled_students: ['s1'],
      programs: ['CS'],
    },
  ],
}

describe('computeClashReport', () => {
  it('flags two courses on the same weekday as a daily conflict', () => {
    const report = computeClashReport(students, courseSections, { A1: 0, B1: 0 })
    const student = report.reports[0]!

    expect(report.students_with_clashes).toBe(1)
    expect(student.status).toBe('Red')
    expect(student.clashing_courses).toEqual([['A', 'B']])
    expect(student.clashing_day).toBe('Monday')
    expect(student.clashing_days).toEqual(['Monday'])
  })

  it('is green when the student has one course per weekday', () => {
    const report = computeClashReport(students, courseSections, { A1: 0, B1: 1 })
    expect(report.students_with_clashes).toBe(0)
    expect(report.reports[0]!.status).toBe('Green')
  })
})

describe('buildSchedule', () => {
  it('assigns deterministic parallel lanes within each weekday', () => {
    const schedule = buildSchedule(
      courseSections,
      { A1: 0, B1: 0 },
      { solver_used: 'test', solver_time_seconds: 0 },
    )
    expect(schedule.entries).toHaveLength(2)
    expect(schedule.entries.every((e) => e.day === 'Monday')).toBe(true)
    expect(schedule.entries.every((e) => e.time === '5:00 PM – 7:00 PM')).toBe(true)
    expect(schedule.entries.map((e) => e.slot_band).sort()).toEqual([1, 2])
    expect(schedule.entries.every((e) => e.parallel_lane_count === 2)).toBe(true)
  })
})

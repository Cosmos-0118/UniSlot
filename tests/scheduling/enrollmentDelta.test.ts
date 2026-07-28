import { describe, expect, it } from 'vitest'
import {
  buildFixedDays,
  computeEnrollmentDelta,
  extractCourseSlotsFromSnapshot,
  freeCourseCodes,
  inferAllowSaturdayFromSnapshot,
  validateBaselineMatchesSnapshot,
} from '../../src/modules/scheduling/merge/enrollmentDelta'
import type { SchedulingSnapshot } from '../../src/modules/scheduling/merge/snapshot'
import type { EnrollmentRow, Section, Student } from '../../src/modules/scheduling/types'

function row(reg: string, course: string, name = reg): EnrollmentRow {
  return {
    program: 'CS',
    register_number: reg,
    student_name: name,
    mobile_number: null,
    email_id: null,
    course_code: course,
    course_title: course,
    faculty: null,
    registration_type: null,
    remarks: null,
  }
}

function minimalSnapshot(overrides?: Partial<SchedulingSnapshot>): SchedulingSnapshot {
  const courseSections: Record<string, Section[]> = {
    A: [
      {
        section_id: 'A',
        course_code: 'A',
        course_title: 'A',
        section_number: 1,
        faculty: null,
        capacity: 64,
        enrolled_students: ['S1'],
        programs: ['CS'],
      },
    ],
    B: [
      {
        section_id: 'B',
        course_code: 'B',
        course_title: 'B',
        section_number: 1,
        faculty: null,
        capacity: 64,
        enrolled_students: ['S1'],
        programs: ['CS'],
      },
    ],
    C: [
      {
        section_id: 'C',
        course_code: 'C',
        course_title: 'C',
        section_number: 1,
        faculty: null,
        capacity: 64,
        enrolled_students: ['S2'],
        programs: ['CS'],
      },
    ],
  }
  const students: Record<string, Student> = {
    S1: {
      register_number: 'S1',
      name: 'Student One',
      program: 'CS',
      email: null,
      mobile: null,
      enrolled_courses: ['A', 'B'],
    },
    S2: {
      register_number: 'S2',
      name: 'Student Two',
      program: 'CS',
      email: null,
      mobile: null,
      enrolled_courses: ['C'],
    },
  }
  return {
    slot_model: 'weekday-v2',
    slot_assignments: { A: 0, B: 1, C: 2 },
    courseSections,
    students,
    enrollmentRows: [row('S1', 'A'), row('S1', 'B'), row('S2', 'C')],
    allowSaturdayForMath: false,
    ...overrides,
  }
}

describe('computeEnrollmentDelta', () => {
  it('detects student swap A,B → C,D', () => {
    const oldRows = [row('S1', 'A'), row('S1', 'B'), row('S2', 'C')]
    const newRows = [row('S1', 'C'), row('S1', 'D'), row('S2', 'C')]
    const delta = computeEnrollmentDelta(oldRows, newRows)
    expect(delta.changed_students).toHaveLength(1)
    expect(delta.changed_students[0]?.register_number).toBe('S1')
    expect(delta.changed_students[0]?.before).toEqual(['A', 'B'])
    expect(delta.changed_students[0]?.after).toEqual(['C', 'D'])
    expect(delta.changed_students[0]?.added).toEqual(['C', 'D'])
    expect(delta.changed_students[0]?.dropped).toEqual(['A', 'B'])
    expect(delta.new_course_codes).toEqual(['D'])
    expect(delta.removed_course_codes).toEqual(['A', 'B'])
  })

  it('reports no changes when enrollments match', () => {
    const rows = [row('S1', 'A'), row('S1', 'B')]
    const delta = computeEnrollmentDelta(rows, rows)
    expect(delta.changed_students).toHaveLength(0)
    expect(delta.new_course_codes).toHaveLength(0)
    expect(delta.removed_course_codes).toHaveLength(0)
  })
})

describe('extractCourseSlotsFromSnapshot', () => {
  it('maps section slots to course codes', () => {
    const snap = minimalSnapshot()
    const slots = extractCourseSlotsFromSnapshot(snap)
    expect(slots).toEqual({ A: 0, B: 1, C: 2 })
  })
})

describe('buildFixedDays and freeCourseCodes', () => {
  it('pins continuing courses and leaves new ones free', () => {
    const snap = minimalSnapshot()
    const newCodes = new Set(['A', 'B', 'C', 'D'])
    const fixed = buildFixedDays(snap, newCodes)
    expect(fixed).toEqual({ A: 0, B: 1, C: 2 })
    expect(freeCourseCodes(newCodes, fixed)).toEqual(['D'])
  })
})

describe('inferAllowSaturdayFromSnapshot', () => {
  it('reads explicit snapshot field', () => {
    expect(inferAllowSaturdayFromSnapshot(minimalSnapshot({ allowSaturdayForMath: true }))).toBe(
      true,
    )
    expect(inferAllowSaturdayFromSnapshot(minimalSnapshot({ allowSaturdayForMath: false }))).toBe(
      false,
    )
  })
})

describe('validateBaselineMatchesSnapshot', () => {
  it('warns when baseline row count differs from snapshot', () => {
    const snap = minimalSnapshot()
    const warnings = validateBaselineMatchesSnapshot([row('S1', 'A')], snap)
    expect(warnings.some((w) => w.field === 'row_count')).toBe(true)
  })
})

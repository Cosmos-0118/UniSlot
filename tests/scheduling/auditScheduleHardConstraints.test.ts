import { describe, expect, it } from 'vitest'
import { auditScheduleHardConstraints } from '../../src/modules/scheduling/solver/hardConstraints'
import type { Section } from '../../src/modules/scheduling/types'

function makeSection(partial: Partial<Section> & Pick<Section, 'section_id' | 'course_code'>): Section {
  return {
    course_title: partial.course_title ?? 'T',
    section_number: partial.section_number ?? 1,
    faculty: partial.faculty ?? null,
    capacity: partial.capacity ?? 100,
    enrolled_students: partial.enrolled_students ?? [],
    programs: partial.programs ?? [],
    ...partial,
  }
}

describe('auditScheduleHardConstraints', () => {
  it('flags faculty double-booking for the same faculty label on one weekday', () => {
    const courseSections: Record<string, Section[]> = {
      A: [makeSection({ section_id: 'a1', course_code: 'A', faculty: 'Dr X' })],
      B: [makeSection({ section_id: 'b1', course_code: 'B', faculty: 'Dr X' })],
    }
    const slotAssignments: Record<string, number> = { a1: 1, b1: 1 }
    const r = auditScheduleHardConstraints(courseSections, slotAssignments, 40, {
      'Dr X': ['a1', 'b1'],
    })
    expect(r.feasible).toBe(false)
    expect(r.violations.some((v: string) => v.includes('Faculty overlap'))).toBe(true)
  })

  it('passes when same faculty teaches one section per weekday', () => {
    const courseSections: Record<string, Section[]> = {
      A: [makeSection({ section_id: 'a1', course_code: 'A', faculty: 'Dr X' })],
      B: [makeSection({ section_id: 'b1', course_code: 'B', faculty: 'Dr X' })],
    }
    const slotAssignments: Record<string, number> = { a1: 1, b1: 2 }
    const r = auditScheduleHardConstraints(courseSections, slotAssignments, 40, {
      'Dr X': ['a1', 'b1'],
    })
    expect(r.feasible).toBe(true)
    expect(r.violations).toHaveLength(0)
  })

  it('flags a student enrolled in two courses on the same weekday', () => {
    const courseSections: Record<string, Section[]> = {
      A: [makeSection({ section_id: 'a1', course_code: 'A', enrolled_students: ['s1'] })],
      B: [makeSection({ section_id: 'b1', course_code: 'B', enrolled_students: ['s1'] })],
    }
    const r = auditScheduleHardConstraints(courseSections, { a1: 0, b1: 0 }, 40, {})

    expect(r.feasible).toBe(false)
    expect(r.violations).toContain('Student s1: A, B scheduled on Monday; maximum one course per weekday')
  })

  it('allows a student to attend courses on different weekdays', () => {
    const courseSections: Record<string, Section[]> = {
      A: [makeSection({ section_id: 'a1', course_code: 'A', enrolled_students: ['s1'] })],
      B: [makeSection({ section_id: 'b1', course_code: 'B', enrolled_students: ['s1'] })],
    }
    const r = auditScheduleHardConstraints(courseSections, { a1: 0, b1: 1 }, 40, {})

    expect(r.feasible).toBe(true)
    expect(r.violations).toHaveLength(0)
  })

  it('flags a non-math course assigned to Saturday (slot 5)', () => {
    const courseSections: Record<string, Section[]> = {
      '21CSC202J': [makeSection({ section_id: 'os1', course_code: '21CSC202J', course_title: 'OPERATING SYSTEMS' })],
    }
    const r = auditScheduleHardConstraints(courseSections, { os1: 5 }, 40, {})
    expect(r.feasible).toBe(false)
    expect(r.violations.some((v: string) => v.includes('Saturday') && v.includes('21CSC202J'))).toBe(true)
  })

  it('allows a math course on Saturday (slot 5)', () => {
    const courseSections: Record<string, Section[]> = {
      '21MAB101T': [makeSection({ section_id: 'ma1', course_code: '21MAB101T', course_title: 'CALCULUS AND LINEAR ALGEBRA' })],
    }
    const r = auditScheduleHardConstraints(courseSections, { ma1: 5 }, 40, {})
    expect(r.feasible).toBe(true)
    expect(r.violations).toHaveLength(0)
  })

  it('flags any course on Saturday when Saturday is blocked', () => {
    const courseSections: Record<string, Section[]> = {
      '21MAB101T': [makeSection({ section_id: 'ma1', course_code: '21MAB101T', course_title: 'CALCULUS AND LINEAR ALGEBRA' })],
    }
    const r = auditScheduleHardConstraints(courseSections, { ma1: 5 }, 40, {}, {
      allowSaturdayForMath: false,
    })
    expect(r.feasible).toBe(false)
    expect(r.violations.some((v: string) => v.includes('temporarily blocked'))).toBe(true)
  })

  it('allows an allowlisted non-math course on Saturday when maths Saturday is off', () => {
    const courseSections: Record<string, Section[]> = {
      '21CSE101T': [makeSection({ section_id: 'c1', course_code: '21CSE101T' })],
    }
    const r = auditScheduleHardConstraints(courseSections, { c1: 5 }, 40, {}, {
      allowSaturdayForMath: false,
      saturdayExtraCourseCodes: ['21CSE101T'],
    })
    expect(r.feasible).toBe(true)
    expect(r.violations).toHaveLength(0)
  })

  it('rejects a non-allowlisted course on Saturday even when extras exist', () => {
    const courseSections: Record<string, Section[]> = {
      '21CSC202J': [makeSection({ section_id: 'os1', course_code: '21CSC202J' })],
    }
    const r = auditScheduleHardConstraints(courseSections, { os1: 5 }, 40, {}, {
      allowSaturdayForMath: false,
      saturdayExtraCourseCodes: ['21CSE101T'],
    })
    expect(r.feasible).toBe(false)
    expect(r.violations.some((v: string) => v.includes('21CSC202J') && v.includes('Saturday'))).toBe(
      true,
    )
  })
})

describe('auditScheduleHardConstraints structural split', () => {
  it('keeps a student same-day overlap out of the structural bucket', () => {
    const courseSections: Record<string, Section[]> = {
      A: [makeSection({ section_id: 'a1', course_code: 'A', enrolled_students: ['s1'] })],
      B: [makeSection({ section_id: 'b1', course_code: 'B', enrolled_students: ['s1'] })],
    }
    const r = auditScheduleHardConstraints(courseSections, { a1: 0, b1: 0 }, 40, {})

    expect(r.feasible).toBe(false)
    expect(r.structuralFeasible).toBe(true)
    expect(r.structuralViolations).toHaveLength(0)
    expect(r.studentOverlapViolations).toHaveLength(1)
  })

  it('marks a capacity breach as structural', () => {
    const courseSections: Record<string, Section[]> = {
      A: [
        makeSection({
          section_id: 'a1',
          course_code: 'A',
          capacity: 1,
          enrolled_students: ['s1', 's2'],
        }),
      ],
    }
    const r = auditScheduleHardConstraints(courseSections, { a1: 0 }, 40, {})

    expect(r.feasible).toBe(false)
    expect(r.structuralFeasible).toBe(false)
    expect(r.structuralViolations.some((v) => v.includes('capacity'))).toBe(true)
  })

  it('marks faculty double-booking as structural', () => {
    const courseSections: Record<string, Section[]> = {
      A: [makeSection({ section_id: 'a1', course_code: 'A', faculty: 'Dr X' })],
      B: [makeSection({ section_id: 'b1', course_code: 'B', faculty: 'Dr X' })],
    }
    const r = auditScheduleHardConstraints(courseSections, { a1: 1, b1: 1 }, 40, {
      'Dr X': ['a1', 'b1'],
    })

    expect(r.structuralFeasible).toBe(false)
    expect(r.studentOverlapViolations).toHaveLength(0)
  })

  it('reports both buckets when structural and soft rules break together', () => {
    const courseSections: Record<string, Section[]> = {
      A: [
        makeSection({
          section_id: 'a1',
          course_code: 'A',
          capacity: 1,
          enrolled_students: ['s1', 's2'],
        }),
      ],
      B: [makeSection({ section_id: 'b1', course_code: 'B', enrolled_students: ['s1'] })],
    }
    const r = auditScheduleHardConstraints(courseSections, { a1: 0, b1: 0 }, 40, {})

    expect(r.structuralViolations.length).toBeGreaterThan(0)
    expect(r.studentOverlapViolations.length).toBeGreaterThan(0)
    expect(r.violations).toEqual([...r.structuralViolations, ...r.studentOverlapViolations])
  })
})

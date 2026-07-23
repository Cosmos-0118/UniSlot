import { describe, expect, it } from 'vitest'
import { auditScheduleHardConstraints } from '../../src/modules/scheduling/solver/localSearchSolver'
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
})

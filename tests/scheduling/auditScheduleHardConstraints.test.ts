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
  it('flags faculty double-booking for the same faculty label in one slot', () => {
    const courseSections: Record<string, Section[]> = {
      A: [makeSection({ section_id: 'a1', course_code: 'A', faculty: 'Dr X' })],
      B: [makeSection({ section_id: 'b1', course_code: 'B', faculty: 'Dr X' })],
    }
    const slotAssignments: Record<string, number> = { a1: 3, b1: 3 }
    const r = auditScheduleHardConstraints(courseSections, slotAssignments, 40, {
      'Dr X': ['a1', 'b1'],
    })
    expect(r.feasible).toBe(false)
    expect(r.violations.some((v: string) => v.includes('Faculty overlap'))).toBe(true)
  })

  it('passes when same faculty teaches one section per slot', () => {
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
})

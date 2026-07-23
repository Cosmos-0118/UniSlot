import { describe, expect, it } from 'vitest'
import { cloneSchedulingSnapshot, WEEKDAY_SLOT_MODEL } from '../../src/modules/scheduling/merge/snapshot'
import { auditSnapshotSchedule, buildScheduleFromSnapshot } from '../../src/modules/scheduling/merge/facultyMapping'
import type { SchedulingSnapshot } from '../../src/modules/scheduling/merge/snapshot'
import type { Section } from '../../src/modules/scheduling/types'

function section(id: string, code: string, faculty = `Planning:${id}`): Section {
  return {
    section_id: id,
    course_code: code,
    course_title: code,
    section_number: 1,
    faculty,
    capacity: 60,
    enrolled_students: ['s1'],
    programs: ['CS'],
  }
}

describe('legacy weekday slot migration', () => {
  it('maps legacy 0–54 band slots onto weekdays', () => {
    const legacy: SchedulingSnapshot = {
      slot_assignments: {
        A1: 8, // Monday band 9 → weekday 0
        B1: 25, // Wednesday band 4 → weekday 2
        C1: 32, // Wednesday band 11 → weekday 2
      },
      courseSections: {
        A: [section('A1', 'A')],
        B: [section('B1', 'B')],
        C: [section('C1', 'C')],
      },
      students: {
        s1: {
          register_number: 's1',
          name: 'S1',
          program: 'CS',
          email: null,
          mobile: null,
          enrolled_courses: ['A', 'B', 'C'],
        },
      },
      enrollmentRows: [],
    }

    const normalized = cloneSchedulingSnapshot(legacy)
    expect(normalized.slot_model).toBe(WEEKDAY_SLOT_MODEL)
    expect(normalized.slot_assignments).toEqual({ A1: 0, B1: 2, C1: 2 })

    const audit = auditSnapshotSchedule(legacy)
    expect(audit.feasible).toBe(false)
    expect(audit.violations.some((v) => v.includes('Student s1'))).toBe(true)

    const built = buildScheduleFromSnapshot(legacy)
    expect(built.schedule.entries.find((e) => e.section_id === 'A1')?.day).toBe('Monday')
    expect(built.schedule.entries.find((e) => e.section_id === 'B1')?.day).toBe('Wednesday')
  })
})

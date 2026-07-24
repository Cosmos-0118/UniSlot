import { describe, expect, it } from 'vitest'
import {
  applyAndValidateFacultyMapping,
  applyFacultyOverridesToSnapshot,
  isPlanningFacultyLabel,
  parseFacultyMappingTable,
} from '../../src/modules/scheduling/merge/facultyMapping'
import type { SchedulingSnapshot } from '../../src/modules/scheduling/merge/snapshot'
import type { Section } from '../../src/modules/scheduling/types'

function makeSnapshot(sections: Section[], slots: Record<string, number>): SchedulingSnapshot {
  const courseSections: Record<string, Section[]> = {}
  for (const s of sections) {
    if (!courseSections[s.course_code]) courseSections[s.course_code] = []
    courseSections[s.course_code]!.push(s)
  }
  return {
    slot_assignments: slots,
    courseSections,
    students: {},
    enrollmentRows: [],
  }
}

describe('facultyMapping', () => {
  it('detects planning placeholder labels', () => {
    expect(isPlanningFacultyLabel('Planning:SEC1')).toBe(true)
    expect(isPlanningFacultyLabel('Dr Smith')).toBe(false)
    expect(isPlanningFacultyLabel('')).toBe(true)
  })

  it('parses CSV mapping rows', () => {
    const text = `section_id,faculty_name
A_SEC1,Dr Smith
B_SEC1,Dr Jones`
    const r = parseFacultyMappingTable(text)
    expect(r.errors).toHaveLength(0)
    expect(r.overrides).toEqual({ A_SEC1: 'Dr Smith', B_SEC1: 'Dr Jones' })
  })

  it('flags faculty double-booking after mapping same person to same slot', () => {
    const snap = makeSnapshot(
      [
        {
          section_id: 'A_SEC1',
          course_code: 'A',
          course_title: 'A',
          section_number: 1,
          faculty: 'Planning:A_SEC1',
          capacity: 50,
          enrolled_students: [],
          programs: [],
        },
        {
          section_id: 'B_SEC1',
          course_code: 'B',
          course_title: 'B',
          section_number: 1,
          faculty: 'Planning:B_SEC1',
          capacity: 50,
          enrolled_students: [],
          programs: [],
        },
      ],
      { A_SEC1: 5, B_SEC1: 5 },
    )
    const out = applyAndValidateFacultyMapping(
      snap,
      {
        A_SEC1: 'Dr Lee',
        B_SEC1: 'Dr Lee',
      },
      { autoRepairSlots: false },
    )
    expect(out.audit.feasible).toBe(false)
    expect(out.audit.violations.some((v) => v.includes('Faculty overlap'))).toBe(true)
  })

  it('auto-repairs faculty double-booking by moving a course bundle', () => {
    const snap = makeSnapshot(
      [
        {
          section_id: 'A_SEC1',
          course_code: 'A',
          course_title: 'A',
          section_number: 1,
          faculty: 'Planning:A_SEC1',
          capacity: 50,
          enrolled_students: [],
          programs: [],
        },
        {
          section_id: 'B_SEC1',
          course_code: 'B',
          course_title: 'B',
          section_number: 1,
          faculty: 'Planning:B_SEC1',
          capacity: 50,
          enrolled_students: [],
          programs: [],
        },
      ],
      { A_SEC1: 2, B_SEC1: 2 },
    )
    const out = applyAndValidateFacultyMapping(snap, {
      A_SEC1: 'Dr Lee',
      B_SEC1: 'Dr Lee',
    })
    expect(out.audit.feasible).toBe(true)
    expect(out.repairedSlots).toBe(true)
    const slotA = out.snapshot.slot_assignments.A_SEC1
    const slotB = out.snapshot.slot_assignments.B_SEC1
    expect(slotA).not.toBe(slotB)
  })

  it('passes audit when same faculty teaches sections in different slots', () => {
    const snap = makeSnapshot(
      [
        {
          section_id: 'A_SEC1',
          course_code: 'A',
          course_title: 'A',
          section_number: 1,
          faculty: 'Planning:A_SEC1',
          capacity: 50,
          enrolled_students: [],
          programs: [],
        },
        {
          section_id: 'B_SEC1',
          course_code: 'B',
          course_title: 'B',
          section_number: 1,
          faculty: 'Planning:B_SEC1',
          capacity: 50,
          enrolled_students: [],
          programs: [],
        },
      ],
      { A_SEC1: 1, B_SEC1: 12 },
    )
    const out = applyAndValidateFacultyMapping(snap, {
      A_SEC1: 'Dr Lee',
      B_SEC1: 'Dr Lee',
    })
    expect(out.audit.feasible).toBe(true)
    expect(out.planningCount).toBe(0)
  })

  it('persists overrides on snapshot', () => {
    const snap = makeSnapshot(
      [
        {
          section_id: 'X1',
          course_code: 'X',
          course_title: 'X',
          section_number: 1,
          faculty: 'Planning:X1',
          capacity: 10,
          enrolled_students: [],
          programs: [],
        },
      ],
      { X1: 0 },
    )
    const next = applyFacultyOverridesToSnapshot(snap, { X1: 'Prof A' })
    expect(next.facultyOverrides?.X1).toBe('Prof A')
    expect(next.courseSections.X?.[0]?.faculty).toBe('Prof A')
  })
})

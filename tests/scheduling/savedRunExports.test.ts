import { describe, expect, it } from 'vitest'
import { computeSavedRunExportState } from '../../src/modules/scheduling/merge/savedRunExports'
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

describe('savedRunExports', () => {
  it('blocks schedule export when audit fails unless provisional is allowed', () => {
    const snapshot = makeSnapshot(
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
    snapshot.facultyOverrides = { A_SEC1: 'Dr Lee', B_SEC1: 'Dr Lee' }
    for (const arr of Object.values(snapshot.courseSections)) {
      for (const sec of arr) {
        const name = snapshot.facultyOverrides![sec.section_id]
        if (name) sec.faculty = name
      }
    }

    const blocked = computeSavedRunExportState(snapshot)
    expect(blocked.schedule_export_blocked).toBe(true)

    const allowed = computeSavedRunExportState(snapshot, { allowProvisionalScheduleExport: true })
    expect(allowed.schedule_export_blocked).toBe(false)
  })
})

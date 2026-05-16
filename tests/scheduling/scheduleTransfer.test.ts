import { describe, expect, it } from 'vitest'
import { scheduleWithEntries, slimScheduleForTransfer } from '../../src/modules/scheduling/worker/scheduleTransfer'
import type { Schedule, ScheduleEntry } from '../../src/modules/scheduling/types'

const entry: ScheduleEntry = {
  section_id: 'S1',
  course_code: 'CS101',
  course_title: 'Intro',
  section_number: 1,
  day: 'Monday',
  time: '6:00 PM',
  slot_index: 0,
  slot_band: 1,
  faculty: null,
  enrollment_count: 30,
  programs: 'BSc',
}

const schedule: Schedule = {
  entries: [entry],
  total_sections: 1,
  solver_used: 'test',
  solver_time_seconds: 1,
  total_clashes: 0,
}

describe('scheduleTransfer', () => {
  it('slimScheduleForTransfer clears entries but keeps metadata', () => {
    const slim = slimScheduleForTransfer(schedule)
    expect(slim.entries).toEqual([])
    expect(slim.solver_used).toBe('test')
    expect(slim.total_sections).toBe(1)
  })

  it('scheduleWithEntries reattaches rows', () => {
    const slim = slimScheduleForTransfer(schedule)
    const full = scheduleWithEntries(slim, [entry])
    expect(full.entries).toHaveLength(1)
    expect(full.entries[0]?.course_code).toBe('CS101')
  })
})

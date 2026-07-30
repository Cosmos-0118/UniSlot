import { describe, expect, it } from 'vitest'
import type { Schedule, ScheduleEntry } from '../../src/modules/scheduling/types'
import { scheduleToWorkbookBuffer } from '../../src/modules/scheduling/io/excelScheduleWorkbook'
import {
  filterScheduleEntries,
  normalizeCourseCodeList,
  readScheduleEntriesFromBuffer,
  scheduleFromFilteredEntries,
} from '../../src/modules/scheduling/io/excelScheduleReader'

function entry(partial: Partial<ScheduleEntry> & Pick<ScheduleEntry, 'course_code' | 'section_id'>): ScheduleEntry {
  return {
    course_title: partial.course_title ?? 'Test Course',
    section_number: partial.section_number ?? 1,
    day: partial.day ?? 'Monday',
    time: partial.time ?? 'Monday 5:00–7:00 PM (Parallel lane 1/2)',
    slot_index: partial.slot_index ?? 0,
    slot_band: partial.slot_band ?? 1,
    parallel_lane_count: partial.parallel_lane_count ?? 2,
    faculty: partial.faculty ?? null,
    enrollment_count: partial.enrollment_count ?? 40,
    programs: partial.programs ?? 'CSE',
    ...partial,
  }
}

describe('normalizeCourseCodeList', () => {
  it('splits commas, newlines, and semicolons; trims; uppercases; dedupes', () => {
    expect(
      normalizeCourseCodeList(' 21csc203p , 21CSE251T\n21CSE254T;21CSC203P\r\n'),
    ).toEqual(['21CSC203P', '21CSE251T', '21CSE254T'])
  })

  it('accepts arrays and returns empty for undefined', () => {
    expect(normalizeCourseCodeList(['ab', ' AB ', '', 'cd\nef'])).toEqual(['AB', 'CD', 'EF'])
    expect(normalizeCourseCodeList(undefined)).toEqual([])
  })
})

describe('filterScheduleEntries', () => {
  const rows = [
    entry({ course_code: '21CSC203P', section_id: '21CSC203P' }),
    entry({ course_code: '21CSE251T', section_id: '21CSE251T_S1', section_number: 1 }),
    entry({ course_code: '21CSE251T', section_id: '21CSE251T_S2', section_number: 2, slot_band: 2 }),
    entry({ course_code: '21CSE999T', section_id: '21CSE999T' }),
  ]

  it('keeps only allowlisted codes and reports missing/excluded', () => {
    const result = filterScheduleEntries(rows, '21CSC203P, 21CSE251T, 21MISSING')
    expect(result.entries.map((e) => e.section_id)).toEqual([
      '21CSC203P',
      '21CSE251T_S1',
      '21CSE251T_S2',
    ])
    expect(result.kept).toBe(3)
    expect(result.dropped).toBe(1)
    expect(result.missingCodes).toEqual(['21MISSING'])
    expect(result.excludedCodes).toEqual(['21CSE999T'])
  })
})

describe('schedule filter round-trip', () => {
  it('parses Details sheet and filters to a subset', async () => {
    const schedule: Schedule = {
      entries: [
        entry({
          course_code: '21CSC203P',
          section_id: '21CSC203P',
          course_title: 'Data Structures',
          day: 'Monday',
          slot_index: 0,
          slot_band: 1,
          parallel_lane_count: 2,
          faculty: 'Dr. A',
          enrollment_count: 55,
          programs: 'CSE, IT',
        }),
        entry({
          course_code: '21CSE251T',
          section_id: '21CSE251T',
          course_title: 'Algorithms',
          day: 'Tuesday',
          slot_index: 1,
          slot_band: 2,
          parallel_lane_count: 2,
          faculty: null,
          enrollment_count: 48,
          programs: 'CSE',
        }),
        entry({
          course_code: '21CSE254T',
          section_id: '21CSE254T',
          course_title: 'Networks',
          day: 'Wednesday',
          slot_index: 2,
          slot_band: 1,
          parallel_lane_count: 1,
          enrollment_count: 30,
          programs: 'ECE',
        }),
      ],
      total_sections: 3,
      solver_used: 'cpsat',
      solver_time_seconds: 1.2,
      total_clashes: 0,
    }

    const buf = await scheduleToWorkbookBuffer(schedule)
    const parsed = await readScheduleEntriesFromBuffer(buf)
    expect(parsed).toHaveLength(3)
    expect(parsed.map((e) => e.course_code).sort()).toEqual([
      '21CSC203P',
      '21CSE251T',
      '21CSE254T',
    ])

    const ds = parsed.find((e) => e.course_code === '21CSC203P')!
    expect(ds.course_title).toBe('Data Structures')
    expect(ds.day).toBe('Monday')
    expect(ds.slot_index).toBe(0)
    expect(ds.slot_band).toBe(1)
    expect(ds.parallel_lane_count).toBe(2)
    expect(ds.faculty).toBe('Dr. A')
    expect(ds.enrollment_count).toBe(55)
    expect(ds.programs).toContain('CSE')

    const alg = parsed.find((e) => e.course_code === '21CSE251T')!
    expect(alg.faculty).toBeNull()

    const filtered = filterScheduleEntries(parsed, '21CSC203P\n21CSE254T')
    expect(filtered.entries.map((e) => e.course_code).sort()).toEqual([
      '21CSC203P',
      '21CSE254T',
    ])
    expect(filtered.dropped).toBe(1)

    const rebuilt = scheduleFromFilteredEntries(filtered.entries)
    const outBuf = await scheduleToWorkbookBuffer(rebuilt)
    const round2 = await readScheduleEntriesFromBuffer(outBuf)
    expect(round2.map((e) => e.course_code).sort()).toEqual(['21CSC203P', '21CSE254T'])
  })
})

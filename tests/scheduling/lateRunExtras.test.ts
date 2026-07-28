import { describe, expect, it } from 'vitest'
import {
  appendRunLog,
  createRunLogEntry,
  nextLateBatch,
  nextRunSeq,
} from '../../src/modules/scheduling/merge/runLog'
import {
  buildClashCause,
  clashProvenanceKey,
  updateClashProvenance,
} from '../../src/modules/scheduling/merge/clashProvenance'
import { diffClashReports } from '../../src/modules/scheduling/merge/rectifyDiff'
import type { ClashReport } from '../../src/modules/scheduling/types'
import { formatLateAddsChain } from '../../src/modules/scheduling/io/excelLateMarking'
import { buildSchedule } from '../../src/modules/scheduling/solver/scheduleOutput'
import type { Section } from '../../src/modules/scheduling/types'

describe('runLog', () => {
  it('sequences and late batches increment', () => {
    expect(nextRunSeq([])).toBe(1)
    expect(nextLateBatch([])).toBe(1)
    const e1 = createRunLogEntry({
      seq: 1,
      mode: 'solve',
      inputs: {},
      students_before: 0,
      students_after: 10,
      students_added: 10,
      registrations_added: 20,
      courses_added: 5,
      sections_created: [],
      students_moved_between_sections: 0,
      capacity_waivers: [],
      parked: [],
      red_before: 0,
      red_after: 1,
      clashes_introduced: 1,
      clashes_resolved: 0,
      decisions: [],
      notes: [],
    }, () => new Date('2026-01-01T00:00:00.000Z'))
    const log = appendRunLog([], e1)
    expect(nextRunSeq(log)).toBe(2)
    const e2 = createRunLogEntry({
      ...e1,
      seq: 2,
      mode: 'late',
      batch: 1,
    })
    const log2 = appendRunLog(log, e2)
    expect(nextLateBatch(log2)).toBe(2)
  })
})

describe('clashProvenance', () => {
  it('records introduced clashes with cause sentences', () => {
    const empty: ClashReport = {
      total_students: 0,
      students_with_clashes: 0,
      clash_free_students: 0,
      clash_percentage: 0,
      reports: [],
    }
    const next: ClashReport = {
      total_students: 1,
      students_with_clashes: 1,
      clash_free_students: 0,
      clash_percentage: 100,
      reports: [
        {
          register_number: 'R1',
          student_name: 'Alice',
          program: 'CSE',
          enrolled_courses: ['A', 'B'],
          status: 'Red',
          clashing_courses: [['A', 'B']],
          clashing_day: 'Monday',
          clashing_days: ['Monday'],
        },
      ],
    }
    const diff = diffClashReports(empty, next)
    const map = updateClashProvenance({}, diff, {
      seq: 2,
      at: '2026-01-02T00:00:00.000Z',
      operation: 'late',
      batch: 1,
      newlyAddedCourses: ['B'],
    })
    const key = clashProvenanceKey('R1', 'Monday')
    expect(map[key]?.operation).toBe('late')
    expect(map[key]?.cause).toContain('Late batch 1')
    expect(map[key]?.cause).toContain('Monday')
  })

  it('buildClashCause for solve mentions proven minimal', () => {
    const cause = buildClashCause(
      {
        register_number: 'R1',
        student_name: 'A',
        day: 'Tuesday',
        courses: ['X', 'Y'],
      },
      { seq: 1, at: 't', operation: 'solve', provenMinimal: true },
    )
    expect(cause).toContain('proven minimal')
  })
})

describe('formatLateAddsChain', () => {
  it('renders batch chain', () => {
    expect(formatLateAddsChain(undefined)).toBe('')
    expect(formatLateAddsChain([5])).toBe('5')
    expect(formatLateAddsChain([5, 3])).toBe('5 +3')
    expect(formatLateAddsChain([5, 3, 2])).toBe('5 +3 +2')
  })
})

describe('laneStability', () => {
  it('preserves previous lane numbers when inserting a new section', () => {
    const courseSections: Record<string, Section[]> = {
      A: [
        {
          section_id: 'A',
          course_code: 'A',
          course_title: 'A',
          section_number: 1,
          faculty: 'fA',
          capacity: 64,
          enrolled_students: ['R1'],
          programs: ['CSE'],
        },
      ],
      B: [
        {
          section_id: 'B',
          course_code: 'B',
          course_title: 'B',
          section_number: 1,
          faculty: 'fB',
          capacity: 64,
          enrolled_students: ['R2'],
          programs: ['CSE'],
        },
      ],
      C: [
        {
          section_id: 'C_S3',
          course_code: 'C',
          course_title: 'C',
          section_number: 3,
          faculty: 'fC',
          capacity: 60,
          enrolled_students: ['R3'],
          programs: ['CSE'],
        },
      ],
    }
    const slots = { A: 0, B: 0, C_S3: 0 }
    const previousLanes = { A: 1, B: 2 }
    const schedule = buildSchedule(
      courseSections,
      slots,
      { solver_used: 'test', solver_time_seconds: 0 },
      { previousLanes },
    )
    const byId = Object.fromEntries(schedule.entries.map((e) => [e.section_id, e.slot_band]))
    expect(byId.A).toBe(1)
    expect(byId.B).toBe(2)
    expect(byId.C_S3).toBe(3)
  })
})

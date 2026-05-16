import { describe, expect, it } from 'vitest'
import {
  applySavedRunEmailsToSession,
  buildCourseEmailsPipelineOutput,
  savedRunEmailsSourceLabel,
} from '../../src/features/scheduling/courseEmailsFromSnapshot'
import type { SavedScheduleRun } from '../../src/features/scheduling/storage/savedRunsStorage'
import type { SchedulingSnapshot } from '../../src/modules/scheduling/merge/snapshot'

function minimalSnapshot(rows: SchedulingSnapshot['enrollmentRows']): SchedulingSnapshot {
  return {
    students: { S1: { register_number: 'S1', student_name: 'Ada', program: 'CS', courses: ['C1'] } },
    courses: { C1: { course_code: 'C1', course_title: 'Intro', faculty: null } },
    courseSections: { C1: [] },
    enrollmentRows: rows,
    facultyOverrides: {},
  }
}

describe('buildCourseEmailsPipelineOutput', () => {
  it('groups emails by course from enrollment rows', () => {
    const snapshot = minimalSnapshot([
      {
        program: 'CS',
        register_number: 'S1',
        student_name: 'Ada',
        mobile_number: null,
        email_id: 'ada@school.edu',
        course_code: 'C1',
        course_title: 'Intro',
        faculty: null,
        registration_type: null,
        remarks: null,
      },
      {
        program: 'CS',
        register_number: 'S2',
        student_name: 'Bob',
        mobile_number: null,
        email_id: 'bob@school.edu',
        course_code: 'C1',
        course_title: 'Intro',
        faculty: null,
        registration_type: null,
        remarks: null,
      },
    ])

    const out = buildCourseEmailsPipelineOutput(snapshot)
    expect(out.courseEmailsData).toHaveLength(1)
    expect(out.courseEmailsData![0]).toMatchObject({
      course_code: 'C1',
      student_count: 2,
      emails: ['ada@school.edu', 'bob@school.edu'],
    })
    expect(out.stats?.studentCount).toBe(1)
  })

  it('returns empty groups when snapshot has no enrollment rows', () => {
    const out = buildCourseEmailsPipelineOutput(minimalSnapshot([]))
    expect(out.courseEmailsData).toEqual([])
  })
})

describe('applySavedRunEmailsToSession', () => {
  const run: SavedScheduleRun = {
    id: 'run-1',
    createdAt: '2026-05-01T12:00:00.000Z',
    title: 'Spring 2026 (5/1/2026)',
    sourceFileName: 'enrollment.xlsx',
    snapshot: minimalSnapshot([
      {
        program: 'CS',
        register_number: 'S1',
        student_name: 'Ada',
        mobile_number: null,
        email_id: 'ada@school.edu',
        course_code: 'C1',
        course_title: 'Intro',
        faculty: null,
        registration_type: null,
        remarks: null,
      },
    ]),
  }

  it('sets session result and source label for runs with enrollment rows', () => {
    let result: ReturnType<typeof buildCourseEmailsPipelineOutput> | null = null
    let fileName: string | null = null
    const ok = applySavedRunEmailsToSession(
      run,
      (r) => {
        result = r
      },
      (n) => {
        fileName = n
      },
    )
    expect(ok).toBe(true)
    expect(result?.courseEmailsData).toHaveLength(1)
    expect(fileName).toBe(savedRunEmailsSourceLabel(run))
    expect(fileName).toContain('enrollment')
  })

  it('returns false when enrollment rows are missing', () => {
    const emptyRun = { ...run, snapshot: minimalSnapshot([]) }
    let called = false
    const ok = applySavedRunEmailsToSession(
      emptyRun,
      () => {
        called = true
      },
      () => {},
    )
    expect(ok).toBe(false)
    expect(called).toBe(false)
  })
})

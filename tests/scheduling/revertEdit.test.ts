import { describe, expect, it } from 'vitest'
import type { EnrollmentRow, Section, Student } from '../../src/modules/scheduling/types'
import {
  WEEKDAY_SLOT_MODEL,
  cloneSchedulingSnapshot,
  type SchedulingSnapshot,
} from '../../src/modules/scheduling/merge/snapshot'
import {
  dropStudentCourse,
  fixStudentCourse,
} from '../../src/modules/scheduling/merge/studentCourseEdit'
import {
  applyReverts,
  diffSnapshots,
  filterChanges,
  parseSearchTerms,
} from '../../src/modules/scheduling/merge/revertEdit'
import { createRunLogEntry } from '../../src/modules/scheduling/merge/runLog'
import { runRevertPipeline } from '../../src/modules/scheduling/pipeline/revertRun'

function row(
  partial: Partial<EnrollmentRow> &
    Pick<EnrollmentRow, 'register_number' | 'course_code' | 'course_title'>,
): EnrollmentRow {
  return {
    program: 'B.Tech CSE',
    student_name: 'Test Student',
    mobile_number: null,
    email_id: null,
    faculty: null,
    registration_type: null,
    remarks: null,
    ...partial,
  }
}

function section(
  partial: Partial<Section> & Pick<Section, 'section_id' | 'course_code' | 'enrolled_students'>,
): Section {
  return {
    course_title: 'Course',
    section_number: 1,
    faculty: null,
    capacity: 60,
    programs: ['B.Tech CSE'],
    ...partial,
  }
}

function student(
  partial: Partial<Student> & Pick<Student, 'register_number' | 'enrolled_courses'>,
): Student {
  return { name: 'Test Student', program: 'B.Tech CSE', email: null, mobile: null, ...partial }
}

function logEntry(seq: number, mode: 'solve' | 'fix-course' | 'drop-course', detail?: string) {
  return createRunLogEntry({
    seq,
    at: `2026-01-0${seq}T00:00:00.000Z`,
    mode,
    inputs: {},
    students_before: 0,
    students_after: 0,
    students_added: 0,
    registrations_added: 0,
    courses_added: 0,
    sections_created: [],
    students_moved_between_sections: 0,
    capacity_waivers: [],
    parked: [],
    red_before: 0,
    red_after: 0,
    clashes_introduced: 0,
    clashes_resolved: 0,
    decisions: detail ? [{ kind: 'other', subject: 'RA002', choice: mode, detail }] : [],
    notes: [],
  })
}

function baseline(): SchedulingSnapshot {
  return {
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: { '21MAB310T': 0, '21MAB301TP': 1, '21CSE101T': 2 },
    courseSections: {
      '21MAB310T': [
        section({
          section_id: '21MAB310T',
          course_code: '21MAB310T',
          course_title: 'Transforms',
          enrolled_students: ['RA001', 'RA002', 'RA003'],
        }),
      ],
      '21MAB301TP': [
        section({
          section_id: '21MAB301TP',
          course_code: '21MAB301TP',
          course_title: 'Typo Course',
          enrolled_students: ['RA999'],
        }),
      ],
      '21CSE101T': [
        section({
          section_id: '21CSE101T',
          course_code: '21CSE101T',
          course_title: 'Programming',
          enrolled_students: ['RA001', 'RA999'],
        }),
      ],
    },
    students: {
      RA001: student({ register_number: 'RA001', enrolled_courses: ['21CSE101T', '21MAB310T'] }),
      RA002: student({ register_number: 'RA002', enrolled_courses: ['21MAB310T'] }),
      RA003: student({ register_number: 'RA003', enrolled_courses: ['21MAB310T'] }),
      RA999: student({
        register_number: 'RA999',
        name: 'Mistaken Student',
        enrolled_courses: ['21CSE101T', '21MAB301TP'],
      }),
    },
    enrollmentRows: [
      row({ register_number: 'RA001', course_code: '21MAB310T', course_title: 'Transforms' }),
      row({ register_number: 'RA002', course_code: '21MAB310T', course_title: 'Transforms' }),
      row({ register_number: 'RA003', course_code: '21MAB310T', course_title: 'Transforms' }),
      row({ register_number: 'RA999', course_code: '21MAB301TP', course_title: 'Typo Course' }),
      row({ register_number: 'RA999', course_code: '21CSE101T', course_title: 'Programming' }),
      row({ register_number: 'RA001', course_code: '21CSE101T', course_title: 'Programming' }),
    ],
    run_log: [logEntry(1, 'solve')],
  }
}

function core(s: SchedulingSnapshot) {
  const c = cloneSchedulingSnapshot(s)
  return {
    courseSections: c.courseSections,
    students: c.students,
    enrollmentRows: c.enrollmentRows,
    slot_assignments: c.slot_assignments,
  }
}

function drop(s: SchedulingSnapshot, register: string, courseCode: string): SchedulingSnapshot {
  const next = dropStudentCourse(s, { register, courseCode }).snapshot
  next.run_log = [...(s.run_log ?? []), logEntry((s.run_log?.length ?? 0) + 1, 'drop-course')]
  return next
}

describe('diffSnapshots', () => {
  it('lists each removed registration', () => {
    const prev = baseline()
    const edited = drop(drop(prev, 'RA002', '21MAB310T'), 'RA999', '21CSE101T')
    const { changes, errors } = diffSnapshots(prev, edited)
    expect(errors).toEqual([])
    expect(changes.map((c) => `${c.kind}:${c.register}:${c.droppedCourse}`).sort()).toEqual([
      'dropped:RA002:21MAB310T',
      'dropped:RA999:21CSE101T',
    ])
  })

  it('reports no differences as an error', () => {
    const prev = baseline()
    const { errors } = diffSnapshots(prev, cloneSchedulingSnapshot(prev))
    expect(errors[0]).toMatch(/No differences/)
  })

  it('refuses swapped or unrelated folders', () => {
    const prev = baseline()
    const edited = drop(prev, 'RA002', '21MAB310T')
    expect(diffSnapshots(edited, prev).errors[0]).toMatch(/swapped/)

    const unrelated = baseline()
    unrelated.run_log = [{ ...logEntry(1, 'solve'), at: '1999-01-01T00:00:00.000Z' }]
    expect(diffSnapshots(prev, unrelated).errors[0]).toMatch(/not from the same schedule/)
  })

  it('pairs a fix-course into one "moved" change using the run log', () => {
    const prev = baseline()
    const fixed = fixStudentCourse(prev, {
      register: 'RA002',
      fromCode: '21MAB310T',
      toCode: '21CSE101T',
    }).snapshot
    fixed.run_log = [...prev.run_log!, logEntry(2, 'fix-course', '21MAB310T→21CSE101T')]
    const { changes } = diffSnapshots(prev, fixed)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: 'moved',
      register: 'RA002',
      droppedCourse: '21MAB310T',
      addedCourse: '21CSE101T',
    })
  })
})

describe('late-enrollment tagging', () => {
  it('tags added registrations that came from a late batch and warns about the extra run', () => {
    const prev = baseline()
    const edited = cloneSchedulingSnapshot(prev)
    edited.enrollmentRows.push(
      row({ register_number: 'RA002', course_code: '21CSE101T', course_title: 'Programming' }),
    )
    edited.students.RA002!.enrolled_courses.push('21CSE101T')
    edited.courseSections['21CSE101T']![0]!.enrolled_students.push('RA002')
    edited.late_enrollments = [{ register_number: 'RA002', course_code: '21CSE101T', batch: 2 }]
    edited.run_log = [
      ...prev.run_log!,
      { ...logEntry(2, 'solve'), mode: 'late' as never },
    ]

    const diff = diffSnapshots(prev, edited)
    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]).toMatchObject({ kind: 'added', lateBatch: 2 })
    expect(diff.warnings.join(' ')).toMatch(/late ×1/)

    const out = applyReverts(edited, prev, diff.changes)
    expect(out.snapshot.late_enrollments ?? []).toEqual([])
    expect(core(out.snapshot)).toEqual(core(prev))
  })
})

describe('filterChanges / parseSearchTerms', () => {
  it('matches register numbers and course codes case-insensitively', () => {
    const prev = baseline()
    const edited = drop(drop(prev, 'RA002', '21MAB310T'), 'RA999', '21CSE101T')
    const { changes } = diffSnapshots(prev, edited)
    expect(filterChanges(changes, ['ra002'])).toHaveLength(1)
    expect(filterChanges(changes, ['21cse101t'])).toHaveLength(1)
    expect(filterChanges(changes, ['ra002', '21CSE101T'])).toHaveLength(2)
    expect(filterChanges(changes, ['nobody'])).toHaveLength(0)
    expect(parseSearchTerms('RA002, 21CSE101T  RA003;')).toEqual(['RA002', '21CSE101T', 'RA003'])
  })
})

describe('applyReverts', () => {
  it('restores a dropped registration exactly as it was', () => {
    const prev = baseline()
    const edited = drop(prev, 'RA002', '21MAB310T') // RA002 had only this course → student removed too
    const { changes } = diffSnapshots(prev, edited)
    const out = applyReverts(edited, prev, changes)
    expect(out.skipped).toEqual([])
    expect(out.students_restored).toEqual(['RA002'])
    expect(core(out.snapshot)).toEqual(core(prev))
  })

  it('brings a pruned course back on its original weekday', () => {
    const prev = baseline()
    const edited = drop(prev, 'RA999', '21MAB301TP')
    expect(edited.courseSections['21MAB301TP']).toBeUndefined()
    const { changes } = diffSnapshots(prev, edited)
    const out = applyReverts(edited, prev, changes)
    expect(out.recreated_courses).toEqual(['21MAB301TP'])
    expect(out.snapshot.slot_assignments['21MAB301TP']).toBe(1)
    expect(core(out.snapshot)).toEqual(core(prev))
  })

  it('restores a student removed from every course', () => {
    const prev = baseline()
    const edited = drop(drop(prev, 'RA999', '21MAB301TP'), 'RA999', '21CSE101T')
    expect(edited.students.RA999).toBeUndefined()
    const { changes } = diffSnapshots(prev, edited)
    const out = applyReverts(edited, prev, changes)
    expect(out.skipped).toEqual([])
    expect(out.students_restored).toEqual(['RA999'])
    expect(core(out.snapshot)).toEqual(core(prev))
  })

  it('reverting a fix-course restores the old course and prunes the provisional one', () => {
    const prev = baseline()
    const fixed = fixStudentCourse(prev, {
      register: 'RA002',
      fromCode: '21MAB310T',
      toCode: '21NEW101T',
      toTitle: 'New Elective',
    }).snapshot
    fixed.slot_assignments['21NEW101T'] = 3
    fixed.run_log = [...prev.run_log!, logEntry(2, 'fix-course', '21MAB310T→21NEW101T (new/cpsat)')]

    const { changes } = diffSnapshots(prev, fixed)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe('moved')

    const out = applyReverts(fixed, prev, changes)
    expect(out.pruned_courses).toEqual(['21NEW101T'])
    expect(out.snapshot.courseSections['21NEW101T']).toBeUndefined()
    expect(out.snapshot.slot_assignments['21NEW101T']).toBeUndefined()
    expect(core(out.snapshot)).toEqual(core(prev))
  })

  it('a partial revert keeps the other edits', () => {
    const prev = baseline()
    const edited = drop(drop(prev, 'RA002', '21MAB310T'), 'RA003', '21MAB310T')
    const { changes } = diffSnapshots(prev, edited)
    const ra002 = changes.filter((c) => c.register === 'RA002')
    const out = applyReverts(edited, prev, ra002)
    expect(out.snapshot.students.RA002).toBeDefined()
    expect(out.snapshot.students.RA003).toBeUndefined()
    expect(out.snapshot.courseSections['21MAB310T']![0]!.enrolled_students).toEqual(['RA001', 'RA002'])
  })

  it('skips a change that cannot be applied without dropping the rest', () => {
    const prev = baseline()
    const edited = drop(drop(prev, 'RA002', '21MAB310T'), 'RA003', '21MAB310T')
    const { changes } = diffSnapshots(prev, edited)
    // Restoring RA002 on a snapshot that already has it is skipped, RA003 still goes through.
    const first = applyReverts(edited, prev, changes.filter((c) => c.register === 'RA002'))
    const out = applyReverts(first.snapshot, prev, changes)
    expect(out.skipped.map((s) => s.change.register)).toEqual(['RA002'])
    expect(out.applied.map((c) => c.register)).toEqual(['RA003'])
  })
})

describe('runRevertPipeline', () => {
  it('rebuilds exports and appends a revert entry to the run log', async () => {
    const prev = baseline()
    const edited = drop(prev, 'RA999', '21MAB301TP')
    const { changes } = diffSnapshots(prev, edited)

    const result = await runRevertPipeline(() => undefined, {
      baselineSnapshot: prev,
      editedSnapshot: edited,
      changes,
    })

    expect(result.infeasible).toBeFalsy()
    expect(result.revertReport?.applied).toHaveLength(1)
    expect(result.scheduleXlsx).not.toBeNull()
    expect(result.enrollmentXlsx).not.toBeNull()
    const last = result.runLog[result.runLog.length - 1]!
    expect(last.mode).toBe('revert')
    expect(last.seq).toBe(3)
    expect(core(result.schedulingSnapshot!)).toEqual(core(prev))
  })

  it('aborts cleanly when nothing is selected', async () => {
    const prev = baseline()
    const edited = drop(prev, 'RA999', '21MAB301TP')
    const result = await runRevertPipeline(() => undefined, {
      baselineSnapshot: prev,
      editedSnapshot: edited,
      changes: [],
    })
    expect(result.infeasible).toBe(true)
    expect(result.schedulingSnapshot).toBeNull()
  })
})

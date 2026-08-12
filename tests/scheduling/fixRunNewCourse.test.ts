import { describe, expect, it, vi } from 'vitest'
import type { EnrollmentRow, Section, Student } from '../../src/modules/scheduling/types'
import {
  WEEKDAY_SLOT_MODEL,
  type SchedulingSnapshot,
} from '../../src/modules/scheduling/merge/snapshot'
import { runFixPipeline } from '../../src/modules/scheduling/pipeline/fixRun'

vi.mock('../../src/modules/scheduling/solver/cpsatBridge', () => ({
  runCpsatScheduler: vi.fn(async () => {
    throw new Error('CP-SAT intentionally unavailable in unit test')
  }),
}))

function row(
  partial: Partial<EnrollmentRow> &
    Pick<EnrollmentRow, 'register_number' | 'course_code' | 'course_title'>,
): EnrollmentRow {
  return {
    program: partial.program ?? 'B.Tech CSE',
    student_name: partial.student_name ?? 'Test Student',
    mobile_number: partial.mobile_number ?? null,
    email_id: partial.email_id ?? null,
    faculty: partial.faculty ?? null,
    registration_type: partial.registration_type ?? null,
    remarks: partial.remarks ?? null,
    ...partial,
  }
}

function section(
  partial: Partial<Section> & Pick<Section, 'section_id' | 'course_code' | 'enrolled_students'>,
): Section {
  return {
    course_title: partial.course_title ?? 'Course',
    section_number: partial.section_number ?? 1,
    faculty: partial.faculty ?? `Faculty:${partial.course_code}`,
    capacity: partial.capacity ?? 60,
    programs: partial.programs ?? ['B.Tech CSE'],
    ...partial,
  }
}

function student(
  partial: Partial<Student> & Pick<Student, 'register_number' | 'enrolled_courses'>,
): Student {
  return {
    name: partial.name ?? 'Test Student',
    program: partial.program ?? 'B.Tech CSE',
    email: partial.email ?? null,
    mobile: partial.mobile ?? null,
    ...partial,
  }
}

function makeSnapshot(): SchedulingSnapshot {
  return {
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: {
      '21MAB310T': 0,
      '21MAB301TP': 1,
      '21CSE101T': 2,
    },
    courseSections: {
      '21MAB310T': [
        section({
          section_id: '21MAB310T',
          course_code: '21MAB310T',
          course_title: 'Transforms',
          enrolled_students: ['RA001'],
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
          enrolled_students: ['RA999', 'RA001'],
        }),
      ],
    },
    students: {
      RA001: student({ register_number: 'RA001', enrolled_courses: ['21CSE101T', '21MAB310T'] }),
      RA999: student({
        register_number: 'RA999',
        name: 'Mistaken Student',
        enrolled_courses: ['21CSE101T', '21MAB301TP'],
      }),
    },
    enrollmentRows: [
      row({ register_number: 'RA001', course_code: '21MAB310T', course_title: 'Transforms' }),
      row({
        register_number: 'RA999',
        course_code: '21MAB301TP',
        course_title: 'Typo Course',
        student_name: 'Mistaken Student',
      }),
      row({
        register_number: 'RA999',
        course_code: '21CSE101T',
        course_title: 'Programming',
        student_name: 'Mistaken Student',
      }),
      row({ register_number: 'RA001', course_code: '21CSE101T', course_title: 'Programming' }),
    ],
  }
}

describe('runFixPipeline new-course path', () => {
  it('places a brand-new target course with existing weekdays frozen', async () => {
    const before = makeSnapshot()
    const result = await runFixPipeline(() => {}, {
      previousSnapshot: before,
      mode: 'fix-course',
      fix: {
        register: 'RA999',
        fromCode: '21MAB301TP',
        toCode: '21NEW101T',
        toTitle: 'Brand New Course',
      },
      seed: 42,
    })

    expect(result.infeasible).toBeFalsy()
    expect(result.editReport?.created_new_course).toBe(true)
    expect(result.editReport?.placement_method).toBe('greedy-fallback')
    expect(result.editReport?.added_course).toBe('21NEW101T')
    expect(result.editReport?.new_course_slot).toBeTypeOf('number')

    const snap = result.schedulingSnapshot!
    expect(snap.courseSections['21NEW101T']![0]!.enrolled_students).toEqual(['RA999'])
    expect(snap.slot_assignments['21NEW101T']).toBe(result.editReport?.new_course_slot)
    // Existing courses keep their weekdays
    expect(snap.slot_assignments['21MAB310T']).toBe(0)
    expect(snap.slot_assignments['21CSE101T']).toBe(2)
    expect(snap.courseSections['21MAB301TP']).toBeUndefined()
  })

  it('keeps snapshot-rebuild path when target already exists', async () => {
    const result = await runFixPipeline(() => {}, {
      previousSnapshot: makeSnapshot(),
      mode: 'fix-course',
      fix: {
        register: 'RA999',
        fromCode: '21MAB301TP',
        toCode: '21MAB310T',
      },
      seed: 42,
    })

    expect(result.infeasible).toBeFalsy()
    expect(result.editReport?.created_new_course).toBe(false)
    expect(result.editReport?.placement_method).toBe('existing')
    expect(result.solver_status).toBe('SNAPSHOT')
    expect(result.schedulingSnapshot!.slot_assignments['21MAB310T']).toBe(0)
  })
})

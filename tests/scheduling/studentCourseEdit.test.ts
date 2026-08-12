import { describe, expect, it } from 'vitest'
import type { EnrollmentRow, Section, Student } from '../../src/modules/scheduling/types'
import {
  WEEKDAY_SLOT_MODEL,
  type SchedulingSnapshot,
} from '../../src/modules/scheduling/merge/snapshot'
import {
  StudentCourseEditError,
  dropStudentCourse,
  fixStudentCourse,
  listStudentCourses,
} from '../../src/modules/scheduling/merge/studentCourseEdit'

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
    faculty: partial.faculty ?? null,
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
  const mainStudents = ['RA001', 'RA002', 'RA003']
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
          enrolled_students: [...mainStudents],
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

describe('listStudentCourses', () => {
  it('lists courses with titles for a register', () => {
    const listed = listStudentCourses(makeSnapshot(), 'ra999')
    expect(listed.map((c) => c.course_code).sort()).toEqual(['21CSE101T', '21MAB301TP'])
    expect(listed.find((c) => c.course_code === '21MAB301TP')?.course_title).toBe('Typo Course')
  })

  it('throws for unknown register', () => {
    expect(() => listStudentCourses(makeSnapshot(), 'NOPE')).toThrow(StudentCourseEditError)
  })
})

describe('fixStudentCourse', () => {
  it('moves typo-course student onto the main course and prunes the empty typo course', () => {
    const before = makeSnapshot()
    const otherSlots = { ...before.slot_assignments }
    const result = fixStudentCourse(before, {
      register: 'RA999',
      fromCode: '21MAB301TP',
      toCode: '21MAB310T',
    })

    expect(result.added_course).toBe('21MAB310T')
    expect(result.pruned_courses).toEqual(['21MAB301TP'])
    expect(result.snapshot.courseSections['21MAB301TP']).toBeUndefined()
    expect(result.snapshot.slot_assignments['21MAB301TP']).toBeUndefined()

    const main = result.snapshot.courseSections['21MAB310T']![0]!
    expect(main.enrolled_students).toContain('RA999')
    expect(main.enrolled_students).toEqual(expect.arrayContaining(['RA001', 'RA002', 'RA003']))

    expect(result.snapshot.students.RA999!.enrolled_courses.sort()).toEqual([
      '21CSE101T',
      '21MAB310T',
    ])
    expect(
      result.snapshot.enrollmentRows.some(
        (r) => r.register_number === 'RA999' && r.course_code === '21MAB301TP',
      ),
    ).toBe(false)
    expect(
      result.snapshot.enrollmentRows.some(
        (r) => r.register_number === 'RA999' && r.course_code === '21MAB310T',
      ),
    ).toBe(true)

    // Other course weekdays unchanged
    expect(result.snapshot.slot_assignments['21MAB310T']).toBe(otherSlots['21MAB310T'])
    expect(result.snapshot.slot_assignments['21CSE101T']).toBe(otherSlots['21CSE101T'])
    expect(result.snapshot.courseSections['21CSE101T']![0]!.enrolled_students).toEqual([
      'RA999',
      'RA001',
    ])
  })

  it('creates a provisional section when the target course is missing', () => {
    const before = makeSnapshot()
    const otherSlots = { ...before.slot_assignments }
    const result = fixStudentCourse(before, {
      register: 'RA999',
      fromCode: '21MAB301TP',
      toCode: '21NEW101T',
      toTitle: 'Brand New Course',
    })

    expect(result.created_new_course).toBe(true)
    expect(result.added_course).toBe('21NEW101T')
    expect(result.pruned_courses).toEqual(['21MAB301TP'])
    expect(result.snapshot.courseSections['21NEW101T']).toHaveLength(1)
    expect(result.snapshot.courseSections['21NEW101T']![0]!.enrolled_students).toEqual(['RA999'])
    expect(result.snapshot.courseSections['21NEW101T']![0]!.course_title).toBe('Brand New Course')
    // No weekday yet — fix pipeline must place via CP-SAT
    expect(result.snapshot.slot_assignments['21NEW101T']).toBeUndefined()
    expect(result.snapshot.students.RA999!.enrolled_courses.sort()).toEqual([
      '21CSE101T',
      '21NEW101T',
    ])
    expect(result.snapshot.slot_assignments['21CSE101T']).toBe(otherSlots['21CSE101T'])
    expect(result.snapshot.slot_assignments['21MAB310T']).toBe(otherSlots['21MAB310T'])
  })

  it('rejects duplicate target enrollment', () => {
    expect(() =>
      fixStudentCourse(makeSnapshot(), {
        register: 'RA999',
        fromCode: '21MAB301TP',
        toCode: '21CSE101T',
      }),
    ).toThrow(/already enrolled/)
  })

  it('marks created_new_course false when moving onto an existing course', () => {
    const result = fixStudentCourse(makeSnapshot(), {
      register: 'RA999',
      fromCode: '21MAB301TP',
      toCode: '21MAB310T',
    })
    expect(result.created_new_course).toBe(false)
  })
})

describe('dropStudentCourse', () => {
  it('removes one course and keeps other enrollments', () => {
    const result = dropStudentCourse(makeSnapshot(), {
      register: 'RA999',
      courseCode: '21CSE101T',
    })
    expect(result.removed_course).toBe('21CSE101T')
    expect(result.student_removed).toBe(false)
    expect(result.snapshot.students.RA999!.enrolled_courses).toEqual(['21MAB301TP'])
    expect(result.snapshot.courseSections['21CSE101T']![0]!.enrolled_students).toEqual(['RA001'])
    expect(
      result.snapshot.enrollmentRows.some(
        (r) => r.register_number === 'RA999' && r.course_code === '21CSE101T',
      ),
    ).toBe(false)
  })

  it('prunes empty course and drops student with no courses left', () => {
    const snap = makeSnapshot()
    // Leave RA999 only on the typo course
    snap.students.RA999!.enrolled_courses = ['21MAB301TP']
    snap.courseSections['21CSE101T']![0]!.enrolled_students = ['RA001']
    snap.enrollmentRows = snap.enrollmentRows.filter(
      (r) => !(r.register_number === 'RA999' && r.course_code === '21CSE101T'),
    )

    const result = dropStudentCourse(snap, { register: 'RA999', courseCode: '21MAB301TP' })
    expect(result.pruned_courses).toEqual(['21MAB301TP'])
    expect(result.student_removed).toBe(true)
    expect(result.snapshot.students.RA999).toBeUndefined()
    expect(result.snapshot.courseSections['21MAB301TP']).toBeUndefined()
  })
})

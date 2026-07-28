import { describe, expect, it } from 'vitest'
import {
  assertFrozenInvariants,
  computeLateAdditions,
  equalizeCourseSections,
  mergeLateStudentsIntoSections,
  nextSectionId,
  preflightLateCapacity,
  type LateAddition,
} from '../../src/modules/scheduling/merge/lateEnrollment'
import type { SchedulingSnapshot } from '../../src/modules/scheduling/merge/snapshot'
import type { EnrollmentRow, Section, Student } from '../../src/modules/scheduling/types'
import { WEEKDAY_SLOT_MODEL } from '../../src/modules/scheduling/merge/snapshot'

function makeSection(
  id: string,
  code: string,
  num: number,
  capacity: number,
  students: string[],
): Section {
  return {
    section_id: id,
    course_code: code,
    course_title: `${code} Title`,
    section_number: num,
    faculty: `Planning:${id}`,
    capacity,
    enrolled_students: [...students],
    programs: ['CSE'],
  }
}

function snapshotFixture(): SchedulingSnapshot {
  const s1 = makeSection('21CSC101T', '21CSC101T', 1, 64, ['R1', 'R2', 'R3'])
  const m1 = makeSection(
    '21MAB101T_S1',
    '21MAB101T',
    1,
    60,
    Array.from({ length: 59 }, (_, i) => `M${i}`),
  )
  const m2 = makeSection(
    '21MAB101T_S2',
    '21MAB101T',
    2,
    60,
    Array.from({ length: 59 }, (_, i) => `N${i}`),
  )

  const students: Record<string, Student> = {
    R1: {
      register_number: 'R1',
      name: 'Alice',
      program: 'CSE',
      email: 'a@x.com',
      mobile: '1',
      enrolled_courses: ['21CSC101T'],
    },
    R2: {
      register_number: 'R2',
      name: 'Bob',
      program: 'CSE',
      email: null,
      mobile: null,
      enrolled_courses: ['21CSC101T'],
    },
    R3: {
      register_number: 'R3',
      name: 'Cara',
      program: 'CSE',
      email: null,
      mobile: null,
      enrolled_courses: ['21CSC101T'],
    },
  }
  for (const reg of m1.enrolled_students.concat(m2.enrolled_students)) {
    students[reg] = {
      register_number: reg,
      name: reg,
      program: 'CSE',
      email: null,
      mobile: null,
      enrolled_courses: ['21MAB101T'],
    }
  }

  const enrollmentRows: EnrollmentRow[] = Object.values(students).flatMap((st) =>
    st.enrolled_courses.map((code) => ({
      program: st.program,
      register_number: st.register_number,
      student_name: st.name,
      mobile_number: st.mobile,
      email_id: st.email,
      course_code: code,
      course_title: `${code} Title`,
      faculty: null,
      registration_type: null,
      remarks: null,
    })),
  )

  return {
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: {
      '21CSC101T': 0,
      '21MAB101T_S1': 1,
      '21MAB101T_S2': 1,
    },
    courseSections: {
      '21CSC101T': [s1],
      '21MAB101T': [m1, m2],
    },
    students,
    enrollmentRows,
  }
}

/** `n` late registrations for the near-full maths course (118/120, 2 seats free). */
function mathAdds(n: number): LateAddition[] {
  return Array.from({ length: n }, (_, i) => ({
    register_number: `L${i}`,
    student_name: `L${i}`,
    program: 'CSE',
    course_code: '21MAB101T',
    course_title: 't',
    mobile_number: null,
    email_id: null,
    faculty: null,
    is_new_student: true,
  }))
}

describe('lateEnrollment', () => {
  it('nextSectionId handles bare-code and already-split courses', () => {
    const bare: Section[] = [
      {
        section_id: '21CSC101T',
        course_code: '21CSC101T',
        course_title: 't',
        section_number: 1,
        faculty: null,
        capacity: 64,
        enrolled_students: [],
        programs: [],
      },
    ]
    expect(nextSectionId('21CSC101T', bare)).toBe('21CSC101T_S2')

    const split: Section[] = [
      { ...bare[0]!, section_id: '21MAB101T_S1', course_code: '21MAB101T', section_number: 1 },
      { ...bare[0]!, section_id: '21MAB101T_S2', course_code: '21MAB101T', section_number: 2 },
    ]
    expect(nextSectionId('21MAB101T', split)).toBe('21MAB101T_S3')
  })

  it('computeLateAdditions finds new rows and ignores already enrolled', () => {
    const snap = snapshotFixture()
    const late: EnrollmentRow[] = [
      {
        program: 'CSE',
        register_number: 'R1',
        student_name: 'Alice',
        mobile_number: null,
        email_id: null,
        course_code: '21CSC101T',
        course_title: 't',
        faculty: null,
        registration_type: null,
        remarks: null,
      },
      {
        program: 'CSE',
        register_number: 'LATE1',
        student_name: 'Late Kid',
        mobile_number: null,
        email_id: null,
        course_code: '21CSC101T',
        course_title: 't',
        faculty: null,
        registration_type: null,
        remarks: null,
      },
    ]
    const result = computeLateAdditions(snap, late)
    expect(result.additions).toHaveLength(1)
    expect(result.additions[0]!.register_number).toBe('LATE1')
    expect(result.classifications.some((c) => c.kind === 'already_enrolled')).toBe(true)
  })

  it('preflightLateCapacity detects shortfall on near-full course', () => {
    const snap = snapshotFixture()
    const adds = Array.from({ length: 5 }, (_, i) => ({
      register_number: `L${i}`,
      student_name: `L${i}`,
      program: 'CSE',
      course_code: '21MAB101T',
      course_title: 't',
      mobile_number: null,
      email_id: null,
      faculty: null,
      is_new_student: true,
    }))
    const conflicts = preflightLateCapacity(
      snap.courseSections,
      adds,
      { '21MAB101T': 1, '21CSC101T': 0 },
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.shortfall).toBe(3) // 2 free, 5 demand
  })

  it('merge with new-section creates S3 and freezes existing weekdays', () => {
    const snap = snapshotFixture()
    const adds = Array.from({ length: 5 }, (_, i) => ({
      register_number: `L${i}`,
      student_name: `L${i}`,
      program: 'CSE',
      course_code: '21MAB101T',
      course_title: 't',
      mobile_number: null,
      email_id: null,
      faculty: null,
      is_new_student: true,
    }))
    const merged = mergeLateStudentsIntoSections({
      snapshot: snap,
      additions: adds,
      decisions: [{ course_code: '21MAB101T', strategy: 'new-section' }],
    })
    expect(merged.new_section_ids).toContain('21MAB101T_S3')
    expect(merged.slot_assignments['21MAB101T_S1']).toBe(1)
    expect(merged.slot_assignments['21MAB101T_S2']).toBe(1)
    expect(merged.slot_assignments['21MAB101T_S3']).toBe(1)
    expect(merged.courseSections['21MAB101T']!).toHaveLength(3)
  })

  it('equalize moves students without changing weekday', () => {
    const secs: Section[] = [
      {
        section_id: 'A_S1',
        course_code: 'A',
        course_title: 'A',
        section_number: 1,
        faculty: 'f1',
        capacity: 60,
        enrolled_students: Array.from({ length: 50 }, (_, i) => `A${i}`),
        programs: ['CSE'],
      },
      {
        section_id: 'A_S2',
        course_code: 'A',
        course_title: 'A',
        section_number: 2,
        faculty: 'f2',
        capacity: 60,
        enrolled_students: Array.from({ length: 10 }, (_, i) => `B${i}`),
        programs: ['CSE'],
      },
    ]
    const students: Record<string, Student> = {}
    for (const s of secs.flatMap((x) => x.enrolled_students)) {
      students[s] = {
        register_number: s,
        name: s,
        program: 'CSE',
        email: null,
        mobile: null,
        enrolled_courses: ['A'],
      }
    }
    const moves = equalizeCourseSections(secs, students)
    expect(moves.length).toBeGreaterThan(0)
    expect(secs[0]!.enrolled_students.length).toBe(30)
    expect(secs[1]!.enrolled_students.length).toBe(30)
  })

  it('fit overflows existing sections and logs a capacity waiver', () => {
    const snap = snapshotFixture()
    const merged = mergeLateStudentsIntoSections({
      snapshot: snap,
      additions: mathAdds(5),
      decisions: [{ course_code: '21MAB101T', strategy: 'fit' }],
    })
    expect(merged.new_section_ids).toHaveLength(0)
    expect(merged.courseSections['21MAB101T']!).toHaveLength(2)
    const loads = merged.courseSections['21MAB101T']!.map((s) => s.enrolled_students.length)
    expect(loads.reduce((a, b) => a + b, 0)).toBe(123)
    expect(merged.capacity_waivers.length).toBeGreaterThan(0)
    expect(merged.assignments.every((a) => a.how === 'overflow')).toBe(true)
  })

  it('buffer fills soft capacity before opening a new section', () => {
    const snap = snapshotFixture()
    // 2 hard-free + 2 soft seats per section = 6 placeable, so 8 adds spill over by 2.
    const merged = mergeLateStudentsIntoSections({
      snapshot: snap,
      additions: mathAdds(8),
      decisions: [{ course_code: '21MAB101T', strategy: 'buffer', buffer_per_section: 2 }],
    })
    expect(merged.new_section_ids).toEqual(['21MAB101T_S3'])
    const secs = merged.courseSections['21MAB101T']!
    expect(secs.slice(0, 2).map((s) => s.enrolled_students.length)).toEqual([62, 62])
    expect(secs[2]!.enrolled_students).toHaveLength(2)
    expect(merged.capacity_waivers).toHaveLength(2)
  })

  it('park fills free seats and leaves the shortfall unplaced', () => {
    const snap = snapshotFixture()
    const merged = mergeLateStudentsIntoSections({
      snapshot: snap,
      additions: mathAdds(5),
      decisions: [{ course_code: '21MAB101T', strategy: 'park' }],
    })
    expect(merged.new_section_ids).toHaveLength(0)
    expect(merged.assignments).toHaveLength(2)
    expect(merged.parked).toHaveLength(3)
    expect(merged.capacity_waivers).toHaveLength(0)
  })

  it('equalize rebalances after the new section and retags moved late students', () => {
    const snap = snapshotFixture()
    const merged = mergeLateStudentsIntoSections({
      snapshot: snap,
      additions: mathAdds(5),
      decisions: [{ course_code: '21MAB101T', strategy: 'equalize' }],
    })
    const loads = merged.courseSections['21MAB101T']!.map((s) => s.enrolled_students.length)
    expect(loads).toEqual([41, 41, 41])
    expect(merged.moved_students.length).toBeGreaterThan(0)
    // Every late student still resolves to the section that actually holds them.
    for (const a of merged.assignments) {
      const holder = merged.courseSections[a.course_code]!.find((s) =>
        s.enrolled_students.includes(a.register_number),
      )
      expect(holder?.section_id).toBe(a.section_id)
    }
  })

  it('park decisions keep the student out of every roster and enrollment row', () => {
    const snap = snapshotFixture()
    const merged = mergeLateStudentsIntoSections({
      snapshot: snap,
      additions: [
        {
          register_number: 'LATE1',
          student_name: 'Late Kid',
          program: 'CSE',
          course_code: '21CSC101T',
          course_title: 't',
          mobile_number: null,
          email_id: null,
          faculty: null,
          is_new_student: true,
        },
      ],
      decisions: [],
      parkedStudents: new Set(['LATE1']),
    })
    expect(merged.assignments).toHaveLength(0)
    expect(merged.parked).toHaveLength(1)
    expect(merged.students.LATE1).toBeUndefined()
    expect(merged.enrollmentRows.some((r) => r.register_number === 'LATE1')).toBe(false)
    expect(
      merged.courseSections['21CSC101T']!.some((s) => s.enrolled_students.includes('LATE1')),
    ).toBe(false)
  })

  it('merge never mutates the source snapshot', () => {
    const snap = snapshotFixture()
    const beforeLoads = snap.courseSections['21MAB101T']!.map((s) => s.enrolled_students.length)
    const beforeRows = snap.enrollmentRows.length
    mergeLateStudentsIntoSections({
      snapshot: snap,
      additions: mathAdds(5),
      decisions: [{ course_code: '21MAB101T', strategy: 'equalize' }],
    })
    expect(snap.courseSections['21MAB101T']!.map((s) => s.enrolled_students.length)).toEqual(
      beforeLoads,
    )
    expect(snap.courseSections['21MAB101T']).toHaveLength(2)
    expect(snap.enrollmentRows).toHaveLength(beforeRows)
  })

  it('assertFrozenInvariants catches weekday moves and untouched-student clashes', () => {
    const snap = snapshotFixture()
    const afterSlots = { ...snap.slot_assignments, '21CSC101T': 2 }
    const violations = assertFrozenInvariants({
      before: snap,
      afterSections: snap.courseSections,
      afterSlots,
      afterClashReds: new Set(['R1']),
      beforeClashReds: new Set(),
      touchedRegisterNumbers: new Set(),
    })
    expect(violations.some((v) => v.kind === 'weekday_moved')).toBe(true)
    expect(violations.some((v) => v.kind === 'untouched_student_clash')).toBe(true)
  })
})

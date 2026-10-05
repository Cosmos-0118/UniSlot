import { describe, expect, it } from 'vitest'
import { assignStudentsToSections } from '../../src/modules/scheduling/solver/sectioning'
import { computeSectionSplits } from '../../src/modules/scheduling/solver/capacity'
import type { EnrollmentRow, Student } from '../../src/modules/scheduling/types'

function student(reg: string, courses: string[]): Student {
  return {
    register_number: reg,
    name: reg,
    program: 'CS',
    email: null,
    mobile: null,
    enrolled_courses: courses,
  }
}

describe('assignStudentsToSections', () => {
  it('keeps every student in exactly one section under capacity', () => {
    const courses = {
      CS101: { code: 'CS101', title: 'CS', enrollment_count: 80, faculty: null, section_count: 0 },
    }
    const courseSections = computeSectionSplits(courses)
    const students: Record<string, Student> = {}
    const rows: EnrollmentRow[] = []
    for (let i = 0; i < 80; i++) {
      const id = `s${i}`
      const others = i < 40 ? ['MA101'] : ['PH101']
      students[id] = student(id, ['CS101', ...others])
      rows.push({
        program: 'CS',
        register_number: id,
        student_name: id,
        mobile_number: null,
        email_id: null,
        course_code: 'CS101',
        course_title: 'CS',
        faculty: null,
        registration_type: null,
        remarks: null,
      })
    }
    const out = assignStudentsToSections(students, courseSections, rows)
    const secs = out.CS101!
    expect(secs.length).toBe(2)
    const assigned = secs.flatMap((s) => s.enrolled_students)
    expect(assigned.sort()).toEqual(Object.keys(students).sort())
    for (const s of secs) {
      expect(s.enrolled_students.length).toBeLessThanOrEqual(s.capacity)
    }
  })

  it('uses canonical memberships, de-duplicates registrations, and ignores row-only memberships', () => {
    const courses = {
      A: { code: 'A', title: 'A', enrollment_count: 65, faculty: null, section_count: 0 },
    }
    const sections = computeSectionSplits(courses)
    sections.A![0]!.capacity = 2
    sections.A![1]!.capacity = 2
    const students = {
      s1: { ...student('s1', ['A', 'A']), program: 'CS' },
      s2: student('s2', ['A']),
      s3: student('s3', ['A']),
    }
    const rows: EnrollmentRow[] = [
      ...['s1', 's1', 's2'].map((id) => ({
        program: id === 's1' ? 'ZPROGRAM' : 'CS', register_number: id, student_name: id, mobile_number: null,
        email_id: null, course_code: 'A', course_title: 'A', faculty: null,
        registration_type: null, remarks: null,
      })),
      {
        program: 'CS', register_number: 'not-canonical', student_name: 'not-canonical',
        mobile_number: null, email_id: null, course_code: 'A', course_title: 'A',
        faculty: null, registration_type: null, remarks: null,
      },
    ]

    const out = assignStudentsToSections(students, sections, rows).A!
    const assigned = out.flatMap((section) => section.enrolled_students)
    expect(assigned.toSorted()).toEqual(['s1', 's2', 's3'])
    expect(new Set(assigned).size).toBe(3)
    expect(out.every((section) => section.enrolled_students.length <= section.capacity)).toBe(true)
    expect(out.flatMap((section) => section.programs)).toContain('ZPROGRAM')
    expect(out.flatMap((section) => section.programs)).toContain('CS')
  })

  it('keeps section loads balanced before using program cohesion as a tie-breaker', () => {
    const courses = {
      A: { code: 'A', title: 'A', enrollment_count: 65, faculty: null, section_count: 0 },
    }
    const sections = computeSectionSplits(courses)
    sections.A![0]!.capacity = 2
    sections.A![1]!.capacity = 4
    const students = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`s${i}`, student(`s${i}`, ['A'])]),
    )
    const rows: EnrollmentRow[] = Array.from({ length: 6 }, (_, i) => ({
      program: i < 3 ? 'CSE' : 'ECE', register_number: `s${i}`, student_name: `s${i}`,
      mobile_number: null, email_id: null, course_code: 'A', course_title: 'A',
      faculty: null, registration_type: null, remarks: null,
    }))

    const out = assignStudentsToSections(students, sections, rows).A!
    expect(out.map((section) => section.enrolled_students.length)).toEqual([2, 4])
    expect(out[0]!.enrolled_students).toEqual(['s0', 's2'])
    expect(out[1]!.enrolled_students).toEqual(['s1', 's3', 's4', 's5'])
    expect(out.flatMap((section) => section.programs)).toEqual(['CSE', 'CSE', 'ECE'])
  })

  it('fails clearly when canonical course enrollment exceeds all section capacities', () => {
    const courses = {
      A: { code: 'A', title: 'A', enrollment_count: 65, faculty: null, section_count: 0 },
    }
    const sections = computeSectionSplits(courses)
    sections.A!.forEach((section) => { section.capacity = 1 })
    const students = Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [`s${i}`, student(`s${i}`, ['A'])]),
    )
    expect(() => assignStudentsToSections(students, sections, [])).toThrow(/capacity/i)
  })
})

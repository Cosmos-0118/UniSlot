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
})

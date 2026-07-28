import { describe, expect, it } from 'vitest'
import { buildConflictGraph } from '../../src/modules/scheduling/preprocess/preprocessing'
import { placeFreeCourseWeekdays } from '../../src/modules/scheduling/merge/rectifyPlacement'
import type { Section } from '../../src/modules/scheduling/types'

function section(
  id: string,
  code: string,
  students: string[],
  faculty: string | null = `Planning:${id}`,
): Section {
  return {
    section_id: id,
    course_code: code,
    course_title: code,
    section_number: 1,
    faculty,
    capacity: 100,
    enrolled_students: students,
    programs: ['CS'],
  }
}

describe('placeFreeCourseWeekdays', () => {
  it('places a single new course avoiding pinned clash', () => {
    const courseSections: Record<string, Section[]> = {
      A: [section('A1', 'A', ['s1'], 'DrA')],
      B: [section('B1', 'B', ['s2'], 'DrB')],
      D: [section('D1', 'D', ['s1'], 'DrD')],
    }
    const students = {
      s1: {
        register_number: 's1',
        name: 'S1',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['A', 'D'],
      },
      s2: {
        register_number: 's2',
        name: 'S2',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['B'],
      },
    }
    const conflictGraph = buildConflictGraph(students, courseSections)
    const fixedDays = { A: 0, B: 1 }
    const result = placeFreeCourseWeekdays(
      ['D'],
      fixedDays,
      courseSections,
      conflictGraph,
      { DrA: ['A1'], DrB: ['B1'], DrD: ['D1'] },
      false,
    )
    expect(result).not.toBeNull()
    expect(result!.slot_by_course.A).toBe(0)
    expect(result!.slot_by_course.B).toBe(1)
    expect(result!.slot_by_course.D).not.toBe(0)
  })
})

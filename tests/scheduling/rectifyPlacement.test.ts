import { describe, expect, it } from 'vitest'
import { buildConflictGraph } from '../../src/modules/scheduling/preprocess/preprocessing'
import {
  buildFacultyByCourse,
  placeFreeCourseWeekdays,
  preflightRectify,
} from '../../src/modules/scheduling/merge/rectifyPlacement'
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

  it('returns null when the faculty is busy on every available weekday', () => {
    const courseSections: Record<string, Section[]> = {
      A: [section('A1', 'A', ['s1'], 'Dr')],
      B: [section('B1', 'B', ['s2'], 'Dr')],
      NEW: [section('N1', 'NEW', ['s3'], 'Dr')],
    }
    const conflictGraph = { sections: ['A1', 'B1', 'N1'], edges: [] }
    // Two active weekdays (Saturday blocked collapses to Mon–Fri, but we pin all five).
    const fixedDays = { A: 0, B: 1 }
    const faculty = { Dr: ['A1', 'B1', 'N1'] }

    const preflight = preflightRectify({
      fixedDays: { ...fixedDays, X: 2, Y: 3, Z: 4 },
      freeCourses: ['NEW'],
      courseSections: {
        ...courseSections,
        X: [section('X1', 'X', [], 'Dr')],
        Y: [section('Y1', 'Y', [], 'Dr')],
        Z: [section('Z1', 'Z', [], 'Dr')],
      },
      facultyConstraints: { Dr: ['A1', 'B1', 'N1', 'X1', 'Y1', 'Z1'] },
      allowSaturdayForMath: false,
    })
    expect(preflight.ok).toBe(false)
    expect(preflight.blockers.join(' ')).toContain('every available weekday')

    const result = placeFreeCourseWeekdays(
      ['NEW'],
      { A: 0, B: 1, X: 2, Y: 3, Z: 4 },
      {
        ...courseSections,
        X: [section('X1', 'X', [], 'Dr')],
        Y: [section('Y1', 'Y', [], 'Dr')],
        Z: [section('Z1', 'Z', [], 'Dr')],
      },
      conflictGraph,
      { Dr: ['A1', 'B1', 'N1', 'X1', 'Y1', 'Z1'] },
      false,
    )
    expect(result).toBeNull()
    expect(faculty.Dr).toHaveLength(3)
  })
})

describe('preflightRectify', () => {
  const courseSections: Record<string, Section[]> = {
    '21MAB101T': [section('M1', '21MAB101T', ['s1'], 'DrM')],
    '21CSC202J': [section('C1', '21CSC202J', ['s2'], 'DrC')],
    NEW: [section('N1', 'NEW', ['s3'], 'DrN')],
  }
  const facultyConstraints = { DrM: ['M1'], DrC: ['C1'], DrN: ['N1'] }

  it('passes when every pinned day is inside the active week', () => {
    const r = preflightRectify({
      fixedDays: { '21MAB101T': 0, '21CSC202J': 1 },
      freeCourses: ['NEW'],
      courseSections,
      facultyConstraints,
      allowSaturdayForMath: false,
    })
    expect(r.ok).toBe(true)
    expect(r.blockers).toHaveLength(0)
  })

  it('blocks a Saturday-pinned course once Saturday is turned off', () => {
    const r = preflightRectify({
      fixedDays: { '21MAB101T': 5, '21CSC202J': 1 },
      freeCourses: ['NEW'],
      courseSections,
      facultyConstraints,
      allowSaturdayForMath: false,
    })
    expect(r.ok).toBe(false)
    expect(r.blockers[0]).toContain('Saturday is now blocked')
  })

  it('blocks a non-math course pinned to Saturday', () => {
    const r = preflightRectify({
      fixedDays: { '21CSC202J': 5 },
      freeCourses: [],
      courseSections,
      facultyConstraints,
      allowSaturdayForMath: true,
    })
    expect(r.ok).toBe(false)
    expect(r.blockers[0]).toContain('maths-only')
  })

  it('blocks two pinned courses that share a faculty on one weekday', () => {
    const shared = {
      A: [section('A1', 'A', [], 'Dr')],
      B: [section('B1', 'B', [], 'Dr')],
    }
    const r = preflightRectify({
      fixedDays: { A: 2, B: 2 },
      freeCourses: [],
      courseSections: shared,
      facultyConstraints: { Dr: ['A1', 'B1'] },
      allowSaturdayForMath: false,
    })
    expect(r.ok).toBe(false)
    expect(r.blockers[0]).toContain('Wednesday')
  })
})

describe('buildFacultyByCourse', () => {
  it('maps each course to the faculty label of its sections', () => {
    const courseSections: Record<string, Section[]> = {
      A: [section('A1', 'A', [], 'Dr X')],
      B: [section('B1', 'B', [], 'Dr Y')],
    }
    const map = buildFacultyByCourse(courseSections, { 'Dr X': ['A1'], 'Dr Y': ['B1'] })
    expect(map.get('A')).toBe('Dr X')
    expect(map.get('B')).toBe('Dr Y')
  })
})

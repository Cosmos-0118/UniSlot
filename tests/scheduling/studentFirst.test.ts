import { describe, expect, it } from 'vitest'
import type { Section, Student } from '../../src/modules/scheduling/types'
import { buildConflictGraph, computeClashWeight } from '../../src/modules/scheduling/solver/conflictGraph'
import { buildGreedyHint } from '../../src/modules/scheduling/solver/greedyHint'
import { runCpsatScheduler } from '../../src/modules/scheduling/solver/cpsatBridge'
import { computeClashReport } from '../../src/modules/scheduling/solver/scheduleOutput'
import { sectionSlotsFromCourseSlots } from '../../src/modules/scheduling/solver/cpsatInstance'
import { placeFreeCourseWeekdays } from '../../src/modules/scheduling/merge/rectifyPlacement'

function fixture(cohorts: string[][], extraCodes: string[] = []) {
  const students: Record<string, Student> = Object.fromEntries(cohorts.map((courses, i) => {
    const id = `s${i}`
    return [id, { register_number: id, name: id, program: 'P', email: null, mobile: null, enrolled_courses: courses }]
  }))
  const codes = [...new Set([...cohorts.flat(), ...extraCodes])]
  const courseSections: Record<string, Section[]> = Object.fromEntries(codes.map((code) => [code, [{
    section_id: code, course_code: code, course_title: code, section_number: 1,
    faculty: null, capacity: 64, programs: ['P'],
    enrolled_students: Object.keys(students).filter((id) => students[id]!.enrolled_courses.includes(code)),
  }]]))
  return { students, courseSections, conflictGraph: buildConflictGraph(students, courseSections) }
}

describe('student-first scheduling', () => {
  it('uses the same student-first goal when CP-SAT is unavailable', () => {
    const f = fixture([['X', 'A', 'B', 'C'], ['X', 'D'], ['X', 'E']], ['FW', 'FT', 'FF'])
    const result = placeFreeCourseWeekdays(['X'],
      { A: 0, B: 0, C: 0, D: 1, E: 1, FW: 2, FT: 3, FF: 4 },
      f.courseSections, f.conflictGraph, { restrictX: ['X', 'FW', 'FT', 'FF'] }, false)
    expect(result?.slot_by_course.X).toBe(0)
    expect(result?.clash_weight).toBe(6)
    const slots = sectionSlotsFromCourseSlots(f.courseSections, result!.slot_by_course)
    expect(computeClashReport(f.students, f.courseSections, slots).students_with_clashes).toBe(1)
  })

  it.each([0, 2])('protects more students even at higher pair cost (portfolio %i)', async (portfolio) => {
    const f = fixture([['X', 'A', 'B', 'C'], ['X', 'D'], ['X', 'E']], ['FW', 'FT', 'FF'])
    const result = await runCpsatScheduler(f.courseSections, f.conflictGraph, {
      restrictX: ['X', 'FW', 'FT', 'FF'],
    }, f.students, {
      workers: 1, seed: 7, portfolio, portfolioRaceSeconds: 0.5, timeLimitSeconds: 10,
      allowSaturdayForMath: false,
      fixedDays: { A: 0, B: 0, C: 0, D: 1, E: 1, FW: 2, FT: 3, FF: 4 },
    })
    expect(result.slot_by_course.X).toBe(0)
    expect(result.red_students).toBe(1)
    expect(result.total_clash_weight).toBe(6)
    expect(computeClashReport(f.students, f.courseSections, result.slot_assignments).students_with_clashes).toBe(1)
    expect(computeClashWeight(f.conflictGraph, result.slot_assignments)).toBe(6)
    expect(result.proven_optimal).toBe(true)
    expect(result.proven_levels).toEqual(['red_students', 'clash_weight', 'balance_and_parallel'])
  }, 30_000)

  it('retains a student-first warm start instead of the lower-pair-cost alternative', () => {
    const f = fixture([
      ['X', 'A', 'B', 'C'], ['X', 'D'], ['X', 'E'],
      ...Array.from({ length: 10 }, () => ['F1', 'F2', 'F3', 'F4']),
    ])
    const warm = buildGreedyHint({ ...f, facultyConstraints: {
      anchors: ['F1', 'F2', 'F3', 'F4'],
      A: ['A', 'F1', 'F2', 'F3', 'F4'], B: ['B', 'F1', 'F2', 'F3', 'F4'],
      C: ['C', 'F1', 'F2', 'F3', 'F4'], D: ['D', 'A', 'F2', 'F3', 'F4'],
      E: ['E', 'A', 'F2', 'F3', 'F4'], X: ['X', 'F2', 'F3', 'F4'],
    }, polishIters: 4000, seed: 42, allowSaturdayForMath: false })
    expect(warm.red_students).toBe(1)
    expect(warm.clash_weight).toBe(6)
    expect(warm.hint.X).toBe(warm.hint.A)
    const slots = sectionSlotsFromCourseSlots(f.courseSections, warm.hint)
    expect(computeClashReport(f.students, f.courseSections, slots).students_with_clashes).toBe(warm.red_students)
    expect(computeClashWeight(f.conflictGraph, slots)).toBe(warm.clash_weight)
  })
})

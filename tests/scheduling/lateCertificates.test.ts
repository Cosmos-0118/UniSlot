import { describe, expect, it } from 'vitest'
import { runLatePipeline } from '../../src/modules/scheduling/pipeline/lateRun'
import { WEEKDAY_SLOT_MODEL, type SchedulingSnapshot } from '../../src/modules/scheduling/merge/snapshot'
import type { EnrollmentRow, Section, Student } from '../../src/modules/scheduling/types'

function row(id: string, code: string): EnrollmentRow {
  return { register_number: id, student_name: id, program: 'P', course_code: code,
    course_title: code, faculty: null, mobile_number: null, email_id: null,
    registration_type: null, remarks: null }
}
function snapshot(): SchedulingSnapshot {
  const students: Record<string, Student> = {}
  const courseSections: Record<string, Section[]> = {}
  for (const [code, id] of [['A', 'R1'], ['B', 'R2']]) {
    students[id!] = { register_number: id!, name: id!, program: 'P', email: null,
      mobile: null, enrolled_courses: [code!] }
    courseSections[code!] = [{ section_id: code!, course_code: code!, course_title: code!,
      section_number: 1, faculty: `Planning:${code}`, capacity: 64,
      enrolled_students: [id!], programs: ['P'] }]
  }
  return { slot_model: WEEKDAY_SLOT_MODEL, slot_assignments: { A: 0, B: 0 },
    students, courseSections, enrollmentRows: [row('R1', 'A'), row('R2', 'B')] }
}

describe('late-enrollment certificates describe the exported model', () => {
  it.each([undefined, 'red-first-v1'] as const)('preserves policy %s without new course placement', async (policy) => {
    const result = await runLatePipeline(() => {}, {
      previousSnapshot: { ...snapshot(), ...(policy ? { objective_policy: policy } : {}) },
      lateRows: [row('R1', 'B')], allowSaturdayForMath: false,
    })
    expect(result.schedule).not.toBeNull()
    expect(result.schedulingSnapshot?.objective_policy).toBe(policy)
    expect(result.proven_optimal).toBe(false)
  })

  it('keeps certificates when the provisional and final models match', async () => {
    const result = await runLatePipeline(() => {}, { previousSnapshot: snapshot(), lateRows: [row('R3', 'X')],
      cpsatWorkers: 1, seed: 7, allowSaturdayForMath: false })
    expect(result.infeasible).not.toBe(true)
    expect(result.schedule).not.toBeNull()
    expect(result.proven_optimal).toBe(true)
    expect(result.red_bound).toBe(0)
    expect(result.red_gap).toBe(0)
  }, 30_000)

  it.each(['known addition', 'parked new course'])('clears provisional proof after %s', async (change) => {
    const result = await runLatePipeline(() => {}, { previousSnapshot: snapshot(),
      lateRows: [row('R3', 'X'), ...(change === 'known addition' ? [row('R1', 'B')] : [])],
      clashDecisions: change === 'parked new course'
        ? [{ register_number: 'R3', choice: 'drop-course', drop_course_code: 'X' }] : [],
      cpsatWorkers: 1, seed: 7, allowSaturdayForMath: false })
    expect(result.infeasible).not.toBe(true)
    expect(result.schedule).not.toBeNull()
    if (change === 'known addition') expect(result.clashReport?.students_with_clashes).toBe(1)
    expect(result.proven_optimal).toBe(false)
    expect(result.proven_levels).toEqual([])
    expect(result.red_bound).toBeUndefined()
    expect(result.red_gap).toBeUndefined()
    expect(result.clash_bound).toBeUndefined()
    expect(result.clash_gap).toBeUndefined()
    expect(result.solver_status).toBe('FEASIBLE')
  }, 30_000)
})

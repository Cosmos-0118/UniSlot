import { describe, expect, it } from 'vitest'
import { computeSchedulingStats } from '../../src/modules/scheduling/solver/metrics'
import { computeClashWeight } from '../../src/modules/scheduling/solver/conflictGraph'
import type { Section } from '../../src/modules/scheduling/types'

function section(id: string): Section {
  return { section_id: id, course_code: id, course_title: id, section_number: 1,
    capacity: 64, faculty: null, enrolled_students: [], programs: [] }
}
const emptyGraph = { sections: [], edges: [] }

describe('statistics use the same active weekdays as the solver', () => {
  it('reports perfect balance for ten sections evenly spread over five days', () => {
    const sections = Array.from({ length: 10 }, (_, i) => section(`C${i}`))
    const slots = Object.fromEntries(sections.map((s, i) => [s.section_id, i % 5]))
    const result = computeSchedulingStats(sections, slots, emptyGraph, { allowSaturdayForMath: false })
    expect(result.total_weekly_slots).toBe(5)
    expect(result.weekday_balance_l1).toBe(0)
    expect(result.average_parallel_sections_per_slot).toBe(2)
    expect(result.slots_with_zero_courses).toBe(0)
  })

  it('includes Saturday when an extra course is allowlisted even with maths disabled', () => {
    const sections = Array.from({ length: 6 }, (_, i) => section(`C${i}`))
    const slots = Object.fromEntries(sections.map((s, i) => [s.section_id, i]))
    const result = computeSchedulingStats(sections, slots, emptyGraph, {
      allowSaturdayForMath: false, saturdayExtraCourseCodes: ['C5'],
    })
    expect(result.total_weekly_slots).toBe(6)
    expect(result.weekday_balance_l1).toBe(0)
    expect(result.average_parallel_sections_per_slot).toBe(1)
  })

  it('does not silently count an unassigned section on Monday', () => {
    expect(() => computeSchedulingStats([section('A')], {}, emptyGraph)).toThrow(/assignment|slot/i)
  })

  it.each([NaN, 0.5, -1, 5])('rejects slot %s outside the active five-day model', (slot) => {
    expect(() => computeSchedulingStats([section('A')], { A: slot }, emptyGraph,
      { allowSaturdayForMath: false })).toThrow(/slot/i)
  })

  it('rejects missing conflict endpoints instead of calling two absent courses a clash', () => {
    const graph = { sections: ['A', 'B'], edges: [{ section_a: 'A', section_b: 'B',
      weight: 3, shared_students: [] }] }
    expect(() => computeClashWeight(graph, {})).toThrow(/assignment|slot/i)
    expect(() => computeClashWeight(graph, { A: 0 })).toThrow(/assignment|slot/i)
    expect(computeClashWeight(graph, { A: 0, B: 0 })).toBe(3)
  })
})

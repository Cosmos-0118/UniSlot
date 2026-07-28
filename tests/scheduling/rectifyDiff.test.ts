import { describe, expect, it } from 'vitest'
import {
  describePlacements,
  diffClashReports,
  diffSectionCounts,
} from '../../src/modules/scheduling/merge/rectifyDiff'
import type { ClashReport, DayName, Section } from '../../src/modules/scheduling/types'

function clashReport(
  entries: { reg: string; days: DayName[]; pairs: [string, string][] }[],
): ClashReport {
  const withClashes = entries.filter((e) => e.days.length > 0).length
  return {
    total_students: entries.length,
    students_with_clashes: withClashes,
    clash_free_students: entries.length - withClashes,
    clash_percentage: entries.length ? (withClashes / entries.length) * 100 : 0,
    reports: entries.map((e) => ({
      register_number: e.reg,
      student_name: e.reg,
      program: 'CS',
      enrolled_courses: [...new Set(e.pairs.flat())],
      status: e.days.length > 0 ? ('Red' as const) : ('Green' as const),
      clashing_courses: e.pairs,
      clashing_day: e.days[0] ?? null,
      clashing_days: e.days,
    })),
  }
}

function section(id: string, code: string, students: string[]): Section {
  return {
    section_id: id,
    course_code: code,
    course_title: `${code} title`,
    section_number: 1,
    faculty: null,
    capacity: 100,
    enrolled_students: students,
    programs: [],
  }
}

describe('diffClashReports', () => {
  it('separates newly introduced clashes from pre-existing ones', () => {
    const before = clashReport([{ reg: 'S1', days: ['Monday'], pairs: [['A', 'B']] }])
    const after = clashReport([
      { reg: 'S1', days: ['Monday'], pairs: [['A', 'B']] },
      { reg: 'S2', days: ['Wednesday'], pairs: [['C', 'D']] },
    ])

    const diff = diffClashReports(before, after)

    expect(diff.introduced.map((c) => c.register_number)).toEqual(['S2'])
    expect(diff.carried_over.map((c) => c.register_number)).toEqual(['S1'])
    expect(diff.resolved).toHaveLength(0)
  })

  it('treats the same student clashing on a different weekday as a new clash', () => {
    const before = clashReport([{ reg: 'S1', days: ['Monday'], pairs: [['A', 'B']] }])
    const after = clashReport([{ reg: 'S1', days: ['Friday'], pairs: [['A', 'C']] }])

    const diff = diffClashReports(before, after)

    expect(diff.introduced).toHaveLength(1)
    expect(diff.introduced[0]!.day).toBe('Friday')
    expect(diff.resolved).toHaveLength(1)
    expect(diff.resolved[0]!.day).toBe('Monday')
  })

  it('reports nothing when the schedule is unchanged', () => {
    const report = clashReport([{ reg: 'S1', days: ['Monday'], pairs: [['A', 'B']] }])
    const diff = diffClashReports(report, report)

    expect(diff.introduced).toHaveLength(0)
    expect(diff.resolved).toHaveLength(0)
    expect(diff.carried_over).toHaveLength(1)
  })
})

describe('diffSectionCounts', () => {
  it('reports only courses whose split count changed', () => {
    const before = {
      A: [section('a1', 'A', [])],
      B: [section('b1', 'B', []), section('b2', 'B', [])],
    }
    const after = {
      A: [section('a1', 'A', []), section('a2', 'A', [])],
      B: [section('b1', 'B', []), section('b2', 'B', [])],
      C: [section('c1', 'C', [])],
    }

    expect(diffSectionCounts(before, after)).toEqual([{ course_code: 'A', before: 1, after: 2 }])
  })
})

describe('describePlacements', () => {
  it('resolves day names, section counts, and enrollment for placed courses', () => {
    const courseSections = { NEW: [section('n1', 'NEW', ['S1', 'S2'])] }
    const placements = describePlacements(['NEW', 'MISSING'], courseSections, { NEW: 2 })

    expect(placements).toHaveLength(1)
    expect(placements[0]).toMatchObject({
      course_code: 'NEW',
      day: 'Wednesday',
      slot_index: 2,
      section_count: 1,
      enrollment: 2,
    })
  })
})

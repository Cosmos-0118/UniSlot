import { describe, expect, it } from 'vitest'
import {
  balancedTargetSize,
  computeSectionSplits,
  SINGLE_SECTION_MAX,
  SPLIT_SECTION_CAP,
} from '../../src/modules/scheduling/solver/capacity'
import { assignStudentsToSections } from '../../src/modules/scheduling/solver/sectioning'
import type { Course, EnrollmentRow, Student } from '../../src/modules/scheduling/types'
import { localSearchSeedPlan, runScheduler } from '../../src/modules/scheduling/solver/scheduler'
import { resolveEffort } from '../../src/modules/scheduling/solver/effort'
import { buildConflictGraph } from '../../src/modules/scheduling/preprocess/preprocessing'
import type { Section } from '../../src/modules/scheduling/types'
import { scheduleToWorkbookBuffer, friendlyTiming } from '../../src/modules/scheduling/io/excelScheduleWorkbook'
import type { Schedule } from '../../src/modules/scheduling/types'
import type { SchedulingSnapshot } from '../../src/modules/scheduling/merge/snapshot'
import ExcelJS from 'exceljs'

describe('capacity split rule (64 single / 60 when split)', () => {
  it('keeps a single section up to 64', () => {
    const courses: Record<string, Course> = {
      C64: {
        code: 'C64',
        title: 'T',
        enrollment_count: 64,
        faculty: null,
        section_count: 0,
      },
    }
    const splits = computeSectionSplits(courses)
    expect(splits.C64).toHaveLength(1)
    expect(splits.C64![0]!.capacity).toBe(SINGLE_SECTION_MAX)
    expect(courses.C64!.section_count).toBe(1)
  })

  it('splits at 65 into ceil(n/60) sections capped at 60', () => {
    const courses: Record<string, Course> = {
      C65: {
        code: 'C65',
        title: 'T',
        enrollment_count: 65,
        faculty: null,
        section_count: 0,
      },
      C120: {
        code: 'C120',
        title: 'T',
        enrollment_count: 120,
        faculty: null,
        section_count: 0,
      },
      C121: {
        code: 'C121',
        title: 'T',
        enrollment_count: 121,
        faculty: null,
        section_count: 0,
      },
    }
    const splits = computeSectionSplits(courses)
    expect(splits.C65).toHaveLength(2)
    expect(splits.C65!.every((s) => s.capacity === SPLIT_SECTION_CAP)).toBe(true)
    expect(splits.C120).toHaveLength(2)
    expect(splits.C121).toHaveLength(3)
    expect(balancedTargetSize(65, 2)).toBe(33)
    expect(balancedTargetSize(120, 2)).toBe(60)
  })
})

describe('sectioning balanced loads', () => {
  it('balances split sections within ±1 for uniform students', () => {
    const n = 65
    const students: Record<string, Student> = {}
    const rows: EnrollmentRow[] = []
    for (let i = 0; i < n; i++) {
      const reg = `R${String(i).padStart(3, '0')}`
      students[reg] = {
        register_number: reg,
        name: `S${i}`,
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['BAL'],
      }
      rows.push({
        program: 'CS',
        register_number: reg,
        student_name: `S${i}`,
        mobile_number: null,
        email_id: null,
        course_code: 'BAL',
        course_title: 'Balanced',
        faculty: null,
        registration_type: null,
        remarks: null,
      })
    }
    const courses: Record<string, Course> = {
      BAL: {
        code: 'BAL',
        title: 'Balanced',
        enrollment_count: n,
        faculty: null,
        section_count: 0,
      },
    }
    const courseSections = computeSectionSplits(courses)
    assignStudentsToSections(students, courseSections, rows)
    const loads = courseSections.BAL!.map((s) => s.enrolled_students.length)
    expect(loads.reduce((a, b) => a + b, 0)).toBe(n)
    expect(Math.max(...loads)).toBeLessThanOrEqual(SPLIT_SECTION_CAP)
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1)
  })
})

describe('elite perturb + effort params', () => {
  it('exposes plan-aligned effort budgets', () => {
    expect(resolveEffort('fast').eliteRestartRounds).toBe(0)
    expect(resolveEffort('balanced').eliteRestartRounds).toBe(2)
    expect(resolveEffort('max').maxIterCap).toBeGreaterThan(resolveEffort('balanced').maxIterCap)
    expect(resolveEffort('max').kempeProb).toBeGreaterThan(resolveEffort('fast').kempeProb)
  })
})

describe('effort dial', () => {
  it('scales seed plan by effort level', () => {
    const fast = localSearchSeedPlan(40, 1, 'fast')
    const bal = localSearchSeedPlan(40, 1, 'balanced')
    const max = localSearchSeedPlan(40, 1, 'max')
    expect(fast.runCount).toBeLessThanOrEqual(resolveEffort('fast').runCountCap)
    expect(bal.runCount).toBeGreaterThanOrEqual(fast.runCount)
    expect(max.runCount).toBeGreaterThanOrEqual(bal.runCount)
    expect(max.poolSize).toBeGreaterThanOrEqual(bal.poolSize)
    expect(bal.effort).toBe('balanced')
  })

  it('is deterministic for fixed seed at fast effort (poolWorkers=1)', () => {
    const courseSections: Record<string, Section[]> = {
      A: [
        {
          section_id: 'A',
          course_code: 'A',
          course_title: 'A',
          section_number: 1,
          faculty: 'Planning:A',
          capacity: 64,
          enrolled_students: ['s1', 's2'],
          programs: ['CS'],
        },
      ],
      B: [
        {
          section_id: 'B',
          course_code: 'B',
          course_title: 'B',
          section_number: 1,
          faculty: 'Planning:B',
          capacity: 64,
          enrolled_students: ['s2', 's3'],
          programs: ['CS'],
        },
      ],
    }
    const students = {
      s1: {
        register_number: 's1',
        name: 'S1',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['A'],
      },
      s2: {
        register_number: 's2',
        name: 'S2',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['A', 'B'],
      },
      s3: {
        register_number: 's3',
        name: 'S3',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['B'],
      },
    }
    const conflictGraph = buildConflictGraph(students, courseSections)
    const facultyConstraints = { 'Planning:A': ['A'], 'Planning:B': ['B'] }
    const a = runScheduler(courseSections, conflictGraph, facultyConstraints, undefined, {
      randomSeed: 99,
      poolWorkers: 1,
      effort: 'fast',
    })
    const b = runScheduler(courseSections, conflictGraph, facultyConstraints, undefined, {
      randomSeed: 99,
      poolWorkers: 1,
      effort: 'fast',
    })
    expect(a.slot_assignments).toEqual(b.slot_assignments)
    expect(a.feasible).toBe(true)
  })
})

describe('excel roster + friendly timing', () => {
  it('formats friendly timing and builds roster sheet when snapshot is provided', async () => {
    expect(friendlyTiming('Monday', 2, 11)).toContain('Monday')
    expect(friendlyTiming('Monday', 2, 11)).toContain('Parallel lane 2/11')

    const schedule: Schedule = {
      entries: [
        {
          section_id: 'C1',
          course_code: 'C1',
          course_title: 'Course One',
          section_number: 1,
          day: 'Monday',
          time: '5:00 PM – 7:00 PM',
          slot_index: 0,
          slot_band: 1,
          parallel_lane_count: 1,
          faculty: 'Dr. A',
          enrollment_count: 2,
          programs: 'CS',
        },
      ],
      total_sections: 1,
      solver_used: 'test',
      solver_time_seconds: 0.1,
      total_clashes: 0,
    }
    const snapshot: SchedulingSnapshot = {
      slot_assignments: { C1: 0 },
      courseSections: {
        C1: [
          {
            section_id: 'C1',
            course_code: 'C1',
            course_title: 'Course One',
            section_number: 1,
            faculty: 'Dr. A',
            capacity: 64,
            enrolled_students: ['R1', 'R2'],
            programs: ['CS'],
          },
        ],
      },
      students: {
        R1: {
          register_number: 'R1',
          name: 'Alice',
          program: 'CS',
          email: 'a@x.edu',
          mobile: '1',
          enrolled_courses: ['C1'],
        },
        R2: {
          register_number: 'R2',
          name: 'Bob',
          program: 'CS',
          email: null,
          mobile: null,
          enrolled_courses: ['C1'],
        },
      },
      enrollmentRows: [],
    }

    const buf = await scheduleToWorkbookBuffer(schedule, { snapshot })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const names = wb.worksheets.map((w) => w.name)
    expect(names).toContain('Schedule')
    expect(names).toContain('Details')
    expect(names).toContain('Students by Course & Weekday')

    const main = wb.getWorksheet('Schedule')!
    // Banner(5) + howto + legend + header
    const headerRow = main.getRow(8)
    const headers: string[] = []
    headerRow.eachCell((c) => headers.push(String(c.value ?? '')))
    expect(headers).toContain('Timing')
    expect(headers).not.toContain('Faculty ID No')
    expect(headers).not.toContain('Slot')

    const roster = wb.getWorksheet('Students by Course & Weekday')!
    const text = roster.getSheetValues().flat().join(' ')
    expect(text).toContain('Alice')
    expect(text).toContain('R1')
  })

  it('skips roster sheet when snapshot is absent', async () => {
    const schedule: Schedule = {
      entries: [],
      total_sections: 0,
      solver_used: 'test',
      solver_time_seconds: 0,
      total_clashes: 0,
    }
    const buf = await scheduleToWorkbookBuffer(schedule)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.map((w) => w.name)).not.toContain('Students by Course & Weekday')
  })
})

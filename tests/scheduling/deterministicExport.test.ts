import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workbookCreatedAt } from '../../src/modules/scheduling/io/deterministicExport'
import { buildSchedule, computeClashReport } from '../../src/modules/scheduling/solver/scheduleOutput'
import { buildScheduleXlsxBuffer, buildClashXlsxBuffer } from '../../src/modules/scheduling/pipeline/exports'
import type { Section } from '../../src/modules/scheduling/types'

function sha256(buf: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(buf)).digest('hex')
}

function tinySchedule() {
  const courseSections: Record<string, Section[]> = {
    A: [
      {
        section_id: 'A1',
        course_code: 'A',
        course_title: 'Course A',
        section_number: 1,
        faculty: 'Planning:A1',
        capacity: 60,
        enrolled_students: ['s1'],
        programs: ['B.Tech.-Computer Science and Engineering'],
      },
    ],
  }
  const students = {
    s1: {
      register_number: 'RA2211054010033',
      name: 'Student One',
      program: 'B.Tech.-Computer Science and Engineering',
      email: null,
      mobile: null,
      enrolled_courses: ['A'],
    },
  }
  const slotAssignments = { A1: 0 }
  const schedule = buildSchedule(courseSections, slotAssignments, {
    solver_used: 'test',
    solver_time_seconds: 0,
  })
  const clashReport = computeClashReport(students, courseSections, slotAssignments)
  return { schedule, clashReport }
}

describe('deterministic export metadata', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses a fixed created timestamp when seed is provided', () => {
    const a = workbookCreatedAt(42)
    const b = workbookCreatedAt(42)
    const live = workbookCreatedAt()
    expect(a.getTime()).toBe(b.getTime())
    expect(a.getTime()).not.toBe(live.getTime())
  })

  it('produces byte-identical schedule and clash workbooks for the same seed', async () => {
    const { schedule, clashReport } = tinySchedule()
    const seed = 4242

    const scheduleA = await buildScheduleXlsxBuffer(schedule, { seed })
    const scheduleB = await buildScheduleXlsxBuffer(schedule, { seed })
    const clashA = await buildClashXlsxBuffer(clashReport, { seed })
    const clashB = await buildClashXlsxBuffer(clashReport, { seed })

    expect(sha256(scheduleA)).toBe(sha256(scheduleB))
    expect(sha256(clashA)).toBe(sha256(clashB))
  })

  it('keeps seeded workbook bytes identical across a ZIP timestamp boundary', async () => {
    const { schedule } = tinySchedule()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
    const beforeBoundary = await buildScheduleXlsxBuffer(schedule, { seed: 4242 })
    vi.setSystemTime(new Date('2026-10-05T12:00:02.000Z'))
    const afterBoundary = await buildScheduleXlsxBuffer(schedule, { seed: 4242 })
    expect(sha256(beforeBoundary)).toBe(sha256(afterBoundary))
  })
})

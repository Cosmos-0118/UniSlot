import { describe, expect, it } from 'vitest'
import { slimClashReportForTransfer } from '../../src/modules/scheduling/worker/clashReportTransfer'
import type { ClashReport } from '../../src/modules/scheduling/types'

describe('slimClashReportForTransfer', () => {
  it('keeps aggregate stats and only red rows up to the cap', () => {
    const reports = Array.from({ length: 120 }, (_, i) => ({
      register_number: `R${i}`,
      student_name: `S${i}`,
      program: 'P',
      enrolled_courses: ['C1'],
      status: (i % 2 === 0 ? 'Red' : 'Green') as 'Red' | 'Green',
      clashing_courses: [['C1', 'C2']] as [string, string][],
      clashing_day: null,
      clashing_days: [],
    }))
    const full: ClashReport = {
      total_students: 120,
      students_with_clashes: 60,
      clash_free_students: 60,
      clash_percentage: 50,
      reports,
    }
    const slim = slimClashReportForTransfer(full, 80)
    expect(slim.total_students).toBe(120)
    expect(slim.students_with_clashes).toBe(60)
    expect(slim.reports).toHaveLength(60)
    expect(slim.reports.every((r) => r.status === 'Red')).toBe(true)
  })
})

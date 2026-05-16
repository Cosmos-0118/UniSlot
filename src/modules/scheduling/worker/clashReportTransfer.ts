import type { ClashReport } from './types'

/** Reduces structured-clone cost while preserving UI preview needs (see ClashPreview). */
export function slimClashReportForTransfer(report: ClashReport, maxRed = 80): ClashReport {
  const red = report.reports.filter((r) => r.status === 'Red')
  return {
    total_students: report.total_students,
    students_with_clashes: report.students_with_clashes,
    clash_free_students: report.clash_free_students,
    clash_percentage: report.clash_percentage,
    reports: red.slice(0, maxRed),
  }
}

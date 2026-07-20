import type { ClashReport, EnrollmentRow, Schedule } from '../types'
import type { SchedulingSnapshot } from '../merge/snapshot'

export type PipelineExportKind = 'schedule' | 'clash' | 'courseEmails'

export async function buildScheduleXlsxBuffer(
  schedule: Schedule,
  snapshot?: SchedulingSnapshot | null,
): Promise<ArrayBuffer> {
  const { scheduleToWorkbookBuffer } = await import('../io/excelScheduleWorkbook')
  return scheduleToWorkbookBuffer(schedule, snapshot ? { snapshot } : undefined)
}

export async function buildClashXlsxBuffer(clashReport: ClashReport): Promise<ArrayBuffer> {
  const { clashReportToRichWorkbookBuffer } = await import('../io/excelClashReport')
  return clashReportToRichWorkbookBuffer(clashReport)
}

export async function buildCourseEmailsXlsxBuffer(rows: EnrollmentRow[]): Promise<ArrayBuffer> {
  const { courseEmailsToWorkbookBuffer } = await import('../io/excelCourseEmails')
  return courseEmailsToWorkbookBuffer(rows)
}

export async function buildPipelineExportBuffer(
  kind: PipelineExportKind,
  artifacts: {
    schedule: Schedule | null
    clashReport: ClashReport | null
    enrollmentRows: EnrollmentRow[] | null
    allowScheduleXlsx: boolean
    snapshot?: SchedulingSnapshot | null
  },
): Promise<ArrayBuffer> {
  switch (kind) {
    case 'schedule': {
      if (!artifacts.allowScheduleXlsx || !artifacts.schedule) {
        throw new Error('Schedule workbook export is not available for this run.')
      }
      return buildScheduleXlsxBuffer(artifacts.schedule, artifacts.snapshot)
    }
    case 'clash': {
      if (!artifacts.clashReport) throw new Error('Clash report export is not available.')
      return buildClashXlsxBuffer(artifacts.clashReport)
    }
    case 'courseEmails': {
      if (!artifacts.enrollmentRows?.length) {
        throw new Error('Course email export is not available for this run.')
      }
      return buildCourseEmailsXlsxBuffer(artifacts.enrollmentRows)
    }
    default: {
      const _exhaustive: never = kind
      throw new Error(`Unknown export kind: ${String(_exhaustive)}`)
    }
  }
}

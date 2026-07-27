import type { ClashReport, EnrollmentRow, Schedule } from '../types'
import type { SchedulingSnapshot } from '../merge/snapshot'
import type { ExportDeterminismOptions } from '../io/deterministicExport'
import type { ScheduleWorkbookBranding } from '../io/excelScheduleWorkbook'

export type PipelineExportKind = 'schedule' | 'clash' | 'courseEmails'

export type ScheduleExportOptions = ExportDeterminismOptions & {
  branding?: ScheduleWorkbookBranding
  snapshot?: SchedulingSnapshot | null
}

export async function buildScheduleXlsxBuffer(
  schedule: Schedule,
  options?: ScheduleWorkbookBranding | ScheduleExportOptions,
): Promise<ArrayBuffer> {
  const { scheduleToWorkbookBuffer } = await import('../io/excelScheduleWorkbook')
  const opts: ScheduleExportOptions =
    options &&
    typeof options === 'object' &&
    ('branding' in options || 'snapshot' in options || 'seed' in options)
      ? (options as ScheduleExportOptions)
      : { branding: options as ScheduleWorkbookBranding | undefined }
  return scheduleToWorkbookBuffer(schedule, opts)
}

export async function buildClashXlsxBuffer(
  clashReport: ClashReport,
  options?: ExportDeterminismOptions,
): Promise<ArrayBuffer> {
  const { clashReportToRichWorkbookBuffer } = await import('../io/excelClashReport')
  return clashReportToRichWorkbookBuffer(clashReport, options)
}

export async function buildCourseEmailsXlsxBuffer(
  rows: EnrollmentRow[],
  options?: ExportDeterminismOptions,
): Promise<ArrayBuffer> {
  const { courseEmailsToWorkbookBuffer } = await import('../io/excelCourseEmails')
  return courseEmailsToWorkbookBuffer(rows, options)
}

export async function buildPipelineExportBuffer(
  kind: PipelineExportKind,
  artifacts: {
    schedule: Schedule | null
    clashReport: ClashReport | null
    enrollmentRows: EnrollmentRow[] | null
    allowScheduleXlsx: boolean
    snapshot?: SchedulingSnapshot | null
    seed?: number
  },
): Promise<ArrayBuffer> {
  const exportOpts = artifacts.seed !== undefined ? { seed: artifacts.seed } : undefined
  switch (kind) {
    case 'schedule': {
      if (!artifacts.allowScheduleXlsx || !artifacts.schedule) {
        throw new Error('Schedule workbook export is not available for this run.')
      }
      return buildScheduleXlsxBuffer(artifacts.schedule, {
        snapshot: artifacts.snapshot,
        ...exportOpts,
      })
    }
    case 'clash': {
      if (!artifacts.clashReport) throw new Error('Clash report export is not available.')
      return buildClashXlsxBuffer(artifacts.clashReport, exportOpts)
    }
    case 'courseEmails': {
      if (!artifacts.enrollmentRows?.length) {
        throw new Error('Course email export is not available for this run.')
      }
      return buildCourseEmailsXlsxBuffer(artifacts.enrollmentRows, exportOpts)
    }
    default: {
      const _exhaustive: never = kind
      throw new Error(`Unknown export kind: ${String(_exhaustive)}`)
    }
  }
}

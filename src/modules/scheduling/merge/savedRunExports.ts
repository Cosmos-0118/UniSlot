import { buildScheduleFromSnapshot } from './facultyMapping'
import type { SchedulingSnapshot } from './snapshot'
import {
  buildClashXlsxBuffer,
  buildCourseEmailsXlsxBuffer,
  buildScheduleXlsxBuffer,
} from '../pipeline/exports'
import { computeClashReport } from '../solver/scheduleOutput'
import type { ClashReport, Schedule } from '../types'

export type SavedRunExportState = {
  schedule: Schedule
  clashReport: ClashReport
  schedule_export_blocked: boolean
  schedule_export_block_reason: string | null
}

export function computeSavedRunExportState(
  snapshot: SchedulingSnapshot,
  options?: { allowProvisionalScheduleExport?: boolean },
): SavedRunExportState {
  const { schedule, audit } = buildScheduleFromSnapshot(snapshot)
  const clashReport = computeClashReport(
    snapshot.students,
    snapshot.courseSections,
    snapshot.slot_assignments,
  )
  const allowScheduleXlsx =
    audit.feasible === true || options?.allowProvisionalScheduleExport === true

  return {
    schedule: { ...schedule, total_clashes: clashReport.students_with_clashes },
    clashReport,
    schedule_export_blocked: !allowScheduleXlsx,
    schedule_export_block_reason: allowScheduleXlsx
      ? null
      : 'Hard-constraint audit did not pass. Enable “Allow provisional schedule export” if you need the schedule workbook anyway.',
  }
}

export async function buildSavedRunScheduleXlsx(
  state: SavedRunExportState,
): Promise<ArrayBuffer | null> {
  if (state.schedule_export_blocked) return null
  return buildScheduleXlsxBuffer(state.schedule)
}

export async function buildSavedRunClashXlsx(state: SavedRunExportState): Promise<ArrayBuffer> {
  return buildClashXlsxBuffer(state.clashReport)
}

export async function buildSavedRunCourseEmailsXlsx(
  snapshot: SchedulingSnapshot,
): Promise<ArrayBuffer | null> {
  if (!snapshot.enrollmentRows.length) return null
  return buildCourseEmailsXlsxBuffer(snapshot.enrollmentRows)
}

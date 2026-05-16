import type { PipelineOutput } from '@/features/scheduling/hooks/useUnislotWorker'
import { displayRunTitle, sourceFileLabel } from '@/features/scheduling/savedRunDisplay'
import type { SavedScheduleRun } from '@/features/scheduling/storage/savedRunsStorage'
import { computeCourseEmailGroups } from '@/modules/scheduling/pipeline/run'
import type { SchedulingSnapshot } from '@/modules/scheduling/merge/snapshot'

/** Build session result for the Emails view from a frozen saved-run snapshot. */
export function buildCourseEmailsPipelineOutput(snapshot: SchedulingSnapshot): PipelineOutput {
  const rows = snapshot.enrollmentRows
  const courseEmailsData = rows.length > 0 ? computeCourseEmailGroups(rows) : []
  const studentCount = Object.keys(snapshot.students).length
  const courseCount = Object.keys(snapshot.courseSections).length
  const sectionCount = Object.values(snapshot.courseSections).reduce((n, arr) => n + arr.length, 0)

  return {
    validation: {
      is_valid: true,
      errors: [],
      warnings: [],
      total_rows: rows.length,
      valid_rows: rows.length,
    },
    schedule: null,
    clashReport: null,
    scheduleXlsx: null,
    clashXlsx: null,
    courseEmailsXlsx: null,
    courseEmailsData,
    stats: {
      studentCount,
      courseCount,
      sectionCount,
      scheduling: null,
    },
    schedulingSnapshot: snapshot,
  }
}

export function savedRunEmailsSourceLabel(run: Pick<SavedScheduleRun, 'title' | 'sourceFileName'>): string {
  const label = displayRunTitle(run.title)
  const fileStem = sourceFileLabel(run.sourceFileName)
  return fileStem ? `${label} (${fileStem})` : label
}

export function applySavedRunEmailsToSession(
  run: SavedScheduleRun,
  setResult: (r: PipelineOutput | null) => void,
  setFileName: (name: string | null) => void,
): boolean {
  if (run.snapshot.enrollmentRows.length === 0) return false
  setResult(buildCourseEmailsPipelineOutput(run.snapshot))
  setFileName(savedRunEmailsSourceLabel(run))
  return true
}

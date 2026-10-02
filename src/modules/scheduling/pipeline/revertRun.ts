import type { ValidationResult } from '../types'
import type { SchedulingSnapshot } from '../merge/snapshot'
import type { RunLogClock } from '../merge/runLog'
import {
  applyReverts,
  type RevertChange,
  type RevertResult,
  type SkippedChange,
} from '../merge/revertEdit'
import {
  inferAllowSaturdayFromSnapshot,
  inferSaturdayExtrasFromSnapshot,
} from '../merge/enrollmentDelta'
import { throwIfAborted } from './cancellation'
import { finishSnapshotRun, type FixPipelineResult } from './fixRun'
import type { PipelineProgressEvent } from './run'

export type RunRevertOptions = {
  /** Snapshot from before the unwanted edits — the source of truth for what to restore. */
  baselineSnapshot: SchedulingSnapshot
  /** Snapshot after the edits — the one the reverts are applied on top of. */
  editedSnapshot: SchedulingSnapshot
  changes: RevertChange[]
  signal?: AbortSignal
  clock?: RunLogClock
  seed?: number
  baselineDir?: string
  editedDir?: string
  outputDir?: string
  programNomenclatureXlsx?: ArrayBuffer
}

export type RevertReport = {
  applied: RevertChange[]
  skipped: SkippedChange[]
  restored: RevertResult['restored']
  removed: RevertResult['removed']
  recreated_courses: string[]
  pruned_courses: string[]
  students_restored: string[]
  red_before: number
  red_after: number
}

export type RevertPipelineResult = FixPipelineResult & { revertReport: RevertReport | null }

function aborted(
  validation: ValidationResult,
  edited: SchedulingSnapshot,
  reason: string,
): RevertPipelineResult {
  return {
    validation,
    schedule: null,
    clashReport: null,
    scheduleXlsx: null,
    clashXlsx: null,
    courseEmailsXlsx: null,
    courseEmailsData: null,
    enrollmentXlsx: null,
    stats: null,
    schedulingSnapshot: null,
    editReport: null,
    revertReport: null,
    runLog: edited.run_log ?? [],
    clashProvenance: edited.clash_provenance ?? {},
    infeasible: true,
    infeasible_reason: reason,
  }
}

/**
 * Undo selected surgical edits. Weekdays stay frozen: restored courses return on the weekday they
 * had in the baseline, and nothing else moves. Writes nothing itself — the caller exports the result.
 */
export async function runRevertPipeline(
  onProgress: (event: PipelineProgressEvent) => void,
  options: RunRevertOptions,
): Promise<RevertPipelineResult> {
  const { baselineSnapshot, editedSnapshot, signal } = options
  const clock = options.clock ?? (() => new Date())

  const validation: ValidationResult = {
    is_valid: true,
    errors: [],
    warnings: [],
    total_rows: editedSnapshot.enrollmentRows.length,
    valid_rows: editedSnapshot.enrollmentRows.length,
  }

  onProgress({ stage: 'parse', message: 'Reverting selected changes…', fraction: 0.1 })
  throwIfAborted(signal)

  if (options.changes.length === 0) {
    return aborted(validation, editedSnapshot, 'No changes were selected to revert.')
  }

  const reverted = applyReverts(editedSnapshot, baselineSnapshot, options.changes)
  if (reverted.applied.length === 0) {
    const why = reverted.skipped.map((s) => `${s.change.label} — ${s.reason}`).join('; ')
    return aborted(validation, editedSnapshot, `Nothing could be reverted: ${why}`)
  }
  throwIfAborted(signal)

  const notes = reverted.applied.map((c) => `Reverted: ${c.label}`)
  if (reverted.recreated_courses.length) {
    notes.push(
      `Restored course(s) on their original weekday: ${reverted.recreated_courses.join(', ')}`,
    )
  }
  if (reverted.pruned_courses.length) {
    notes.push(`Pruned empty course(s): ${reverted.pruned_courses.join(', ')}`)
  }
  if (reverted.students_restored.length) {
    notes.push(`Restored student(s): ${reverted.students_restored.join(', ')}`)
  }
  for (const s of reverted.skipped) notes.push(`Skipped: ${s.change.label} — ${s.reason}`)

  const finished = await finishSnapshotRun({
    previous: editedSnapshot,
    working: reverted.snapshot,
    validation,
    emit: onProgress,
    signal,
    clock,
    options: {
      seed: options.seed,
      inputFileName: undefined,
      previousDir: options.editedDir,
      outputDir: options.outputDir,
      programNomenclatureXlsx: options.programNomenclatureXlsx,
    },
    allowSaturdayForMath: inferAllowSaturdayFromSnapshot(editedSnapshot),
    saturdayExtraCourseCodes: inferSaturdayExtrasFromSnapshot(editedSnapshot),
    placement: {
      solverStatus: 'SNAPSHOT',
      solverMessage: 'Revert — timetable weekdays frozen',
      solverUsed: 'snapshot-rebuild',
      solverTimeSeconds: 0,
    },
    summary: {
      mode: 'revert',
      notes,
      decisions: reverted.applied.map((c) => ({
        kind: 'other' as const,
        subject: c.register,
        choice: 'revert',
        detail: c.label,
      })),
      registrationsAdded: reverted.restored.length - reverted.removed.length,
      coursesAdded: reverted.recreated_courses.length - reverted.pruned_courses.length,
      sectionsCreated: [],
      newlyAddedCourses: reverted.recreated_courses,
      doneMessage: `Reverted ${reverted.applied.length} change(s)`,
    },
  })

  const { red_before, red_after, ...result } = finished
  if (result.infeasible) return { ...result, revertReport: null }

  return {
    ...result,
    revertReport: {
      applied: reverted.applied,
      skipped: reverted.skipped,
      restored: reverted.restored,
      removed: reverted.removed,
      recreated_courses: reverted.recreated_courses,
      pruned_courses: reverted.pruned_courses,
      students_restored: reverted.students_restored,
      red_before: red_before ?? 0,
      red_after: red_after ?? 0,
    },
  }
}

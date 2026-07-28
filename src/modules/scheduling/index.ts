/**
 * Evening scheduling domain: parse → preprocess → CP-SAT → Excel.
 * Prefer `import { … } from '@/modules/scheduling'` from the CLI.
 */
export type {
  ClashReport,
  ClashStatus,
  ConflictGraph,
  Course,
  CourseEmailGroup,
  DayName,
  EnrollmentRow,
  Schedule,
  ScheduleEntry,
  Section,
  Student,
  StudentClashReport,
  ValidationError,
  ValidationResult,
} from './types'
export type { SchedulingStats } from './solver/metrics'
export type { PipelineResult, RunPipelineOptions, PipelineProgressEvent } from './pipeline/run'
export { runPipeline, computeCourseEmailGroups } from './pipeline/run'
export { PipelineCancelledError, throwIfAborted } from './pipeline/cancellation'
export type { SchedulingSnapshot } from './merge/snapshot'
export { cloneSchedulingSnapshot, loadSchedulingSnapshot } from './merge/snapshot'
export type { RectifyPipelineResult, RectificationReport, RunRectifyOptions } from './pipeline/rectifyRun'
export {
  runRectifyPipeline,
  parseEnrollmentWorkbook,
  loadPreviousSummary,
} from './pipeline/rectifyRun'
export { parseExcelRows, loadAndValidate } from './parse/parser'
export {
  auditScheduleHardConstraints,
  parallelHardCap,
  runCpsatScheduler,
  buildSchedule,
  computeClashReport,
} from './solver/scheduler'

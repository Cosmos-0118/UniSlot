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
export type {
  PlacementMethod,
  RectifyPipelineResult,
  RectificationReport,
  RunRectifyOptions,
} from './pipeline/rectifyRun'
export {
  runRectifyPipeline,
  parseEnrollmentWorkbook,
  loadPreviousSummary,
} from './pipeline/rectifyRun'
export type {
  BaselineValidationWarning,
  EnrollmentDelta,
  StudentEnrollmentChange,
} from './merge/enrollmentDelta'
export {
  buildFixedDays,
  computeEnrollmentDelta,
  extractCourseSlotsFromSnapshot,
  formatEnrollmentDeltaSummary,
  freeCourseCodes,
  inferAllowSaturdayFromSnapshot,
  validateBaselineMatchesSnapshot,
} from './merge/enrollmentDelta'
export type { PlaceFreeCoursesResult, RectifyPreflight } from './merge/rectifyPlacement'
export {
  buildFacultyByCourse,
  placeFreeCourseWeekdays,
  preflightRectify,
} from './merge/rectifyPlacement'
export type {
  ClashDiff,
  ClashEntry,
  CoursePlacement,
  SectionCountChange,
} from './merge/rectifyDiff'
export { describePlacements, diffClashReports, diffSectionCounts } from './merge/rectifyDiff'
export { parseExcelRows, loadAndValidate } from './parse/parser'
export type { ScheduleAudit } from './solver/hardConstraints'
export {
  auditScheduleHardConstraints,
  parallelHardCap,
  runCpsatScheduler,
  buildSchedule,
  computeClashReport,
} from './solver/scheduler'

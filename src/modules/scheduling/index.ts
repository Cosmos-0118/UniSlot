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
export type { SchedulingSnapshot, LateEnrollmentRecord } from './merge/snapshot'
export { cloneSchedulingSnapshot, loadSchedulingSnapshot, sectionLanesFromEntries } from './merge/snapshot'
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
  LatePipelineResult,
  LateEnrollmentReport,
  RunLateOptions,
  ClashDecision,
} from './pipeline/lateRun'
export { runLatePipeline } from './pipeline/lateRun'
export type {
  LateAddition,
  LateAdditionsResult,
  CapacityConflict,
  CapacityDecision,
  OnFullStrategy,
} from './merge/lateEnrollment'
export {
  computeLateAdditions,
  preflightLateCapacity,
  mergeLateStudentsIntoSections,
  assertFrozenInvariants,
  nextSectionId,
  equalizeCourseSections,
} from './merge/lateEnrollment'
export type { CapacityPanel, ClashPanel, PredictedClash } from './merge/lateResolution'
export {
  buildCapacityPanel,
  buildClashPanel,
  predictLateClashes,
  formatProjectedLoads,
} from './merge/lateResolution'
export type { RunLogEntry, RunMode } from './merge/runLog'
export { nextRunSeq, nextLateBatch, createRunLogEntry, appendRunLog, cloneRunLog } from './merge/runLog'
export type { ClashOrigin, ClashProvenanceMap } from './merge/clashProvenance'
export {
  updateClashProvenance,
  buildClashCause,
  activeClashOrigins,
  allClashOrigins,
  clashProvenanceKey,
} from './merge/clashProvenance'
export type { LateMarking } from './io/excelLateMarking'
export {
  buildLateMarking,
  formatLateAddsChain,
  lateAddsIncludesBatch,
} from './io/excelLateMarking'
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
export { parseExcelRows, loadAndValidate, validateBusinessRules } from './parse/parser'
export type {
  EnrollmentIssue,
  IssueCategory,
  IssueFinderReport,
  IssueSeverity,
} from './parse/issueFinder'
export {
  ISSUE_CATEGORY_LABELS,
  ISSUE_CATEGORY_ORDER,
  categoryForValidationError,
  findEnrollmentIssues,
} from './parse/issueFinder'
export type { FilterScheduleResult } from './io/excelScheduleReader'
export {
  normalizeCourseCodeList,
  filterScheduleEntries,
  scheduleFromFilteredEntries,
  readScheduleEntriesFromBuffer,
  readScheduleEntriesFromFile,
} from './io/excelScheduleReader'
export type { ScheduleAudit } from './solver/hardConstraints'
export {
  auditScheduleHardConstraints,
  parallelHardCap,
  runCpsatScheduler,
  buildSchedule,
  computeClashReport,
} from './solver/scheduler'

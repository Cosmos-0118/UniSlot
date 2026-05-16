/**
 * Evening scheduling domain: parse → preprocess → optimize → Excel.
 * Prefer `import { … } from '@/modules/scheduling'` in app code.
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
export type { PipelineResult } from './pipeline/run'
export { runPipeline, computeCourseEmailGroups, type RunPipelineOptions } from './pipeline/run'
export type { SchedulingSnapshot } from './merge/snapshot'
export { cloneSchedulingSnapshot } from './merge/snapshot'
export {
  mergeLateEnrollmentIntoSnapshot,
  appendStudentToCourseSection,
  type MergeLateEnrollmentResult,
  type LateMergeSummary,
} from './merge/lateEnrollment'
export { parseExcelRows, loadAndValidate } from './parse/parser'
export { runScheduler, auditScheduleHardConstraints } from './solver/scheduler'
export {
  applyAndValidateFacultyMapping,
  applyFacultyOverridesToSnapshot,
  buildScheduleFromSnapshot,
  countPlanningFacultySections,
  facultyMappingTemplateCsv,
  isPlanningFacultyLabel,
  listFacultyMappingRows,
  parseFacultyMappingTable,
  type ParseFacultyMappingResult,
} from './merge/facultyMapping'
export type { ScheduleWorkbookBranding } from './io/excelScheduleWorkbook'

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
export type { SchedulingStats } from './engines/metrics'
export type { PipelineResult } from './pipeline'
export { runPipeline, computeCourseEmailGroups, type RunPipelineOptions } from './pipeline'
export { parseExcelRows, loadAndValidate } from './parser'
export { runScheduler, auditScheduleHardConstraints } from './scheduler'

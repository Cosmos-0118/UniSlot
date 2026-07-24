/**
 * Public scheduling API — CP-SAT path of record.
 */
export {
  auditScheduleHardConstraints,
  parallelHardCap,
  facultySlotsFeasible,
} from './hardConstraints'
export { buildSchedule, computeClashReport } from './scheduleOutput'
export {
  buildCpsatInstance,
  aggregateCourseConflictEdges,
  sectionSlotsFromCourseSlots,
} from './cpsatInstance'
export type { CpsatInstance, CpsatSolution, CpsatProgressEvent } from './cpsatInstance'
export { runCpsatScheduler, spawnCpsatSolve, resolveCpsatPython, CPSAT_DIR } from './cpsatBridge'
export {
  INDEX_TO_DAY,
  TOTAL_WEEKLY_SLOTS,
  PREFERRED_PARALLEL_SECTIONS,
  isMathCourse,
} from './timeModel'
export { computeSchedulingLowerBounds } from './lowerBounds'
export type { SchedulingLowerBounds } from './lowerBounds'

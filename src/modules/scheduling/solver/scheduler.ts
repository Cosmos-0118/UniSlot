/**
 * Public scheduling API — implementation lives in sibling solver modules.
 */
export {
  runScheduler,
  runSchedulerAsync,
  auditScheduleHardConstraints,
  localSearchSeedPlan,
  parallelHardCap,
  reduceSeedRuns,
  runPhase1SeedTask,
  runPhase2RefineTask,
  finalizeSchedulerBest,
  buildCourseAdjacencyForPool,
  tryRepairFacultyBundleOverlaps,
  computeSchedulingLowerBounds,
} from './localSearchSolver'
export type { SchedulerRunResult, SchedulerRunOptions, SeedRunResult, EffortLevel } from './localSearchSolver'
export type { SchedulingLowerBounds } from './lowerBounds'
export { resolveEffort, EFFORT_LEVELS, effortLabel } from './effort'
export { buildSchedule, computeClashReport } from './scheduleOutput'
export {
  buildCpsatInstance,
  aggregateCourseConflictEdges,
  sectionSlotsFromCourseSlots,
} from './cpsatInstance'
export type { CpsatInstance, CpsatSolution, CpsatProgressEvent } from './cpsatInstance'
export { runCpsatScheduler, spawnCpsatSolve, resolveCpsatPython, CPSAT_DIR } from './cpsatBridge'
export { INDEX_TO_DAY, TOTAL_WEEKLY_SLOTS, PREFERRED_PARALLEL_SECTIONS, isMathCourse } from './timeModel'
export { fixAndOptimizeConflictedCourses } from './fixAndOptimize'

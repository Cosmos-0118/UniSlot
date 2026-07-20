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
} from './localSearchSolver'
export type { SchedulerRunResult, SchedulerRunOptions, SeedRunResult, EffortLevel } from './localSearchSolver'
export { resolveEffort, EFFORT_LEVELS, effortLabel } from './effort'
export { buildSchedule, computeClashReport } from './scheduleOutput'
export { INDEX_TO_DAY, TOTAL_WEEKLY_SLOTS, SLOTS_PER_DAY } from './timeModel'

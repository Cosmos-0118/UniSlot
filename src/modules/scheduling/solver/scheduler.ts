/**
 * Public scheduling API — implementation lives in sibling solver modules.
 */
export { runScheduler, auditScheduleHardConstraints, localSearchSeedPlan, parallelHardCap } from './localSearchSolver'
export { buildSchedule, computeClashReport } from './scheduleOutput'
export { INDEX_TO_DAY, TOTAL_WEEKLY_SLOTS, SLOTS_PER_DAY } from './timeModel'

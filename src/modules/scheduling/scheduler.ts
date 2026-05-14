/**
 * Public scheduling API — implementation lives in `./engines/*`.
 */
export { runScheduler, auditScheduleHardConstraints, localSearchSeedPlan } from './engines/localSearchSolver'
export { buildSchedule, computeClashReport } from './engines/scheduleOutput'
export { INDEX_TO_DAY, TOTAL_WEEKLY_SLOTS, SLOTS_PER_DAY } from './engines/timeModel'

import type { Schedule, ScheduleEntry } from './types'

/** Drops timetable rows from the initial worker result to shrink structured-clone cost. */
export function slimScheduleForTransfer(schedule: Schedule): Schedule {
  return {
    ...schedule,
    entries: [],
  }
}

export function scheduleWithEntries(schedule: Schedule, entries: ScheduleEntry[]): Schedule {
  return { ...schedule, entries }
}

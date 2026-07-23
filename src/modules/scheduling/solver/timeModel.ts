import type { DayName } from '../types'

/** One simultaneous evening session (5–7 PM) on each weekday. */
export const WEEKDAY_COUNT = 6
export const TOTAL_WEEKLY_SLOTS = WEEKDAY_COUNT
/** Comfortable number of simultaneous sections; the solver may exceed this when required. */
export const PREFERRED_PARALLEL_SECTIONS = 11
/** Used only to convert saved schedules created by the pre-weekday model. */
export const LEGACY_BANDS_PER_DAY = 11

export const WEEKDAY_ORDER: DayName[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/** 0–4 → weekday (Mon..Fri). */
export function slotIndexToDay(slotIndex: number): DayName {
  return WEEKDAY_ORDER[Math.min(Math.max(slotIndex, 0), WEEKDAY_ORDER.length - 1)]!
}

/** Weekday index → day name, retained for schedule exports. */
export const INDEX_TO_DAY: Record<number, DayName> = {}
for (let i = 0; i < TOTAL_WEEKLY_SLOTS; i++) {
  INDEX_TO_DAY[i] = slotIndexToDay(i)
}

/** Converts a legacy 0–54 band slot to its weekday index. */
export function legacySlotToWeekday(slotIndex: number): number {
  return Math.min(
    Math.max(Math.floor(slotIndex / LEGACY_BANDS_PER_DAY), 0),
    WEEKDAY_COUNT - 1,
  )
}

export function formatSlotTime(): string {
  return '5:00 PM – 7:00 PM'
}

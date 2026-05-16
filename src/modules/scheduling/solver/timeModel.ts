import type { DayName } from '../types'

/** Evening model: 5 weekdays × 11 intra-day bands (Constraints.md §4). */
export const SLOTS_PER_DAY = 11
export const WEEKDAY_COUNT = 5
export const TOTAL_WEEKLY_SLOTS = SLOTS_PER_DAY * WEEKDAY_COUNT

export const WEEKDAY_ORDER: DayName[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
]

/** 0–54 → weekday (Mon..Fri). */
export function slotIndexToDay(slotIndex: number): DayName {
  const d = Math.floor(slotIndex / SLOTS_PER_DAY)
  return WEEKDAY_ORDER[Math.min(Math.max(d, 0), WEEKDAY_ORDER.length - 1)]!
}

/** 1-based band within the day (1..11). */
export function slotIndexToBand(slotIndex: number): number {
  return (slotIndex % SLOTS_PER_DAY) + 1
}

export function dayAndBandToSlotIndex(day: DayName, band1: number): number {
  const di = WEEKDAY_ORDER.indexOf(day)
  if (di < 0) return 0
  const b = Math.min(Math.max(band1, 1), SLOTS_PER_DAY) - 1
  return di * SLOTS_PER_DAY + b
}

/** Legacy map: global slot index → day (band encoded in `formatSlotTime`). */
export const INDEX_TO_DAY: Record<number, DayName> = {}
for (let i = 0; i < TOTAL_WEEKLY_SLOTS; i++) {
  INDEX_TO_DAY[i] = slotIndexToDay(i)
}

export function formatSlotTime(slotIndex: number): string {
  const band = slotIndexToBand(slotIndex)
  return `5:00 PM – 7:00 PM · band ${band}/${SLOTS_PER_DAY}`
}

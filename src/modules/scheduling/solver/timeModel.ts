import type { DayName } from '../types'

/** One simultaneous evening session (5–7 PM) on each weekday. */
export const WEEKDAY_COUNT = 6
export const TOTAL_WEEKLY_SLOTS = WEEKDAY_COUNT
/** Comfortable number of simultaneous sections; the solver may exceed this when required. */
export const PREFERRED_PARALLEL_SECTIONS = 11
/** Non-mathematics courses may only use Mon–Fri (slots 0–4). */
export const NON_MATH_WEEKDAY_COUNT = 5
/** Saturday evening index (Constraints.md: maths-only when enabled). */
export const SATURDAY_SLOT_INDEX = TOTAL_WEEKLY_SLOTS - 1
/** Used only to convert saved schedules created by the pre-weekday model. */
export const LEGACY_BANDS_PER_DAY = 11

/** Saturday (slot 5) is reserved for mathematics courses (Constraints.md). */
export function isMathCourse(code: string): boolean {
  const upper = code.toUpperCase()
  // Matches '21MAB101T', '21MAC503T', 'MA101', 'MAT201', etc.
  return /^[0-9]*MA/.test(upper) || upper.startsWith('MAT')
}

/** Parse comma-separated or array course codes into a normalized, deduped list. */
export function normalizeSaturdayExtraCodes(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return []
  const parts = Array.isArray(raw) ? raw : raw.split(',')
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const code = part.trim().toUpperCase()
    if (!code || seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

function extrasSet(extras: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return new Set(normalizeSaturdayExtraCodes([...extras]))
}

/** True when Saturday evening is available for any course this run. */
export function saturdaySlotOpen(
  allowSaturdayForMath: boolean,
  extras: readonly string[] = [],
): boolean {
  return allowSaturdayForMath || extras.length > 0
}

/**
 * Whether a course may be placed on Saturday.
 * Maths when the maths flag is on, or any code in the independent extra allowlist.
 */
export function isSaturdayEligible(
  code: string,
  allowSaturdayForMath: boolean,
  extras: ReadonlySet<string> | readonly string[] = [],
): boolean {
  const upper = code.trim().toUpperCase()
  if (extrasSet(extras).has(upper)) return true
  return allowSaturdayForMath && isMathCourse(code)
}

/** Active weekday count: Mon–Sat when Saturday is open, else Mon–Fri. */
export function activeWeekdayCount(
  allowSaturdayForMath = true,
  extras: readonly string[] = [],
): number {
  return saturdaySlotOpen(allowSaturdayForMath, extras) ? TOTAL_WEEKLY_SLOTS : NON_MATH_WEEKDAY_COUNT
}

/** Highest slot index a course may use under the Saturday policy. */
export function maxSlotIndexForCourse(
  code: string,
  allowSaturdayForMath = true,
  extras: ReadonlySet<string> | readonly string[] = [],
): number {
  return isSaturdayEligible(code, allowSaturdayForMath, extras)
    ? SATURDAY_SLOT_INDEX
    : NON_MATH_WEEKDAY_COUNT - 1
}

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

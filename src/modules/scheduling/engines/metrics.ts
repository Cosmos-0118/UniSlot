import type { ConflictGraph, Section } from '../types'
import { computeClashWeight } from './conflictGraph'
import { SLOTS_PER_DAY, TOTAL_WEEKLY_SLOTS, WEEKDAY_COUNT } from './timeModel'

export interface SchedulingStats {
  total_sections: number
  total_weekly_slots: number
  max_parallel_sections_in_slot: number
  average_parallel_sections_per_slot: number
  slots_with_zero_courses: number
  total_clash_weight: number
  /** L1 distance of per-weekday section counts from even spread (Constraints §2). Lower is better. */
  weekday_balance_l1: number
}

export function computeSchedulingStats(
  sections: Section[],
  slotAssignments: Record<string, number>,
  conflictGraph: ConflictGraph,
): SchedulingStats {
  const loads = new Array(TOTAL_WEEKLY_SLOTS).fill(0)
  for (const sec of sections) {
    const sl = slotAssignments[sec.section_id] ?? 0
    if (sl >= 0 && sl < TOTAL_WEEKLY_SLOTS) loads[sl] = (loads[sl] ?? 0) + 1
  }
  const maxParallel = Math.max(0, ...loads)
  const sumLoad = loads.reduce((a: number, b: number) => a + b, 0)
  const avgParallel = TOTAL_WEEKLY_SLOTS ? sumLoad / TOTAL_WEEKLY_SLOTS : 0
  const emptySlots = loads.filter((n: number) => n === 0).length

  const dayTotals = new Array(WEEKDAY_COUNT).fill(0)
  for (let s = 0; s < TOTAL_WEEKLY_SLOTS; s++) {
    const di = Math.floor(s / SLOTS_PER_DAY)
    dayTotals[di] = (dayTotals[di] ?? 0) + (loads[s] ?? 0)
  }
  const idealPerDay = sections.length / WEEKDAY_COUNT
  const weekdayBalanceL1 = dayTotals.reduce(
    (acc: number, d: number) => acc + Math.abs(d - idealPerDay),
    0,
  )

  return {
    total_sections: sections.length,
    total_weekly_slots: TOTAL_WEEKLY_SLOTS,
    max_parallel_sections_in_slot: maxParallel,
    average_parallel_sections_per_slot: Math.round(avgParallel * 1000) / 1000,
    slots_with_zero_courses: emptySlots,
    total_clash_weight: computeClashWeight(conflictGraph, slotAssignments),
    weekday_balance_l1: Math.round(weekdayBalanceL1 * 1000) / 1000,
  }
}

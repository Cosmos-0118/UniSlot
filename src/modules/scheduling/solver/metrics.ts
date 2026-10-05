import type { ConflictGraph, Section, Student } from '../types'
import { computeClashWeight } from './conflictGraph'
import {
  computeSchedulingLowerBounds,
  type SchedulingLowerBounds,
} from './lowerBounds'
import { activeWeekdayCount } from './timeModel'

export type { SchedulingLowerBounds }

export interface SchedulingStats {
  total_sections: number
  total_weekly_slots: number
  max_parallel_sections_in_slot: number
  average_parallel_sections_per_slot: number
  slots_with_zero_courses: number
  total_clash_weight: number
  /** L1 distance of per-weekday section counts from even spread (Constraints §2). Lower is better. */
  weekday_balance_l1: number
  /** Structural lower bounds (clique / pigeonhole) — not a solver claim of optimality. */
  lower_bounds?: SchedulingLowerBounds
}

export function computeSchedulingStats(
  sections: Section[],
  slotAssignments: Record<string, number>,
  conflictGraph: ConflictGraph,
  options?: {
    courseSections?: Record<string, Section[]>
    students?: Record<string, Student>
    /** Reuse bounds already computed for this run (skip a second clique search). */
    lower_bounds?: SchedulingLowerBounds
    allowSaturdayForMath?: boolean
    saturdayExtraCourseCodes?: string[]
  },
): SchedulingStats {
  const weekdays = activeWeekdayCount(options?.allowSaturdayForMath !== false,
    options?.saturdayExtraCourseCodes)
  const loads = new Array<number>(weekdays).fill(0)
  for (const sec of sections) {
    const sl = slotAssignments[sec.section_id]
    if (sl === undefined || !Number.isInteger(sl) || sl < 0 || sl >= weekdays) {
      throw new Error(`Section ${sec.section_id}: invalid or missing slot assignment ${String(sl)}`)
    }
    loads[sl] = (loads[sl] ?? 0) + 1
  }
  const maxParallel = Math.max(0, ...loads)
  const sumLoad = loads.reduce((a: number, b: number) => a + b, 0)
  const avgParallel = sumLoad / weekdays
  const emptySlots = loads.filter((n: number) => n === 0).length

  const dayTotals = [...loads]
  const idealPerDay = sections.length / weekdays
  const weekdayBalanceL1 = dayTotals.reduce(
    (acc: number, d: number) => acc + Math.abs(d - idealPerDay),
    0,
  )

  let lower_bounds: SchedulingLowerBounds | undefined = options?.lower_bounds
  if (!lower_bounds && options?.courseSections) {
    lower_bounds = computeSchedulingLowerBounds(
      options.courseSections,
      conflictGraph,
      options.students,
      { allowSaturdayForMath: options.allowSaturdayForMath,
        saturdayExtraCourseCodes: options.saturdayExtraCourseCodes },
    )
  }

  return {
    total_sections: sections.length,
    total_weekly_slots: weekdays,
    max_parallel_sections_in_slot: maxParallel,
    average_parallel_sections_per_slot: Math.round(avgParallel * 1000) / 1000,
    slots_with_zero_courses: emptySlots,
    total_clash_weight: computeClashWeight(conflictGraph, slotAssignments),
    weekday_balance_l1: Math.round(weekdayBalanceL1 * 1000) / 1000,
    lower_bounds,
  }
}

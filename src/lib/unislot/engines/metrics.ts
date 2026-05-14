import type { ConflictGraph, Section } from '../types'
import { computeClashWeight } from './conflictGraph'
import { TOTAL_WEEKLY_SLOTS } from './timeModel'

export interface SchedulingStats {
  total_sections: number
  total_weekly_slots: number
  max_parallel_sections_in_slot: number
  average_parallel_sections_per_slot: number
  slots_with_zero_courses: number
  total_clash_weight: number
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

  return {
    total_sections: sections.length,
    total_weekly_slots: TOTAL_WEEKLY_SLOTS,
    max_parallel_sections_in_slot: maxParallel,
    average_parallel_sections_per_slot: Math.round(avgParallel * 1000) / 1000,
    slots_with_zero_courses: emptySlots,
    total_clash_weight: computeClashWeight(conflictGraph, slotAssignments),
  }
}

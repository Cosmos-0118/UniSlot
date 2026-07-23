import { describe, expect, it } from 'vitest'
import { TOTAL_WEEKLY_SLOTS } from '../../src/modules/scheduling/solver/timeModel'

/**
 * Oracle checks for clash / parallel excess helpers used by the SA hot path.
 * Mirrors the micro-opt semantics in localSearchSolver (small-map student clash,
 * analytic parallel excess deltas) under the five-weekday model.
 */

const TARGET_PARALLEL = 11

function studentHasSlotClash(
  sectionIds: string[],
  slotOfSec: (secId: string) => number,
  numSlots: number,
): boolean {
  const seen = new Map<number, number>()
  for (const secId of sectionIds) {
    const sl = slotOfSec(secId)
    if (sl === undefined || sl < 0 || sl >= numSlots) continue
    const c = (seen.get(sl) ?? 0) + 1
    if (c >= 2) return true
    seen.set(sl, c)
  }
  return false
}

function studentHasSlotClashOracle(
  sectionIds: string[],
  slotOfSec: (secId: string) => number,
  numSlots: number,
): boolean {
  const tally = new Array(numSlots).fill(0)
  for (const secId of sectionIds) {
    const sl = slotOfSec(secId)
    if (sl !== undefined && sl >= 0 && sl < numSlots) tally[sl]++
  }
  return tally.some((c: number) => c >= 2)
}

function parallelExcessAt(load: number): number {
  return load > TARGET_PARALLEL ? load - TARGET_PARALLEL : 0
}

function parallelExcessPenalty(loads: number[]): number {
  let p = 0
  for (const L of loads) p += parallelExcessAt(L)
  return p
}

describe('student clash micro-opt vs weekday oracle', () => {
  it('matches oracle for clash and clash-free enrollments', () => {
    const slots: Record<string, number> = { a: 1, b: 1, c: 3 }
    const ids = ['a', 'b', 'c']
    const slotOf = (id: string) => slots[id]!
    expect(studentHasSlotClash(ids, slotOf, TOTAL_WEEKLY_SLOTS)).toBe(true)
    expect(studentHasSlotClashOracle(ids, slotOf, TOTAL_WEEKLY_SLOTS)).toBe(true)

    slots.b = 2
    expect(studentHasSlotClash(ids, slotOf, TOTAL_WEEKLY_SLOTS)).toBe(false)
    expect(studentHasSlotClashOracle(ids, slotOf, TOTAL_WEEKLY_SLOTS)).toBe(false)
  })

  it('matches oracle across random small enrollments', () => {
    for (let t = 0; t < 200; t++) {
      const n = 2 + (t % 4)
      const ids = Array.from({ length: n }, (_, i) => `s${i}`)
      const slots: Record<string, number> = {}
      for (const id of ids) slots[id] = Math.floor(Math.random() * TOTAL_WEEKLY_SLOTS)
      const slotOf = (id: string) => slots[id]!
      expect(studentHasSlotClash(ids, slotOf, TOTAL_WEEKLY_SLOTS)).toBe(
        studentHasSlotClashOracle(ids, slotOf, TOTAL_WEEKLY_SLOTS),
      )
    }
  })
})

describe('parallel excess analytic delta vs full recompute', () => {
  it('matches move delta', () => {
    const loads = new Array(TOTAL_WEEKLY_SLOTS).fill(0)
    loads[1] = 12
    loads[3] = 10
    const k = 2
    const oldSlot = 1
    const newSlot = 3
    const before = parallelExcessPenalty(loads)
    const analytic =
      parallelExcessAt(loads[oldSlot]! - k) +
      parallelExcessAt(loads[newSlot]! + k) -
      (parallelExcessAt(loads[oldSlot]!) + parallelExcessAt(loads[newSlot]!))
    const copy = [...loads]
    copy[oldSlot]! -= k
    copy[newSlot]! += k
    const full = parallelExcessPenalty(copy) - before
    expect(analytic).toBe(full)
  })

  it('matches swap delta', () => {
    const loads = new Array(TOTAL_WEEKLY_SLOTS).fill(0)
    loads[1] = 14
    loads[4] = 9
    const ka = 3
    const kb = 1
    const sa = 1
    const sb = 4
    const before = parallelExcessPenalty(loads)
    const analytic =
      parallelExcessAt(loads[sa]! - ka + kb) +
      parallelExcessAt(loads[sb]! - kb + ka) -
      (parallelExcessAt(loads[sa]!) + parallelExcessAt(loads[sb]!))
    const copy = [...loads]
    copy[sa]! = copy[sa]! - ka + kb
    copy[sb]! = copy[sb]! - kb + ka
    const full = parallelExcessPenalty(copy) - before
    expect(analytic).toBe(full)
  })
})

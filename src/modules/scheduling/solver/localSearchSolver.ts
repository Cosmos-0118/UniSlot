import { PipelineCancelledError } from '../cancellation'
import type { ConflictGraph, Section } from '../types'
import {
  buildAdjacency,
  computeClashWeight,
  sumConflictGraphWeights,
} from './conflictGraph'
import { createRng, type Rng } from './rng'
import { SLOTS_PER_DAY, TOTAL_WEEKLY_SLOTS, WEEKDAY_COUNT } from './timeModel'

const TARGET_PARALLEL_SECTIONS = 11
const PARALLEL_SOFT_WEIGHT = 100
const DAY_BALANCE_WEIGHT = 6
const LOAD_BALANCE_FACTOR = 4

function multiStartRunCount(courseCount: number): number {
  return Math.min(72, Math.max(16, Math.ceil(Math.sqrt(courseCount) * 5)))
}

function solutionPoolSize(runCount: number): number {
  return Math.min(14, Math.max(4, Math.floor(runCount / 5)))
}

/** Exposed for pipeline UX (seed counts match the solver). */
export function localSearchSeedPlan(courseCount: number): { runCount: number; poolSize: number } {
  const runCount = multiStartRunCount(courseCount)
  return { runCount, poolSize: solutionPoolSize(runCount) }
}

export type SchedulerProgressEvent = {
  message: string
  etaSeconds?: number | null
  /** Portion of the solver pass, 0 = start … ~1 before hard-constraint audit */
  solverFraction?: number
}

function formatEtaSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '…'
  if (sec < 120) return `~${Math.max(1, Math.round(sec))}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `~${m}m ${s}s`
}

/** Hard ceiling for sections per slot (solvability); soft objective still pushes toward 11. */
export function parallelHardCap(totalSections: number): number {
  return Math.min(36, Math.max(TARGET_PARALLEL_SECTIONS, Math.ceil((totalSections * 1.35) / TOTAL_WEEKLY_SLOTS) + 6))
}

function buildEnrollmentIndex(sections: Section[]) {
  const studentToSections = new Map<string, string[]>()
  const sectionToStudents = new Map<string, string[]>()
  for (const sec of sections) {
    sectionToStudents.set(sec.section_id, sec.enrolled_students)
    for (const st of sec.enrolled_students) {
      if (!studentToSections.has(st)) studentToSections.set(st, [])
      studentToSections.get(st)!.push(sec.section_id)
    }
  }
  return { studentToSections, sectionToStudents }
}

function countStudentsWithSlotClashes(
  studentToSections: Map<string, string[]>,
  slotBySection: Record<string, number>,
  numSlots: number,
): number {
  let n = 0
  for (const st of studentToSections.keys()) {
    const tally = new Array(numSlots).fill(0)
    for (const secId of studentToSections.get(st)!) {
      const sl = slotBySection[secId]
      if (sl !== undefined && sl >= 0 && sl < numSlots) tally[sl]++
    }
    if (tally.some((c: number) => c >= 2)) n++
  }
  return n
}

function parallelExcessPenalty(slotLoads: number[]): number {
  let p = 0
  for (let s = 0; s < slotLoads.length; s++) {
    const L = slotLoads[s] ?? 0
    if (L > TARGET_PARALLEL_SECTIONS) p += L - TARGET_PARALLEL_SECTIONS
  }
  return p
}

function dayL1Penalty(dayTotals: number[], idealPerDay: number): number {
  let s = 0
  for (const d of dayTotals) s += Math.abs(d - idealPerDay)
  return s
}

function buildDayTotals(slotLoads: number[]): number[] {
  const dayTotals = new Array(WEEKDAY_COUNT).fill(0)
  for (let s = 0; s < TOTAL_WEEKLY_SLOTS; s++) {
    const di = Math.floor(s / SLOTS_PER_DAY)
    dayTotals[di] = (dayTotals[di] ?? 0) + (slotLoads[s] ?? 0)
  }
  return dayTotals
}

function dayL1PenaltyFromSlotLoads(slotLoads: number[], idealPerDay: number): number {
  return dayL1Penalty(buildDayTotals(slotLoads), idealPerDay)
}

function deltaDayL1Move(
  oldSlot: number,
  newSlot: number,
  k: number,
  dayTotals: number[],
  idealPerDay: number,
): number {
  const dOld = Math.floor(oldSlot / SLOTS_PER_DAY)
  const dNew = Math.floor(newSlot / SLOTS_PER_DAY)
  if (dOld === dNew) return 0
  const before =
    Math.abs(dayTotals[dOld]! - idealPerDay) + Math.abs(dayTotals[dNew]! - idealPerDay)
  const after =
    Math.abs(dayTotals[dOld]! - k - idealPerDay) + Math.abs(dayTotals[dNew]! + k - idealPerDay)
  return after - before
}

function deltaDayL1Swap(
  sa: number,
  sb: number,
  ka: number,
  kb: number,
  dayTotals: number[],
  idealPerDay: number,
): number {
  const da = Math.floor(sa / SLOTS_PER_DAY)
  const db = Math.floor(sb / SLOTS_PER_DAY)
  if (da === db) return 0
  const before =
    Math.abs(dayTotals[da]! - idealPerDay) + Math.abs(dayTotals[db]! - idealPerDay)
  const after =
    Math.abs(dayTotals[da]! - ka + kb - idealPerDay) +
    Math.abs(dayTotals[db]! - kb + ka - idealPerDay)
  return after - before
}

function slotLoadsFromBundleSlots(
  courseCodes: string[],
  slotByCourse: Record<string, number>,
  sectionCountByCourse: Map<string, number>,
): number[] {
  const loads = new Array(TOTAL_WEEKLY_SLOTS).fill(0)
  for (const c of courseCodes) {
    const sl = slotByCourse[c] ?? 0
    const k = sectionCountByCourse.get(c) ?? 1
    loads[sl] = (loads[sl] ?? 0) + k
  }
  return loads
}

function sectionSlotsFromBundle(
  sections: Section[],
  slotByCourse: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const sec of sections) {
    out[sec.section_id] = slotByCourse[sec.course_code] ?? 0
  }
  return out
}

/** True iff no faculty teaches two sections in the same slot. */
function facultySlotsFeasible(sections: Section[], slotByCourse: Record<string, number>): boolean {
  const keyToSection = new Map<string, string>()
  for (const sec of sections) {
    if (!sec.faculty) continue
    const slot = slotByCourse[sec.course_code] ?? 0
    const key = `${sec.faculty}\t${slot}`
    const prev = keyToSection.get(key)
    if (prev !== undefined && prev !== sec.section_id) return false
    keyToSection.set(key, sec.section_id)
  }
  return true
}

function buildFacultySlotMap(
  sections: Section[],
  slotByCourse: Record<string, number>,
): Map<string, Map<number, string>> {
  const m = new Map<string, Map<number, string>>()
  for (const sec of sections) {
    const f = sec.faculty
    if (!f) continue
    const slot = slotByCourse[sec.course_code] ?? 0
    if (!m.has(f)) m.set(f, new Map())
    m.get(f)!.set(slot, sec.section_id)
  }
  return m
}

function buildCourseAdjacency(
  conflictGraph: ConflictGraph,
  sectionToCourse: Map<string, string>,
): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>()
  for (const e of conflictGraph.edges) {
    const ca = sectionToCourse.get(e.section_a)
    const cb = sectionToCourse.get(e.section_b)
    if (!ca || !cb || ca === cb) continue
    const a = ca < cb ? ca : cb
    const b = ca < cb ? cb : ca
    if (!m.has(a)) m.set(a, new Map())
    if (!m.has(b)) m.set(b, new Map())
    m.get(a)!.set(b, (m.get(a)!.get(b) ?? 0) + e.weight)
    m.get(b)!.set(a, (m.get(b)!.get(a) ?? 0) + e.weight)
  }
  return m
}

function clashDeltaMoveCourse(
  course: string,
  oldSlot: number,
  newSlot: number,
  courseAdj: Map<string, Map<string, number>>,
  slotByCourse: Record<string, number>,
): number {
  let d = 0
  const neighbors = courseAdj.get(course)
  if (!neighbors) return 0
  for (const [other, w] of neighbors) {
    const so = slotByCourse[other] ?? 0
    d += w * ((so === newSlot ? 1 : 0) - (so === oldSlot ? 1 : 0))
  }
  return d
}

function clashDeltaSwapCourses(
  c1: string,
  c2: string,
  courseAdj: Map<string, Map<string, number>>,
  slotByCourse: Record<string, number>,
): number | null {
  const A = slotByCourse[c1] ?? 0
  const B = slotByCourse[c2] ?? 0
  if (A === B) return null
  let d = 0
  const n1 = courseAdj.get(c1)
  if (n1) {
    for (const [v, w] of n1) {
      if (v === c2) continue
      const sv = slotByCourse[v] ?? 0
      d += w * ((sv === B ? 1 : 0) - (sv === A ? 1 : 0))
    }
  }
  const n2 = courseAdj.get(c2)
  if (n2) {
    for (const [v, w] of n2) {
      if (v === c1) continue
      const sv = slotByCourse[v] ?? 0
      d += w * ((sv === A ? 1 : 0) - (sv === B ? 1 : 0))
    }
  }
  return d
}

/** Post-solve audit for Constraints.md §13 hard rules (bundle same-slot, faculty, capacity, parallel cap, slot range). */
export function auditScheduleHardConstraints(
  courseSections: Record<string, Section[]>,
  slotAssignments: Record<string, number>,
  parallelCap: number,
  facultyConstraints: Record<string, string[]>,
): { feasible: boolean; violations: string[] } {
  const violations: string[] = []
  const sections = Object.values(courseSections).flat()

  for (const [code, secs] of Object.entries(courseSections)) {
    if (secs.length <= 1) continue
    const slots = new Set(secs.map((s) => slotAssignments[s.section_id] ?? -1))
    if (slots.size > 1) {
      violations.push(
        `Course ${code}: split sections must share one slot; found ${[...slots].join(', ')}`,
      )
    }
  }

  for (const sec of sections) {
    const sl = slotAssignments[sec.section_id]
    if (sl === undefined || sl < 0 || sl >= TOTAL_WEEKLY_SLOTS) {
      violations.push(`Section ${sec.section_id}: invalid slot ${String(sl)}`)
    }
    if (sec.enrolled_students.length > sec.capacity) {
      violations.push(
        `Section ${sec.section_id}: enrollment ${sec.enrolled_students.length} > capacity ${sec.capacity}`,
      )
    }
  }

  const slotByCourse: Record<string, number> = {}
  for (const sec of sections) {
    slotByCourse[sec.course_code] = slotAssignments[sec.section_id] ?? 0
  }
  if (!facultySlotsFeasible(sections, slotByCourse)) {
    violations.push('Faculty overlap: same faculty in multiple sections at one time slot')
  }

  const slotLoads = new Array(TOTAL_WEEKLY_SLOTS).fill(0)
  for (const sec of sections) {
    const sl = slotAssignments[sec.section_id] ?? 0
    if (sl >= 0 && sl < TOTAL_WEEKLY_SLOTS) slotLoads[sl] = (slotLoads[sl] ?? 0) + 1
  }
  for (let s = 0; s < slotLoads.length; s++) {
    if (slotLoads[s]! > parallelCap) {
      violations.push(`Slot ${s}: ${slotLoads[s]} sections exceed parallel hard cap ${parallelCap}`)
    }
  }

  for (const [facLabel, secIds] of Object.entries(facultyConstraints)) {
    for (const id of secIds) {
      const sec = sections.find((x) => x.section_id === id)
      if (!sec) violations.push(`Faculty map references unknown section ${id}`)
      else if (sec.faculty !== facLabel) {
        violations.push(
          `Faculty map mismatch for ${id}: map "${facLabel}" vs section "${sec.faculty ?? ''}"`,
        )
      }
    }
  }

  return { feasible: violations.length === 0, violations }
}

function hybridSATabuImprove(
  initialSlotByCourse: Record<string, number>,
  courseCodes: string[],
  sections: Section[],
  conflictGraph: ConflictGraph,
  courseAdj: Map<string, Map<string, number>>,
  sectionCountByCourse: Map<string, number>,
  parallelCap: number,
  options?: { maxIterFactor?: number; shouldAbort?: () => boolean },
  rng: Rng = Math.random,
): Record<string, number> {
  const slotByCourse: Record<string, number> = { ...initialSlotByCourse }
  const n = courseCodes.length
  const mEdges = conflictGraph.edges.length

  const slotLoads = slotLoadsFromBundleSlots(courseCodes, slotByCourse, sectionCountByCourse)
  const facultySlots = buildFacultySlotMap(sections, slotByCourse)

  const maxIter = Math.min(
    350_000,
    Math.max(8_000, Math.floor((options?.maxIterFactor ?? 1) * (400 * n + 40 * mEdges + 2500))),
  )
  const baseTenure = Math.max(4, Math.min(36, Math.floor(4 + n / 10)))
  const coolPeriod = Math.max(35, Math.floor(20 + n / 4))
  const stagnationReheat = Math.max(200, Math.floor(150 + n * 3))

  const { studentToSections } = buildEnrollmentIndex(sections)
  const LEX_W = sumConflictGraphWeights(conflictGraph) + 1

  const sectionIdToCourse = new Map<string, string>()
  const secSlot: Record<string, number> = {}
  for (const sec of sections) {
    sectionIdToCourse.set(sec.section_id, sec.course_code)
    secSlot[sec.section_id] = slotByCourse[sec.course_code] ?? 0
  }

  let totalClash = computeClashWeight(conflictGraph, secSlot)
  let studentClash = countStudentsWithSlotClashes(studentToSections, secSlot, TOTAL_WEEKLY_SLOTS)
  let parallelPenalty = parallelExcessPenalty(slotLoads)

  const idealPerDay = sections.length / WEEKDAY_COUNT
  const dayTotals = buildDayTotals(slotLoads)
  let dayPenalty = dayL1Penalty(dayTotals, idealPerDay)

  let globalBestStudents = studentClash
  let globalBestEdges = totalClash
  let globalBestParallel = parallelPenalty
  let globalBestDay = dayPenalty
  const globalBest: Record<string, number> = { ...slotByCourse }

  let temperature = Math.max(
    40,
    studentClash * LEX_W * 0.05 + totalClash * 0.03 + parallelPenalty * 8 + dayPenalty * DAY_BALANCE_WEIGHT * 0.05,
  )
  const t0 = temperature

  const tabuUntil = new Map<string, number>()
  let iterSinceGlobalBest = 0

  function tabuAttrKey(course: string, slot: number): string {
    return `${course}\t${slot}`
  }

  function isTabu(course: string, toSlot: number, iter: number): boolean {
    return (tabuUntil.get(tabuAttrKey(course, toSlot)) ?? 0) > iter
  }

  function feasibleCourseMove(course: string, newSlot: number): boolean {
    const oldSlot = slotByCourse[course]!
    if (oldSlot === newSlot) return false
    if (newSlot < 0 || newSlot >= TOTAL_WEEKLY_SLOTS) return false

    const k = sectionCountByCourse.get(course) ?? 1
    const loadAfter = (slotLoads[newSlot] ?? 0) + k
    if (loadAfter > parallelCap) return false

    for (const sec of sections) {
      if (sec.course_code !== course) continue
      const f = sec.faculty
      if (!f) continue
      const occ = facultySlots.get(f)?.get(newSlot)
      if (occ && occ !== sec.section_id) return false
    }
    return true
  }

  function applyCourseMove(course: string, newSlot: number): void {
    const oldSlot = slotByCourse[course]!
    const k = sectionCountByCourse.get(course) ?? 1
    for (const sec of sections) {
      if (sec.course_code !== course) continue
      const f = sec.faculty
      if (f) {
        if (!facultySlots.has(f)) facultySlots.set(f, new Map())
        const fm = facultySlots.get(f)!
        if (fm.get(oldSlot) === sec.section_id) fm.delete(oldSlot)
        fm.set(newSlot, sec.section_id)
      }
    }
    slotLoads[oldSlot] = (slotLoads[oldSlot] ?? 0) - k
    slotLoads[newSlot] = (slotLoads[newSlot] ?? 0) + k
    slotByCourse[course] = newSlot
    const dOld = Math.floor(oldSlot / SLOTS_PER_DAY)
    const dNew = Math.floor(newSlot / SLOTS_PER_DAY)
    if (dOld !== dNew) {
      dayTotals[dOld] = (dayTotals[dOld] ?? 0) - k
      dayTotals[dNew] = (dayTotals[dNew] ?? 0) + k
    }
    for (const sec of sections) {
      if (sec.course_code === course) secSlot[sec.section_id] = newSlot
    }
  }

  function feasibleSwapCourses(ca: string, cb: string): boolean {
    const sa = slotByCourse[ca]!
    const sb = slotByCourse[cb]!
    if (sa === sb) return false
    const ka = sectionCountByCourse.get(ca) ?? 1
    const kb = sectionCountByCourse.get(cb) ?? 1
    const la = (slotLoads[sa] ?? 0) - ka + kb
    const lb = (slotLoads[sb] ?? 0) - kb + ka
    if (la > parallelCap || lb > parallelCap) return false
    const t = { ...slotByCourse, [ca]: sb, [cb]: sa }
    return facultySlotsFeasible(sections, t)
  }

  function applySwapCourses(ca: string, cb: string): void {
    const sa = slotByCourse[ca]!
    const sb = slotByCourse[cb]!
    const ka = sectionCountByCourse.get(ca) ?? 1
    const kb = sectionCountByCourse.get(cb) ?? 1

    for (const sec of sections) {
      const f = sec.faculty
      if (!f) continue
      if (sec.course_code === ca || sec.course_code === cb) {
        if (!facultySlots.has(f)) facultySlots.set(f, new Map())
        const fm = facultySlots.get(f)!
        if (fm.get(sa) === sec.section_id) fm.delete(sa)
        if (fm.get(sb) === sec.section_id) fm.delete(sb)
      }
    }
    for (const sec of sections) {
      const f = sec.faculty
      if (!f) continue
      if (sec.course_code === ca) {
        if (!facultySlots.has(f)) facultySlots.set(f, new Map())
        facultySlots.get(f)!.set(sb, sec.section_id)
      } else if (sec.course_code === cb) {
        if (!facultySlots.has(f)) facultySlots.set(f, new Map())
        facultySlots.get(f)!.set(sa, sec.section_id)
      }
    }

    slotLoads[sa] = (slotLoads[sa] ?? 0) - ka + kb
    slotLoads[sb] = (slotLoads[sb] ?? 0) - kb + ka
    slotByCourse[ca] = sb
    slotByCourse[cb] = sa
    const da = Math.floor(sa / SLOTS_PER_DAY)
    const db = Math.floor(sb / SLOTS_PER_DAY)
    if (da !== db) {
      dayTotals[da] = dayTotals[da]! - ka + kb
      dayTotals[db] = dayTotals[db]! - kb + ka
    }
    for (const sec of sections) {
      if (sec.course_code === ca || sec.course_code === cb) {
        secSlot[sec.section_id] = slotByCourse[sec.course_code] ?? 0
      }
    }
  }

  function studentClashUnder(slotOfSec: (secId: string) => number, st: string): boolean {
    const tally = new Array(TOTAL_WEEKLY_SLOTS).fill(0)
    for (const secId of studentToSections.get(st) ?? []) {
      const sl = slotOfSec(secId)
      if (sl >= 0 && sl < TOTAL_WEEKLY_SLOTS) tally[sl]++
    }
    return tally.some((c: number) => c >= 2)
  }

  function deltaStudentsCourseMove(course: string, newSlot: number): number {
    const affected = new Set<string>()
    for (const sec of sections) {
      if (sec.course_code === course) {
        for (const st of sec.enrolled_students) affected.add(st)
      }
    }
    let d = 0
    for (const st of affected) {
      const before = studentClashUnder((secId) => secSlot[secId]!, st)
      const after = studentClashUnder(
        (secId) => (sectionIdToCourse.get(secId) === course ? newSlot : secSlot[secId]!),
        st,
      )
      d += (after ? 1 : 0) - (before ? 1 : 0)
    }
    return d
  }

  function deltaStudentsSwapCourses(ca: string, cb: string): number {
    const sa = slotByCourse[ca]!
    const sb = slotByCourse[cb]!
    const affected = new Set<string>()
    for (const sec of sections) {
      if (sec.course_code === ca || sec.course_code === cb) {
        for (const st of sec.enrolled_students) affected.add(st)
      }
    }
    let d = 0
    for (const st of affected) {
      const before = studentClashUnder((secId) => secSlot[secId]!, st)
      const after = studentClashUnder((secId) => {
        const c = sectionIdToCourse.get(secId)
        if (c === ca) return sb
        if (c === cb) return sa
        return secSlot[secId]!
      }, st)
      d += (after ? 1 : 0) - (before ? 1 : 0)
    }
    return d
  }

  function deltaParallelMove(course: string, oldSlot: number, newSlot: number): number {
    const k = sectionCountByCourse.get(course) ?? 1
    const before = parallelExcessPenalty(slotLoads)
    const a = [...slotLoads]
    a[oldSlot] = (a[oldSlot] ?? 0) - k
    a[newSlot] = (a[newSlot] ?? 0) + k
    return parallelExcessPenalty(a) - before
  }

  function deltaParallelSwap(ca: string, cb: string): number {
    const sa = slotByCourse[ca]!
    const sb = slotByCourse[cb]!
    const ka = sectionCountByCourse.get(ca) ?? 1
    const kb = sectionCountByCourse.get(cb) ?? 1
    const before = parallelExcessPenalty(slotLoads)
    const a = [...slotLoads]
    a[sa] = (a[sa] ?? 0) - ka + kb
    a[sb] = (a[sb] ?? 0) - kb + ka
    return parallelExcessPenalty(a) - before
  }

  function registerTabu(course: string, fromSlot: number, iter: number, tenure: number): void {
    tabuUntil.set(tabuAttrKey(course, fromSlot), iter + tenure)
  }

    const abortStride = 2048
  for (let iter = 0; iter < maxIter; iter++) {
    if (iter > 0 && iter % abortStride === 0 && options?.shouldAbort?.()) {
      throw new PipelineCancelledError()
    }
    if (iter > 0 && iter % coolPeriod === 0) temperature *= 0.992

    const tenure = baseTenure + (iter % 5)
    const roll = rng()

    const canAccept = (
      dS: number,
      dE: number,
      dP: number,
      dDay: number,
      tabuBlocked: boolean,
    ): boolean => {
      const newS = studentClash + dS
      const newE = totalClash + dE
      const newP = parallelPenalty + dP
      const newDay = dayPenalty + dDay
      if (
        newS < globalBestStudents ||
        (newS === globalBestStudents && newE < globalBestEdges) ||
        (newS === globalBestStudents && newE === globalBestEdges && newP < globalBestParallel) ||
        (newS === globalBestStudents &&
          newE === globalBestEdges &&
          newP === globalBestParallel &&
          newDay < globalBestDay)
      ) {
        return true
      }
      if (tabuBlocked) return false
      const deltaF =
        dS * LEX_W + dE + dP * PARALLEL_SOFT_WEIGHT + dDay * DAY_BALANCE_WEIGHT
      if (deltaF <= 0) return true
      return rng() < Math.exp(-deltaF / temperature)
    }

    if (roll < 0.58) {
      const course = courseCodes[Math.floor(rng() * n)]!
      const newSlot = Math.floor(rng() * TOTAL_WEEKLY_SLOTS)
      if (!feasibleCourseMove(course, newSlot)) continue
      const oldSlot = slotByCourse[course]!
      const k = sectionCountByCourse.get(course) ?? 1
      const dE = clashDeltaMoveCourse(course, oldSlot, newSlot, courseAdj, slotByCourse)
      const dS = deltaStudentsCourseMove(course, newSlot)
      const dP = deltaParallelMove(course, oldSlot, newSlot)
      const dDay = deltaDayL1Move(oldSlot, newSlot, k, dayTotals, idealPerDay)
      const tabuBlocked = isTabu(course, newSlot, iter)
      if (!canAccept(dS, dE, dP, dDay, tabuBlocked)) continue
      applyCourseMove(course, newSlot)
      totalClash += dE
      studentClash += dS
      parallelPenalty += dP
      dayPenalty += dDay
      registerTabu(course, oldSlot, iter, tenure)
    } else {
      const ca = courseCodes[Math.floor(rng() * n)]!
      const cb = courseCodes[Math.floor(rng() * n)]!
      if (ca === cb) continue
      const dE = clashDeltaSwapCourses(ca, cb, courseAdj, slotByCourse)
      if (dE === null) continue
      if (!feasibleSwapCourses(ca, cb)) continue
      const dS = deltaStudentsSwapCourses(ca, cb)
      const dP = deltaParallelSwap(ca, cb)
      const sa = slotByCourse[ca]!
      const sb = slotByCourse[cb]!
      const ka = sectionCountByCourse.get(ca) ?? 1
      const kb = sectionCountByCourse.get(cb) ?? 1
      const dDay = deltaDayL1Swap(sa, sb, ka, kb, dayTotals, idealPerDay)
      const tabuBlocked = isTabu(ca, sb, iter) || isTabu(cb, sa, iter)
      if (!canAccept(dS, dE, dP, dDay, tabuBlocked)) continue
      applySwapCourses(ca, cb)
      totalClash += dE
      studentClash += dS
      parallelPenalty += dP
      dayPenalty += dDay
      registerTabu(ca, sa, iter, tenure)
      registerTabu(cb, sb, iter, tenure)
    }

    if (
      studentClash < globalBestStudents ||
      (studentClash === globalBestStudents && totalClash < globalBestEdges) ||
      (studentClash === globalBestStudents &&
        totalClash === globalBestEdges &&
        parallelPenalty < globalBestParallel) ||
      (studentClash === globalBestStudents &&
        totalClash === globalBestEdges &&
        parallelPenalty === globalBestParallel &&
        dayPenalty < globalBestDay)
    ) {
      globalBestStudents = studentClash
      globalBestEdges = totalClash
      globalBestParallel = parallelPenalty
      globalBestDay = dayPenalty
      for (const c of courseCodes) globalBest[c] = slotByCourse[c]!
      iterSinceGlobalBest = 0
      if (globalBestStudents === 0 && globalBestEdges === 0) break
    } else {
      iterSinceGlobalBest++
      if (iterSinceGlobalBest >= stagnationReheat) {
        temperature = Math.min(t0 * 1.45, temperature * 1.3)
        iterSinceGlobalBest = 0
      }
    }
  }

  return globalBest
}

function solveGreedySeed(
  courseCodes: string[],
  sections: Section[],
  conflictGraph: ConflictGraph,
  courseAdj: Map<string, Map<string, number>>,
  sectionCountByCourse: Map<string, number>,
  conflictDensity: Record<string, number>,
  parallelCap: number,
  randomize: boolean,
  rng: Rng,
): { slotByCourse: Record<string, number>; clashWeight: number } {
  function coursePriority(code: string): number {
    const secs = sections.filter((s) => s.course_code === code)
    let score = 0
    for (const s of secs) {
      const cw = conflictDensity[s.section_id] ?? 0
      const deg = courseAdj.get(code)?.size ?? 0
      const enrollment = s.enrolled_students.length
      score += cw * 100 + deg * 15 + enrollment
    }
    if (randomize) score += (rng() - 0.5) * 200
    return score
  }

  const sorted = [...courseCodes].sort((a, b) => coursePriority(b) - coursePriority(a))
  const slotByCourse: Record<string, number> = {}
  const slotLoads = new Array(TOTAL_WEEKLY_SLOTS).fill(0)
  const idealPerDay = sections.length / WEEKDAY_COUNT

  const FACULTY_VIOL = 1_000_000_000
  const CAP_HARD = 100_000_000

  for (const code of sorted) {
    const k = sectionCountByCourse.get(code) ?? 1
    const secs = sections.filter((s) => s.course_code === code)
    const faculties = secs.map((s) => s.faculty).filter(Boolean) as string[]

    let bestSlot = 0
    let bestScore = Number.POSITIVE_INFINITY

    const totalAssigned = slotLoads.reduce((a: number, b: number) => a + b, 0)
    const targetLoad = TOTAL_WEEKLY_SLOTS ? totalAssigned / TOTAL_WEEKLY_SLOTS : 0

    for (let slot = 0; slot < TOTAL_WEEKLY_SLOTS; slot++) {
      let violation = 0
      if (slotLoads[slot]! + k > parallelCap) {
        violation += CAP_HARD * (slotLoads[slot]! + k - parallelCap)
      }
      for (const f of faculties) {
        for (const sec of sections) {
          if (sec.faculty === f && slotByCourse[sec.course_code] === slot && sec.course_code !== code) {
            violation += FACULTY_VIOL
          }
        }
      }

      let conflictCost = 0
      for (const other of sorted) {
        if (other === code || slotByCourse[other] === undefined) continue
        if (slotByCourse[other] === slot) {
          const w = courseAdj.get(code)?.get(other)
          if (w) conflictCost += w
        }
      }

      const L = (slotLoads[slot] ?? 0) + k
      const parallelSoft = Math.max(0, L - TARGET_PARALLEL_SECTIONS) * PARALLEL_SOFT_WEIGHT
      const loadPenalty = Math.max(0, (slotLoads[slot] ?? 0) - targetLoad) * LOAD_BALANCE_FACTOR
      const trialLoads = [...slotLoads]
      trialLoads[slot] = (trialLoads[slot] ?? 0) + k
      const daySoft = dayL1PenaltyFromSlotLoads(trialLoads, idealPerDay) * 3
      let score = violation + conflictCost + parallelSoft + loadPenalty + daySoft
      if (randomize) score += rng() * (conflictCost > 0 ? conflictCost * 0.4 + 3 : 3)
      if (score < bestScore) {
        bestScore = score
        bestSlot = slot
      }
    }

    slotByCourse[code] = bestSlot
    slotLoads[bestSlot] = (slotLoads[bestSlot] ?? 0) + k
  }

  const improved = hybridSATabuImprove(
    slotByCourse,
    courseCodes,
    sections,
    conflictGraph,
    courseAdj,
    sectionCountByCourse,
    parallelCap,
    undefined,
    rng,
  )

  const cw = computeClashWeight(conflictGraph, sectionSlotsFromBundle(sections, improved))
  return { slotByCourse: improved, clashWeight: cw }
}

/** Greedy bundle moves to eliminate same-faculty double-booking across courses (post-SA polish). */
function tryRepairFacultyBundleOverlaps(
  courseCodes: string[],
  sections: Section[],
  slotByCourse: Record<string, number>,
  sectionCountByCourse: Map<string, number>,
  parallelCap: number,
  rng: Rng,
  maxIterations: number,
): Record<string, number> | null {
  let cur = { ...slotByCourse }
  if (facultySlotsFeasible(sections, cur)) return cur

  for (let iter = 0; iter < maxIterations; iter++) {
    if (facultySlotsFeasible(sections, cur)) return cur

    const order = [...courseCodes].sort(() => rng() - 0.5)
    let progressed = false
    for (const code of order) {
      const oldSlot = cur[code]!
      const slotsTry = [...Array(TOTAL_WEEKLY_SLOTS).keys()].sort(() => rng() - 0.5)
      for (const newSlot of slotsTry) {
        if (newSlot === oldSlot) continue
        const trial = { ...cur, [code]: newSlot }
        if (!facultySlotsFeasible(sections, trial)) continue
        const loads = slotLoadsFromBundleSlots(courseCodes, trial, sectionCountByCourse)
        let bad = false
        for (let i = 0; i < loads.length; i++) {
          if ((loads[i] ?? 0) > parallelCap) {
            bad = true
            break
          }
        }
        if (bad) continue
        cur = trial
        progressed = true
        break
      }
      if (progressed) break
    }
    if (!progressed) break
  }

  return facultySlotsFeasible(sections, cur) ? cur : null
}

export function runScheduler(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  onProgress?: (evt: SchedulerProgressEvent) => void,
  options?: { randomSeed?: number; shouldAbort?: () => boolean },
): {
  slot_assignments: Record<string, number>
  solver_used: string
  solver_time_seconds: number
  total_clash_weight: number
  feasible: boolean
  /** True when {@link feasible} and best solution has zero RED students and zero clash weight (heuristic certificate, not global optimality proof). */
  optimal: boolean
  hard_constraint_violations: string[]
} {
  const rng = createRng(options?.randomSeed)
  const t0 = performance.now() / 1000
  const sections = Object.values(courseSections).flat()
  const courseCodes = Object.keys(courseSections)
  const sectionToCourse = new Map<string, string>()
  const sectionCountByCourse = new Map<string, number>()
  for (const c of courseCodes) {
    const arr = courseSections[c]!
    sectionCountByCourse.set(c, arr.length)
    for (const s of arr) sectionToCourse.set(s.section_id, c)
  }

  const courseAdj = buildCourseAdjacency(conflictGraph, sectionToCourse)
  const { conflictDensity, adj } = buildAdjacency(conflictGraph)
  void adj

  const parallelCap = parallelHardCap(sections.length)
  const runCount = multiStartRunCount(courseCodes.length)
  const poolSize = solutionPoolSize(runCount)

  const { studentToSections } = buildEnrollmentIndex(sections)

  const runs: {
    slotByCourse: Record<string, number>
    clashWeight: number
    students: number
  }[] = []

  const push = (evt: SchedulerProgressEvent) => onProgress?.(evt)

  const tPhase1 = performance.now()
  push({
    message: `Phase 1/2: ${runCount} bundle-aware greedy seeds (${TOTAL_WEEKLY_SLOTS} slots/week)`,
    etaSeconds: null,
    solverFraction: 0,
  })

  const shouldAbort = options?.shouldAbort
  const progressStep = Math.max(1, Math.floor(runCount / 10))
  for (let i = 0; i < runCount; i++) {
    if (shouldAbort?.()) throw new PipelineCancelledError()
    const r = solveGreedySeed(
      courseCodes,
      sections,
      conflictGraph,
      courseAdj,
      sectionCountByCourse,
      conflictDensity,
      parallelCap,
      i > 0,
      rng,
    )
    const slotMap = sectionSlotsFromBundle(sections, r.slotByCourse)
    const students = countStudentsWithSlotClashes(studentToSections, slotMap, TOTAL_WEEKLY_SLOTS)
    runs.push({ slotByCourse: { ...r.slotByCourse }, clashWeight: r.clashWeight, students })

    const done = i + 1
    const elapsed = (performance.now() - tPhase1) / 1000
    const shouldReport = done === 1 || done === runCount || done % progressStep === 0
    if (shouldReport) {
      const etaSeconds = done >= 2 ? (elapsed / done) * (runCount - done) : null
      push({
        message: `Phase 1/2: ${done}/${runCount} seeds · ${elapsed.toFixed(1)}s elapsed${
          etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0.5
            ? ` · ETA ${formatEtaSeconds(etaSeconds)}`
            : ''
        }`,
        etaSeconds:
          etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0.5 ? etaSeconds : null,
        solverFraction: 0.55 * (done / runCount),
      })
    }
  }

  runs.sort((a, b) => a.students - b.students || a.clashWeight - b.clashWeight)
  let best = runs[0] ?? { slotByCourse: {}, clashWeight: 0, students: 0 }

  const pool = Math.min(poolSize, runs.length)
  const refinementSteps = Math.max(1, pool - 1)

  if (pool <= 1) {
    push({
      message: `Phase 2/2 skipped (single seed). Best: ${best.students} students with overlaps · clash weight ${best.clashWeight}.`,
      etaSeconds: null,
      solverFraction: 0.92,
    })
  } else {
    push({
      message: `Phase 2/2: Tabu/SA refine top ${pool} candidates (best so far: ${best.students} overlaps · weight ${best.clashWeight})`,
      etaSeconds: null,
      solverFraction: 0.55,
    })

    const tPhase2 = performance.now()
    for (let p = 1; p < pool; p++) {
      if (shouldAbort?.()) throw new PipelineCancelledError()
      const seed = runs[p]
      if (!seed) continue
      const elapsed = (performance.now() - tPhase2) / 1000
      const finished = p - 1
      const etaSeconds =
        finished >= 1 ? (elapsed / finished) * (refinementSteps - finished) : null
      push({
        message: `Phase 2/2: refine ${p}/${refinementSteps} · ${elapsed.toFixed(1)}s${
          etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0.5
            ? ` · ETA ${formatEtaSeconds(etaSeconds)}`
            : ''
        }`,
        etaSeconds:
          etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0.5 ? etaSeconds : null,
        solverFraction: 0.55 + 0.44 * (p / refinementSteps),
      })
      const refined = hybridSATabuImprove(
        { ...seed.slotByCourse },
        courseCodes,
        sections,
        conflictGraph,
        courseAdj,
        sectionCountByCourse,
        parallelCap,
        { maxIterFactor: 1.85, shouldAbort },
        rng,
      )
      const slotMap = sectionSlotsFromBundle(sections, refined)
      const cw = computeClashWeight(conflictGraph, slotMap)
      const st = countStudentsWithSlotClashes(studentToSections, slotMap, TOTAL_WEEKLY_SLOTS)
      if (st < best.students || (st === best.students && cw < best.clashWeight)) {
        best = { slotByCourse: refined, clashWeight: cw, students: st }
      }
    }
  }

  push({
    message: `Search finished: ${best.students} students with slot overlaps · clash weight ${best.clashWeight}.`,
    etaSeconds: null,
    solverFraction: 0.96,
  })

  if (!facultySlotsFeasible(sections, best.slotByCourse)) {
    push({
      message: 'Post-process: resolving faculty bundle double-bookings (slot moves)…',
      etaSeconds: null,
      solverFraction: 0.98,
    })
    const fixed = tryRepairFacultyBundleOverlaps(
      courseCodes,
      sections,
      best.slotByCourse,
      sectionCountByCourse,
      parallelCap,
      rng,
      800,
    )
    if (fixed) {
      const slotMap = sectionSlotsFromBundle(sections, fixed)
      const cw = computeClashWeight(conflictGraph, slotMap)
      const st = countStudentsWithSlotClashes(studentToSections, slotMap, TOTAL_WEEKLY_SLOTS)
      best = { slotByCourse: fixed, clashWeight: cw, students: st }
    }
  }

  const slot_assignments = sectionSlotsFromBundle(sections, best.slotByCourse)
  const audit = auditScheduleHardConstraints(
    courseSections,
    slot_assignments,
    parallelCap,
    facultyConstraints,
  )
  const primarySatisfied = best.students === 0 && best.clashWeight === 0

  return {
    slot_assignments,
    solver_used: 'bundle-sa-tabu-55',
    solver_time_seconds: performance.now() / 1000 - t0,
    total_clash_weight: best.clashWeight,
    feasible: audit.feasible,
    optimal: audit.feasible && primarySatisfied,
    hard_constraint_violations: audit.violations,
  }
}

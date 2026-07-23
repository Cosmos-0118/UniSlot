import { PipelineCancelledError } from '../worker/cancellation'
import type { ConflictGraph, Section } from '../types'
import {
  buildAdjacency,
  computeClashWeight,
  sumConflictGraphWeights,
} from './conflictGraph'
import { resolveEffort, type EffortLevel, type EffortParams } from './effort'
import { createRng, type Rng } from './rng'
import { PREFERRED_PARALLEL_SECTIONS, TOTAL_WEEKLY_SLOTS, WEEKDAY_COUNT, slotIndexToDay } from './timeModel'

export type { EffortLevel } from './effort'
export { resolveEffort, EFFORT_LEVELS, effortLabel } from './effort'

const TARGET_PARALLEL_SECTIONS = PREFERRED_PARALLEL_SECTIONS
const PARALLEL_SOFT_WEIGHT = 0.01
const DAY_BALANCE_WEIGHT = 0.001
const LOAD_BALANCE_FACTOR = 4

function isMathCourse(code: string): boolean {
  const upper = code.toUpperCase()
  // Matches '21MAB101T', '21MAC503T', 'MA101', 'MAT201', etc.
  return /^[0-9]*MA/.test(upper) || upper.startsWith('MAT')
}

function multiStartRunCount(
  courseCount: number,
  poolWorkers = 1,
  effort: EffortParams = resolveEffort('balanced'),
): number {
  const base = Math.min(
    effort.runCountCap,
    Math.max(16, Math.ceil(Math.sqrt(courseCount) * 5)),
  )
  if (poolWorkers <= 1) return base
  return Math.min(effort.runCountCap, base + 12 * (poolWorkers - 1))
}

function solutionPoolSize(runCount: number, effort: EffortParams = resolveEffort('balanced')): number {
  return Math.min(effort.poolSizeCap, Math.max(4, Math.floor(runCount / 5)))
}

/** Exposed for pipeline UX (seed counts match the solver). */
export function localSearchSeedPlan(
  courseCount: number,
  poolWorkers = 1,
  effortLevel: EffortLevel = 'balanced',
): {
  runCount: number
  poolSize: number
  poolWorkers: number
  phase2IterFactor: number
  effort: EffortLevel
} {
  const effort = resolveEffort(effortLevel)
  const runCount = multiStartRunCount(courseCount, poolWorkers, effort)
  return {
    runCount,
    poolSize: solutionPoolSize(runCount, effort),
    poolWorkers,
    phase2IterFactor: effort.phase2IterFactor,
    effort: effort.effort,
  }
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

/** Parallel lanes may expand as needed; 11 is a soft weekday comfort target only. */
export function parallelHardCap(totalSections: number): number {
  return totalSections
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
    if (studentHasSlotClash(studentToSections.get(st)!, (secId) => slotBySection[secId]!, numSlots)) {
      n++
    }
  }
  return n
}

/** Pairwise / small-map clash check — students enroll in ≤5 courses, avoid Array(55) alloc. */
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

function parallelExcessAt(load: number): number {
  return load > TARGET_PARALLEL_SECTIONS ? load - TARGET_PARALLEL_SECTIONS : 0
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
    dayTotals[s] = (dayTotals[s] ?? 0) + (slotLoads[s] ?? 0)
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
  const dOld = oldSlot
  const dNew = newSlot
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
  const da = sa
  const db = sb
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

/** Public for solver pool problem packing. */
export function buildCourseAdjacencyForPool(
  conflictGraph: ConflictGraph,
  sectionToCourse: Map<string, string>,
): Map<string, Map<string, number>> {
  return buildCourseAdjacency(conflictGraph, sectionToCourse)
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

/** Post-solve audit for Constraints.md §13 hard rules (bundle weekday, faculty, capacity, student day, range). */
export function auditScheduleHardConstraints(
  courseSections: Record<string, Section[]>,
  slotAssignments: Record<string, number>,
  _parallelCap: number,
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

  const studentDayCourses = new Map<string, Map<number, Set<string>>>()
  for (const sec of sections) {
    const slot = slotAssignments[sec.section_id]
    if (slot === undefined || slot < 0 || slot >= TOTAL_WEEKLY_SLOTS) continue
    const day = slot
    for (const studentId of sec.enrolled_students) {
      if (!studentDayCourses.has(studentId)) studentDayCourses.set(studentId, new Map())
      const coursesByDay = studentDayCourses.get(studentId)!
      if (!coursesByDay.has(day)) coursesByDay.set(day, new Set())
      coursesByDay.get(day)!.add(sec.course_code)
    }
  }
  for (const [studentId, coursesByDay] of studentDayCourses) {
    for (const [day, courses] of coursesByDay) {
      if (courses.size > 1) {
        violations.push(
          `Student ${studentId}: ${[...courses].sort().join(', ')} scheduled on ${slotIndexToDay(day)}; maximum one course per weekday`,
        )
      }
    }
  }

  const slotByCourse: Record<string, number> = {}
  for (const sec of sections) {
    slotByCourse[sec.course_code] = slotAssignments[sec.section_id] ?? 0
  }
  if (!facultySlotsFeasible(sections, slotByCourse)) {
    violations.push('Faculty overlap: same faculty in multiple sections on one weekday')
  }

  // Saturday (slot 5) is reserved exclusively for Mathematics courses.
  for (const [code, slot] of Object.entries(slotByCourse)) {
    if (slot === 5 && !isMathCourse(code)) {
      violations.push(
        `Course ${code}: non-mathematics course assigned to Saturday (slot 5); Saturday is reserved for mathematics courses`,
      )
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
  options?: {
    maxIterFactor?: number
    shouldAbort?: () => boolean
    effort?: EffortParams
    deadlineMs?: number
    enableKempe?: boolean
  },
  rng: Rng = Math.random,
): Record<string, number> {
  const effort = options?.effort ?? resolveEffort('balanced')
  const slotByCourse: Record<string, number> = { ...initialSlotByCourse }
  const n = courseCodes.length
  const mEdges = conflictGraph.edges.length

  const slotLoads = slotLoadsFromBundleSlots(courseCodes, slotByCourse, sectionCountByCourse)
  const facultySlots = buildFacultySlotMap(sections, slotByCourse)

  const rawMax = Math.floor((options?.maxIterFactor ?? 1) * (400 * n + 40 * mEdges + 2500))
  const maxIter = Math.min(effort.maxIterCap, Math.max(8_000, rawMax))
  const baseTenure = Math.max(4, Math.min(36, Math.floor(4 + n / 10)))
  const coolPeriod = Math.max(35, Math.floor(20 + n / 4))
  const stagnationReheat = Math.max(200, Math.floor(150 + n * 3))
  const tStart = performance.now()
  const deadlineMs = options?.deadlineMs ?? effort.perTaskMs

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
    
    // Domain Constraint: Saturday (slot 5) is strictly reserved for Mathematics courses.
    if (newSlot === 5 && !isMathCourse(course)) return false

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
    const dOld = oldSlot
    const dNew = newSlot
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

    // Domain Constraint: Saturday (slot 5) is strictly reserved for Mathematics courses.
    if (sb === 5 && !isMathCourse(ca)) return false
    if (sa === 5 && !isMathCourse(cb)) return false

    const ka = sectionCountByCourse.get(ca) ?? 1
    const kb = sectionCountByCourse.get(cb) ?? 1
    if ((slotLoads[sa] ?? 0) - ka + kb > parallelCap) return false
    if ((slotLoads[sb] ?? 0) - kb + ka > parallelCap) return false
    // Faculty check without cloning slotByCourse: ca→sb, cb→sa.
    for (const sec of sections) {
      if (sec.course_code === ca) {
        const f = sec.faculty
        if (!f) continue
        const occ = facultySlots.get(f)?.get(sb)
        if (occ && occ !== sec.section_id && sectionIdToCourse.get(occ) !== cb) return false
      } else if (sec.course_code === cb) {
        const f = sec.faculty
        if (!f) continue
        const occ = facultySlots.get(f)?.get(sa)
        if (occ && occ !== sec.section_id && sectionIdToCourse.get(occ) !== ca) return false
      }
    }
    return true
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
    const da = sa
    const db = sb
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
    return studentHasSlotClash(studentToSections.get(st) ?? [], slotOfSec, TOTAL_WEEKLY_SLOTS)
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
    if (oldSlot === newSlot) return 0
    const k = sectionCountByCourse.get(course) ?? 1
    const o = slotLoads[oldSlot] ?? 0
    const n = slotLoads[newSlot] ?? 0
    const before = parallelExcessAt(o) + parallelExcessAt(n)
    const after = parallelExcessAt(o - k) + parallelExcessAt(n + k)
    return after - before
  }

  function deltaParallelSwap(ca: string, cb: string): number {
    const sa = slotByCourse[ca]!
    const sb = slotByCourse[cb]!
    if (sa === sb) return 0
    const ka = sectionCountByCourse.get(ca) ?? 1
    const kb = sectionCountByCourse.get(cb) ?? 1
    const o = slotLoads[sa] ?? 0
    const n = slotLoads[sb] ?? 0
    const before = parallelExcessAt(o) + parallelExcessAt(n)
    const after = parallelExcessAt(o - ka + kb) + parallelExcessAt(n - kb + ka)
    return after - before
  }

  function registerTabu(course: string, fromSlot: number, iter: number, tenure: number): void {
    tabuUntil.set(tabuAttrKey(course, fromSlot), iter + tenure)
  }

  const conflictCourses = new Set<string>()
  function rebuildConflictCourses(): void {
    conflictCourses.clear()
    for (const e of conflictGraph.edges) {
      const ca = sectionIdToCourse.get(e.section_a)
      const cb = sectionIdToCourse.get(e.section_b)
      if (!ca || !cb || ca === cb) continue
      if ((slotByCourse[ca] ?? -1) === (slotByCourse[cb] ?? -2)) {
        conflictCourses.add(ca)
        conflictCourses.add(cb)
      }
    }
  }
  rebuildConflictCourses()

  function pickMinConflictSlot(course: string): number | null {
    const sample = effort.minConflictSlotSample
    const candidates: number[] = []
    const seen = new Set<number>()
    for (let t = 0; t < sample * 2 && candidates.length < sample; t++) {
      const s = Math.floor(rng() * TOTAL_WEEKLY_SLOTS)
      if (seen.has(s)) continue
      seen.add(s)
      if (feasibleCourseMove(course, s)) candidates.push(s)
    }
    if (candidates.length === 0) return null
    let bestSlot = candidates[0]!
    let bestScore = Number.POSITIVE_INFINITY
    const oldSlot = slotByCourse[course]!
    for (const s of candidates) {
      const dS = deltaStudentsCourseMove(course, s)
      const dE = clashDeltaMoveCourse(course, oldSlot, s, courseAdj, slotByCourse)
      const score = dS * LEX_W + dE
      if (score < bestScore) {
        bestScore = score
        bestSlot = s
      }
    }
    return bestSlot
  }

  function tryKempeChain(): boolean {
    const sa = Math.floor(rng() * TOTAL_WEEKLY_SLOTS)
    let sb = Math.floor(rng() * TOTAL_WEEKLY_SLOTS)
    if (sa === sb) sb = (sb + 1) % TOTAL_WEEKLY_SLOTS

    const inA: string[] = []
    const inB: string[] = []
    for (const c of courseCodes) {
      const sl = slotByCourse[c]!
      if (sl === sa) inA.push(c)
      else if (sl === sb) inB.push(c)
    }
    if (inA.length === 0 || inB.length === 0) return false

    const neighborsA = new Map<string, string[]>()
    const neighborsB = new Map<string, string[]>()
    for (const a of inA) {
      const nb: string[] = []
      const adj = courseAdj.get(a)
      if (adj) {
        for (const b of inB) {
          if (adj.has(b)) nb.push(b)
        }
      }
      if (nb.length) neighborsA.set(a, nb)
    }
    for (const b of inB) {
      const nb: string[] = []
      const adj = courseAdj.get(b)
      if (adj) {
        for (const a of inA) {
          if (adj.has(a)) nb.push(a)
        }
      }
      if (nb.length) neighborsB.set(b, nb)
    }
    if (neighborsA.size === 0) return false

    const seeds = [...neighborsA.keys()]
    const start = seeds[Math.floor(rng() * seeds.length)]!
    const chainA = new Set<string>()
    const chainB = new Set<string>()
    const q: { c: string; side: 'A' | 'B' }[] = [{ c: start, side: 'A' }]
    const seen = new Set<string>([`A:${start}`])
    while (q.length) {
      const { c, side } = q.pop()!
      if (side === 'A') {
        chainA.add(c)
        for (const b of neighborsA.get(c) ?? []) {
          const key = `B:${b}`
          if (seen.has(key)) continue
          seen.add(key)
          q.push({ c: b, side: 'B' })
        }
      } else {
        chainB.add(c)
        for (const a of neighborsB.get(c) ?? []) {
          const key = `A:${a}`
          if (seen.has(key)) continue
          seen.add(key)
          q.push({ c: a, side: 'A' })
        }
      }
    }
    if (chainA.size === 0 || chainB.size === 0) return false

    const trial = { ...slotByCourse }
    for (const c of chainA) trial[c] = sb
    for (const c of chainB) trial[c] = sa

    // Reject Kempe swaps that would place non-math courses on Saturday
    if (sb === 5) { for (const c of chainA) if (!isMathCourse(c)) return false }
    if (sa === 5) { for (const c of chainB) if (!isMathCourse(c)) return false }

    if (!facultySlotsFeasible(sections, trial)) return false
    const loads = slotLoadsFromBundleSlots(courseCodes, trial, sectionCountByCourse)
    for (let i = 0; i < loads.length; i++) {
      if ((loads[i] ?? 0) > parallelCap) return false
    }

    for (const c of chainA) {
      if (slotByCourse[c] !== sb) applyCourseMove(c, sb)
    }
    for (const c of chainB) {
      if (slotByCourse[c] !== sa) applyCourseMove(c, sa)
    }
    return true
  }

  const abortStride = 2048
  for (let iter = 0; iter < maxIter; iter++) {
    if (iter > 0 && iter % abortStride === 0) {
      if (options?.shouldAbort?.()) throw new PipelineCancelledError()
      if (performance.now() - tStart > deadlineMs) break
    }
    if (iter > 0 && iter % coolPeriod === 0) {
      // Adaptive cooling: faster when making progress, slower when stagnating.
      const progressRatio = iterSinceGlobalBest / stagnationReheat
      const coolRate = progressRatio < 0.3 ? 0.988 : progressRatio < 0.7 ? 0.992 : 0.996
      temperature *= coolRate
    }

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

    if (options?.enableKempe && roll < effort.kempeProb) {
      if (tryKempeChain()) {
        const slotMap = sectionSlotsFromBundle(sections, slotByCourse)
        totalClash = computeClashWeight(conflictGraph, slotMap)
        studentClash = countStudentsWithSlotClashes(studentToSections, slotMap, TOTAL_WEEKLY_SLOTS)
        parallelPenalty = parallelExcessPenalty(slotLoads)
        dayPenalty = dayL1Penalty(dayTotals, idealPerDay)
        rebuildConflictCourses()
      }
    } else if (roll < 0.50 + effort.focusProb * 0.15) {
      // Single-course move (~50% + focus bias)
      let course: string
      if (conflictCourses.size > 0 && rng() < effort.focusProb) {
        const arr = [...conflictCourses]
        course = arr[Math.floor(rng() * arr.length)]!
      } else {
        course = courseCodes[Math.floor(rng() * n)]!
      }
      const picked =
        rng() < 0.85 ? pickMinConflictSlot(course) : Math.floor(rng() * TOTAL_WEEKLY_SLOTS)
      const newSlot = picked ?? Math.floor(rng() * TOTAL_WEEKLY_SLOTS)
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
      if (dE !== 0 || dS !== 0) rebuildConflictCourses()
    } else if (roll < 0.92) {
      // Pairwise swap (~34%)
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
      if (dE !== 0 || dS !== 0) rebuildConflictCourses()
    } else {
      // 3-opt cyclic rotation (~8%): pick 3 courses in different slots and rotate A→B’s slot, B→C’s slot, C→A’s slot.
      if (n < 3) continue
      const ca = courseCodes[Math.floor(rng() * n)]!
      const cb = courseCodes[Math.floor(rng() * n)]!
      const cc = courseCodes[Math.floor(rng() * n)]!
      if (ca === cb || ca === cc || cb === cc) continue
      const sa = slotByCourse[ca]!
      const sb = slotByCourse[cb]!
      const sc = slotByCourse[cc]!
      if (sa === sb || sb === sc || sa === sc) continue

      // Check feasibility of the 3-way rotation.
      if (!feasibleCourseMove(ca, sb)) continue
      if (!feasibleCourseMove(cb, sc)) continue
      // For cc→sa, we need to check after applying the first two moves.
      // Use a lightweight feasibility check on the trial state.
      // Also respect Saturday math-only constraint for cc→sa.
      if (sa === 5 && !isMathCourse(cc)) continue
      const trial = { ...slotByCourse, [ca]: sb, [cb]: sc, [cc]: sa }
      if (!facultySlotsFeasible(sections, trial)) continue
      const trialLoads = slotLoadsFromBundleSlots(courseCodes, trial, sectionCountByCourse)
      let overCap = false
      for (let i = 0; i < trialLoads.length; i++) {
        if ((trialLoads[i] ?? 0) > parallelCap) { overCap = true; break }
      }
      if (overCap) continue

      // Compute delta by full recomputation (3-opt is rare enough).
      const trialSecSlots = sectionSlotsFromBundle(sections, trial)
      const newClash = computeClashWeight(conflictGraph, trialSecSlots)
      const newStudents = countStudentsWithSlotClashes(studentToSections, trialSecSlots, TOTAL_WEEKLY_SLOTS)
      const newParallel = parallelExcessPenalty(trialLoads)
      const trialDayTotals = buildDayTotals(trialLoads)
      const newDay = dayL1Penalty(trialDayTotals, idealPerDay)
      const dE = newClash - totalClash
      const dS = newStudents - studentClash
      const dP = newParallel - parallelPenalty
      const dDay = newDay - dayPenalty
      const tabuBlocked = isTabu(ca, sb, iter) || isTabu(cb, sc, iter) || isTabu(cc, sa, iter)
      if (!canAccept(dS, dE, dP, dDay, tabuBlocked)) continue

      // Apply the rotation.
      applyCourseMove(ca, sb)
      applyCourseMove(cb, sc)
      applyCourseMove(cc, sa)
      totalClash = newClash
      studentClash = newStudents
      parallelPenalty = newParallel
      dayPenalty = newDay
      registerTabu(ca, sa, iter, tenure)
      registerTabu(cb, sb, iter, tenure)
      registerTabu(cc, sc, iter, tenure)
      rebuildConflictCourses()
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
        // Conflict-directed perturbation: relocate 2–3 clashing courses to random feasible slots.
        if (conflictCourses.size > 0) {
          const perturbCount = Math.min(3, conflictCourses.size)
          const perturbArr = [...conflictCourses]
          for (let pi = 0; pi < perturbCount; pi++) {
            const pc = perturbArr[Math.floor(rng() * perturbArr.length)]!
            const newSlot = Math.floor(rng() * TOTAL_WEEKLY_SLOTS)
            if (feasibleCourseMove(pc, newSlot)) {
              applyCourseMove(pc, newSlot)
            }
          }
          // Recompute state after perturbation.
          const perturbSlotMap = sectionSlotsFromBundle(sections, slotByCourse)
          totalClash = computeClashWeight(conflictGraph, perturbSlotMap)
          studentClash = countStudentsWithSlotClashes(studentToSections, perturbSlotMap, TOTAL_WEEKLY_SLOTS)
          parallelPenalty = parallelExcessPenalty(slotLoads)
          dayPenalty = dayL1Penalty(dayTotals, idealPerDay)
          rebuildConflictCourses()
        }
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
  shouldAbort?: () => boolean,
  options?: { useDsatur?: boolean; effort?: EffortParams },
): { slotByCourse: Record<string, number>; clashWeight: number } {
  const effort = options?.effort ?? resolveEffort('balanced')
  const useDsatur = options?.useDsatur === true

  // Pre-build enrollment index for student-aware slot scoring.
  const greedyStudentToSections = new Map<string, string[]>()
  const greedySectionToStudents = new Map<string, string[]>()
  for (const sec of sections) {
    greedySectionToStudents.set(sec.section_id, sec.enrolled_students)
    for (const st of sec.enrolled_students) {
      if (!greedyStudentToSections.has(st)) greedyStudentToSections.set(st, [])
      greedyStudentToSections.get(st)!.push(sec.section_id)
    }
  }
  const sectionIdToCourseGreedy = new Map<string, string>()
  for (const sec of sections) sectionIdToCourseGreedy.set(sec.section_id, sec.course_code)



  // Pre-compute per-course enrollment for tiebreaking.
  const courseEnrollment = new Map<string, number>()
  for (const code of courseCodes) {
    let total = 0
    for (const sec of sections) {
      if (sec.course_code === code) total += sec.enrolled_students.length
    }
    courseEnrollment.set(code, total)
  }

  function staticPriority(code: string): number {
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

  const slotByCourse: Record<string, number> = {}
  const slotLoads = new Array(TOTAL_WEEKLY_SLOTS).fill(0)
  const idealPerDay = sections.length / WEEKDAY_COUNT
  const remaining = new Set(courseCodes)

  const FACULTY_VIOL = 1_000_000_000
  const CAP_HARD = 100_000_000

  /**
   * Fast student-clash delta estimate for greedy scoring.
   * Counts how many students of `code` already have another course assigned to `slot`.
   */
  function studentClashEstimate(code: string, slot: number): number {
    let clashes = 0
    for (const sec of sections) {
      if (sec.course_code !== code) continue
      for (const st of sec.enrolled_students) {
        const otherSecs = greedyStudentToSections.get(st)
        if (!otherSecs) continue
        for (const osid of otherSecs) {
          const oc = sectionIdToCourseGreedy.get(osid)
          if (!oc || oc === code) continue
          if (slotByCourse[oc] === slot) {
            clashes++
            // Count all overlaps (no break) to accurately reflect density
          }
        }
      }
    }
    return clashes
  }

  function scoreSlot(code: string, slot: number, k: number, faculties: string[]): number {
    let violation = 0
    if (slot === 5 && !isMathCourse(code)) {
      violation += CAP_HARD * 10
    }
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
    const adj = courseAdj.get(code)
    if (adj) {
      for (const [other, w] of adj) {
        if (slotByCourse[other] === slot) conflictCost += w
      }
    }
    // Direct student-clash estimate for all courses (accurate and fast enough in JS).
    const studentClashCost = studentClashEstimate(code, slot) * 50
    const totalAssigned = slotLoads.reduce((a: number, b: number) => a + b, 0)
    const targetLoad = TOTAL_WEEKLY_SLOTS ? totalAssigned / TOTAL_WEEKLY_SLOTS : 0
    const L = (slotLoads[slot] ?? 0) + k
    const parallelSoft = Math.max(0, L - TARGET_PARALLEL_SECTIONS) * PARALLEL_SOFT_WEIGHT
    const loadPenalty = Math.max(0, (slotLoads[slot] ?? 0) - targetLoad) * LOAD_BALANCE_FACTOR
    const trialLoads = [...slotLoads]
    trialLoads[slot] = (trialLoads[slot] ?? 0) + k
    const daySoft = dayL1PenaltyFromSlotLoads(trialLoads, idealPerDay) * 3
    let score = violation + conflictCost + studentClashCost + parallelSoft + loadPenalty + daySoft
    if (randomize) score += rng() * (conflictCost > 0 ? conflictCost * 0.4 + 3 : 3)
    return score
  }

  function pickNextCourse(): string {
    if (!useDsatur) {
      const sorted = [...remaining].sort((a, b) => staticPriority(b) - staticPriority(a))
      return sorted[0]!
    }
    // DSATUR: max saturation (distinct neighbor slots already used), then weighted degree,
    // then enrollment size as third-level tiebreaker — larger courses are harder to place later.
    let best: string | null = null
    let bestSat = -1
    let bestDeg = -1
    let bestEnroll = -1
    for (const code of remaining) {
      const used = new Set<number>()
      const adj = courseAdj.get(code)
      let deg = 0
      if (adj) {
        for (const [other, w] of adj) {
          deg += w
          if (slotByCourse[other] !== undefined) used.add(slotByCourse[other]!)
        }
      }
      const sat = used.size
      const enroll = courseEnrollment.get(code) ?? 0
      if (
        sat > bestSat ||
        (sat === bestSat && deg > bestDeg) ||
        (sat === bestSat && deg === bestDeg && enroll > bestEnroll)
      ) {
        bestSat = sat
        bestDeg = deg
        bestEnroll = enroll
        best = code
      }
    }
    return best ?? [...remaining][0]!
  }

  while (remaining.size > 0) {
    if (shouldAbort?.()) throw new PipelineCancelledError()
    const code = pickNextCourse()
    remaining.delete(code)
    const k = sectionCountByCourse.get(code) ?? 1
    const secs = sections.filter((s) => s.course_code === code)
    const faculties = secs.map((s) => s.faculty).filter(Boolean) as string[]

    let bestSlot = 0
    let bestScore = Number.POSITIVE_INFINITY
    for (let slot = 0; slot < TOTAL_WEEKLY_SLOTS; slot++) {
      const score = scoreSlot(code, slot, k, faculties)
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
    { shouldAbort, effort, enableKempe: false, deadlineMs: effort.perTaskMs },
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
        // Respect Saturday math-only constraint
        if (newSlot === 5 && !isMathCourse(code)) continue
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

export type SchedulerRunResult = {
  slot_assignments: Record<string, number>
  solver_used: string
  solver_time_seconds: number
  total_clash_weight: number
  feasible: boolean
  /** True when {@link feasible} and best solution has zero RED students and zero clash weight (heuristic certificate, not global optimality proof). */
  optimal: boolean
  hard_constraint_violations: string[]
}

export type SchedulerRunOptions = {
  randomSeed?: number
  shouldAbort?: () => boolean
  /** 1 = in-process sequential (tests). Omit to auto-detect in async path. */
  poolWorkers?: number
  /** Search effort dial. Default balanced. */
  effort?: EffortLevel
}

export type SeedRunResult = {
  seedIndex: number
  slotByCourse: Record<string, number>
  clashWeight: number
  students: number
}

/** One Phase-1 greedy+SA seed with independent RNG (`baseSeed + seedIndex`). */
export function runPhase1SeedTask(
  courseCodes: string[],
  sections: Section[],
  conflictGraph: ConflictGraph,
  courseAdj: Map<string, Map<string, number>>,
  sectionCountByCourse: Map<string, number>,
  conflictDensity: Record<string, number>,
  parallelCap: number,
  seedIndex: number,
  baseSeed: number | undefined,
  shouldAbort?: () => boolean,
  effortLevel: EffortLevel = 'balanced',
): SeedRunResult {
  const effort = resolveEffort(effortLevel)
  const rng = createRng(baseSeed === undefined ? undefined : (baseSeed + seedIndex) >>> 0)
  const r = solveGreedySeed(
    courseCodes,
    sections,
    conflictGraph,
    courseAdj,
    sectionCountByCourse,
    conflictDensity,
    parallelCap,
    seedIndex > 0,
    rng,
    shouldAbort,
    // Use DSATUR on 60% of seeds (first 60%); random-priority on the rest.
    // DSATUR produces tighter initial colorings for dense conflict graphs.
    { useDsatur: seedIndex === 0 || rng() < 0.6, effort },
  )
  const { studentToSections } = buildEnrollmentIndex(sections)
  const slotMap = sectionSlotsFromBundle(sections, r.slotByCourse)
  const students = countStudentsWithSlotClashes(studentToSections, slotMap, TOTAL_WEEKLY_SLOTS)
  return {
    seedIndex,
    slotByCourse: { ...r.slotByCourse },
    clashWeight: r.clashWeight,
    students,
  }
}

/** One Phase-2 Tabu/SA refine with independent RNG (`baseSeed + 10000 + refineIndex`). */
export function runPhase2RefineTask(
  initialSlotByCourse: Record<string, number>,
  courseCodes: string[],
  sections: Section[],
  conflictGraph: ConflictGraph,
  courseAdj: Map<string, Map<string, number>>,
  sectionCountByCourse: Map<string, number>,
  parallelCap: number,
  refineIndex: number,
  baseSeed: number | undefined,
  maxIterFactor: number,
  shouldAbort?: () => boolean,
  effortLevel: EffortLevel = 'balanced',
): SeedRunResult {
  const effort = resolveEffort(effortLevel)
  const rng = createRng(baseSeed === undefined ? undefined : (baseSeed + 10_000 + refineIndex) >>> 0)
  const refined = hybridSATabuImprove(
    { ...initialSlotByCourse },
    courseCodes,
    sections,
    conflictGraph,
    courseAdj,
    sectionCountByCourse,
    parallelCap,
    {
      maxIterFactor,
      shouldAbort,
      effort,
      enableKempe: true,
      deadlineMs: effort.perTaskMs,
    },
    rng,
  )
  const { studentToSections } = buildEnrollmentIndex(sections)
  const slotMap = sectionSlotsFromBundle(sections, refined)
  const clashWeight = computeClashWeight(conflictGraph, slotMap)
  const students = countStudentsWithSlotClashes(studentToSections, slotMap, TOTAL_WEEKLY_SLOTS)
  return {
    seedIndex: refineIndex,
    slotByCourse: refined,
    clashWeight,
    students,
  }
}

/** Perturb elite solution for restart diversification. */
export function perturbEliteSlots(
  slotByCourse: Record<string, number>,
  courseCodes: string[],
  conflictGraph: ConflictGraph,
  courseAdj: Map<string, Map<string, number>>,
  sectionToCourse: Map<string, string>,
  rng: Rng,
  kicks = 6,
  partnerSlotByCourse?: Record<string, number>,
): Record<string, number> {
  const next = { ...slotByCourse }
  const conflict: string[] = []
  for (const e of conflictGraph.edges) {
    const ca = sectionToCourse.get(e.section_a)
    const cb = sectionToCourse.get(e.section_b)
    if (!ca || !cb || ca === cb) continue
    if ((next[ca] ?? -1) === (next[cb] ?? -2)) {
      conflict.push(ca, cb)
    }
  }

  // Cross-elite recombination: courses with conflicts take their slot from the partner.
  if (partnerSlotByCourse) {
    const conflictSet = new Set(conflict)
    for (const c of conflictSet) {
      if (partnerSlotByCourse[c] !== undefined) {
        const partnerSlot = partnerSlotByCourse[c]!
        // Don't place non-math courses on Saturday via recombination
        if (partnerSlot === 5 && !isMathCourse(c)) continue
        next[c] = partnerSlot
      }
    }
  }

  const pool = conflict.length > 0 ? conflict : courseCodes
  for (let i = 0; i < kicks; i++) {
    const c = pool[Math.floor(rng() * pool.length)]!
    // Non-math courses can only go to Mon–Fri (slots 0–4)
    const slotRange = isMathCourse(c) ? TOTAL_WEEKLY_SLOTS : TOTAL_WEEKLY_SLOTS - 1
    next[c] = Math.floor(rng() * slotRange)
  }
  void courseAdj
  return next
}

/** Stable reduce: sort by (students, clashWeight), ties broken by lower seedIndex. */
export function reduceSeedRuns(runs: SeedRunResult[]): SeedRunResult[] {
  return [...runs].sort(
    (a, b) =>
      a.students - b.students || a.clashWeight - b.clashWeight || a.seedIndex - b.seedIndex,
  )
}

/** Faculty repair + hard-constraint audit after search (coordinator thread). */
export function finalizeSchedulerBest(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  bestIn: { slotByCourse: Record<string, number>; clashWeight: number; students: number },
  options?: {
    randomSeed?: number
    onProgress?: (evt: SchedulerProgressEvent) => void
    solverUsed?: string
    elapsedAlreadySeconds?: number
  },
): SchedulerRunResult {
  const t0 = performance.now() / 1000 - (options?.elapsedAlreadySeconds ?? 0)
  const sections = Object.values(courseSections).flat()
  const courseCodes = Object.keys(courseSections)
  const sectionCountByCourse = new Map<string, number>()
  for (const c of courseCodes) {
    sectionCountByCourse.set(c, courseSections[c]!.length)
  }
  const parallelCap = parallelHardCap(sections.length)
  const repairRng = createRng(
    options?.randomSeed === undefined ? undefined : (options.randomSeed + 50_000) >>> 0,
  )
  const push = (evt: SchedulerProgressEvent) => options?.onProgress?.(evt)

  let best = { ...bestIn }

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
      repairRng,
      800,
    )
    if (fixed) {
      const { studentToSections } = buildEnrollmentIndex(sections)
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
    solver_used: options?.solverUsed ?? 'weekday-sa-tabu',
    solver_time_seconds: performance.now() / 1000 - t0,
    total_clash_weight: best.clashWeight,
    feasible: audit.feasible,
    optimal: audit.feasible && primarySatisfied,
    hard_constraint_violations: audit.violations,
  }
}

export function runScheduler(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  onProgress?: (evt: SchedulerProgressEvent) => void,
  options?: SchedulerRunOptions,
): SchedulerRunResult {
  const poolWorkers = options?.poolWorkers ?? 1
  return runSchedulerInProcess(
    courseSections,
    conflictGraph,
    facultyConstraints,
    onProgress,
    { ...options, poolWorkers },
  )
}

function runSchedulerInProcess(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  onProgress: ((evt: SchedulerProgressEvent) => void) | undefined,
  options: SchedulerRunOptions & { poolWorkers: number },
): SchedulerRunResult {
  const effort = resolveEffort(options.effort)
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
  const { conflictDensity } = buildAdjacency(conflictGraph)
  const parallelCap = parallelHardCap(sections.length)
  const runCount = multiStartRunCount(courseCodes.length, options.poolWorkers, effort)
  const poolSize = solutionPoolSize(runCount, effort)
  const maxIterFactor = effort.phase2IterFactor
  const shouldAbort = options.shouldAbort
  const baseSeed = options.randomSeed
  const overallDeadlineMs =
    effort.perTaskMs * Math.max(8, runCount) * effort.overallDeadlineMul * 0.15

  const push = (evt: SchedulerProgressEvent) => onProgress?.(evt)
  const tPhase1 = performance.now()

  push({
    message: `Phase 1/2: ${runCount} seeds (${effort.effort}) × ${options.poolWorkers} worker(s) · ${TOTAL_WEEKLY_SLOTS} weekday sessions/week`,
    etaSeconds: null,
    solverFraction: 0,
  })

  const progressStep = Math.max(1, Math.floor(runCount / 10))
  const seedResults: SeedRunResult[] = []
  for (let i = 0; i < runCount; i++) {
    if (shouldAbort?.()) throw new PipelineCancelledError()
    if (performance.now() - tPhase1 > overallDeadlineMs) break
    const r = runPhase1SeedTask(
      courseCodes,
      sections,
      conflictGraph,
      courseAdj,
      sectionCountByCourse,
      conflictDensity,
      parallelCap,
      i,
      baseSeed,
      shouldAbort,
      effort.effort,
    )
    seedResults.push(r)

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
        solverFraction: 0.5 * (done / Math.max(1, runCount)),
      })
    }
  }

  const ranked = reduceSeedRuns(seedResults)
  let best = ranked[0] ?? {
    seedIndex: 0,
    slotByCourse: {},
    clashWeight: 0,
    students: 0,
  }

  const pool = Math.min(poolSize, ranked.length)
  const refinementSteps = Math.max(1, pool - 1)

  if (pool <= 1) {
    push({
      message: `Phase 2/2 skipped (single seed). Best: ${best.students} overlaps · weight ${best.clashWeight}.`,
      etaSeconds: null,
      solverFraction: 0.85,
    })
  } else {
    push({
      message: `Phase 2/2: refine top ${pool} (factor ${maxIterFactor}; best ${best.students} overlaps · weight ${best.clashWeight})`,
      etaSeconds: null,
      solverFraction: 0.55,
    })

    const tPhase2 = performance.now()
    for (let p = 1; p < pool; p++) {
      if (shouldAbort?.()) throw new PipelineCancelledError()
      const seed = ranked[p]
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
        solverFraction: 0.55 + 0.25 * (p / refinementSteps),
      })
      const refined = runPhase2RefineTask(
        seed.slotByCourse,
        courseCodes,
        sections,
        conflictGraph,
        courseAdj,
        sectionCountByCourse,
        parallelCap,
        p,
        baseSeed,
        maxIterFactor,
        shouldAbort,
        effort.effort,
      )
      if (
        refined.students < best.students ||
        (refined.students === best.students && refined.clashWeight < best.clashWeight)
      ) {
        best = refined
      }
    }
  }

  // Elite restart diversification (balanced/max).
  if (effort.eliteRestartRounds > 0 && best.students > 0) {
    const elites = ranked.slice(0, Math.min(6, ranked.length))
    let stagnant = 0
    for (let round = 0; round < effort.eliteRestartRounds; round++) {
      if (shouldAbort?.()) throw new PipelineCancelledError()
      if (performance.now() / 1000 - t0 > overallDeadlineMs / 1000) break
      if (best.students === 0 && best.clashWeight === 0) break

      push({
        message: `Elite restart ${round + 1}/${effort.eliteRestartRounds} (best ${best.students} RED · weight ${best.clashWeight})`,
        etaSeconds: null,
        solverFraction: 0.82 + 0.08 * (round / effort.eliteRestartRounds),
      })

      let improved = false
      for (let ei = 0; ei < elites.length; ei++) {
        const elite = elites[ei]!
        const perturbRng = createRng(
          baseSeed === undefined ? undefined : (baseSeed + 20_000 + round * 100 + ei) >>> 0,
        )
        const partnerElite = elites[Math.floor(perturbRng() * elites.length)]!
        const kicked = perturbEliteSlots(
          elite.slotByCourse,
          courseCodes,
          conflictGraph,
          courseAdj,
          sectionToCourse,
          perturbRng,
          Math.floor(3 + 3 * Math.log2(round + 1)), // graduated kick strength
          partnerElite.slotByCourse,
        )
        const refined = runPhase2RefineTask(
          kicked,
          courseCodes,
          sections,
          conflictGraph,
          courseAdj,
          sectionCountByCourse,
          parallelCap,
          1000 + round * 50 + ei,
          baseSeed,
          maxIterFactor * 1.1,
          shouldAbort,
          effort.effort,
        )
        if (
          refined.students < best.students ||
          (refined.students === best.students && refined.clashWeight < best.clashWeight)
        ) {
          best = refined
          improved = true
        }
      }
      if (!improved) {
        stagnant++
        if (stagnant >= effort.eliteStagnationStop) break
      } else {
        stagnant = 0
      }
    }
  }

  return finalizeSchedulerBest(
    courseSections,
    conflictGraph,
    facultyConstraints,
    best,
    {
      randomSeed: baseSeed,
      onProgress,
      solverUsed:
        options.poolWorkers > 1
          ? `weekday-sa-tabu-pool-${effort.effort}`
          : `weekday-sa-tabu-${effort.effort}`,
      elapsedAlreadySeconds: performance.now() / 1000 - t0,
    },
  )
}

/** Async multi-worker solve; falls back to in-process when poolWorkers===1 or Workers unavailable. */
export async function runSchedulerAsync(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  onProgress?: (evt: SchedulerProgressEvent) => void,
  options?: SchedulerRunOptions,
): Promise<SchedulerRunResult> {
  const { resolvePoolWorkerCount } = await import('../worker/solverPoolTypes')
  const poolWorkers = options?.poolWorkers ?? resolvePoolWorkerCount()
  if (poolWorkers <= 1) {
    return runSchedulerInProcess(courseSections, conflictGraph, facultyConstraints, onProgress, {
      ...options,
      poolWorkers: 1,
    })
  }

  try {
    const { runSchedulerWithPool } = await import('../worker/solverPool')
    return await runSchedulerWithPool(
      courseSections,
      conflictGraph,
      facultyConstraints,
      onProgress,
      { ...options, poolWorkers },
    )
  } catch (e) {
    console.warn('Solver pool unavailable; falling back to in-process', e)
    return runSchedulerInProcess(courseSections, conflictGraph, facultyConstraints, onProgress, {
      ...options,
      poolWorkers: 1,
    })
  }
}

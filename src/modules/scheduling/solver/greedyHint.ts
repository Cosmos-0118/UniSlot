/**
 * Fast course→weekday warm start for CP-SAT (DSATUR seed + light SA polish).
 * Clash/RED scoring is incremental: a move only touches incident edges and enrolled students.
 */
import type { ConflictGraph, Section, Student } from '../types'
import {
  aggregateCourseConflictEdges,
} from './cpsatInstance'
import { maxSlotIndexForCourse, normalizeSaturdayExtraCodes } from './timeModel'

export type GreedyHintResult = {
  hint: Record<string, number>
  clash_weight: number
  red_students: number
  timings?: { dsat_seconds: number; polish_seconds: number }
}

type HintInput = {
  courseSections: Record<string, Section[]>
  conflictGraph: ConflictGraph
  facultyConstraints: Record<string, string[]>
  students: Record<string, Student>
  /** SA polish iterations (default 4000). */
  polishIters?: number
  seed?: number
  /** Default true. Pass false to exclude Saturday for maths. */
  allowSaturdayForMath?: boolean
  /** Extra course codes independently allowed on Saturday. */
  saturdayExtraCourseCodes?: string[]
}

const WEEKDAY_BINS = 6

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function maxDayFor(
  code: string,
  allowSaturdayForMath: boolean,
  extras: readonly string[],
): number {
  return maxSlotIndexForCourse(code, allowSaturdayForMath, extras)
}

function buildFacultyForbidden(
  facultyConstraints: Record<string, string[]>,
  sectionToCourse: Map<string, string>,
): Map<string, Set<string>> {
  /** course → set of courses that cannot share a weekday (same faculty). */
  const forbid = new Map<string, Set<string>>()
  const touch = (a: string, b: string) => {
    if (a === b) return
    if (!forbid.has(a)) forbid.set(a, new Set())
    if (!forbid.has(b)) forbid.set(b, new Set())
    forbid.get(a)!.add(b)
    forbid.get(b)!.add(a)
  }
  for (const sectionIds of Object.values(facultyConstraints)) {
    const codes = [
      ...new Set(
        sectionIds
          .map((sid) => sectionToCourse.get(sid))
          .filter((c): c is string => Boolean(c)),
      ),
    ]
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        touch(codes[i]!, codes[j]!)
      }
    }
  }
  return forbid
}

type Incident = { other: string; weight: number }

class IncrementalColoring {
  readonly dayOf: Record<string, number> = {}
  clash = 0
  red = 0
  private readonly incident: Map<string, Incident[]>
  private readonly studentsOf: Map<string, string[]>
  private readonly studentDayCount = new Map<string, number[]>()
  private readonly studentRed = new Map<string, boolean>()

  constructor(incident: Map<string, Incident[]>, studentsOf: Map<string, string[]>, studentIds: string[]) {
    this.incident = incident
    this.studentsOf = studentsOf
    for (const sid of studentIds) {
      this.studentDayCount.set(sid, new Array(WEEKDAY_BINS).fill(0))
      this.studentRed.set(sid, false)
    }
  }

  isAssigned(code: string): boolean {
    return this.dayOf[code] !== undefined
  }

  /**
   * Clash/RED change if `code` is placed on `newDay`.
   * Only already-assigned neighbors count (partial DSATUR must not treat
   * undefined === undefined as a clash).
   */
  deltaIfSet(code: string, newDay: number): { clash: number; red: number } {
    const old = this.dayOf[code]
    let clash = 0
    for (const { other, weight } of this.incident.get(code) ?? []) {
      const od = this.dayOf[other]
      if (od === undefined) continue
      if (old !== undefined && od === old) clash -= weight
      if (od === newDay) clash += weight
    }

    let red = 0
    for (const sid of this.studentsOf.get(code) ?? []) {
      const counts = this.studentDayCount.get(sid)
      if (!counts) continue
      const wasRed = this.studentRed.get(sid) === true
      if (old !== undefined) counts[old] = (counts[old] ?? 0) - 1
      counts[newDay] = (counts[newDay] ?? 0) + 1
      const nowRed = studentHasClash(counts)
      if (old !== undefined) {
        counts[newDay]!--
        counts[old] = (counts[old] ?? 0) + 1
      } else {
        counts[newDay]!--
      }
      if (nowRed && !wasRed) red++
      else if (!nowRed && wasRed) red--
    }
    return { clash, red }
  }

  assign(code: string, newDay: number): void {
    const old = this.dayOf[code]
    if (old === newDay) return
    const d = this.deltaIfSet(code, newDay)
    this.clash += d.clash
    this.red += d.red
    for (const sid of this.studentsOf.get(code) ?? []) {
      const counts = this.studentDayCount.get(sid)
      if (!counts) continue
      if (old !== undefined) counts[old] = (counts[old] ?? 0) - 1
      counts[newDay] = (counts[newDay] ?? 0) + 1
      this.studentRed.set(sid, studentHasClash(counts))
    }
    this.dayOf[code] = newDay
  }

  swap(c1: string, c2: string): void {
    const d1 = this.dayOf[c1]
    const d2 = this.dayOf[c2]
    if (d1 === undefined || d2 === undefined || d1 === d2) return
    this.assign(c1, d2)
    this.assign(c2, d1)
  }

  cloneDays(): Record<string, number> {
    return { ...this.dayOf }
  }
}

function studentHasClash(counts: number[]): boolean {
  for (const n of counts) {
    if (n >= 2) return true
  }
  return false
}

function isFacultyOk(
  code: string,
  day: number,
  dayOf: Record<string, number>,
  forbid: Map<string, Set<string>>,
): boolean {
  for (const other of forbid.get(code) ?? []) {
    if (dayOf[other] === day) return false
  }
  return true
}

function dsatSaturation(
  code: string,
  dayOf: Record<string, number>,
  adj: Map<string, Set<string>>,
): number {
  const used = new Set<number>()
  for (const n of adj.get(code) ?? []) {
    if (dayOf[n] != null) used.add(dayOf[n]!)
  }
  return used.size
}

function weightedDegree(code: string, edgeWeight: Map<string, number>, adj: Map<string, Set<string>>): number {
  let w = 0
  for (const n of adj.get(code) ?? []) {
    w += edgeWeight.get(pairKey(code, n)) ?? 0
  }
  return w
}

/** DSATUR greedy coloring, then light SA polish minimizing RED then clash weight. */
export function buildGreedyHint(input: HintInput): GreedyHintResult {
  const {
    courseSections,
    conflictGraph,
    facultyConstraints,
    students,
    polishIters = 4000,
    seed = 42,
    allowSaturdayForMath = true,
    saturdayExtraCourseCodes,
  } = input
  const saturdayExtras = normalizeSaturdayExtraCodes(saturdayExtraCourseCodes)

  const sectionToCourse = new Map<string, string>()
  const enrollment = new Map<string, number>()
  const codes: string[] = []
  const studentsOf = new Map<string, string[]>()
  for (const [code, sections] of Object.entries(courseSections)) {
    codes.push(code)
    let en = 0
    const enrolled: string[] = []
    for (const s of sections) {
      sectionToCourse.set(s.section_id, code)
      en += s.enrolled_students.length
      enrolled.push(...s.enrolled_students)
    }
    enrollment.set(code, en)
    studentsOf.set(code, enrolled)
  }
  codes.sort((a, b) => a.localeCompare(b))

  const edges = aggregateCourseConflictEdges(conflictGraph, sectionToCourse)
  const edgeWeight = new Map<string, number>()
  const adj = new Map<string, Set<string>>()
  const incident = new Map<string, Incident[]>()
  for (const c of codes) {
    adj.set(c, new Set())
    incident.set(c, [])
  }
  for (const e of edges) {
    edgeWeight.set(pairKey(e.course_a, e.course_b), e.weight)
    adj.get(e.course_a)?.add(e.course_b)
    adj.get(e.course_b)?.add(e.course_a)
    incident.get(e.course_a)?.push({ other: e.course_b, weight: e.weight })
    incident.get(e.course_b)?.push({ other: e.course_a, weight: e.weight })
  }

  const forbid = buildFacultyForbidden(facultyConstraints, sectionToCourse)
  const studentIds = new Set(Object.keys(students))
  for (const ids of studentsOf.values()) {
    for (const id of ids) studentIds.add(id)
  }

  const coloring = new IncrementalColoring(incident, studentsOf, [...studentIds])
  const remaining = new Set(codes)

  const dsatT0 = performance.now()
  while (remaining.size) {
    let best: string | null = null
    let bestKey: [number, number, number] | null = null
    for (const code of remaining) {
      const sat = dsatSaturation(code, coloring.dayOf, adj)
      const deg = weightedDegree(code, edgeWeight, adj)
      const en = enrollment.get(code) ?? 0
      const key: [number, number, number] = [sat, deg, en]
      if (
        !best ||
        key[0] > bestKey![0] ||
        (key[0] === bestKey![0] && key[1] > bestKey![1]) ||
        (key[0] === bestKey![0] && key[1] === bestKey![1] && key[2] > bestKey![2])
      ) {
        best = code
        bestKey = key
      }
    }
    const code = best!
    remaining.delete(code)

    const maxD = maxDayFor(code, allowSaturdayForMath, saturdayExtras)
    let pick = 0
    let pickClash = Number.POSITIVE_INFINITY
    let pickRed = Number.POSITIVE_INFINITY
    let foundFacultyOk = false
    for (let d = 0; d <= maxD; d++) {
      if (!isFacultyOk(code, d, coloring.dayOf, forbid)) continue
      foundFacultyOk = true
      const delta = coloring.deltaIfSet(code, d)
      const clash = coloring.clash + delta.clash
      const red = coloring.red + delta.red
      if (red < pickRed || (red === pickRed && clash < pickClash)) {
        pick = d
        pickClash = clash
        pickRed = red
      }
    }
    if (!foundFacultyOk) {
      for (let d = 0; d <= maxD; d++) {
        if (isFacultyOk(code, d, coloring.dayOf, forbid)) {
          pick = d
          break
        }
      }
    }
    coloring.assign(code, pick)
  }
  const dsatSeconds = (performance.now() - dsatT0) / 1000

  const rand = mulberry32(seed)
  let curClash = coloring.clash
  let curRed = coloring.red
  let bestClash = curClash
  let bestRed = curRed
  const bestDay = coloring.cloneDays()
  let temp = Math.max(1, curRed * 0.15)

  const polishT0 = performance.now()
  for (let it = 0; it < polishIters; it++) {
    const useSwap = rand() < 0.35 && codes.length >= 2
    const c1 = codes[Math.floor(rand() * codes.length)]!
    const old1 = coloring.dayOf[c1]!

    if (useSwap) {
      const c2 = codes[Math.floor(rand() * codes.length)]!
      if (c2 === c1) continue
      const old2 = coloring.dayOf[c2]!
      if (
        old2 > maxDayFor(c1, allowSaturdayForMath, saturdayExtras) ||
        old1 > maxDayFor(c2, allowSaturdayForMath, saturdayExtras)
      )
        continue
      coloring.swap(c1, c2)
      if (
        !isFacultyOk(c1, coloring.dayOf[c1]!, coloring.dayOf, forbid) ||
        !isFacultyOk(c2, coloring.dayOf[c2]!, coloring.dayOf, forbid)
      ) {
        coloring.assign(c1, old1)
        coloring.assign(c2, old2)
        continue
      }
      const clash = coloring.clash
      const red = coloring.red
      const better = red < curRed || (red === curRed && clash < curClash)
      const delta = red !== curRed ? red - curRed : clash - curClash
      const accept = better || (delta > 0 && rand() < Math.exp(-delta / Math.max(0.01, temp)))
      if (accept) {
        curClash = clash
        curRed = red
        if (red < bestRed || (red === bestRed && clash < bestClash)) {
          bestClash = clash
          bestRed = red
          Object.assign(bestDay, coloring.dayOf)
        }
      } else {
        coloring.assign(c1, old1)
        coloring.assign(c2, old2)
      }
    } else {
      const maxD = maxDayFor(c1, allowSaturdayForMath, saturdayExtras)
      const nd = Math.floor(rand() * (maxD + 1))
      if (nd === old1) continue
      if (!isFacultyOk(c1, nd, coloring.dayOf, forbid)) continue
      const delta = coloring.deltaIfSet(c1, nd)
      const clash = coloring.clash + delta.clash
      const red = coloring.red + delta.red
      const better = red < curRed || (red === curRed && clash < curClash)
      const scoreDelta = red !== curRed ? red - curRed : clash - curClash
      const accept = better || (scoreDelta > 0 && rand() < Math.exp(-scoreDelta / Math.max(0.01, temp)))
      if (accept) {
        coloring.assign(c1, nd)
        curClash = coloring.clash
        curRed = coloring.red
        if (red < bestRed || (red === bestRed && clash < bestClash)) {
          bestClash = clash
          bestRed = red
          Object.assign(bestDay, coloring.dayOf)
        }
      }
    }

    temp *= 0.9992
  }
  const polishSeconds = (performance.now() - polishT0) / 1000

  return {
    hint: bestDay,
    clash_weight: bestClash,
    red_students: bestRed,
    timings: { dsat_seconds: dsatSeconds, polish_seconds: polishSeconds },
  }
}

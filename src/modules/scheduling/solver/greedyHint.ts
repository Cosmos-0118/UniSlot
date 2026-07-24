/**
 * Fast course→weekday warm start for CP-SAT (DSATUR seed + light SA polish).
 * Does not restore the old browser local-search stack — coloring only.
 */
import type { ConflictGraph, Section, Student } from '../types'
import {
  aggregateCourseConflictEdges,
  type CpsatConflictEdge,
} from './cpsatInstance'
import { isMathCourse, NON_MATH_WEEKDAY_COUNT, TOTAL_WEEKLY_SLOTS } from './timeModel'

export type GreedyHintResult = {
  hint: Record<string, number>
  clash_weight: number
  red_students: number
}

type HintInput = {
  courseSections: Record<string, Section[]>
  conflictGraph: ConflictGraph
  facultyConstraints: Record<string, string[]>
  students: Record<string, Student>
  /** SA polish iterations (default 4000). */
  polishIters?: number
  seed?: number
}

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

function maxDayFor(code: string): number {
  return isMathCourse(code) ? TOTAL_WEEKLY_SLOTS - 1 : NON_MATH_WEEKDAY_COUNT - 1
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

function scoreClash(
  dayOf: Record<string, number>,
  edges: CpsatConflictEdge[],
): number {
  let w = 0
  for (const e of edges) {
    if (dayOf[e.course_a] === dayOf[e.course_b]) w += e.weight
  }
  return w
}

function scoreRed(
  dayOf: Record<string, number>,
  studentCourses: string[][],
): number {
  let red = 0
  for (const courses of studentCourses) {
    let hit = false
    for (let i = 0; i < courses.length && !hit; i++) {
      for (let j = i + 1; j < courses.length; j++) {
        if (dayOf[courses[i]!] === dayOf[courses[j]!]) {
          hit = true
          break
        }
      }
    }
    if (hit) red++
  }
  return red
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

/** DSATUR greedy coloring, then light SA polish minimizing clash then RED. */
export function buildGreedyHint(input: HintInput): GreedyHintResult {
  const {
    courseSections,
    conflictGraph,
    facultyConstraints,
    students,
    polishIters = 4000,
    seed = 42,
  } = input

  const sectionToCourse = new Map<string, string>()
  const enrollment = new Map<string, number>()
  const codes: string[] = []
  for (const [code, sections] of Object.entries(courseSections)) {
    codes.push(code)
    let en = 0
    for (const s of sections) {
      sectionToCourse.set(s.section_id, code)
      en += s.enrolled_students.length
    }
    enrollment.set(code, en)
  }
  codes.sort((a, b) => a.localeCompare(b))

  const edges = aggregateCourseConflictEdges(conflictGraph, sectionToCourse)
  const edgeWeight = new Map<string, number>()
  const adj = new Map<string, Set<string>>()
  for (const c of codes) adj.set(c, new Set())
  for (const e of edges) {
    edgeWeight.set(pairKey(e.course_a, e.course_b), e.weight)
    adj.get(e.course_a)?.add(e.course_b)
    adj.get(e.course_b)?.add(e.course_a)
  }

  const forbid = buildFacultyForbidden(facultyConstraints, sectionToCourse)
  const studentCourses: string[][] = []
  for (const st of Object.values(students)) {
    const enrolled = (st.enrolled_courses ?? []).filter((c) => c in courseSections)
    const uniq = [...new Set(enrolled)]
    if (uniq.length >= 2) studentCourses.push(uniq)
  }

  const dayOf: Record<string, number> = {}
  const remaining = new Set(codes)

  while (remaining.size) {
    let best: string | null = null
    let bestKey: [number, number, number] | null = null
    for (const code of remaining) {
      const sat = dsatSaturation(code, dayOf, adj)
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

    const maxD = maxDayFor(code)
    let pick = 0
    let pickClash = Number.POSITIVE_INFINITY
    let pickRed = Number.POSITIVE_INFINITY
    for (let d = 0; d <= maxD; d++) {
      if (!isFacultyOk(code, d, dayOf, forbid)) continue
      dayOf[code] = d
      const clash = scoreClash(dayOf, edges)
      const red = scoreRed(dayOf, studentCourses)
      delete dayOf[code]
      if (clash < pickClash || (clash === pickClash && red < pickRed)) {
        pick = d
        pickClash = clash
        pickRed = red
      }
    }
    // If every day violates faculty (shouldn't happen for valid data), fall back to 0.
    if (!isFacultyOk(code, pick, dayOf, forbid)) {
      for (let d = 0; d <= maxD; d++) {
        if (isFacultyOk(code, d, dayOf, forbid)) {
          pick = d
          break
        }
      }
    }
    dayOf[code] = pick
  }

  // Light SA polish: random move / swap, accept improving or Metropolis on clash.
  const rand = mulberry32(seed)
  let curClash = scoreClash(dayOf, edges)
  let curRed = scoreRed(dayOf, studentCourses)
  let bestClash = curClash
  let bestRed = curRed
  const bestDay = { ...dayOf }
  let temp = Math.max(1, curClash * 0.15)

  for (let it = 0; it < polishIters; it++) {
    const useSwap = rand() < 0.35 && codes.length >= 2
    let c1 = codes[Math.floor(rand() * codes.length)]!
    let c2: string | null = null
    let old1 = dayOf[c1]!
    let old2 = 0

    if (useSwap) {
      c2 = codes[Math.floor(rand() * codes.length)]!
      if (c2 === c1) continue
      old2 = dayOf[c2]!
      // Try swap if domains allow.
      if (old2 > maxDayFor(c1) || old1 > maxDayFor(c2)) continue
      dayOf[c1] = old2
      dayOf[c2] = old1
      if (!isFacultyOk(c1, dayOf[c1]!, dayOf, forbid) || !isFacultyOk(c2, dayOf[c2]!, dayOf, forbid)) {
        dayOf[c1] = old1
        dayOf[c2] = old2
        continue
      }
    } else {
      const maxD = maxDayFor(c1)
      const nd = Math.floor(rand() * (maxD + 1))
      if (nd === old1) continue
      dayOf[c1] = nd
      if (!isFacultyOk(c1, nd, dayOf, forbid)) {
        dayOf[c1] = old1
        continue
      }
    }

    const clash = scoreClash(dayOf, edges)
    const red = scoreRed(dayOf, studentCourses)
    const better =
      clash < curClash || (clash === curClash && red < curRed)
    const delta = clash - curClash
    const accept =
      better || (delta > 0 && rand() < Math.exp(-delta / Math.max(0.01, temp)))

    if (accept) {
      curClash = clash
      curRed = red
      if (clash < bestClash || (clash === bestClash && red < bestRed)) {
        bestClash = clash
        bestRed = red
        Object.assign(bestDay, dayOf)
      }
    } else if (useSwap && c2) {
      dayOf[c1] = old1
      dayOf[c2] = old2
    } else {
      dayOf[c1] = old1
    }

    temp *= 0.9992
  }

  return {
    hint: bestDay,
    clash_weight: bestClash,
    red_students: bestRed,
  }
}

import type { ConflictGraph, Section, Student } from '../types'
import {
  NON_MATH_WEEKDAY_COUNT,
  TOTAL_WEEKLY_SLOTS,
  isMathCourse,
} from './timeModel'

export type SchedulingLowerBounds = {
  /** Largest clique found in the course conflict graph (heuristic + local exact). */
  max_clique_size: number
  /** Colors available for a perfect clash-free coloring (6 weekdays). */
  available_colors: number
  /** True when clique size or student pigeonhole proves zero clash weight is impossible. */
  zero_clash_structurally_impossible: boolean
  /** True when at least one student must be RED by day/domain pigeonhole. */
  zero_red_structurally_impossible: boolean
  /** Lower bound on monochromatic conflict pairs from clique vs colors (weight ≥ this if edges ≥ 1). */
  min_clash_weight_lower_bound: number
  /** Students who must clash given enrollment + Saturday maths-only. */
  min_red_students_lower_bound: number
  notes: string[]
}

/** Balanced pigeonhole: min Σ C(size_c, 2) when placing n clique vertices into k colors. */
export function minMonochromePairs(n: number, k: number): number {
  if (n <= 0 || k <= 0 || n <= k) return 0
  const base = Math.floor(n / k)
  const rem = n % k
  const large = base + 1
  return rem * ((large * (large - 1)) / 2) + (k - rem) * ((base * (base - 1)) / 2)
}

function buildCourseConflictAdj(
  conflictGraph: ConflictGraph,
  sectionToCourse: Map<string, string>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  const touch = (a: string, b: string) => {
    if (a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }
  for (const e of conflictGraph.edges) {
    const ca = sectionToCourse.get(e.section_a)
    const cb = sectionToCourse.get(e.section_b)
    if (!ca || !cb || ca === cb) continue
    touch(ca, cb)
  }
  return adj
}

/** Greedy clique: start from each high-degree vertex, grow by densest candidate. */
function greedyMaxClique(adj: Map<string, Set<string>>, starts = 48): number {
  const nodes = [...adj.keys()].sort((a, b) => (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0))
  if (!nodes.length) return 0
  let best = 1
  const limit = Math.min(starts, nodes.length)
  for (let i = 0; i < limit; i++) {
    const start = nodes[i]!
    const clique = [start]
    let candidates = [...(adj.get(start) ?? [])]
    while (candidates.length) {
      candidates.sort((a, b) => {
        const da = candidates.filter((c) => adj.get(a)?.has(c)).length
        const db = candidates.filter((c) => adj.get(b)?.has(c)).length
        return db - da || (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0)
      })
      const pick = candidates[0]!
      clique.push(pick)
      candidates = candidates.filter((c) => c !== pick && adj.get(pick)?.has(c))
    }
    if (clique.length > best) best = clique.length
  }
  return best
}

/**
 * Bron–Kerbosch with pivoting on a degree-filtered subgraph (exact on the induced set).
 * Caps node count so browser solve stays snappy.
 */
function exactMaxCliqueOnCore(adj: Map<string, Set<string>>, maxNodes = 64): number {
  const ranked = [...adj.keys()].sort((a, b) => (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0))
  const core = ranked.slice(0, Math.min(maxNodes, ranked.length))
  const coreSet = new Set(core)
  const local = new Map<string, Set<string>>()
  for (const v of core) {
    local.set(v, new Set([...(adj.get(v) ?? [])].filter((u) => coreSet.has(u))))
  }

  let best = 0
  function bk(r: string[], p: Set<string>, x: Set<string>): void {
    if (p.size === 0 && x.size === 0) {
      if (r.length > best) best = r.length
      return
    }
    if (r.length + p.size <= best) return
    let pivot: string | null = null
    let pivotDeg = -1
    for (const u of [...p, ...x]) {
      const d = [...(local.get(u) ?? [])].filter((n) => p.has(n)).length
      if (d > pivotDeg) {
        pivotDeg = d
        pivot = u
      }
    }
    const pivotNbrs = pivot ? local.get(pivot) ?? new Set() : new Set<string>()
    const candidates = [...p].filter((v) => !pivotNbrs.has(v))
    for (const v of candidates) {
      const nbrs = local.get(v) ?? new Set()
      const p2 = new Set([...p].filter((u) => nbrs.has(u)))
      const x2 = new Set([...x].filter((u) => nbrs.has(u)))
      bk([...r, v], p2, x2)
      p.delete(v)
      x.add(v)
    }
  }
  bk([], new Set(core), new Set())
  return best
}

function studentPigeonholeRedLowerBound(
  students: Record<string, Student>,
): { count: number; notes: string[] } {
  let count = 0
  const notes: string[] = []
  for (const st of Object.values(students)) {
    const courses = st.enrolled_courses
    if (!courses.length) continue
    let nonMath = 0
    let math = 0
    for (const c of courses) {
      if (isMathCourse(c)) math++
      else nonMath++
    }
    // Non-math may only use Mon–Fri; math may also use Saturday.
    const maxFeasibleDistinctDays =
      Math.min(nonMath, NON_MATH_WEEKDAY_COUNT) +
      Math.min(math, TOTAL_WEEKLY_SLOTS - Math.min(nonMath, NON_MATH_WEEKDAY_COUNT))
    if (courses.length > maxFeasibleDistinctDays) {
      count++
      if (notes.length < 3) {
        notes.push(
          `Student ${st.register_number}: ${courses.length} courses but at most ${maxFeasibleDistinctDays} feasible distinct evenings (Saturday maths-only).`,
        )
      }
    }
  }
  return { count, notes }
}

/**
 * Structural lower bounds for clash weight / RED students on the weekday model.
 * Clique size is a proven chromatic lower bound; student pigeonhole is a proven RED lower bound.
 */
export function computeSchedulingLowerBounds(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  students?: Record<string, Student>,
): SchedulingLowerBounds {
  const sectionToCourse = new Map<string, string>()
  for (const secs of Object.values(courseSections)) {
    for (const s of secs) sectionToCourse.set(s.section_id, s.course_code)
  }
  const adj = buildCourseConflictAdj(conflictGraph, sectionToCourse)
  const greedy = greedyMaxClique(adj)
  const exactCore = exactMaxCliqueOnCore(adj)
  const maxClique = Math.max(greedy, exactCore, adj.size ? 1 : 0)
  const colors = TOTAL_WEEKLY_SLOTS
  const minPairs = minMonochromePairs(maxClique, colors)
  const notes: string[] = []

  if (maxClique > colors) {
    notes.push(
      `Course conflict clique of size ${maxClique} exceeds ${colors} weekdays — a clash-free timetable is impossible.`,
    )
  } else if (maxClique > 0) {
    notes.push(`Largest course conflict clique found: ${maxClique} (chromatic lower bound).`)
  }

  let minRed = 0
  if (students && Object.keys(students).length) {
    const pigeon = studentPigeonholeRedLowerBound(students)
    minRed = pigeon.count
    notes.push(...pigeon.notes)
    if (minRed > 0) {
      notes.push(
        `At least ${minRed} student(s) must have a timetable clash given enrollment and Saturday maths-only.`,
      )
    }
  }

  // Non-math subgraph: only 5 colors.
  let nonMathClique = 0
  const nonMathAdj = new Map<string, Set<string>>()
  for (const [v, nbrs] of adj) {
    if (isMathCourse(v)) continue
    const filtered = new Set([...nbrs].filter((u) => !isMathCourse(u)))
    if (filtered.size) nonMathAdj.set(v, filtered)
  }
  if (nonMathAdj.size) {
    nonMathClique = Math.max(greedyMaxClique(nonMathAdj, 32), exactMaxCliqueOnCore(nonMathAdj, 48))
    if (nonMathClique > NON_MATH_WEEKDAY_COUNT) {
      notes.push(
        `Non-math conflict clique of size ${nonMathClique} exceeds ${NON_MATH_WEEKDAY_COUNT} Mon–Fri evenings.`,
      )
    }
  }

  const zeroClash =
    maxClique > colors ||
    nonMathClique > NON_MATH_WEEKDAY_COUNT ||
    minPairs > 0
  const clashWeightLb = Math.max(
    minPairs,
    minMonochromePairs(nonMathClique, NON_MATH_WEEKDAY_COUNT),
  )

  return {
    max_clique_size: Math.max(maxClique, nonMathClique),
    available_colors: colors,
    zero_clash_structurally_impossible: zeroClash,
    zero_red_structurally_impossible: minRed > 0 || zeroClash,
    min_clash_weight_lower_bound: clashWeightLb,
    min_red_students_lower_bound: minRed,
    notes,
  }
}

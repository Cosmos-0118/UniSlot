import type { ConflictGraph, Section, Student } from '../types'
import {
  activeWeekdayCount,
  NON_MATH_WEEKDAY_COUNT,
  TOTAL_WEEKLY_SLOTS,
  isSaturdayEligible,
  normalizeSaturdayExtraCodes,
  saturdaySlotOpen,
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
  /** Lower bound on monochromatic conflict weight (weighted clique pigeonhole + packing). */
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

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`
}

function buildCourseConflictWeighted(
  conflictGraph: ConflictGraph,
  sectionToCourse: Map<string, string>,
): {
  adj: Map<string, Set<string>>
  weights: Map<string, number>
} {
  const adj = new Map<string, Set<string>>()
  const weights = new Map<string, number>()
  const touch = (a: string, b: string, w: number) => {
    if (a === b || w <= 0) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
    const key = pairKey(a, b)
    weights.set(key, (weights.get(key) ?? 0) + w)
  }
  for (const e of conflictGraph.edges) {
    const ca = sectionToCourse.get(e.section_a)
    const cb = sectionToCourse.get(e.section_b)
    if (!ca || !cb || ca === cb) continue
    touch(ca, cb, e.weight)
  }
  return { adj, weights }
}

/** Greedy clique: start from each high-degree vertex, grow by densest candidate. */
function greedyMaxClique(adj: Map<string, Set<string>>, starts = 48): string[] {
  const nodes = [...adj.keys()].sort((a, b) => (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0))
  if (!nodes.length) return []
  let best: string[] = [nodes[0]!]
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
    if (clique.length > best.length) best = clique
  }
  return best
}

/**
 * Bron–Kerbosch with pivoting on a degree-filtered subgraph (exact on the induced set).
 * Caps node count so browser solve stays snappy.
 */
function exactMaxCliqueOnCore(adj: Map<string, Set<string>>, maxNodes = 64): string[] {
  const ranked = [...adj.keys()].sort((a, b) => (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0))
  const core = ranked.slice(0, Math.min(maxNodes, ranked.length))
  const coreSet = new Set(core)
  const local = new Map<string, Set<string>>()
  for (const v of core) {
    local.set(v, new Set([...(adj.get(v) ?? [])].filter((u) => coreSet.has(u))))
  }

  let best: string[] = []
  function bk(r: string[], p: Set<string>, x: Set<string>): void {
    if (p.size === 0 && x.size === 0) {
      if (r.length > best.length) best = [...r]
      return
    }
    if (r.length + p.size <= best.length) return
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

/**
 * Valid weighted LB: ≥ `pairs` edges must be monochromatic; cheapest `pairs` edges
 * in the clique lower-bound the mono weight contribution.
 */
export function weightedCliquePigeonholeLb(
  clique: string[],
  weights: Map<string, number>,
  colors: number,
): number {
  const pairs = minMonochromePairs(clique.length, colors)
  if (pairs <= 0) return 0
  const edgeWs: number[] = []
  for (let i = 0; i < clique.length; i++) {
    for (let j = i + 1; j < clique.length; j++) {
      const w = weights.get(pairKey(clique[i]!, clique[j]!)) ?? 0
      if (w > 0) edgeWs.push(w)
    }
  }
  if (edgeWs.length < pairs) return pairs // unit fallback
  edgeWs.sort((a, b) => a - b)
  let sum = 0
  for (let i = 0; i < pairs; i++) sum += edgeWs[i]!
  return sum
}

function connectedComponents(adj: Map<string, Set<string>>): string[][] {
  const seen = new Set<string>()
  const comps: string[][] = []
  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    const stack = [start]
    seen.add(start)
    const comp: string[] = []
    while (stack.length) {
      const u = stack.pop()!
      comp.push(u)
      for (const v of adj.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v)
          stack.push(v)
        }
      }
    }
    comps.push(comp)
  }
  return comps
}

function greedyCliqueFrom(
  adj: Map<string, Set<string>>,
  nodeSet: Set<string>,
  start: string,
): string[] {
  const clique = [start]
  let candidates = [...(adj.get(start) ?? [])].filter((v) => nodeSet.has(v))
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
  return clique
}

/** Max of best single-clique LB and a greedy edge-disjoint clique packing. */
function componentWeightedCliqueLb(
  adj: Map<string, Set<string>>,
  weights: Map<string, number>,
  nodes: string[],
  colors: number,
  starts = 24,
): number {
  if (!nodes.length) return 0
  const nodeSet = new Set(nodes)
  const ranked = [...nodes].sort((a, b) => (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0))
  let best = 0
  let packed = 0
  const usedEdges = new Set<string>()
  const limit = Math.min(starts, ranked.length)
  for (let i = 0; i < limit; i++) {
    const clique = greedyCliqueFrom(adj, nodeSet, ranked[i]!)
    const lb = weightedCliquePigeonholeLb(clique, weights, colors)
    best = Math.max(best, lb)
    const edges: string[] = []
    let ok = true
    for (let a = 0; a < clique.length && ok; a++) {
      for (let b = a + 1; b < clique.length; b++) {
        const key = pairKey(clique[a]!, clique[b]!)
        if ((weights.get(key) ?? 0) <= 0) continue
        if (usedEdges.has(key)) {
          ok = false
          break
        }
        edges.push(key)
      }
    }
    if (ok && edges.length && lb > 0) {
      packed += lb
      for (const e of edges) usedEdges.add(e)
    }
  }
  return Math.max(best, packed)
}

function studentPigeonholeRedLowerBound(
  students: Record<string, Student>,
  allowSaturdayForMath: boolean,
  saturdayExtras: readonly string[],
): { count: number; notes: string[] } {
  let count = 0
  const notes: string[] = []
  const saturdayOpen = saturdaySlotOpen(allowSaturdayForMath, saturdayExtras)
  const saturdayNote = saturdayOpen
    ? 'Saturday for eligible courses only'
    : 'Mon–Fri only (Saturday blocked)'
  for (const st of Object.values(students)) {
    const courses = st.enrolled_courses
    if (!courses.length) continue
    let maxFeasibleDistinctDays: number
    if (!saturdayOpen) {
      maxFeasibleDistinctDays = Math.min(courses.length, NON_MATH_WEEKDAY_COUNT)
    } else {
      let restricted = 0
      let eligible = 0
      for (const c of courses) {
        if (isSaturdayEligible(c, allowSaturdayForMath, saturdayExtras)) eligible++
        else restricted++
      }
      maxFeasibleDistinctDays =
        Math.min(restricted, NON_MATH_WEEKDAY_COUNT) +
        Math.min(eligible, TOTAL_WEEKLY_SLOTS - Math.min(restricted, NON_MATH_WEEKDAY_COUNT))
    }
    if (courses.length > maxFeasibleDistinctDays) {
      count++
      if (notes.length < 3) {
        notes.push(
          `Student ${st.register_number}: ${courses.length} courses but at most ${maxFeasibleDistinctDays} feasible distinct evenings (${saturdayNote}).`,
        )
      }
    }
  }
  return { count, notes }
}

/**
 * Structural lower bounds for clash weight / RED students on the weekday model.
 * Uses weighted clique pigeonhole + component packing (not unit-weight only).
 */
export function computeSchedulingLowerBounds(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  students?: Record<string, Student>,
  options?: { allowSaturdayForMath?: boolean; saturdayExtraCourseCodes?: string[] },
): SchedulingLowerBounds {
  const allowSaturdayForMath = options?.allowSaturdayForMath !== false
  const saturdayExtras = normalizeSaturdayExtraCodes(options?.saturdayExtraCourseCodes)
  const saturdayOpen = saturdaySlotOpen(allowSaturdayForMath, saturdayExtras)
  const sectionToCourse = new Map<string, string>()
  for (const secs of Object.values(courseSections)) {
    for (const s of secs) sectionToCourse.set(s.section_id, s.course_code)
  }
  const { adj, weights } = buildCourseConflictWeighted(conflictGraph, sectionToCourse)
  const greedyClique = greedyMaxClique(adj)
  const exactClique = exactMaxCliqueOnCore(adj)
  const maxCliqueNodes =
    exactClique.length >= greedyClique.length ? exactClique : greedyClique
  const maxClique = maxCliqueNodes.length || (adj.size ? 1 : 0)
  const colors = activeWeekdayCount(allowSaturdayForMath, saturdayExtras)
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
    const pigeon = studentPigeonholeRedLowerBound(students, allowSaturdayForMath, saturdayExtras)
    minRed = pigeon.count
    notes.push(...pigeon.notes)
    if (minRed > 0) {
      notes.push(
        saturdayOpen
          ? `At least ${minRed} student(s) must have a timetable clash given enrollment and Saturday eligibility rules.`
          : `At least ${minRed} student(s) must have a timetable clash given enrollment and Mon–Fri-only (Saturday blocked).`,
      )
    }
  }

  // Restricted (non-Saturday-eligible) subgraph: only 5 colors (or all colors when Saturday is blocked).
  let nonMathClique = 0
  const nonMathAdj = new Map<string, Set<string>>()
  for (const [v, nbrs] of adj) {
    if (isSaturdayEligible(v, allowSaturdayForMath, saturdayExtras)) continue
    const filtered = new Set(
      [...nbrs].filter((u) => !isSaturdayEligible(u, allowSaturdayForMath, saturdayExtras)),
    )
    if (filtered.size) nonMathAdj.set(v, filtered)
  }
  let nonMathCliqueNodes: string[] = []
  if (nonMathAdj.size) {
    const g = greedyMaxClique(nonMathAdj, 32)
    const e = exactMaxCliqueOnCore(nonMathAdj, 48)
    nonMathCliqueNodes = e.length >= g.length ? e : g
    nonMathClique = nonMathCliqueNodes.length
    if (nonMathClique > NON_MATH_WEEKDAY_COUNT) {
      notes.push(
        `Non-Saturday-eligible conflict clique of size ${nonMathClique} exceeds ${NON_MATH_WEEKDAY_COUNT} Mon–Fri evenings.`,
      )
    }
  }

  // Component-wise weighted packing + best single cliques.
  let weightedLb = 0
  for (const comp of connectedComponents(adj)) {
    weightedLb += componentWeightedCliqueLb(adj, weights, comp, colors)
  }
  const singleWeighted = weightedCliquePigeonholeLb(maxCliqueNodes, weights, colors)
  const nonMathWeighted = weightedCliquePigeonholeLb(
    nonMathCliqueNodes,
    weights,
    NON_MATH_WEEKDAY_COUNT,
  )
  const unitLb = Math.max(
    minMonochromePairs(maxClique, colors),
    minMonochromePairs(nonMathClique, NON_MATH_WEEKDAY_COUNT),
  )
  const clashWeightLb = Math.max(unitLb, singleWeighted, nonMathWeighted, weightedLb)
  if (clashWeightLb > unitLb) {
    notes.push(
      `Weighted clique/pigeonhole LB raised clash cut to ${clashWeightLb} (unit pigeonhole was ${unitLb}).`,
    )
  }

  const zeroClash =
    maxClique > colors ||
    nonMathClique > NON_MATH_WEEKDAY_COUNT ||
    clashWeightLb > 0

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

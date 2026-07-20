import type { ConflictGraph, Section } from '../types'
import type { EffortLevel } from '../solver/effort'

/** Immutable problem snapshot posted once to each seed worker. */
export type SolverPoolProblem = {
  courseCodes: string[]
  sections: Section[]
  conflictGraph: ConflictGraph
  /** Serializable course adjacency: course → [[neighbor, weight], ...] */
  courseAdj: [string, [string, number][]][]
  sectionCountByCourse: [string, number][]
  conflictDensity: Record<string, number>
  parallelCap: number
  effort: EffortLevel
}

export type SolverSeedRequest =
  | { type: 'init'; problem: SolverPoolProblem }
  | {
      type: 'seed'
      jobId: number
      seedIndex: number
      baseSeed?: number
      effort?: EffortLevel
    }
  | {
      type: 'refine'
      jobId: number
      refineIndex: number
      slotByCourse: Record<string, number>
      baseSeed?: number
      maxIterFactor: number
      effort?: EffortLevel
    }
  | { type: 'cancel' }

export type SolverSeedResponse =
  | {
      type: 'seedResult'
      jobId: number
      seedIndex: number
      slotByCourse: Record<string, number>
      clashWeight: number
      students: number
    }
  | {
      type: 'refineResult'
      jobId: number
      refineIndex: number
      slotByCourse: Record<string, number>
      clashWeight: number
      students: number
    }
  | { type: 'error'; jobId: number; message: string }
  | { type: 'cancelled'; jobId: number }

export function packCourseAdj(
  courseAdj: Map<string, Map<string, number>>,
): [string, [string, number][]][] {
  const out: [string, [string, number][]][] = []
  for (const [k, m] of courseAdj) {
    out.push([k, [...m.entries()]])
  }
  return out
}

export function unpackCourseAdj(
  packed: [string, [string, number][]][],
): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>()
  for (const [k, entries] of packed) {
    m.set(k, new Map(entries))
  }
  return m
}

export function unpackSectionCounts(entries: [string, number][]): Map<string, number> {
  return new Map(entries)
}

/** Pool size: leave one core for UI/coordinator; cap at 8. */
export function resolvePoolWorkerCount(override?: number): number {
  if (override != null) return Math.max(1, Math.min(8, Math.floor(override)))
  const hc =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 1
  if (hc <= 1) return 1
  return Math.min(8, Math.max(2, hc - 1))
}

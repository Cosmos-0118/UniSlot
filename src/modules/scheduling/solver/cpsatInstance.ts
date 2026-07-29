import type { ConflictGraph, Section, Student } from '../types'
import {
  activeWeekdayCount,
  isMathCourse,
  maxSlotIndexForCourse,
  PREFERRED_PARALLEL_SECTIONS,
  SATURDAY_SLOT_INDEX,
} from './timeModel'

/** Course-level conflict edge for the CP-SAT instance. */
export type CpsatConflictEdge = {
  course_a: string
  course_b: string
  weight: number
}

export type CpsatInstance = {
  num_weekdays: number
  saturday_index: number
  /** When false, Saturday is excluded entirely (temporary Mon–Fri-only mode). */
  allow_saturday: boolean
  preferred_parallel: number
  courses: Array<{
    code: string
    is_math: boolean
    section_count: number
    section_ids: string[]
  }>
  conflict_edges: CpsatConflictEdge[]
  faculty_groups: Array<{ faculty: string; course_codes: string[] }>
  students: Array<{ id: string; courses: string[] }>
  hint?: Record<string, number>
  /** Hard-pinned course→weekday assignments (rectification mode). */
  fixed_days?: Record<string, number>
  /** Structural lower bound injected as CP-SAT cut (clash_weight >= lb). */
  min_clash_weight_lower_bound?: number
  /** Structural lower bound injected as CP-SAT cut (red_students >= lb). */
  min_red_students_lower_bound?: number
}

export type CpsatSolution = {
  status: string
  proven_optimal: boolean
  proven_levels?: string[]
  slot_by_course: Record<string, number>
  clash_weight: number | null
  red_students: number | null
  weekday_balance_l1_scaled?: number | null
  parallel_excess?: number | null
  solver_time_seconds: number
  num_workers: number
  message?: string
  error?: string
  ortools_version?: string
  python_version?: string
}

/** Present on events from a portfolio race member (multi-seed clash race). */
export type CpsatPortfolioMeta = {
  index: number
  size: number
  seed: number
  member_workers: number
  /** Wall-clock budget for this race member (seconds). */
  race_seconds?: number
}

export type CpsatProgressEvent =
  | {
      type: 'toolchain'
      python_version: string
      ortools_version: string
      portfolio?: CpsatPortfolioMeta
    }
  | {
      type: 'start'
      workers: number
      courses: number
      edges?: number
      students?: number
      python_version?: string
      ortools_version?: string
      portfolio?: CpsatPortfolioMeta
    }
  | {
      type: 'model_ready'
      elapsed?: number
      courses?: number
      portfolio?: CpsatPortfolioMeta
    }
  | {
      type: 'phase'
      phase: string
      phase_label?: string
      workers?: number
      clash_weight?: number
      red_students?: number
      elapsed?: number
      portfolio?: CpsatPortfolioMeta
      /** Seed list when phase === portfolio_race (UI initializes lanes). */
      portfolio_seeds?: number[]
      portfolio_member_workers?: number
      portfolio_race_seconds?: number
    }
  | {
      type: 'progress' | 'heartbeat'
      phase: string
      phase_label?: string
      best_clash: number | null
      best_red: number | null
      best_balance_l1_scaled?: number | null
      best_parallel_excess?: number | null
      bound?: number | null
      elapsed: number
      workers: number
      solutions: number
      activity?: 'searching' | 'improving' | 'proving'
      seconds_since_improve?: number
      event?: string
      solver_status?: string
      portfolio?: CpsatPortfolioMeta
    }
  | {
      type: 'done'
      status?: string
      clash_weight?: number | null
      red_students?: number | null
      proven_optimal?: boolean
      portfolio?: CpsatPortfolioMeta
    }
  | {
      type: 'error'
      message: string
      /** Python traceback when solve_lex raised. */
      traceback?: string
      portfolio?: CpsatPortfolioMeta
    }

/** Aggregate section-level conflict edges to course pairs (unique students already per edge). */
export function aggregateCourseConflictEdges(
  conflictGraph: ConflictGraph,
  sectionToCourse: Map<string, string>,
): CpsatConflictEdge[] {
  const weights = new Map<string, number>()
  for (const edge of conflictGraph.edges) {
    const ca = sectionToCourse.get(edge.section_a)
    const cb = sectionToCourse.get(edge.section_b)
    if (!ca || !cb || ca === cb) continue
    const a = ca < cb ? ca : cb
    const b = ca < cb ? cb : ca
    const key = `${a}|${b}`
    weights.set(key, (weights.get(key) ?? 0) + edge.weight)
  }
  const out: CpsatConflictEdge[] = []
  for (const [key, weight] of weights) {
    const [course_a, course_b] = key.split('|') as [string, string]
    out.push({ course_a, course_b, weight })
  }
  return out
}

export function buildCpsatInstance(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  students: Record<string, Student>,
  options?: {
    hint?: Record<string, number>
    fixed_days?: Record<string, number>
    min_clash_weight_lower_bound?: number
    min_red_students_lower_bound?: number
    /** Default true (Constraints.md). Pass false to exclude Saturday entirely. */
    allowSaturdayForMath?: boolean
  },
): CpsatInstance {
  const allowSaturdayForMath = options?.allowSaturdayForMath !== false
  const sectionToCourse = new Map<string, string>()
  const courses: CpsatInstance['courses'] = []

  for (const [code, sections] of Object.entries(courseSections)) {
    const section_ids = sections.map((s) => s.section_id)
    for (const s of sections) sectionToCourse.set(s.section_id, code)
    courses.push({
      code,
      is_math: isMathCourse(code),
      section_count: sections.length,
      section_ids,
    })
  }
  courses.sort((a, b) => a.code.localeCompare(b.code))

  const faculty_groups: CpsatInstance['faculty_groups'] = []
  for (const [faculty, sectionIds] of Object.entries(facultyConstraints)) {
    const codes = [
      ...new Set(
        sectionIds
          .map((sid) => sectionToCourse.get(sid))
          .filter((c): c is string => Boolean(c)),
      ),
    ].sort()
    if (codes.length >= 2) {
      faculty_groups.push({ faculty, course_codes: codes })
    }
  }

  const studentRows: CpsatInstance['students'] = []
  for (const [id, st] of Object.entries(students)) {
    const enrolled = (st.enrolled_courses ?? []).filter((c) => c in courseSections)
    if (enrolled.length) studentRows.push({ id, courses: enrolled })
  }

  let hint = options?.hint
  if (hint && !allowSaturdayForMath) {
    const clamped: Record<string, number> = {}
    for (const [code, slot] of Object.entries(hint)) {
      clamped[code] = Math.min(slot, maxSlotIndexForCourse(code, false))
    }
    hint = clamped
  }

  return {
    num_weekdays: activeWeekdayCount(allowSaturdayForMath),
    saturday_index: SATURDAY_SLOT_INDEX,
    allow_saturday: allowSaturdayForMath,
    preferred_parallel: PREFERRED_PARALLEL_SECTIONS,
    courses,
    conflict_edges: aggregateCourseConflictEdges(conflictGraph, sectionToCourse),
    faculty_groups,
    students: studentRows,
    hint,
    fixed_days: options?.fixed_days,
    min_clash_weight_lower_bound: options?.min_clash_weight_lower_bound,
    min_red_students_lower_bound: options?.min_red_students_lower_bound,
  }
}

/** Expand course→day assignment to section_id→day (split sections share the parent day). */
export function sectionSlotsFromCourseSlots(
  courseSections: Record<string, Section[]>,
  slotByCourse: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const sections of Object.values(courseSections)) {
    for (const sec of sections) {
      out[sec.section_id] = slotByCourse[sec.course_code] ?? 0
    }
  }
  return out
}

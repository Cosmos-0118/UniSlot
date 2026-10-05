import type { ConflictGraph, Section, Student } from '../types'
import {
  activeWeekdayCount,
  isSaturdayEligible,
  maxSlotIndexForCourse,
  normalizeSaturdayExtraCodes,
  saturdaySlotOpen,
  PREFERRED_PARALLEL_SECTIONS,
  SATURDAY_SLOT_INDEX,
} from './timeModel'

/** Identifies RED-first scoring and primary certificate semantics in saved outputs. */
export const OBJECTIVE_POLICY = 'red-first-v1' as const

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
  /** When true, Python skips duplicate clique packing and reuses the TS bound. */
  bounds_precomputed?: boolean
  /** Greedy cliques for same-day inequalities. */
  clique_cuts?: string[][]
}

export type CpsatSolution = {
  objective_policy?: typeof OBJECTIVE_POLICY | 'clash-only'
  status: string
  proven_optimal: boolean
  proven_levels?: string[]
  slot_by_course: Record<string, number>
    clash_weight: number | null
    red_students: number | null
    weekday_balance_l1_scaled?: number | null
    parallel_excess?: number | null
    clash_bound?: number | null
    clash_gap?: number | null
    red_bound?: number | null
    red_gap?: number | null
    solver_time_seconds: number
    num_workers: number
    message?: string
    error?: string
    ortools_version?: string
    python_version?: string
    timings?: Record<string, number>
    model_stats?: { variables: number; constraints: number }
}

/** Present on events from a portfolio race member (multi-seed RED race). */
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
      variables?: number
      constraints?: number
      portfolio?: CpsatPortfolioMeta
    }
  | {
      type: 'profile'
      timings?: Record<string, number>
      model_stats?: { variables: number; constraints: number }
      clash_bound?: number | null
      clash_gap?: number | null
      red_bound?: number | null
      red_gap?: number | null
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
      incumbent?: number | null
      bound?: number | null
      elapsed: number
      workers: number
      solutions: number
      activity?: 'searching' | 'improving' | 'proving'
      seconds_since_improve?: number
      event?: string
      solver_status?: string
      /** Integer-gap certificate for the objective of this phase. */
      proven?: boolean
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

function buildCanonicalCourseConflictEdges(
  students: Record<string, Student>,
  modeledCourses: Set<string>,
): CpsatConflictEdge[] {
  const weights = new Map<string, { course_a: string; course_b: string; weight: number }>()
  for (const [id, student] of Object.entries(students)) {
    if (id !== student.register_number) {
      throw new Error(
        `Invalid student roster: key "${id}" does not match register number "${student.register_number}".`,
      )
    }
    const enrolled = [...new Set((student.enrolled_courses ?? []).filter((course) => modeledCourses.has(course)))].sort()
    for (let i = 0; i < enrolled.length; i++) {
      for (let j = i + 1; j < enrolled.length; j++) {
        const course_a = enrolled[i]!
        const course_b = enrolled[j]!
        const key = `${course_a}\0${course_b}`
        const edge = weights.get(key)
        if (edge) edge.weight++
        else weights.set(key, { course_a, course_b, weight: 1 })
      }
    }
  }
  return [...weights.values()]
}

function validateSectionMembership(
  courseSections: Record<string, Section[]>,
  students: Record<string, Student>,
): Map<string, string> {
  const sectionToCourse = new Map<string, string>()
  const membershipCounts = new Map<string, Map<string, number>>()
  for (const [courseCode, sections] of Object.entries(courseSections)) {
    for (const section of sections) {
      if (section.course_code !== courseCode) {
        throw new Error(
          `Invalid section roster: section ${section.section_id} names course ${section.course_code}, but is listed under ${courseCode}.`,
        )
      }
      if (sectionToCourse.has(section.section_id)) {
        throw new Error(`Invalid section roster: duplicate section ID ${section.section_id}.`)
      }
      sectionToCourse.set(section.section_id, courseCode)
      for (const studentId of section.enrolled_students) {
        const student = students[studentId]
        if (!student) {
          throw new Error(
            `Invalid section roster: section ${section.section_id} contains unknown student ${studentId}.`,
          )
        }
        if (!(student.enrolled_courses ?? []).includes(courseCode)) {
          throw new Error(
            `Invalid section roster: student ${studentId} is not canonically enrolled in ${courseCode}.`,
          )
        }
        const byStudent = membershipCounts.get(courseCode) ?? new Map<string, number>()
        byStudent.set(studentId, (byStudent.get(studentId) ?? 0) + 1)
        membershipCounts.set(courseCode, byStudent)
      }
    }
  }

  for (const [studentId, student] of Object.entries(students)) {
    for (const courseCode of new Set(student.enrolled_courses ?? [])) {
      // Registrations for courses outside this solve are allowed and ignored.
      if (!(courseCode in courseSections)) continue
      const count = membershipCounts.get(courseCode)?.get(studentId) ?? 0
      if (count === 0) {
        throw new Error(
          `Invalid section roster: canonical student ${studentId} is missing from every section of ${courseCode}.`,
        )
      }
      if (count > 1) {
        throw new Error(
          `Invalid section roster: student ${studentId} appears in multiple sections of ${courseCode}.`,
        )
      }
    }
  }
  return sectionToCourse
}

function assertCourseEdgesMatchCanonical(
  conflictGraph: ConflictGraph,
  sectionToCourse: Map<string, string>,
  canonicalEdges: CpsatConflictEdge[],
): void {
  const fromSections = aggregateCourseConflictEdges(conflictGraph, sectionToCourse)
    .sort((a, b) => a.course_a.localeCompare(b.course_a) || a.course_b.localeCompare(b.course_b))
  const canonical = [...canonicalEdges]
    .sort((a, b) => a.course_a.localeCompare(b.course_a) || a.course_b.localeCompare(b.course_b))
  if (JSON.stringify(fromSections) !== JSON.stringify(canonical)) {
    throw new Error('Section conflict graph does not match canonical student course enrollments.')
  }
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
    bounds_precomputed?: boolean
    clique_cuts?: string[][]
    /** Default true (Constraints.md). Pass false to exclude Saturday for maths. */
    allowSaturdayForMath?: boolean
    /** Extra course codes independently allowed on Saturday. */
    saturdayExtraCourseCodes?: string[]
  },
): CpsatInstance {
  const allowSaturdayForMath = options?.allowSaturdayForMath !== false
  const saturdayExtras = normalizeSaturdayExtraCodes(options?.saturdayExtraCourseCodes)
  const saturdayOpen = saturdaySlotOpen(allowSaturdayForMath, saturdayExtras)
  const sectionToCourse = validateSectionMembership(courseSections, students)
  const courses: CpsatInstance['courses'] = []

  for (const [code, sections] of Object.entries(courseSections)) {
    const section_ids = sections.map((s) => s.section_id)
    courses.push({
      code,
      // Python field name: Saturday-eligible (maths and/or extras allowlist).
      is_math: isSaturdayEligible(code, allowSaturdayForMath, saturdayExtras),
      section_count: sections.length,
      section_ids,
    })
  }
  courses.sort((a, b) => a.code.localeCompare(b.code))
  const conflictEdges = buildCanonicalCourseConflictEdges(students, new Set(Object.keys(courseSections)))
  assertCourseEdgesMatchCanonical(conflictGraph, sectionToCourse, conflictEdges)

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
    const enrolled = [...new Set((st.enrolled_courses ?? []).filter((c) => c in courseSections))].sort()
    if (enrolled.length) studentRows.push({ id, courses: enrolled })
  }

  let hint = options?.hint
  if (hint && !saturdayOpen) {
    const clamped: Record<string, number> = {}
    for (const [code, slot] of Object.entries(hint)) {
      clamped[code] = Math.min(slot, maxSlotIndexForCourse(code, false, saturdayExtras))
    }
    hint = clamped
  } else if (hint) {
    const clamped: Record<string, number> = {}
    for (const [code, slot] of Object.entries(hint)) {
      clamped[code] = Math.min(slot, maxSlotIndexForCourse(code, allowSaturdayForMath, saturdayExtras))
    }
    hint = clamped
  }

  return {
    num_weekdays: activeWeekdayCount(allowSaturdayForMath, saturdayExtras),
    saturday_index: SATURDAY_SLOT_INDEX,
    allow_saturday: saturdayOpen,
    preferred_parallel: PREFERRED_PARALLEL_SECTIONS,
    courses,
    conflict_edges: conflictEdges,
    faculty_groups,
    students: studentRows,
    hint,
    fixed_days: options?.fixed_days,
    min_clash_weight_lower_bound: options?.min_clash_weight_lower_bound,
    min_red_students_lower_bound: options?.min_red_students_lower_bound,
    bounds_precomputed: options?.bounds_precomputed,
    clique_cuts: options?.clique_cuts,
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

import type { DayName } from '../types'
import type { ClashDiff, ClashEntry } from './rectifyDiff'
import type { RunMode } from './runLog'

/** Where a (student, weekday) clash first appeared. */
export type ClashOrigin = {
  register_number: string
  student_name: string
  day: DayName
  courses: string[]
  first_seen_seq: number
  first_seen_at: string
  operation: RunMode
  batch?: number
  /** Plain-language explanation of why this clash exists. */
  cause: string
  /** Set when a later run cleared this (student, weekday) clash. */
  resolved_seq?: number
  resolved_at?: string
}

export type ClashProvenanceMap = Record<string, ClashOrigin>

export function clashProvenanceKey(registerNumber: string, day: DayName): string {
  return `${registerNumber}\t${day}`
}

export function cloneClashProvenance(
  map: ClashProvenanceMap | undefined,
): ClashProvenanceMap {
  if (!map) return {}
  const out: ClashProvenanceMap = {}
  for (const [k, v] of Object.entries(map)) {
    out[k] = { ...v, courses: [...v.courses] }
  }
  return out
}

export type ClashCauseContext = {
  seq: number
  at: string
  operation: RunMode
  batch?: number
  /** Courses that were newly placed / newly enrolled this run (optional detail for the sentence). */
  newlyAddedCourses?: string[]
  /** Proven minimal clash weight from the initial solve (solve-only). */
  provenMinimal?: boolean
  previousClashWeight?: number
}

function describeCourses(courses: string[]): string {
  if (courses.length === 0) return 'unknown courses'
  if (courses.length === 1) return courses[0]!
  if (courses.length === 2) return `${courses[0]} and ${courses[1]}`
  return `${courses.slice(0, -1).join(', ')}, and ${courses[courses.length - 1]}`
}

/** Build a plain-language cause sentence for a newly introduced clash. */
export function buildClashCause(entry: ClashEntry, ctx: ClashCauseContext): string {
  const courseList = describeCourses(entry.courses)
  if (ctx.operation === 'solve') {
    if (ctx.provenMinimal) {
      return (
        `Present from the initial solve (run #${ctx.seq}). ` +
        `${courseList} share ${entry.day}. Clash weight was proven minimal, ` +
        `so this clash is unavoidable under the six-weekday model.`
      )
    }
    return (
      `Present from the initial solve (run #${ctx.seq}). ` +
      `${courseList} share ${entry.day}.`
    )
  }

  if (ctx.operation === 'late') {
    const batchLabel = ctx.batch != null ? `Late batch ${ctx.batch}` : 'Late enrollment'
    const added = (ctx.newlyAddedCourses ?? []).filter((c) => entry.courses.includes(c))
    const prior = entry.courses.filter((c) => !added.includes(c))
    if (added.length > 0 && prior.length > 0) {
      return (
        `${batchLabel} (run #${ctx.seq}) added ${describeCourses(added)} (${entry.day}); ` +
        `${entry.register_number} already held ${describeCourses(prior)} on ${entry.day}. ` +
        `Both weekdays were frozen, so neither course could move.`
      )
    }
    return (
      `${batchLabel} (run #${ctx.seq}) produced a clash for ${entry.register_number} on ${entry.day}: ` +
      `${courseList}. Affected course weekdays were frozen.`
    )
  }

  // rectify
  const placed = (ctx.newlyAddedCourses ?? []).filter((c) => entry.courses.includes(c))
  if (placed.length > 0) {
    return (
      `Rectify (run #${ctx.seq}) placed ${describeCourses(placed)} on ${entry.day}; ` +
      `${entry.register_number} already held other courses on that weekday. ` +
      `Continuing courses were pinned, so existing weekdays could not move.`
    )
  }
  return (
    `Rectify (run #${ctx.seq}) introduced a clash for ${entry.register_number} on ${entry.day}: ` +
    `${courseList}.`
  )
}

/**
 * Apply a clash diff onto the provenance map.
 * Introduced → new origins; carried_over → untouched; resolved → stamp resolved_seq.
 */
export function updateClashProvenance(
  previous: ClashProvenanceMap,
  diff: ClashDiff,
  ctx: ClashCauseContext,
): ClashProvenanceMap {
  const next = cloneClashProvenance(previous)

  for (const entry of diff.introduced) {
    const key = clashProvenanceKey(entry.register_number, entry.day)
    next[key] = {
      register_number: entry.register_number,
      student_name: entry.student_name,
      day: entry.day,
      courses: [...entry.courses],
      first_seen_seq: ctx.seq,
      first_seen_at: ctx.at,
      operation: ctx.operation,
      batch: ctx.batch,
      cause: buildClashCause(entry, ctx),
    }
  }

  for (const entry of diff.resolved) {
    const key = clashProvenanceKey(entry.register_number, entry.day)
    const existing = next[key]
    if (existing) {
      next[key] = {
        ...existing,
        resolved_seq: ctx.seq,
        resolved_at: ctx.at,
      }
    }
  }

  // Carried-over: leave origins alone (they already point at the run that caused them).
  // Refresh course list if the pair set changed slightly while the (student, day) key remained.
  for (const entry of diff.carried_over) {
    const key = clashProvenanceKey(entry.register_number, entry.day)
    const existing = next[key]
    if (existing && !existing.resolved_seq) {
      next[key] = { ...existing, courses: [...entry.courses], student_name: entry.student_name }
    } else if (!existing) {
      // Snapshot older than provenance tracking — backfill as carried-over with unknown origin.
      next[key] = {
        register_number: entry.register_number,
        student_name: entry.student_name,
        day: entry.day,
        courses: [...entry.courses],
        first_seen_seq: Math.max(1, ctx.seq - 1),
        first_seen_at: ctx.at,
        operation: 'solve',
        cause: `Carried over from a prior run before clash provenance was recorded. ${describeCourses(entry.courses)} share ${entry.day}.`,
      }
    }
  }

  return next
}

/** Active (unresolved) clash origins, sorted by student then day. */
export function activeClashOrigins(map: ClashProvenanceMap): ClashOrigin[] {
  return Object.values(map)
    .filter((o) => o.resolved_seq == null)
    .sort(
      (a, b) =>
        a.register_number.localeCompare(b.register_number) || a.day.localeCompare(b.day),
    )
}

/** Full event list (including resolved), newest first_seen last. */
export function allClashOrigins(map: ClashProvenanceMap): ClashOrigin[] {
  return Object.values(map).sort(
    (a, b) =>
      a.first_seen_seq - b.first_seen_seq ||
      a.register_number.localeCompare(b.register_number) ||
      a.day.localeCompare(b.day),
  )
}

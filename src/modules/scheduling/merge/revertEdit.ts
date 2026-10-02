import type { Section } from '../types'
import { cloneSchedulingSnapshot, type SchedulingSnapshot } from './snapshot'
import { dropStudentCourse, recomputeSectionPrograms } from './studentCourseEdit'

/**
 * Review-and-revert for surgical edits (fix-course / drop-course).
 *
 * `previous` is the snapshot before the edits, `edited` the one after. Every
 * registration (student × course) that differs between the two is a change;
 * reverting a change rewrites the *edited* snapshot using `previous` as the
 * source of truth, so any other edits made in between are kept.
 */

export type RevertChangeKind = 'dropped' | 'added' | 'moved'

export type RevertChange = {
  /** Stable id: kind|register|droppedCourse|addedCourse. */
  id: string
  kind: RevertChangeKind
  register: string
  studentName: string
  /** Course the student lost (dropped, or the "from" side of a move). */
  droppedCourse?: string
  droppedTitle?: string
  /** Course the student gained (added, or the "to" side of a move). */
  addedCourse?: string
  addedTitle?: string
  /** Set when the added registration came from a late-enrollment batch. */
  lateBatch?: number
  label: string
}

export type SnapshotDiff = {
  changes: RevertChange[]
  /** Blocking problems — the two folders cannot be compared safely. */
  errors: string[]
  /** Non-blocking caveats the user should see before reverting. */
  warnings: string[]
}

const KEY_SEP = '\t'
const key = (register: string, course: string) => `${register}${KEY_SEP}${course}`

function registrationKeys(snapshot: SchedulingSnapshot): Set<string> {
  return new Set(snapshot.enrollmentRows.map((r) => key(r.register_number, r.course_code)))
}

function titleFor(snapshot: SchedulingSnapshot, course: string): string {
  const fromSection = snapshot.courseSections[course]?.find((s) => s.course_title)?.course_title
  if (fromSection) return fromSection
  return snapshot.enrollmentRows.find((r) => r.course_code === course && r.course_title)?.course_title ?? ''
}

function nameFor(register: string, ...snapshots: SchedulingSnapshot[]): string {
  for (const s of snapshots) {
    const name = s.students[register]?.name
    if (name) return name
    const row = s.enrollmentRows.find((r) => r.register_number === register && r.student_name)
    if (row?.student_name) return row.student_name
  }
  return ''
}

function maxSeq(snapshot: SchedulingSnapshot): number {
  const log = snapshot.run_log ?? []
  return log.length ? Math.max(...log.map((e) => e.seq)) : 0
}

/** `[register, from, to]` for each fix-course run recorded after `previous`. */
function recordedMoves(previous: SchedulingSnapshot, edited: SchedulingSnapshot) {
  const base = maxSeq(previous)
  const moves: { register: string; from: string; to: string }[] = []
  for (const entry of edited.run_log ?? []) {
    if (entry.seq <= base || entry.mode !== 'fix-course') continue
    for (const d of entry.decisions) {
      if (d.choice !== 'fix-course' || !d.detail) continue
      const m = /^(.+?)→(.+?)(?:\s*\(|$)/.exec(d.detail)
      if (m) moves.push({ register: d.subject, from: m[1]!.trim(), to: m[2]!.trim() })
    }
  }
  return moves
}

function describe(change: Pick<RevertChange, 'kind' | 'register' | 'droppedCourse' | 'addedCourse'>): string {
  switch (change.kind) {
    case 'moved':
      return `${change.register}: moved ${change.droppedCourse} → ${change.addedCourse}`
    case 'dropped':
      return `${change.register}: removed from ${change.droppedCourse}`
    default:
      return `${change.register}: added to ${change.addedCourse}`
  }
}

/** Compare two snapshots and list what changed, plus whether the pair looks sane. */
export function diffSnapshots(previous: SchedulingSnapshot, edited: SchedulingSnapshot): SnapshotDiff {
  const errors: string[] = []
  const warnings: string[] = []

  const prevSeqs = new Map((previous.run_log ?? []).map((e) => [e.seq, e.at]))
  const editedSeqs = new Map((edited.run_log ?? []).map((e) => [e.seq, e.at]))
  if (prevSeqs.size > 0) {
    const missing = [...prevSeqs].some(([seq, at]) => editedSeqs.get(seq) !== at)
    if (missing) {
      errors.push(
        maxSeq(edited) < maxSeq(previous)
          ? 'These folders look swapped: the "previous" folder has newer runs than the "edited" one.'
          : 'These folders are not from the same schedule (the run history does not line up).',
      )
    }
  } else {
    warnings.push('The previous folder has no run history, so folder order could not be verified.')
  }

  const before = registrationKeys(previous)
  const after = registrationKeys(edited)
  const droppedKeys = [...before].filter((k) => !after.has(k))
  const addedKeys = [...after].filter((k) => !before.has(k))

  const split = (k: string) => k.split(KEY_SEP) as [string, string]
  const dropped = new Set(droppedKeys)
  const added = new Set(addedKeys)
  const changes: RevertChange[] = []

  const finish = (c: Omit<RevertChange, 'id' | 'label'>): void => {
    const partial = { ...c, id: [c.kind, c.register, c.droppedCourse ?? '', c.addedCourse ?? ''].join('|') }
    changes.push({ ...partial, label: describe(partial) })
  }

  for (const move of recordedMoves(previous, edited)) {
    const from = key(move.register, move.from)
    const to = key(move.register, move.to)
    if (!dropped.has(from) || !added.has(to)) continue
    dropped.delete(from)
    added.delete(to)
    finish({
      kind: 'moved',
      register: move.register,
      studentName: nameFor(move.register, edited, previous),
      droppedCourse: move.from,
      droppedTitle: titleFor(previous, move.from),
      addedCourse: move.to,
      addedTitle: titleFor(edited, move.to),
    })
  }
  for (const k of dropped) {
    const [register, course] = split(k)
    finish({
      kind: 'dropped',
      register,
      studentName: nameFor(register, previous, edited),
      droppedCourse: course,
      droppedTitle: titleFor(previous, course),
    })
  }
  const priorLate = new Set(
    (previous.late_enrollments ?? []).map((r) => key(r.register_number, r.course_code)),
  )
  const lateBatchOf = (register: string, course: string): number | undefined =>
    priorLate.has(key(register, course))
      ? undefined
      : edited.late_enrollments?.find((r) => r.register_number === register && r.course_code === course)
          ?.batch
  for (const k of added) {
    const [register, course] = split(k)
    const lateBatch = lateBatchOf(register, course)
    finish({
      kind: 'added',
      register,
      studentName: nameFor(register, edited, previous),
      addedCourse: course,
      addedTitle: titleFor(edited, course),
      ...(lateBatch !== undefined ? { lateBatch } : {}),
    })
  }
  changes.sort(
    (a, b) =>
      a.register.localeCompare(b.register) ||
      (a.droppedCourse ?? a.addedCourse ?? '').localeCompare(b.droppedCourse ?? b.addedCourse ?? ''),
  )

  if (errors.length === 0 && changes.length === 0) {
    errors.push(
      'No differences found between the two folders. If you already restored over the original, ' +
        'recover the old folder from Time Machine (or a backup) and pick it as "previous".',
    )
  }

  const base = maxSeq(previous)
  const foreign = (edited.run_log ?? []).filter(
    (e) => e.seq > base && e.mode !== 'fix-course' && e.mode !== 'drop-course',
  )
  if (foreign.length > 0) {
    const counts = new Map<string, number>()
    for (const e of foreign) counts.set(e.mode, (counts.get(e.mode) ?? 0) + 1)
    const ran = [...counts].map(([mode, n]) => `${mode} ×${n}`).join(', ')
    warnings.push(
      `These folders are ${foreign.length === 1 ? 'one run' : `${foreign.length} runs`} apart, ` +
        `and not just removals or fixes (${ran}). ` +
        'Their registrations show up below; ones from late batches are tagged. ' +
        'Leave anything you did not mean to undo unticked.',
    )
  }
  const slotMoved = Object.keys(edited.slot_assignments).filter(
    (id) => id in previous.slot_assignments && previous.slot_assignments[id] !== edited.slot_assignments[id],
  )
  if (slotMoved.length > 0) {
    warnings.push(`${slotMoved.length} section(s) changed weekday between the folders; they stay as in the edited folder.`)
  }

  return { changes, errors, warnings }
}

/** Match changes against register numbers / course codes (case-insensitive substring). */
export function filterChanges(changes: RevertChange[], terms: string[]): RevertChange[] {
  const needles = terms.map((t) => t.trim().toLowerCase()).filter(Boolean)
  if (needles.length === 0) return changes
  return changes.filter((c) => {
    const hay = [c.register, c.droppedCourse, c.addedCourse, c.studentName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return needles.some((n) => hay.includes(n))
  })
}

/** Split free text like "RA001, 21CSE101T RA002" into search terms. */
export function parseSearchTerms(input: string): string[] {
  return input.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)
}

export type SkippedChange = { change: RevertChange; reason: string }

export type RevertResult = {
  snapshot: SchedulingSnapshot
  applied: RevertChange[]
  skipped: SkippedChange[]
  /** Registrations put back (register × course). */
  restored: { register: string; course: string }[]
  /** Registrations taken out again (the "added" side of reverted moves/adds). */
  removed: { register: string; course: string }[]
  /** Courses that had been pruned and were brought back on their original weekday. */
  recreated_courses: string[]
  /** Courses pruned because reverting emptied them. */
  pruned_courses: string[]
  students_restored: string[]
}

function restoreRegistration(
  snap: SchedulingSnapshot,
  prev: SchedulingSnapshot,
  register: string,
  course: string,
  out: RevertResult,
): string | null {
  const prevRow = prev.enrollmentRows.find((r) => r.register_number === register && r.course_code === course)
  const prevStudent = prev.students[register]
  if (!prevRow || !prevStudent) return 'not present in the previous folder'
  if (snap.enrollmentRows.some((r) => r.register_number === register && r.course_code === course)) {
    return 'already registered in the edited folder'
  }

  // Enrollment row — back at its original position.
  const have = new Set(snap.enrollmentRows.map((r) => key(r.register_number, r.course_code)))
  const at = prev.enrollmentRows.findIndex((r) => r === prevRow)
  let insertAt = 0
  for (let i = at - 1; i >= 0; i--) {
    const r = prev.enrollmentRows[i]!
    if (have.has(key(r.register_number, r.course_code))) {
      insertAt = snap.enrollmentRows.findIndex(
        (x) => x.register_number === r.register_number && x.course_code === r.course_code,
      ) + 1
      break
    }
  }
  snap.enrollmentRows.splice(insertAt, 0, { ...prevRow })

  // Student record + course list (previous order).
  let student = snap.students[register]
  if (!student) {
    student = { ...prevStudent, enrolled_courses: [] }
    snap.students[register] = student
    out.students_restored.push(register)
  }
  if (!student.enrolled_courses.includes(course)) {
    student.enrolled_courses.push(course)
    const order = prevStudent.enrolled_courses
    const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length)
    student.enrolled_courses.sort((a, b) => rank(a) - rank(b))
  }

  // Course sections — recreate the pruned course on its original weekday.
  const prevSections = prev.courseSections[course] ?? []
  if (!snap.courseSections[course]?.length) {
    if (!prevSections.length) return 'course is missing from the previous folder'
    snap.courseSections[course] = prevSections.map((s) => ({
      ...s,
      enrolled_students: [],
      programs: [],
    }))
    for (const s of prevSections) {
      if (s.section_id in prev.slot_assignments) {
        snap.slot_assignments[s.section_id] = prev.slot_assignments[s.section_id]!
      }
      const faculty = prev.facultyOverrides?.[s.section_id]
      if (faculty !== undefined) (snap.facultyOverrides ??= {})[s.section_id] = faculty
      const lane = prev.section_lanes?.[s.section_id]
      if (lane !== undefined) (snap.section_lanes ??= {})[s.section_id] = lane
    }
    out.recreated_courses.push(course)
  }

  // Roster — same section, same position as before.
  const prevSection = prevSections.find((s) => s.enrolled_students.includes(register)) ?? prevSections[0]
  const sections = snap.courseSections[course]!
  let target: Section | undefined = prevSection && sections.find((s) => s.section_id === prevSection.section_id)
  if (!target) {
    target = sections.reduce((best, s) =>
      s.enrolled_students.length < best.enrolled_students.length ? s : best,
    )
  }
  if (!target.enrolled_students.includes(register)) {
    const order = prevSection?.enrolled_students ?? []
    let pos = 0
    for (let i = order.indexOf(register) - 1; i >= 0; i--) {
      const idx = target.enrolled_students.indexOf(order[i]!)
      if (idx >= 0) {
        pos = idx + 1
        break
      }
    }
    target.enrolled_students.splice(pos, 0, register)
  }
  recomputeSectionPrograms(target, snap.students)

  // Late-enrollment record, if it had one.
  const prevLate = prev.late_enrollments?.find((r) => r.register_number === register && r.course_code === course)
  if (prevLate && !snap.late_enrollments?.some((r) => r.register_number === register && r.course_code === course)) {
    snap.late_enrollments = [...(snap.late_enrollments ?? []), { ...prevLate }]
  }
  return null
}

/**
 * Revert the chosen changes on top of `edited`. Fails soft per change: anything that cannot be
 * applied is returned in `skipped` with a reason and the rest still goes through.
 */
export function applyReverts(
  edited: SchedulingSnapshot,
  previous: SchedulingSnapshot,
  changes: RevertChange[],
): RevertResult {
  let snap = cloneSchedulingSnapshot(edited)
  const out: RevertResult = {
    snapshot: snap,
    applied: [],
    skipped: [],
    restored: [],
    removed: [],
    recreated_courses: [],
    pruned_courses: [],
    students_restored: [],
  }

  for (const change of changes) {
    // Work on a scratch copy so a half-applied change never leaks into the result.
    const scratch = cloneSchedulingSnapshot(snap)
    const scratchOut: RevertResult = {
      ...out,
      restored: [],
      removed: [],
      recreated_courses: [],
      pruned_courses: [],
      students_restored: [],
    }
    let reason: string | null = null

    if (change.droppedCourse) {
      reason = restoreRegistration(scratch, previous, change.register, change.droppedCourse, scratchOut)
      if (!reason) scratchOut.restored.push({ register: change.register, course: change.droppedCourse })
    }
    if (!reason && change.addedCourse) {
      try {
        const res = dropStudentCourse(scratch, { register: change.register, courseCode: change.addedCourse })
        // dropStudentCourse works on a clone; adopt it.
        Object.assign(scratch, res.snapshot)
        scratchOut.removed.push({ register: change.register, course: change.addedCourse })
        scratchOut.pruned_courses.push(...res.pruned_courses)
      } catch (err) {
        reason = err instanceof Error ? err.message : String(err)
      }
    }

    if (reason) {
      out.skipped.push({ change, reason })
      continue
    }
    snap = scratch
    out.applied.push(change)
    out.restored.push(...scratchOut.restored)
    out.removed.push(...scratchOut.removed)
    out.recreated_courses.push(...scratchOut.recreated_courses)
    out.pruned_courses.push(...scratchOut.pruned_courses)
    out.students_restored.push(...scratchOut.students_restored)
  }

  out.snapshot = snap
  return out
}

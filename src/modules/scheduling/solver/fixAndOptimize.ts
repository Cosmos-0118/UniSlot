import type { ConflictGraph, Section } from '../types'
import { computeClashWeight } from './conflictGraph'
import { TOTAL_WEEKLY_SLOTS, isMathCourse } from './timeModel'

type EnrollmentIndex = {
  studentToSections: Map<string, string[]>
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

function buildEnrollmentIndex(sections: Section[]): EnrollmentIndex {
  const studentToSections = new Map<string, string[]>()
  for (const sec of sections) {
    for (const st of sec.enrolled_students) {
      if (!studentToSections.has(st)) studentToSections.set(st, [])
      studentToSections.get(st)!.push(sec.section_id)
    }
  }
  return { studentToSections }
}

function scoreAssignment(
  slotByCourse: Record<string, number>,
  sections: Section[],
  conflictGraph: ConflictGraph,
  enrollment: EnrollmentIndex,
): { students: number; clashWeight: number } {
  const slotMap = sectionSlotsFromBundle(sections, slotByCourse)
  return {
    clashWeight: computeClashWeight(conflictGraph, slotMap),
    students: countStudentsWithSlotClashes(enrollment.studentToSections, slotMap, TOTAL_WEEKLY_SLOTS),
  }
}

function pickConflictedCourses(
  slotByCourse: Record<string, number>,
  conflictGraph: ConflictGraph,
  sectionToCourse: Map<string, string>,
  windowSize: number,
): string[] {
  const contrib = new Map<string, number>()
  for (const e of conflictGraph.edges) {
    const ca = sectionToCourse.get(e.section_a)
    const cb = sectionToCourse.get(e.section_b)
    if (!ca || !cb || ca === cb) continue
    if ((slotByCourse[ca] ?? -1) !== (slotByCourse[cb] ?? -2)) continue
    contrib.set(ca, (contrib.get(ca) ?? 0) + e.weight)
    contrib.set(cb, (contrib.get(cb) ?? 0) + e.weight)
  }
  return [...contrib.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, windowSize)
    .map(([c]) => c)
}

/**
 * Pure-JS fix-and-optimize: freeze most course→day assignments, exhaustively
 * recolor a small window of currently conflicted courses (≤ 6^windowSize trials).
 * No WASM / backend required — decision domain is only 6 weekdays.
 */
export function fixAndOptimizeConflictedCourses(
  slotByCourse: Record<string, number>,
  courseCodes: string[],
  sections: Section[],
  conflictGraph: ConflictGraph,
  options?: {
    windowSize?: number
    shouldAbort?: () => boolean
  },
): { slotByCourse: Record<string, number>; students: number; clashWeight: number; improved: boolean } {
  const windowSize = Math.min(options?.windowSize ?? 5, 6)
  const sectionToCourse = new Map<string, string>()
  for (const sec of sections) sectionToCourse.set(sec.section_id, sec.course_code)
  const enrollment = buildEnrollmentIndex(sections)

  const baseline = scoreAssignment(slotByCourse, sections, conflictGraph, enrollment)
  let bestSlots = { ...slotByCourse }
  let bestStudents = baseline.students
  let bestClash = baseline.clashWeight

  if (baseline.students === 0 && baseline.clashWeight === 0) {
    return { slotByCourse: bestSlots, students: bestStudents, clashWeight: bestClash, improved: false }
  }

  const free = pickConflictedCourses(slotByCourse, conflictGraph, sectionToCourse, windowSize)
  if (!free.length) {
    // Fallback: highest total conflict-degree courses.
    const deg = new Map<string, number>()
    for (const e of conflictGraph.edges) {
      const ca = sectionToCourse.get(e.section_a)
      const cb = sectionToCourse.get(e.section_b)
      if (!ca || !cb || ca === cb) continue
      deg.set(ca, (deg.get(ca) ?? 0) + e.weight)
      deg.set(cb, (deg.get(cb) ?? 0) + e.weight)
    }
    free.push(
      ...[...deg.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, windowSize)
        .map(([c]) => c),
    )
  }
  if (!free.length) {
    return { slotByCourse: bestSlots, students: bestStudents, clashWeight: bestClash, improved: false }
  }

  const freeSet = new Set(free)
  const locked = courseCodes.filter((c) => !freeSet.has(c))
  void locked

  const domains: number[][] = free.map((code) => {
    const slots: number[] = []
    for (let s = 0; s < TOTAL_WEEKLY_SLOTS; s++) {
      if (s === 5 && !isMathCourse(code)) continue
      slots.push(s)
    }
    return slots.length ? slots : [slotByCourse[code] ?? 0]
  })

  const trial = { ...slotByCourse }
  const assignAt = (depth: number): void => {
    if (options?.shouldAbort?.()) return
    if (depth === free.length) {
      if (!facultySlotsFeasible(sections, trial)) return
      const scored = scoreAssignment(trial, sections, conflictGraph, enrollment)
      if (
        scored.students < bestStudents ||
        (scored.students === bestStudents && scored.clashWeight < bestClash)
      ) {
        bestStudents = scored.students
        bestClash = scored.clashWeight
        bestSlots = { ...trial }
      }
      return
    }
    const code = free[depth]!
    const domain = domains[depth]!
    for (const slot of domain) {
      trial[code] = slot
      assignAt(depth + 1)
      if (bestStudents === 0 && bestClash === 0) return
    }
  }

  assignAt(0)

  const improved =
    bestStudents < baseline.students ||
    (bestStudents === baseline.students && bestClash < baseline.clashWeight)

  return {
    slotByCourse: bestSlots,
    students: bestStudents,
    clashWeight: bestClash,
    improved,
  }
}

import type { EnrollmentRow, Section, Student } from '../types'
import { SPLIT_SECTION_CAP } from '../solver/capacity'
import type { SchedulingSnapshot } from './snapshot'

function enrollmentKey(row: { register_number: string; course_code: string }): string {
  return `${row.register_number}:${row.course_code}`
}

export type LateRowKind =
  | 'add'
  | 'already_enrolled'
  | 'duplicate_in_file'
  | 'unknown_course'
  | 'removal_ignored'

export type LateRowClassification = {
  kind: LateRowKind
  row: EnrollmentRow
  sheet_row?: number
  note?: string
}

export type LateAddition = {
  register_number: string
  student_name: string
  program: string
  course_code: string
  course_title: string
  mobile_number: string | null
  email_id: string | null
  faculty: string | null
  /** True when this register number was not in the previous snapshot. */
  is_new_student: boolean
}

export type LateContactDrift = {
  register_number: string
  field: 'name' | 'email' | 'mobile'
  before: string | null
  after: string | null
}

export type LateTitleDrift = {
  course_code: string
  snapshot_title: string
  late_title: string
}

export type LateAdditionsResult = {
  additions: LateAddition[]
  classifications: LateRowClassification[]
  contact_drift: LateContactDrift[]
  title_drift: LateTitleDrift[]
  unknown_course_codes: string[]
  /** Rows that appear in the snapshot but not in a full-workbook input (ignored). */
  removals_ignored: { register_number: string; course_code: string }[]
  /** True when the late file looked like a full workbook (superset of snapshot), not a delta. */
  was_full_workbook: boolean
}

/**
 * Classify late-file rows against a snapshot.
 * Accepts a delta (only new rows) or a full updated workbook (superset of snapshot rows).
 */
export function computeLateAdditions(
  snapshot: SchedulingSnapshot,
  lateRows: EnrollmentRow[],
): LateAdditionsResult {
  const snapshotKeys = new Set(snapshot.enrollmentRows.map(enrollmentKey))
  const knownCourses = new Set(Object.keys(snapshot.courseSections))
  const knownStudents = new Set(Object.keys(snapshot.students))

  const lateKeys = new Set<string>()
  for (const row of lateRows) {
    if (row.register_number && row.course_code) lateKeys.add(enrollmentKey(row))
  }

  // Heuristic: if ≥80% of snapshot keys appear in the late file and late has more rows,
  // treat it as a full workbook and subtract.
  let overlap = 0
  for (const key of snapshotKeys) {
    if (lateKeys.has(key)) overlap++
  }
  const overlapRatio = snapshotKeys.size === 0 ? 0 : overlap / snapshotKeys.size
  const was_full_workbook =
    snapshotKeys.size > 0 && lateKeys.size >= snapshotKeys.size && overlapRatio >= 0.8

  const classifications: LateRowClassification[] = []
  const additions: LateAddition[] = []
  const contact_drift: LateContactDrift[] = []
  const title_drift: LateTitleDrift[] = []
  const unknown_course_codes = new Set<string>()
  const seenInFile = new Set<string>()
  const titleSeen = new Set<string>()

  const removals_ignored: { register_number: string; course_code: string }[] = []
  if (was_full_workbook) {
    for (const row of snapshot.enrollmentRows) {
      const key = enrollmentKey(row)
      if (!lateKeys.has(key)) {
        removals_ignored.push({
          register_number: row.register_number,
          course_code: row.course_code,
        })
      }
    }
  }

  for (const row of lateRows) {
    if (!row.register_number || !row.course_code) continue
    const key = enrollmentKey(row)

    if (seenInFile.has(key)) {
      classifications.push({
        kind: 'duplicate_in_file',
        row,
        note: 'Duplicate row in late file — ignored',
      })
      continue
    }
    seenInFile.add(key)

    if (was_full_workbook && snapshotKeys.has(key)) {
      // Full workbook: existing rows are not late additions; still check contact drift.
      recordContactDrift(snapshot, row, contact_drift)
      continue
    }

    if (snapshotKeys.has(key)) {
      classifications.push({
        kind: 'already_enrolled',
        row,
        note: 'Already enrolled in the previous schedule',
      })
      recordContactDrift(snapshot, row, contact_drift)
      continue
    }

    const isKnownCourse = knownCourses.has(row.course_code)
    if (!isKnownCourse) {
      unknown_course_codes.add(row.course_code)
      classifications.push({
        kind: 'unknown_course',
        row,
        note: 'Course was not in the previous schedule — will need a weekday',
      })
    } else {
      classifications.push({ kind: 'add', row })
      const snapTitle = snapshot.courseSections[row.course_code]?.[0]?.course_title
      if (
        snapTitle &&
        row.course_title &&
        snapTitle !== row.course_title &&
        !titleSeen.has(row.course_code)
      ) {
        titleSeen.add(row.course_code)
        title_drift.push({
          course_code: row.course_code,
          snapshot_title: snapTitle,
          late_title: row.course_title,
        })
      }
    }

    recordContactDrift(snapshot, row, contact_drift)

    additions.push({
      register_number: row.register_number,
      student_name: row.student_name || row.register_number,
      program: row.program || '',
      course_code: row.course_code,
      course_title:
        (isKnownCourse
          ? snapshot.courseSections[row.course_code]?.[0]?.course_title
          : null) ||
        row.course_title ||
        row.course_code,
      mobile_number: row.mobile_number,
      email_id: row.email_id,
      faculty: row.faculty,
      is_new_student: !knownStudents.has(row.register_number),
    })
  }

  return {
    additions,
    classifications,
    contact_drift,
    title_drift,
    unknown_course_codes: [...unknown_course_codes].sort(),
    removals_ignored,
    was_full_workbook,
  }
}

function recordContactDrift(
  snapshot: SchedulingSnapshot,
  row: EnrollmentRow,
  out: LateContactDrift[],
): void {
  const st = snapshot.students[row.register_number]
  if (!st) return
  if (row.student_name && row.student_name !== st.name) {
    out.push({
      register_number: row.register_number,
      field: 'name',
      before: st.name,
      after: row.student_name,
    })
  }
  const lateEmail = row.email_id?.trim() || null
  if (lateEmail && lateEmail !== (st.email ?? null)) {
    out.push({
      register_number: row.register_number,
      field: 'email',
      before: st.email,
      after: lateEmail,
    })
  }
  const lateMobile = row.mobile_number?.trim() || null
  if (lateMobile && lateMobile !== (st.mobile ?? null)) {
    out.push({
      register_number: row.register_number,
      field: 'mobile',
      before: st.mobile,
      after: lateMobile,
    })
  }
}

export type CapacityConflict = {
  course_code: string
  course_title: string
  frozen_day_index: number
  sections: { section_id: string; enrollment: number; capacity: number }[]
  seats_free: number
  late_demand: number
  shortfall: number
  late_register_numbers: string[]
}

/** Courses where late demand exceeds remaining seats (before any strategy). */
export function preflightLateCapacity(
  courseSections: Record<string, Section[]>,
  additions: LateAddition[],
  slotByCourse: Record<string, number>,
): CapacityConflict[] {
  const demandByCourse = new Map<string, string[]>()
  for (const a of additions) {
    if (!(a.course_code in courseSections)) continue
    if (!demandByCourse.has(a.course_code)) demandByCourse.set(a.course_code, [])
    demandByCourse.get(a.course_code)!.push(a.register_number)
  }

  const conflicts: CapacityConflict[] = []
  for (const [code, regs] of demandByCourse) {
    const sections = courseSections[code]!
    const seats_free = sections.reduce(
      (n, s) => n + Math.max(0, s.capacity - s.enrolled_students.length),
      0,
    )
    const late_demand = regs.length
    const shortfall = Math.max(0, late_demand - seats_free)
    if (shortfall === 0) continue
    conflicts.push({
      course_code: code,
      course_title: sections[0]?.course_title ?? code,
      frozen_day_index: slotByCourse[code] ?? 0,
      sections: sections.map((s) => ({
        section_id: s.section_id,
        enrollment: s.enrolled_students.length,
        capacity: s.capacity,
      })),
      seats_free,
      late_demand,
      shortfall,
      late_register_numbers: [...regs].sort(),
    })
  }
  return conflicts.sort((a, b) => a.course_code.localeCompare(b.course_code))
}

export type OnFullStrategy = 'new-section' | 'equalize' | 'fit' | 'buffer' | 'park'

export type CapacityDecision = {
  course_code: string
  strategy: OnFullStrategy
  /** Only for strategy === 'buffer'. */
  buffer_per_section?: number
}

export type SectionAssignment = {
  register_number: string
  course_code: string
  section_id: string
  how: 'existing' | 'new_section' | 'overflow' | 'equalized'
}

export type ParkedRegistration = {
  register_number: string
  course_code: string
  reason: string
}

export type MergeLateResult = {
  courseSections: Record<string, Section[]>
  students: Record<string, Student>
  enrollmentRows: EnrollmentRow[]
  assignments: SectionAssignment[]
  new_section_ids: string[]
  moved_students: { register_number: string; course_code: string; from: string; to: string }[]
  capacity_waivers: { section_id: string; enrollment: number; capacity: number }[]
  parked: ParkedRegistration[]
  slot_assignments: Record<string, number>
}

/** Next section id for a course that needs an extra section. */
export function nextSectionId(courseCode: string, existing: Section[]): string {
  if (existing.length === 1 && existing[0]!.section_id === courseCode) {
    return `${courseCode}_S2`
  }
  const maxNum = existing.reduce((m, s) => Math.max(m, s.section_number), 0)
  return `${courseCode}_S${maxNum + 1}`
}

function leastLoadedIndex(sections: Section[], allowOverCapacity: boolean): number {
  let best = -1
  let bestLoad = Number.POSITIVE_INFINITY
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!
    const load = s.enrolled_students.length
    const space = s.capacity - load
    if (!allowOverCapacity && space <= 0) continue
    if (load < bestLoad || (load === bestLoad && (best < 0 || s.section_number < sections[best]!.section_number))) {
      bestLoad = load
      best = i
    }
  }
  return best
}

function facultyForNewSection(existing: Section[], newId: string, newNum: number): string {
  const base = existing[0]?.faculty
  if (base && !base.startsWith('Planning:')) {
    const root = base.replace(/\s·\sSec\s\d+$/, '')
    return `${root} · Sec ${newNum}`
  }
  return `Planning:${newId}`
}

function rebuildPrograms(sec: Section, students: Record<string, Student>): void {
  const progs = new Set<string>()
  for (const reg of sec.enrolled_students) {
    progs.add(students[reg]?.program ?? 'Unknown')
  }
  sec.programs = [...progs].sort()
}

/**
 * Equalize section loads for one course by moving the fewest possible existing students.
 * Returns the list of moves. Weekday unchanged (all sections share one day).
 */
export function equalizeCourseSections(
  sections: Section[],
  students: Record<string, Student>,
): { register_number: string; from: string; to: string }[] {
  if (sections.length < 2) return []
  const total = sections.reduce((n, s) => n + s.enrolled_students.length, 0)
  const target = Math.ceil(total / sections.length)
  const moves: { register_number: string; from: string; to: string }[] = []

  // Keep each section's existing order; transfer only the tail of over-target sections.
  let guard = 0
  while (guard++ < 10_000) {
    let donor = -1
    let donorOver = 0
    for (let i = 0; i < sections.length; i++) {
      const over = sections[i]!.enrolled_students.length - target
      if (over > donorOver) {
        donorOver = over
        donor = i
      }
    }
    if (donor < 0) break

    let receiver = -1
    let receiverUnder = 0
    for (let i = 0; i < sections.length; i++) {
      if (i === donor) continue
      const under = target - sections[i]!.enrolled_students.length
      const space = sections[i]!.capacity - sections[i]!.enrolled_students.length
      if (under > 0 && space > 0 && under > receiverUnder) {
        receiverUnder = under
        receiver = i
      }
    }
    if (receiver < 0) break

    const from = sections[donor]!
    const to = sections[receiver]!
    const reg = from.enrolled_students.pop()
    if (!reg) break
    to.enrolled_students.push(reg)
    moves.push({ register_number: reg, from: from.section_id, to: to.section_id })
  }

  for (const sec of sections) rebuildPrograms(sec, students)
  return moves
}

/**
 * Merge late additions into a deep-cloned snapshot section map.
 * Decisions must already cover every capacity conflict (or default to new-section).
 */
export function mergeLateStudentsIntoSections(args: {
  snapshot: SchedulingSnapshot
  additions: LateAddition[]
  decisions: CapacityDecision[]
  /** Register numbers to skip entirely (parked at student level). */
  parkedStudents?: Set<string>
  /** Specific reg:code pairs to skip (parked at course level). */
  parkedPairs?: Set<string>
  defaultBuffer?: number
}): MergeLateResult {
  const {
    snapshot,
    additions,
    decisions,
    parkedStudents = new Set(),
    parkedPairs = new Set(),
    defaultBuffer = 2,
  } = args

  const courseSections: Record<string, Section[]> = {}
  for (const [code, secs] of Object.entries(snapshot.courseSections)) {
    courseSections[code] = secs.map((s) => ({
      ...s,
      enrolled_students: [...s.enrolled_students],
      programs: [...s.programs],
    }))
  }

  const students: Record<string, Student> = {}
  for (const [k, v] of Object.entries(snapshot.students)) {
    students[k] = { ...v, enrolled_courses: [...v.enrolled_courses] }
  }

  const enrollmentRows: EnrollmentRow[] = snapshot.enrollmentRows.map((r) => ({ ...r }))
  const slot_assignments: Record<string, number> = { ...snapshot.slot_assignments }

  // Derive course→weekday from existing assignments.
  const slotByCourse: Record<string, number> = {}
  for (const [code, secs] of Object.entries(courseSections)) {
    for (const s of secs) {
      const slot = slot_assignments[s.section_id]
      if (slot !== undefined) slotByCourse[code] = slot
    }
  }

  const decisionByCourse = new Map(decisions.map((d) => [d.course_code, d]))
  const assignments: SectionAssignment[] = []
  const new_section_ids: string[] = []
  const moved_students: MergeLateResult['moved_students'] = []
  const capacity_waivers: MergeLateResult['capacity_waivers'] = []
  const parked: ParkedRegistration[] = []

  // Group additions by course for capacity handling.
  const byCourse = new Map<string, LateAddition[]>()
  for (const a of additions) {
    if (parkedStudents.has(a.register_number)) {
      parked.push({
        register_number: a.register_number,
        course_code: a.course_code,
        reason: 'Student parked (clash or capacity decision)',
      })
      continue
    }
    if (parkedPairs.has(enrollmentKey(a))) {
      parked.push({
        register_number: a.register_number,
        course_code: a.course_code,
        reason: 'Course registration parked (clash decision)',
      })
      continue
    }
    if (!byCourse.has(a.course_code)) byCourse.set(a.course_code, [])
    byCourse.get(a.course_code)!.push(a)
  }

  for (const [code, courseAdds] of [...byCourse.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let sections = courseSections[code]
    if (!sections) {
      // Callers must section (and place on a weekday) new courses before merging.
      for (const a of courseAdds) {
        parked.push({
          register_number: a.register_number,
          course_code: a.course_code,
          reason: 'Course has no sections — needs a weekday placement first',
        })
      }
      continue
    }

    const decision = decisionByCourse.get(code)
    const strategy: OnFullStrategy = decision?.strategy ?? 'new-section'
    const bufferN = decision?.buffer_per_section ?? defaultBuffer

    const seatsFree = () =>
      sections!.reduce((n, s) => n + Math.max(0, s.capacity - s.enrolled_students.length), 0)

    // Ensure capacity for this course's adds per strategy.
    if (courseAdds.length > seatsFree()) {
      if (strategy === 'park') {
        // Fill free seats first, park the rest.
        const placeable = seatsFree()
        const toPlace = courseAdds.slice(0, placeable)
        const toPark = courseAdds.slice(placeable)
        for (const a of toPark) {
          parked.push({
            register_number: a.register_number,
            course_code: a.course_code,
            reason: `No seats in ${code} (park strategy); shortfall`,
          })
        }
        placeIntoSections(toPlace, sections, students, enrollmentRows, assignments, 'existing', false)
        continue
      }

      if (strategy === 'fit') {
        placeIntoSections(courseAdds, sections, students, enrollmentRows, assignments, 'overflow', true)
        for (const s of sections) {
          if (s.enrolled_students.length > s.capacity) {
            capacity_waivers.push({
              section_id: s.section_id,
              enrollment: s.enrolled_students.length,
              capacity: s.capacity,
            })
          }
        }
        continue
      }

      if (strategy === 'buffer') {
        const softCap = (s: Section) => s.capacity + bufferN
        const softFree = sections.reduce(
          (n, s) => n + Math.max(0, softCap(s) - s.enrolled_students.length),
          0,
        )
        if (courseAdds.length <= softFree) {
          placeIntoSections(courseAdds, sections, students, enrollmentRows, assignments, 'overflow', true, softCap)
          for (const s of sections) {
            if (s.enrolled_students.length > s.capacity) {
              capacity_waivers.push({
                section_id: s.section_id,
                enrollment: s.enrolled_students.length,
                capacity: s.capacity,
              })
            }
          }
          continue
        }
        // Fill soft capacity, then create a new section for the rest.
        const sorted = [...courseAdds]
        const softPlace: LateAddition[] = []
        const remainder: LateAddition[] = []
        let remainingSoft = softFree
        for (const a of sorted) {
          if (remainingSoft > 0) {
            softPlace.push(a)
            remainingSoft--
          } else {
            remainder.push(a)
          }
        }
        placeIntoSections(softPlace, sections, students, enrollmentRows, assignments, 'overflow', true, softCap)
        for (const s of sections) {
          if (s.enrolled_students.length > s.capacity) {
            capacity_waivers.push({
              section_id: s.section_id,
              enrollment: s.enrolled_students.length,
              capacity: s.capacity,
            })
          }
        }
        const created = createNewSection(code, sections, slotByCourse, slot_assignments)
        new_section_ids.push(created.section_id)
        sections = courseSections[code]!
        placeIntoSections(remainder, sections, students, enrollmentRows, assignments, 'new_section', false)
        continue
      }

      if (strategy === 'new-section' || strategy === 'equalize') {
        // Fill free seats, put overflow into a new section.
        const free = seatsFree()
        const toExisting = courseAdds.slice(0, free)
        const toNew = courseAdds.slice(free)
        placeIntoSections(toExisting, sections, students, enrollmentRows, assignments, 'existing', false)
        if (toNew.length > 0) {
          const created = createNewSection(code, sections, slotByCourse, slot_assignments)
          new_section_ids.push(created.section_id)
          sections = courseSections[code]!
          placeIntoSections(toNew, [created], students, enrollmentRows, assignments, 'new_section', false)
          // Also append created into courseSections already done by createNewSection.
        }
        if (strategy === 'equalize') {
          const moves = equalizeCourseSections(sections, students)
          for (const m of moves) {
            moved_students.push({ ...m, course_code: code })
            // Retag assignment how for late students who were moved.
            for (const asg of assignments) {
              if (asg.register_number === m.register_number && asg.course_code === code) {
                asg.section_id = m.to
                asg.how = 'equalized'
              }
            }
          }
        }
        continue
      }
    }

    // Plenty of seats — just place.
    placeIntoSections(courseAdds, sections, students, enrollmentRows, assignments, 'existing', false)
  }

  for (const secs of Object.values(courseSections)) {
    for (const s of secs) rebuildPrograms(s, students)
  }

  return {
    courseSections,
    students,
    enrollmentRows,
    assignments,
    new_section_ids,
    moved_students,
    capacity_waivers,
    parked,
    slot_assignments,
  }

  function createNewSection(
    code: string,
    sections: Section[],
    slots: Record<string, number>,
    slotAssign: Record<string, number>,
  ): Section {
    const newId = nextSectionId(code, sections)
    const newNum = sections.reduce((m, s) => Math.max(m, s.section_number), 0) + 1
    const created: Section = {
      section_id: newId,
      course_code: code,
      course_title: sections[0]!.course_title,
      section_number: newNum,
      faculty: facultyForNewSection(sections, newId, newNum),
      capacity: SPLIT_SECTION_CAP,
      enrolled_students: [],
      programs: [],
    }
    sections.push(created)
    courseSections[code] = sections
    const day = slots[code]
    if (day !== undefined) slotAssign[newId] = day
    return created
  }
}

function placeIntoSections(
  adds: LateAddition[],
  sections: Section[],
  students: Record<string, Student>,
  enrollmentRows: EnrollmentRow[],
  assignments: SectionAssignment[],
  how: SectionAssignment['how'],
  allowOver: boolean,
  capacityFn: (s: Section) => number = (s) => s.capacity,
): void {
  for (const a of adds) {
    // Prefer least-loaded under capacityFn; ties broken by section number for determinism.
    let best = -1
    let bestLoad = Number.POSITIVE_INFINITY
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]!
      const load = s.enrolled_students.length
      if (load >= capacityFn(s) && !allowOver) continue
      if (
        load < bestLoad ||
        (load === bestLoad && best >= 0 && s.section_number < sections[best]!.section_number)
      ) {
        bestLoad = load
        best = i
      }
    }
    if (best < 0) best = leastLoadedIndex(sections, true)
    if (best < 0) continue
    const sec = sections[best]!
    if (!sec.enrolled_students.includes(a.register_number)) {
      sec.enrolled_students.push(a.register_number)
    }

    let st = students[a.register_number]
    if (!st) {
      st = {
        register_number: a.register_number,
        name: a.student_name,
        program: a.program,
        email: a.email_id,
        mobile: a.mobile_number,
        enrolled_courses: [],
      }
      students[a.register_number] = st
    } else {
      // Late file wins for contact fields.
      if (a.student_name) st.name = a.student_name
      if (a.email_id) st.email = a.email_id
      if (a.mobile_number) st.mobile = a.mobile_number
      if (a.program) st.program = a.program
    }
    if (!st.enrolled_courses.includes(a.course_code)) {
      st.enrolled_courses.push(a.course_code)
      st.enrolled_courses.sort()
    }

    enrollmentRows.push({
      program: a.program,
      register_number: a.register_number,
      student_name: a.student_name,
      mobile_number: a.mobile_number,
      email_id: a.email_id,
      course_code: a.course_code,
      course_title: a.course_title,
      faculty: a.faculty,
      registration_type: null,
      remarks: null,
    })

    assignments.push({
      register_number: a.register_number,
      course_code: a.course_code,
      section_id: sec.section_id,
      how,
    })
  }
}

export type FrozenInvariantViolation = {
  kind:
    | 'weekday_moved'
    | 'section_renamed'
    | 'faculty_changed'
    | 'capacity_changed'
    | 'untouched_student_clash'
  message: string
}

/**
 * Assert that pre-existing weekdays, section ids, and faculties were not disturbed,
 * and that students whose registration set was untouched did not gain a clash.
 */
export function assertFrozenInvariants(args: {
  before: SchedulingSnapshot
  afterSections: Record<string, Section[]>
  afterSlots: Record<string, number>
  afterClashReds: Set<string>
  beforeClashReds: Set<string>
  touchedRegisterNumbers: Set<string>
}): FrozenInvariantViolation[] {
  const violations: FrozenInvariantViolation[] = []
  const { before, afterSections, afterSlots, afterClashReds, beforeClashReds, touchedRegisterNumbers } =
    args

  for (const [code, secs] of Object.entries(before.courseSections)) {
    const afterSecs = afterSections[code]
    if (!afterSecs) {
      violations.push({
        kind: 'section_renamed',
        message: `Course ${code} disappeared after late merge`,
      })
      continue
    }
    for (const sec of secs) {
      const match = afterSecs.find((s) => s.section_id === sec.section_id)
      if (!match) {
        violations.push({
          kind: 'section_renamed',
          message: `Section ${sec.section_id} was removed or renamed`,
        })
        continue
      }
      if (match.faculty !== sec.faculty) {
        violations.push({
          kind: 'faculty_changed',
          message: `Section ${sec.section_id} faculty changed: "${sec.faculty}" → "${match.faculty}"`,
        })
      }
      const beforeSlot = before.slot_assignments[sec.section_id]
      const afterSlot = afterSlots[sec.section_id]
      if (beforeSlot !== undefined && afterSlot === undefined) {
        violations.push({
          kind: 'weekday_moved',
          message: `Section ${sec.section_id} lost its weekday (was ${beforeSlot})`,
        })
      } else if (beforeSlot !== undefined && afterSlot !== beforeSlot) {
        violations.push({
          kind: 'weekday_moved',
          message: `Section ${sec.section_id} weekday moved: ${beforeSlot} → ${afterSlot}`,
        })
      }
      if (match.capacity !== sec.capacity) {
        violations.push({
          kind: 'capacity_changed',
          message: `Section ${sec.section_id} capacity changed: ${sec.capacity} → ${match.capacity}`,
        })
      }
      // Every previously enrolled student must still be in this section or another section of same course
      // (equalize may move them). They must NOT disappear.
      for (const reg of sec.enrolled_students) {
        const stillHere = afterSecs.some((s) => s.enrolled_students.includes(reg))
        if (!stillHere) {
          violations.push({
            kind: 'section_renamed',
            message: `Student ${reg} vanished from course ${code}`,
          })
        }
      }
    }
  }

  for (const reg of afterClashReds) {
    if (beforeClashReds.has(reg)) continue
    if (touchedRegisterNumbers.has(reg)) continue
    violations.push({
      kind: 'untouched_student_clash',
      message: `Untouched student ${reg} gained a clash — merge bug`,
    })
  }

  return violations
}

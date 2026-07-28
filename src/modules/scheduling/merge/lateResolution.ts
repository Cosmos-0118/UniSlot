import { slotIndexToDay } from '../solver/timeModel'
import type { Section, Student } from '../types'
import type {
  CapacityConflict,
  LateAddition,
  OnFullStrategy,
} from './lateEnrollment'
import { nextSectionId } from './lateEnrollment'
import { SPLIT_SECTION_CAP } from '../solver/capacity'

export type ProjectedSectionLoad = {
  section_id: string
  enrollment: number
  capacity: number
  is_new?: boolean
}

export type CapacityOption = {
  strategy: OnFullStrategy
  label: string
  summary: string
  projected: ProjectedSectionLoad[]
  /** Existing students who would change section (equalize only). */
  students_moved: number
  /** Registrations that would be parked. */
  parked_count: number
  /** Seats past capacity (fit / buffer). */
  overflow_seats: number
  buffer_per_section?: number
}

export type CapacityPanel = {
  conflict: CapacityConflict
  frozen_day: string
  options: CapacityOption[]
}

function projectLoads(
  sections: { section_id: string; enrollment: number; capacity: number }[],
  extraOnExisting: number[],
  newSections: { enrollment: number; capacity: number; section_id: string }[] = [],
): ProjectedSectionLoad[] {
  const out: ProjectedSectionLoad[] = sections.map((s, i) => ({
    section_id: s.section_id,
    enrollment: s.enrollment + (extraOnExisting[i] ?? 0),
    capacity: s.capacity,
  }))
  for (const n of newSections) {
    out.push({
      section_id: n.section_id,
      enrollment: n.enrollment,
      capacity: n.capacity,
      is_new: true,
    })
  }
  return out
}

function distributeInto(
  capacities: number[],
  current: number[],
  count: number,
  softExtra = 0,
): number[] {
  const extra = current.map(() => 0)
  let remaining = count
  while (remaining > 0) {
    let best = -1
    let bestLoad = Infinity
    for (let i = 0; i < current.length; i++) {
      const load = current[i]! + extra[i]!
      const cap = capacities[i]! + softExtra
      if (load >= cap) continue
      if (load < bestLoad) {
        bestLoad = load
        best = i
      }
    }
    if (best < 0) break
    extra[best]!++
    remaining--
  }
  return extra
}

/** Build the option set shown in Panel 1 for one over-capacity course. */
export function buildCapacityOptions(
  conflict: CapacityConflict,
  existingSections: Section[],
  bufferDefault = 2,
): CapacityOption[] {
  const { late_demand, seats_free, shortfall, sections } = conflict
  const current = sections.map((s) => s.enrollment)
  const caps = sections.map((s) => s.capacity)
  const newId = nextSectionId(conflict.course_code, existingSections)

  // Option 1: new section, late students only
  const fillExisting = distributeInto(caps, current, Math.min(seats_free, late_demand))
  const intoNew = late_demand - fillExisting.reduce((a, b) => a + b, 0)
  const newSectionOnly: CapacityOption = {
    strategy: 'new-section',
    label: 'New section, late students only',
    summary: intoNew > 0
      ? `Nothing existing moves. New section gets ${intoNew} late student(s); loads will be uneven.`
      : 'Enough free seats — no new section needed (should not appear).',
    projected: projectLoads(
      sections,
      fillExisting,
      intoNew > 0
        ? [{ section_id: newId, enrollment: intoNew, capacity: SPLIT_SECTION_CAP }]
        : [],
    ),
    students_moved: 0,
    parked_count: 0,
    overflow_seats: 0,
  }

  // Option 2: new section then equalize
  const totalAfter = sections.reduce((n, s) => n + s.enrollment, 0) + late_demand
  const nSections = sections.length + (intoNew > 0 || shortfall > 0 ? 1 : 0)
  const equalTarget = Math.ceil(totalAfter / Math.max(1, nSections))
  // Approximate moved count: students currently above the post-equalize target.
  let movedApprox = 0
  const provisional = sections.map((s) => s.enrollment)
  // After adding late to a new section, equalize pulls from over-target existing sections.
  for (const e of provisional) {
    if (e > equalTarget) movedApprox += e - equalTarget
  }
  const equalLoads: ProjectedSectionLoad[] = []
  let remaining = totalAfter
  for (let i = 0; i < nSections; i++) {
    const take = i === nSections - 1 ? remaining : equalTarget
    remaining -= take
    equalLoads.push({
      section_id: i < sections.length ? sections[i]!.section_id : newId,
      enrollment: take,
      capacity: i < sections.length ? sections[i]!.capacity : SPLIT_SECTION_CAP,
      is_new: i >= sections.length,
    })
  }
  const equalize: CapacityOption = {
    strategy: 'equalize',
    label: 'New section, then equalize the course',
    summary:
      `${movedApprox} existing student(s) would change section. ` +
      `Their weekday and clash status do NOT change — only printed section rosters go stale.`,
    projected: equalLoads,
    students_moved: movedApprox,
    parked_count: 0,
    overflow_seats: 0,
  }

  // Option 3: fit into existing — least-loaded first, capacity ignored.
  const fitExtra = current.map(() => 0)
  for (let rem = late_demand; rem > 0; rem--) {
    let best = 0
    for (let i = 1; i < current.length; i++) {
      if (current[i]! + fitExtra[i]! < current[best]! + fitExtra[best]!) best = i
    }
    fitExtra[best]!++
  }
  const overflowSeats = fitExtra.reduce(
    (n, e, i) => n + Math.max(0, current[i]! + e - caps[i]!),
    0,
  )
  const fit: CapacityOption = {
    strategy: 'fit',
    label: 'Fit them into the existing sections',
    summary: `No new section. Capacity exceeded by ${overflowSeats} seat(s) — waiver logged.`,
    projected: projectLoads(sections, fitExtra),
    students_moved: 0,
    parked_count: 0,
    overflow_seats: overflowSeats,
  }

  // Option 4: buffer then new section
  const softExtra = distributeInto(caps, current, late_demand, bufferDefault)
  const softPlaced = softExtra.reduce((a, b) => a + b, 0)
  const bufferRemainder = late_demand - softPlaced
  const bufferOverflow = softExtra.reduce(
    (n, e, i) => n + Math.max(0, current[i]! + e - caps[i]!),
    0,
  )
  const buffer: CapacityOption = {
    strategy: 'buffer',
    label: `Fit up to +${bufferDefault} per section, new section for the rest`,
    summary:
      bufferRemainder > 0
        ? `Soft overflow ${bufferOverflow} seat(s); ${bufferRemainder} go to a new section.`
        : `All fit within +${bufferDefault} soft capacity; overflow ${bufferOverflow} seat(s).`,
    projected: projectLoads(
      sections,
      softExtra,
      bufferRemainder > 0
        ? [{ section_id: newId, enrollment: bufferRemainder, capacity: SPLIT_SECTION_CAP }]
        : [],
    ),
    students_moved: 0,
    parked_count: 0,
    overflow_seats: bufferOverflow,
    buffer_per_section: bufferDefault,
  }

  // Option 5: park shortfall
  const parkFill = distributeInto(caps, current, seats_free)
  const park: CapacityOption = {
    strategy: 'park',
    label: `Park the ${shortfall} student(s) with no seat`,
    summary: `${seats_free} late student(s) fill free seats; ${shortfall} listed as unplaced.`,
    projected: projectLoads(sections, parkFill),
    students_moved: 0,
    parked_count: shortfall,
    overflow_seats: 0,
  }

  return [newSectionOnly, equalize, fit, buffer, park]
}

export function buildCapacityPanel(
  conflict: CapacityConflict,
  existingSections: Section[],
  bufferDefault = 2,
): CapacityPanel {
  return {
    conflict,
    frozen_day: slotIndexToDay(conflict.frozen_day_index),
    options: buildCapacityOptions(conflict, existingSections, bufferDefault),
  }
}

export type PredictedClash = {
  register_number: string
  student_name: string
  program: string
  late_courses: string[]
  day: string
  day_index: number
  clashing_courses: string[]
  /** Frozen enrollment counts for each clashing course (for the "why" text). */
  course_enrollments: Record<string, number>
}

export type ClashOption = {
  choice: 'accept' | 'drop-course' | 'park-student'
  label: string
  summary: string
  /** When choice === 'drop-course', which course to drop. */
  drop_course_code?: string
}

export type ClashPanel = {
  clash: PredictedClash
  options: ClashOption[]
}

/**
 * Predict late-student clashes against frozen weekdays.
 * Only students touched by this batch are considered.
 */
export function predictLateClashes(args: {
  additions: LateAddition[]
  students: Record<string, Student>
  slotByCourse: Record<string, number>
  courseSections: Record<string, Section[]>
}): PredictedClash[] {
  const { additions, students, slotByCourse, courseSections } = args

  // Effective course set per touched student after adding late courses.
  const lateByStudent = new Map<string, LateAddition[]>()
  for (const a of additions) {
    if (!lateByStudent.has(a.register_number)) lateByStudent.set(a.register_number, [])
    lateByStudent.get(a.register_number)!.push(a)
  }

  const out: PredictedClash[] = []
  for (const [reg, lateAdds] of lateByStudent) {
    const existing = students[reg]?.enrolled_courses ?? []
    const after = new Set([...existing, ...lateAdds.map((a) => a.course_code)])
    const byDay = new Map<number, string[]>()
    for (const code of after) {
      const day = slotByCourse[code]
      if (day === undefined) continue
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(code)
    }
    for (const [day, courses] of byDay) {
      if (courses.length < 2) continue
      // Only report if at least one of the courses on this day is newly added.
      const lateCodes = new Set(lateAdds.map((a) => a.course_code))
      if (!courses.some((c) => lateCodes.has(c))) continue

      const course_enrollments: Record<string, number> = {}
      for (const c of courses) {
        course_enrollments[c] =
          courseSections[c]?.reduce((n, s) => n + s.enrolled_students.length, 0) ?? 0
      }

      out.push({
        register_number: reg,
        student_name: lateAdds[0]?.student_name ?? students[reg]?.name ?? reg,
        program: lateAdds[0]?.program ?? students[reg]?.program ?? '',
        late_courses: lateAdds.map((a) => a.course_code).sort(),
        day: slotIndexToDay(day),
        day_index: day,
        clashing_courses: [...courses].sort(),
        course_enrollments,
      })
    }
  }

  return out.sort(
    (a, b) =>
      a.register_number.localeCompare(b.register_number) || a.day.localeCompare(b.day),
  )
}

export function buildClashPanel(clash: PredictedClash): ClashPanel {
  const options: ClashOption[] = [
    {
      choice: 'accept',
      label: 'Schedule both anyway',
      summary: `Student is marked Red; clash on ${clash.day} logged with its cause.`,
    },
  ]
  for (const code of clash.clashing_courses) {
    if (!clash.late_courses.includes(code)) continue
    options.push({
      choice: 'drop-course',
      label: `Drop ${code} for now`,
      summary: `Other course(s) on ${clash.day} stay scheduled; ${code} is listed as parked.`,
      drop_course_code: code,
    })
  }
  options.push({
    choice: 'park-student',
    label: 'Park this student entirely',
    summary: 'Nothing scheduled for them; listed for manual handling.',
  })
  return { clash, options }
}

/** Format projected loads as "60 / 58 / 7". */
export function formatProjectedLoads(loads: ProjectedSectionLoad[]): string {
  return loads.map((l) => String(l.enrollment)).join(' / ')
}

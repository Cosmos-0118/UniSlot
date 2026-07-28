import { describe, expect, it } from 'vitest'
import { buildFixedDays, computeEnrollmentDelta } from '../../src/modules/scheduling/merge/enrollmentDelta'
import type { SchedulingSnapshot } from '../../src/modules/scheduling/merge/snapshot'
import type { Course, EnrollmentRow, Student } from '../../src/modules/scheduling/types'
import {
  applyDistinctFacultyPerSection,
  assignStudentsToSections,
  computeSectionSplits,
  extractFacultyConstraints,
} from '../../src/modules/scheduling/preprocess/preprocessing'
import { sectionSlotsFromCourseSlots } from '../../src/modules/scheduling/solver/cpsatInstance'
import { auditScheduleHardConstraints, parallelHardCap } from '../../src/modules/scheduling/solver/hardConstraints'
import { runRectifyPipeline } from '../../src/modules/scheduling/pipeline/rectifyRun'

function row(reg: string, course: string): EnrollmentRow {
  return {
    program: 'CS',
    register_number: reg,
    student_name: reg,
    mobile_number: null,
    email_id: null,
    course_code: course,
    course_title: course,
    faculty: null,
    registration_type: null,
    remarks: null,
  }
}

function buildSnapshotFromEnrollment(
  enrollmentRows: EnrollmentRow[],
  slotByCourse: Record<string, number>,
): SchedulingSnapshot {
  const students: Record<string, Student> = {}
  const courses: Record<string, Course> = {}
  for (const r of enrollmentRows) {
    if (!students[r.register_number]) {
      students[r.register_number] = {
        register_number: r.register_number,
        name: r.student_name,
        program: r.program,
        email: null,
        mobile: null,
        enrolled_courses: [],
      }
    }
    if (!students[r.register_number]!.enrolled_courses.includes(r.course_code)) {
      students[r.register_number]!.enrolled_courses.push(r.course_code)
    }
    if (!courses[r.course_code]) {
      courses[r.course_code] = {
        code: r.course_code,
        title: r.course_title,
        enrollment_count: 0,
        faculty: null,
        section_count: 1,
      }
    }
    courses[r.course_code]!.enrollment_count++
  }
  let courseSections = computeSectionSplits(courses)
  applyDistinctFacultyPerSection(courses, courseSections)
  courseSections = assignStudentsToSections(students, courseSections, enrollmentRows)
  const slotAssignments = sectionSlotsFromCourseSlots(courseSections, slotByCourse)
  return {
    slot_model: 'weekday-v2',
    slot_assignments: slotAssignments,
    courseSections,
    students,
    enrollmentRows,
    allowSaturdayForMath: false,
  }
}

describe('rectify pinned slots without CP-SAT', () => {
  it('re-sections changed student while keeping course weekdays', () => {
    const baseline = [row('S1', 'A'), row('S1', 'B'), row('S2', 'C')]
    const rectified = [row('S1', 'C'), row('S2', 'C')]
    const snapshot = buildSnapshotFromEnrollment(baseline, { A: 0, B: 1, C: 2 })

    const delta = computeEnrollmentDelta(baseline, rectified)
    expect(delta.changed_students).toHaveLength(1)
    expect(delta.new_course_codes).toHaveLength(0)

    const newCodes = new Set(['C'])
    const fixedDays = buildFixedDays(snapshot, newCodes)
    expect(fixedDays).toEqual({ C: 2 })

    const students: Record<string, Student> = {
      S1: {
        register_number: 'S1',
        name: 'S1',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['C'],
      },
      S2: {
        register_number: 'S2',
        name: 'S2',
        program: 'CS',
        email: null,
        mobile: null,
        enrolled_courses: ['C'],
      },
    }
    const courses: Record<string, Course> = {
      C: { code: 'C', title: 'C', enrollment_count: 2, faculty: null, section_count: 1 },
    }
    let courseSections = computeSectionSplits(courses)
    applyDistinctFacultyPerSection(courses, courseSections)
    courseSections = assignStudentsToSections(students, courseSections, rectified)
    const facultyConstraints = extractFacultyConstraints(courseSections)
    const slotAssignments = sectionSlotsFromCourseSlots(courseSections, fixedDays)
    const audit = auditScheduleHardConstraints(
      courseSections,
      slotAssignments,
      parallelHardCap(1),
      facultyConstraints,
      { allowSaturdayForMath: false },
    )
    expect(audit.feasible).toBe(true)
    expect(slotAssignments.C).toBe(2)
    expect(courseSections.C![0]!.enrolled_students.sort()).toEqual(['S1', 'S2'])
  })
})

describe('runRectifyPipeline', () => {
  it('completes when the previous run already had student clashes', async () => {
    // S3 is double-booked on Monday in the baseline; rectify must not treat that as fatal.
    const baseline = [
      row('S1', 'A'),
      row('S2', 'B'),
      row('S3', 'A'),
      row('S3', 'B'),
    ]
    const rectified = [...baseline, row('S1', 'B')]
    const snapshot = buildSnapshotFromEnrollment(baseline, { A: 0, B: 0 })

    const result = await runRectifyPipeline(new ArrayBuffer(0), () => undefined, {
      rectifiedRows: rectified,
      baselineRows: baseline,
      previousSnapshot: snapshot,
      allowSaturdayForMath: false,
    })

    expect(result.infeasible).toBeFalsy()
    expect(result.schedule).not.toBeNull()

    const report = result.rectificationReport!
    expect(report.placement_method).toBe('pinned-only')
    expect(report.hard_constraints_feasible).toBe(true)
    // S3's Monday clash predates the rectification, so it is carried over, not introduced.
    expect(report.carried_over_clashes.map((c) => c.register_number)).toContain('S3')
    // S1 picked up B on the same Monday as A, which is genuinely new.
    expect(report.new_clashes.map((c) => c.register_number)).toEqual(['S1'])
  })

  it('reports a structural blocker instead of spawning the solver', async () => {
    const baseline = [row('S1', '21CSC202J')]
    const rectified = [...baseline, row('S2', 'NEWCOURSE')]
    // Saturday pin becomes unreachable once Saturday is switched off.
    const snapshot = buildSnapshotFromEnrollment(baseline, { '21CSC202J': 5 })

    const result = await runRectifyPipeline(new ArrayBuffer(0), () => undefined, {
      rectifiedRows: rectified,
      baselineRows: baseline,
      previousSnapshot: snapshot,
      allowSaturdayForMath: false,
    })

    expect(result.infeasible).toBe(true)
    expect(result.infeasible_reason).toContain('Saturday is now blocked')
    expect(result.schedule).toBeNull()
  })

  it('keeps every continuing weekday identical to the snapshot', async () => {
    const baseline = [row('S1', 'A'), row('S2', 'B'), row('S3', 'C')]
    const rectified = [...baseline, row('S4', 'A')]
    const snapshot = buildSnapshotFromEnrollment(baseline, { A: 3, B: 1, C: 4 })

    const result = await runRectifyPipeline(new ArrayBuffer(0), () => undefined, {
      rectifiedRows: rectified,
      baselineRows: baseline,
      previousSnapshot: snapshot,
      allowSaturdayForMath: false,
    })

    expect(result.infeasible).toBeFalsy()
    const slots = result.schedulingSnapshot!.slot_assignments
    for (const [sectionId, slot] of Object.entries(snapshot.slot_assignments)) {
      expect(slots[sectionId]).toBe(slot)
    }
  })
})

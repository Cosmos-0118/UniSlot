import { buildConflictGraph, extractFacultyConstraints } from '../preprocess/preprocessing'
import { auditScheduleHardConstraints, parallelHardCap } from '../solver/scheduler'
import { buildSchedule, computeClashReport } from '../solver/scheduleOutput'
import { computeSchedulingStats } from '../solver/metrics'
import { computeCourseEmailGroups, type PipelineResult, type RunPipelineOptions } from '../pipeline/run'
import { loadAndValidate, parseExcelRows, validateBusinessRules, buildCanonicalData } from '../parse/parser'
import type { EnrollmentRow, Section, Student, ValidationResult } from '../types'
import { buildClashXlsxBuffer, buildScheduleXlsxBuffer } from '../pipeline/exports'
import { readFirstSheetAsAoA } from '../io/excelIo'
import {
  cloneSchedulingSnapshot,
  deepCloneCourseSections,
  type SchedulingSnapshot,
} from './snapshot'

function studentOtherCourses(students: Record<string, Student>, reg: string, currentCourse: string): string[] {
  const st = students[reg]
  if (!st) return []
  return st.enrolled_courses.filter((c) => c !== currentCourse).sort()
}

function crossEdgeScoreForChunk(
  courseCode: string,
  sections: Section[],
  secIdx: number,
  ids: string[],
  students: Record<string, Student>,
): number {
  const sec = sections[secIdx]!
  let crossEdges = 0
  const setOther = new Set<string>()
  for (const oid of sec.enrolled_students) {
    for (const oc of studentOtherCourses(students, oid, courseCode)) setOther.add(oc)
  }
  for (const reg of ids) {
    for (const oc of studentOtherCourses(students, reg, courseCode)) {
      if (setOther.has(oc)) crossEdges++
    }
  }
  return crossEdges
}

/**
 * Places one student into the best-fitting section for a course (capacity + edge heuristic),
 * matching the spirit of {@link assignStudentsToSections} but without moving existing students.
 */
export function appendStudentToCourseSection(
  courseSections: Record<string, Section[]>,
  students: Record<string, Student>,
  courseCode: string,
  studentReg: string,
  program: string,
): { ok: true } | { ok: false; reason: string } {
  const sections = courseSections[courseCode]
  if (!sections?.length) {
    return { ok: false, reason: `Course ${courseCode} is not part of this saved schedule.` }
  }
  for (const sec of sections) {
    if (sec.enrolled_students.includes(studentReg)) return { ok: true }
  }
  const sectionLoads = sections.map((s) => s.enrolled_students.length)
  let bestSi = -1
  let bestScore = Number.POSITIVE_INFINITY
  for (let si = 0; si < sections.length; si++) {
    const space = sections[si]!.capacity - sectionLoads[si]!
    if (space <= 0) continue
    const cross = crossEdgeScoreForChunk(courseCode, sections, si, [studentReg], students)
    const loadPenalty = sectionLoads[si]! * 0.01
    const score = cross * 1000 + loadPenalty
    if (score < bestScore) {
      bestScore = score
      bestSi = si
    }
  }
  if (bestSi < 0) {
    return {
      ok: false,
      reason: `No section capacity left for ${courseCode} (student ${studentReg}).`,
    }
  }
  const sec = sections[bestSi]!
  sec.enrolled_students.push(studentReg)
  if (!sec.programs.includes(program)) sec.programs.push(program)
  return { ok: true }
}

export type LateMergeSummary = {
  addedEnrollmentRows: number
  skippedAlreadyScheduled: number
  newStudents: number
  existingStudentsNewCourses: number
}

function emptyInvalid(message: string): PipelineResult {
  return {
    validation: {
      is_valid: false,
      errors: [{ field: 'late_merge', message }],
      warnings: [],
      total_rows: 0,
      valid_rows: 0,
    },
    schedule: null,
    clashReport: null,
    scheduleXlsx: null,
    clashXlsx: null,
    courseEmailsXlsx: null,
    courseEmailsData: null,
    stats: null,
    schedulingSnapshot: null,
  }
}

export type MergeLateEnrollmentResult = PipelineResult & {
  mergeSummary: LateMergeSummary | null
}

/**
 * Parses a workbook of **new** enrollment rows, merges them into a frozen snapshot (same section
 * time slots), assigns only the delta into existing sections, then rebuilds exports.
 */
export async function mergeLateEnrollmentIntoSnapshot(
  snapshot: SchedulingSnapshot,
  newWorkbookBuffer: ArrayBuffer,
  options?: RunPipelineOptions,
): Promise<MergeLateEnrollmentResult> {
  const snap = cloneSchedulingSnapshot(snapshot)

  const aoa = await readFirstSheetAsAoA(newWorkbookBuffer)
  if (!aoa) {
    return { ...emptyInvalid('No worksheets found or workbook could not be read.'), mergeSummary: null }
  }

  const { rows, validation: parseValidation } = parseExcelRows(aoa)
  const incoming = loadAndValidate(rows, parseValidation)
  if (!incoming.validation.is_valid) {
    return {
      validation: incoming.validation,
      schedule: null,
      clashReport: null,
      scheduleXlsx: null,
      clashXlsx: null,
      courseEmailsXlsx: null,
      courseEmailsData: null,
      stats: null,
      schedulingSnapshot: null,
      mergeSummary: null,
    }
  }

  const baselineKeys = new Set(
    snap.enrollmentRows.map((r) => `${r.register_number}:${r.course_code}`),
  )

  const deltaRows: EnrollmentRow[] = []
  let skippedAlreadyScheduled = 0
  for (const row of incoming.enrollmentRows) {
    const key = `${row.register_number}:${row.course_code}`
    if (baselineKeys.has(key)) {
      skippedAlreadyScheduled++
      continue
    }
    if (!snap.courseSections[row.course_code]) {
      return {
        ...emptyInvalid(
          `Row for ${row.register_number} references ${row.course_code}, which was not in the original saved schedule. Late adds are limited to courses already sectioned in that run.`,
        ),
        mergeSummary: null,
      }
    }
    deltaRows.push(row)
  }

  if (deltaRows.length === 0) {
    return {
      ...emptyInvalid(
        skippedAlreadyScheduled > 0
          ? 'Every row in this file was already part of the saved run. Upload only new registrations (students or courses not already in the snapshot).'
          : 'No new enrollment rows found in the workbook.',
      ),
      mergeSummary: {
        addedEnrollmentRows: 0,
        skippedAlreadyScheduled,
        newStudents: 0,
        existingStudentsNewCourses: 0,
      },
    }
  }

  const merged = [...snap.enrollmentRows, ...deltaRows]
  const { rows: mergedDeduped, validation: biz } = validateBusinessRules(merged)
  if (!biz.is_valid) {
    const v: ValidationResult = {
      is_valid: false,
      errors: [...incoming.validation.errors, ...biz.errors],
      warnings: [...incoming.validation.warnings, ...biz.warnings],
      total_rows: merged.length,
      valid_rows: biz.valid_rows,
    }
    return {
      validation: v,
      schedule: null,
      clashReport: null,
      scheduleXlsx: null,
      clashXlsx: null,
      courseEmailsXlsx: null,
      courseEmailsData: null,
      stats: null,
      schedulingSnapshot: null,
      mergeSummary: null,
    }
  }

  const { students: mergedStudents } = buildCanonicalData(mergedDeduped)
  const courseSections = deepCloneCourseSections(snap.courseSections)

  const baselineRegs = new Set(Object.keys(snap.students))
  const newStudentRegs = new Set<string>()
  const existingRegsWithNewCourse = new Set<string>()
  for (const row of deltaRows) {
    if (!baselineRegs.has(row.register_number)) newStudentRegs.add(row.register_number)
    else existingRegsWithNewCourse.add(row.register_number)
  }

  const sortedDelta = [...deltaRows].sort(
    (a, b) =>
      a.register_number.localeCompare(b.register_number) || a.course_code.localeCompare(b.course_code),
  )

  for (const row of sortedDelta) {
    const placed = appendStudentToCourseSection(
      courseSections,
      mergedStudents,
      row.course_code,
      row.register_number,
      row.program,
    )
    if (!placed.ok) {
      return { ...emptyInvalid(placed.reason), mergeSummary: null }
    }
  }

  const conflictGraph = buildConflictGraph(mergedStudents, courseSections)
  const facultyConstraints = extractFacultyConstraints(courseSections)
  const flatSections = Object.values(courseSections).flat()
  const parallelCap = parallelHardCap(flatSections.length)
  const audit = auditScheduleHardConstraints(courseSections, snap.slot_assignments, parallelCap, facultyConstraints)

  let schedule = buildSchedule(courseSections, snap.slot_assignments, {
    solver_used: 'late-enrollment-merge',
    solver_time_seconds: 0,
    hard_constraints_feasible: audit.feasible,
    hard_constraint_violations: audit.violations,
    solver_primary_metrics_zero: false,
  })
  const clashReport = computeClashReport(mergedStudents, courseSections, snap.slot_assignments)
  schedule = { ...schedule, total_clashes: clashReport.students_with_clashes }

  const allowScheduleXlsx =
    audit.feasible === true || options?.allowProvisionalScheduleExport === true
  const scheduleExportBlocked = !allowScheduleXlsx
  const scheduleExportBlockReason = scheduleExportBlocked
    ? 'Hard-constraint audit did not pass after merging. Enable “Allow provisional schedule export” if you need the schedule workbook anyway.'
    : null

  const scheduleXlsx = allowScheduleXlsx ? await buildScheduleXlsxBuffer(schedule) : null
  const clashXlsx = await buildClashXlsxBuffer(clashReport)
  const courseEmailsXlsx = null

  const schedulingStats = computeSchedulingStats(flatSections, snap.slot_assignments, conflictGraph)

  const nextSnapshot: SchedulingSnapshot = {
    slot_assignments: { ...snap.slot_assignments },
    courseSections: deepCloneCourseSections(courseSections),
    students: (() => {
      const o: Record<string, Student> = {}
      for (const [k, v] of Object.entries(mergedStudents)) {
        o[k] = { ...v, enrolled_courses: [...v.enrolled_courses] }
      }
      return o
    })(),
    enrollmentRows: mergedDeduped.map((r) => ({ ...r })),
  }

  const validation: ValidationResult = {
    is_valid: true,
    errors: [],
    warnings: [
      ...incoming.validation.warnings,
      ...(skippedAlreadyScheduled > 0
        ? [
            {
              field: 'late_merge',
              message: `${skippedAlreadyScheduled} row(s) skipped because they were already in the saved run (same register number and course).`,
            },
          ]
        : []),
    ],
    total_rows: mergedDeduped.length,
    valid_rows: mergedDeduped.length,
  }

  return {
    validation,
    schedule,
    clashReport,
    scheduleXlsx,
    clashXlsx,
    courseEmailsXlsx,
    courseEmailsData: computeCourseEmailGroups(mergedDeduped),
    stats: {
      studentCount: Object.keys(mergedStudents).length,
      courseCount: Object.keys(courseSections).length,
      sectionCount: flatSections.length,
      scheduling: schedulingStats,
    },
    schedule_export_blocked: scheduleExportBlocked,
    schedule_export_block_reason: scheduleExportBlockReason,
    schedulingSnapshot: nextSnapshot,
    mergeSummary: {
      addedEnrollmentRows: deltaRows.length,
      skippedAlreadyScheduled,
      newStudents: newStudentRegs.size,
      existingStudentsNewCourses: existingRegsWithNewCourse.size,
    },
  }
}

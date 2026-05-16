import { loadAndValidate, parseExcelRows } from './parser'
import {
  applyDistinctFacultyPerSection,
  assignStudentsToSections,
  buildConflictGraph,
  computeSectionSplits,
  extractFacultyConstraints,
} from './preprocessing'
import { buildSchedule, computeClashReport, localSearchSeedPlan, runScheduler } from './scheduler'
import { computeSchedulingStats, type SchedulingStats } from './engines/metrics'
import { sumConflictGraphWeights } from './engines/conflictGraph'
import { TOTAL_WEEKLY_SLOTS } from './engines/timeModel'
import type { SchedulerProgressEvent } from './engines/localSearchSolver'
import type { ClashReport, CourseEmailGroup, EnrollmentRow, Schedule, ValidationResult } from './types'
import {
  cloneStudents,
  deepCloneCourseSections,
  type SchedulingSnapshot,
} from './schedulingSnapshot'
import { clashReportToRichWorkbookBuffer } from './io/excelClashReport'
import { courseEmailsToWorkbookBuffer } from './io/excelCourseEmails'
import { readFirstSheetAsAoA } from './io/excelIo'
import { scheduleToWorkbookBuffer } from './io/excelScheduleWorkbook'

export function computeCourseEmailGroups(rows: EnrollmentRow[]): CourseEmailGroup[] {
  const courseMap = new Map<string, { title: string; student_count: number; emails: Set<string> }>()
  
  for (const row of rows) {
    if (!row.course_code) continue
    const em = row.email_id?.trim().toLowerCase()
    
    let g = courseMap.get(row.course_code)
    if (!g) {
      g = { title: row.course_title || '', student_count: 0, emails: new Set() }
      courseMap.set(row.course_code, g)
    }
    g.title = g.title || row.course_title || ''
    g.student_count++
    if (em) g.emails.add(em)
  }

  const result: CourseEmailGroup[] = []
  for (const [code, info] of courseMap.entries()) {
    result.push({
      course_code: code,
      course_title: info.title,
      student_count: info.student_count,
      emails: Array.from(info.emails),
    })
  }
  return result.sort((a, b) => a.course_code.localeCompare(b.course_code))
}

export type PipelineStage =
  | 'queued'
  | 'read'
  | 'parse'
  | 'preprocess'
  | 'schedule'
  | 'export'
  | 'done'

export interface PipelineProgressEvent {
  stage: PipelineStage | string
  message: string
  fraction?: number
  etaSeconds?: number | null
}

const READ_END = 0.08
const PARSE_END = 0.14
const PRE_END = 0.18
const SCHEDULE_LO = 0.18
const SCHEDULE_HI = 0.88

function mapSolverFraction(solverFraction: number | undefined): number | undefined {
  if (solverFraction === undefined) return undefined
  return SCHEDULE_LO + solverFraction * (SCHEDULE_HI - SCHEDULE_LO)
}

export type RunPipelineOptions = {
  randomSeed?: number
  allowProvisionalScheduleExport?: boolean
}

export interface PipelineResult {
  validation: ValidationResult
  schedule: Schedule | null
  clashReport: ClashReport | null
  scheduleXlsx: ArrayBuffer | null
  clashXlsx: ArrayBuffer | null
  courseEmailsXlsx: ArrayBuffer | null
  courseEmailsData: import('./types').CourseEmailGroup[] | null
  stats: {
    studentCount: number
    courseCount: number
    sectionCount: number
    scheduling: SchedulingStats | null
  } | null
  schedule_export_blocked?: boolean
  schedule_export_block_reason?: string | null
  /** Present after a full solve so runs can be saved and extended with late registrations. */
  schedulingSnapshot: SchedulingSnapshot | null
}

export async function runPipeline(
  arrayBuffer: ArrayBuffer,
  onProgress: (event: PipelineProgressEvent) => void,
  options?: RunPipelineOptions,
): Promise<PipelineResult> {
  const emit = onProgress

  emit({ stage: 'read', message: 'Reading first worksheet from workbook…', fraction: 0.02 })
  const aoa = await readFirstSheetAsAoA(arrayBuffer)
  if (!aoa) {
    emit({
      stage: 'read',
      message: 'No worksheets found or workbook could not be read.',
      fraction: READ_END,
    })
    return {
      validation: {
        is_valid: false,
        errors: [{ field: 'file', message: 'No sheets in workbook' }],
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

  emit({
    stage: 'read',
    message: `First worksheet: ${aoa.length.toLocaleString()} rows (row 1 is treated as header)`,
    fraction: READ_END,
  })

  emit({ stage: 'parse', message: 'Parsing cells into enrollment rows…', fraction: 0.09 })
  const { rows, validation: parseValidation } = parseExcelRows(aoa)
  const { students, courses, enrollmentRows, validation } = loadAndValidate(rows, parseValidation)

  if (!validation.is_valid || Object.keys(students).length === 0) {
    emit({
      stage: 'parse',
      message: `Validation stopped: ${validation.errors.length} error(s), ${validation.warnings.length} warning(s).`,
      fraction: PARSE_END,
    })
    return {
      validation,
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

  const studentCount = Object.keys(students).length
  const courseCount = Object.keys(courses).length
  emit({
    stage: 'parse',
    message: `${validation.valid_rows.toLocaleString()}/${validation.total_rows.toLocaleString()} valid rows · ${studentCount.toLocaleString()} students · ${courseCount.toLocaleString()} courses`,
    fraction: PARSE_END,
  })

  emit({
    stage: 'preprocess',
    message: 'Splitting sections, assigning enrollments, extracting faculty labels…',
    fraction: 0.15,
  })
  let courseSections = computeSectionSplits(courses)
  applyDistinctFacultyPerSection(courses, courseSections)
  courseSections = assignStudentsToSections(students, courseSections, enrollmentRows)
  const conflictGraph = buildConflictGraph(students, courseSections)
  const facultyConstraints = extractFacultyConstraints(courseSections)

  const sectionCount = Object.values(courseSections).reduce((n, s) => n + s.length, 0)
  const edgeWeight = sumConflictGraphWeights(conflictGraph)
  emit({
    stage: 'preprocess',
    message: `${sectionCount.toLocaleString()} sections · ${conflictGraph.edges.length.toLocaleString()} conflict edges (weighted sum ${edgeWeight.toLocaleString()})`,
    fraction: PRE_END,
  })

  const seedPlan = localSearchSeedPlan(courseCount)
  emit({
    stage: 'schedule',
    message: `Local search: ${seedPlan.runCount} greedy seeds → refine top ${seedPlan.poolSize} · ${TOTAL_WEEKLY_SLOTS} slots/week`,
    fraction: SCHEDULE_LO,
    etaSeconds: null,
  })

  const sched = runScheduler(
    courseSections,
    conflictGraph,
    facultyConstraints,
    (evt: SchedulerProgressEvent) => {
      emit({
        stage: 'schedule',
        message: evt.message,
        fraction: mapSolverFraction(evt.solverFraction),
        etaSeconds: evt.etaSeconds,
      })
    },
    { randomSeed: options?.randomSeed },
  )
  let schedule = buildSchedule(courseSections, sched.slot_assignments, {
    solver_used: sched.solver_used,
    solver_time_seconds: sched.solver_time_seconds,
    hard_constraints_feasible: sched.feasible,
    hard_constraint_violations: sched.hard_constraint_violations,
    solver_primary_metrics_zero: sched.optimal,
  })
  const clashReport = computeClashReport(students, courseSections, sched.slot_assignments)
  schedule = { ...schedule, total_clashes: clashReport.students_with_clashes }

  const allowScheduleXlsx =
    sched.feasible === true || options?.allowProvisionalScheduleExport === true
  const scheduleExportBlocked = !allowScheduleXlsx
  const scheduleExportBlockReason = scheduleExportBlocked
    ? 'Hard-constraint audit did not pass. The schedule workbook was not generated. Enable “Allow provisional schedule export” and re-run with the same file, or fix the underlying data and re-run.'
    : null

  emit({
    stage: 'export',
    message: 'Serialising schedule, clash report, and course-email workbooks…',
    fraction: 0.9,
    etaSeconds: null,
  })
  const [scheduleXlsx, clashXlsx, courseEmailsXlsx] = await Promise.all([
    allowScheduleXlsx ? scheduleToWorkbookBuffer(schedule) : Promise.resolve(null),
    clashReportToRichWorkbookBuffer(clashReport),
    courseEmailsToWorkbookBuffer(enrollmentRows),
  ])

  const sectionCountForStats = Object.values(courseSections).reduce((n, s) => n + s.length, 0)
  const flatSections = Object.values(courseSections).flat()
  const schedulingStats = computeSchedulingStats(flatSections, sched.slot_assignments, conflictGraph)

  emit({
    stage: 'done',
    message: `Run complete · local search ${sched.solver_time_seconds.toFixed(2)}s · ${sectionCountForStats} sections · hard-constraint audit ${sched.feasible ? 'passed' : 'failed'}`,
    fraction: 1,
    etaSeconds: null,
  })
  return {
    validation,
    schedule,
    clashReport,
    scheduleXlsx,
    clashXlsx,
    courseEmailsXlsx,
    courseEmailsData: computeCourseEmailGroups(enrollmentRows),
    stats: {
      studentCount: Object.keys(students).length,
      courseCount: Object.keys(courses).length,
      sectionCount: sectionCountForStats,
      scheduling: schedulingStats,
    },
    schedule_export_blocked: scheduleExportBlocked,
    schedule_export_block_reason: scheduleExportBlockReason,
    schedulingSnapshot: {
      slot_assignments: { ...sched.slot_assignments },
      courseSections: deepCloneCourseSections(courseSections),
      students: cloneStudents(students),
      enrollmentRows: enrollmentRows.map((r) => ({ ...r })),
    },
  }
}

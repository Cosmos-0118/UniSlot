import { loadAndValidate, parseExcelRows } from '../parse/parser'
import {
  applyDistinctFacultyPerSection,
  assignStudentsToSections,
  buildConflictGraph,
  computeSectionSplits,
  extractFacultyConstraints,
} from '../preprocess/preprocessing'
import { computeSchedulingStats, type SchedulingStats } from '../solver/metrics'
import { sumConflictGraphWeights } from '../solver/conflictGraph'
import { TOTAL_WEEKLY_SLOTS } from '../solver/timeModel'
import type { SchedulerProgressEvent } from '../solver/localSearchSolver'
import type { ClashReport, CourseEmailGroup, EnrollmentRow, Schedule, ValidationResult } from '../types'
import {
  cloneStudents,
  deepCloneCourseSections,
  WEEKDAY_SLOT_MODEL,
  type SchedulingSnapshot,
} from '../merge/snapshot'
import { throwIfAborted } from '../worker/cancellation'
import {
  buildClashXlsxBuffer,
  buildCourseEmailsXlsxBuffer,
  buildScheduleXlsxBuffer,
  type PipelineExportKind,
} from './exports'

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
  /** Search effort: fast | balanced | max | extreme | unlimited. Default balanced. */
  effort?: import('../solver/effort').EffortLevel
  /**
   * When true, build .xlsx buffers during the run (higher memory, slower time-to-done).
   * Default false: exports are generated on demand in the worker after the solve completes.
   */
  eagerExports?: boolean
  /** Which workbooks to build when {@link eagerExports} is true (ignored otherwise). */
  eagerExportKinds?: Partial<Record<PipelineExportKind, boolean>>
  signal?: AbortSignal
}

export interface PipelineResult {
  validation: ValidationResult
  schedule: Schedule | null
  clashReport: ClashReport | null
  scheduleXlsx: ArrayBuffer | null
  clashXlsx: ArrayBuffer | null
  courseEmailsXlsx: ArrayBuffer | null
  courseEmailsData: import('../types').CourseEmailGroup[] | null
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

async function buildEagerExportsSequential(
  kinds: Partial<Record<PipelineExportKind, boolean>>,
  artifacts: {
    schedule: Schedule | null
    clashReport: ClashReport | null
    enrollmentRows: EnrollmentRow[]
    allowScheduleXlsx: boolean
    snapshot?: import('../merge/snapshot').SchedulingSnapshot | null
  },
): Promise<{
  scheduleXlsx: ArrayBuffer | null
  clashXlsx: ArrayBuffer | null
  courseEmailsXlsx: ArrayBuffer | null
}> {
  let scheduleXlsx: ArrayBuffer | null = null
  let clashXlsx: ArrayBuffer | null = null
  let courseEmailsXlsx: ArrayBuffer | null = null

  if (kinds.schedule && artifacts.allowScheduleXlsx && artifacts.schedule) {
    scheduleXlsx = await buildScheduleXlsxBuffer(artifacts.schedule, artifacts.snapshot)
  }
  if (kinds.clash && artifacts.clashReport) {
    clashXlsx = await buildClashXlsxBuffer(artifacts.clashReport)
  }
  if (kinds.courseEmails && artifacts.enrollmentRows.length > 0) {
    courseEmailsXlsx = await buildCourseEmailsXlsxBuffer(artifacts.enrollmentRows)
  }

  return { scheduleXlsx, clashXlsx, courseEmailsXlsx }
}

export async function runPipeline(
  arrayBuffer: ArrayBuffer,
  onProgress: (event: PipelineProgressEvent) => void,
  options?: RunPipelineOptions,
): Promise<PipelineResult> {
  const emit = onProgress
  const signal = options?.signal

  emit({ stage: 'read', message: 'Reading first worksheet from workbook…', fraction: 0.02 })
  throwIfAborted(signal)
  const { readFirstSheetAsAoA } = await import('../io/excelIo')
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
  throwIfAborted(signal)
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
  throwIfAborted(signal)
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

  const { localSearchSeedPlan, runSchedulerAsync, buildSchedule, computeClashReport } = await import(
    '../solver/scheduler',
  )
  throwIfAborted(signal)

  const { resolvePoolWorkerCount } = await import('../worker/solverPoolTypes')
  const poolWorkers = resolvePoolWorkerCount()
  const effort = options?.effort ?? 'balanced'
  const seedPlan = localSearchSeedPlan(courseCount, poolWorkers, effort)
  emit({
    stage: 'schedule',
    message: `Local search (${seedPlan.effort}): ${seedPlan.runCount} seeds → refine top ${seedPlan.poolSize} · ${seedPlan.poolWorkers} CPU workers · ${TOTAL_WEEKLY_SLOTS} weekday sessions/week`,
    fraction: SCHEDULE_LO,
    etaSeconds: null,
  })

  const sched = await runSchedulerAsync(
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
    {
      randomSeed: options?.randomSeed,
      shouldAbort: () => signal?.aborted === true,
      poolWorkers,
      effort,
    },
  )
  throwIfAborted(signal)
  const flatSectionsEarly = Object.values(courseSections).flat()
  const schedulingStatsPreview = computeSchedulingStats(
    flatSectionsEarly,
    sched.slot_assignments,
    conflictGraph,
    { courseSections, students },
  )
  const lb = schedulingStatsPreview.lower_bounds
  let schedule = buildSchedule(courseSections, sched.slot_assignments, {
    solver_used: sched.solver_used,
    solver_time_seconds: sched.solver_time_seconds,
    hard_constraints_feasible: sched.feasible,
    hard_constraint_violations: sched.hard_constraint_violations,
    solver_primary_metrics_zero: sched.optimal,
    min_red_students_lower_bound: lb?.min_red_students_lower_bound,
    min_clash_weight_lower_bound: lb?.min_clash_weight_lower_bound,
    zero_clash_structurally_impossible: lb?.zero_clash_structurally_impossible,
    lower_bound_notes: lb?.notes,
  })
  const clashReport = computeClashReport(students, courseSections, sched.slot_assignments)
  schedule = { ...schedule, total_clashes: clashReport.students_with_clashes }

  // Always allow schedule export — clashes are soft warnings, not export blockers.
  const scheduleExportBlocked = false
  const scheduleExportBlockReason: string | null = null

  const schedulingSnapshot: SchedulingSnapshot = {
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: { ...sched.slot_assignments },
    courseSections: deepCloneCourseSections(courseSections),
    students: cloneStudents(students),
    enrollmentRows: enrollmentRows.map((r) => ({ ...r })),
  }

  const eagerKinds = options?.eagerExportKinds ?? {
    schedule: true,
    clash: true,
    courseEmails: false,
  }
  let scheduleXlsx: ArrayBuffer | null = null
  let clashXlsx: ArrayBuffer | null = null
  let courseEmailsXlsx: ArrayBuffer | null = null

  if (options?.eagerExports) {
    emit({
      stage: 'export',
      message: 'Serialising requested workbooks (one at a time)…',
      fraction: 0.9,
      etaSeconds: null,
    })
    throwIfAborted(signal)
    const built = await buildEagerExportsSequential(eagerKinds, {
      schedule,
      clashReport,
      enrollmentRows,
      allowScheduleXlsx: true,
      snapshot: schedulingSnapshot,
    })
    scheduleXlsx = built.scheduleXlsx
    clashXlsx = built.clashXlsx
    courseEmailsXlsx = built.courseEmailsXlsx
  } else {
    emit({
      stage: 'done',
      message: 'Solve complete — workbook exports are available on demand when you download.',
      fraction: 0.98,
      etaSeconds: null,
    })
  }

  const sectionCountForStats = Object.values(courseSections).reduce((n, s) => n + s.length, 0)
  const schedulingStats = schedulingStatsPreview

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
    schedulingSnapshot,
  }
}

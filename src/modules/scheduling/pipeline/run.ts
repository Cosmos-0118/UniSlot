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
import { activeWeekdayCount } from '../solver/timeModel'
import type { ClashReport, CourseEmailGroup, EnrollmentRow, Schedule, ValidationResult } from '../types'
import {
  cloneStudents,
  deepCloneCourseSections,
  WEEKDAY_SLOT_MODEL,
  type SchedulingSnapshot,
} from '../merge/snapshot'
import { throwIfAborted } from './cancellation'
import {
  buildClashXlsxBuffer,
  buildCourseEmailsXlsxBuffer,
  buildScheduleXlsxBuffer,
  type PipelineExportKind,
} from './exports'

import DEFAULT_PROGRAM_NOMENCLATURE_MAP from '../io/programNomenclatureMap.json'

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
  /** Structured CP-SAT progress (CLI uses this for live updates). */
  cpsat?: import('../solver/cpsatInstance').CpsatProgressEvent
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
  /** Optional CP-SAT wall-clock limit (seconds). Omit for unbounded prove-to-optimal. */
  cpsatTimeLimitSeconds?: number
  /** CP-SAT search workers (0 / omit = all CPUs). */
  cpsatWorkers?: number
  /** Portfolio race size (default 0). Pass k>0 for a multi-seed clash race (non-reproducible). */
  cpsatPortfolio?: number
  /** Seconds per portfolio race member (default 45). */
  cpsatPortfolioRaceSeconds?: number
  /** Stop clash prove when incumbent−bound ≤ this. */
  cpsatAbsoluteGap?: number
  /** Stop clash prove when incumbent and bound are flat for N seconds. */
  cpsatProvePlateauSeconds?: number
  /** Disable plateau/gap escapes; chase full clash OPTIMAL. */
  cpsatFullProve?: boolean
  /**
   * When false, Saturday is blocked for all courses (including maths).
   * Default true (Constraints.md Saturday maths-only).
   */
  allowSaturdayForMath?: boolean
  /**
   * When true, build .xlsx buffers during the run.
   * Default false: caller builds exports later if needed.
   */
  eagerExports?: boolean
  /**
   * Optional `Nomenclature.xlsx` (first sheet) used to map long program labels
   * to short nomenclature abbreviations in schedule exports.
   */
  programNomenclatureXlsx?: ArrayBuffer
  /** Which workbooks to build when {@link eagerExports} is true. */
  eagerExportKinds?: Partial<Record<PipelineExportKind, boolean>>
  /**
   * Random seed for warm-start polish and CP-SAT. When set, CP-SAT uses
   * interleaved deterministic search; export metadata is seed-derived.
   * Portfolio race (if enabled) still uses wall-clock and breaks reproducibility.
   */
  seed?: number
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
  schedulingSnapshot: SchedulingSnapshot | null
  /** True when clash weight is proven minimal under the course→weekday CP-SAT model. */
  proven_optimal?: boolean
  proven_levels?: string[]
  solver_status?: string
  solver_message?: string
}

async function buildEagerExportsSequential(
  kinds: Partial<Record<PipelineExportKind, boolean>>,
  artifacts: {
    schedule: Schedule | null
    clashReport: ClashReport | null
    enrollmentRows: EnrollmentRow[]
    allowScheduleXlsx: boolean
    snapshot?: import('../merge/snapshot').SchedulingSnapshot | null
    seed?: number
  },
): Promise<{
  scheduleXlsx: ArrayBuffer | null
  clashXlsx: ArrayBuffer | null
  courseEmailsXlsx: ArrayBuffer | null
}> {
  let scheduleXlsx: ArrayBuffer | null = null
  let clashXlsx: ArrayBuffer | null = null
  let courseEmailsXlsx: ArrayBuffer | null = null
  const exportOpts = artifacts.seed !== undefined ? { seed: artifacts.seed } : undefined

  if (kinds.schedule && artifacts.allowScheduleXlsx && artifacts.schedule) {
    scheduleXlsx = await buildScheduleXlsxBuffer(
      artifacts.schedule,
      artifacts.snapshot ? { snapshot: artifacts.snapshot, ...exportOpts } : exportOpts,
    )
  }
  if (kinds.clash && artifacts.clashReport) {
    clashXlsx = await buildClashXlsxBuffer(artifacts.clashReport, exportOpts)
  }
  if (kinds.courseEmails && artifacts.enrollmentRows.length > 0) {
    courseEmailsXlsx = await buildCourseEmailsXlsxBuffer(artifacts.enrollmentRows, exportOpts)
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

  const { buildSchedule, computeClashReport, auditScheduleHardConstraints, parallelHardCap } =
    await import('../solver/scheduler')
  const { runCpsatScheduler } = await import('../solver/cpsatBridge')
  const { buildGreedyHint } = await import('../solver/greedyHint')
  const { computeSchedulingLowerBounds } = await import('../solver/lowerBounds')
  const { cpus } = await import('node:os')
  throwIfAborted(signal)

  const workers =
    options?.cpsatWorkers && options.cpsatWorkers > 0 ? options.cpsatWorkers : cpus().length
  const allowSaturdayForMath = options?.allowSaturdayForMath !== false
  const weekdays = activeWeekdayCount(allowSaturdayForMath)

  emit({
    stage: 'schedule',
    message: 'Building warm-start hint (DSATUR + polish)…',
    fraction: SCHEDULE_LO,
    etaSeconds: null,
  })
  const solverSeed = options?.seed
  const warm = buildGreedyHint({
    courseSections,
    conflictGraph,
    facultyConstraints,
    students,
    allowSaturdayForMath,
    seed: solverSeed ?? 42,
  })
  emit({
    stage: 'schedule',
    message: `Warm start · clash ${warm.clash_weight} · RED ${warm.red_students}`,
    fraction: SCHEDULE_LO + 0.01,
    etaSeconds: null,
  })

  const structuralLb = computeSchedulingLowerBounds(courseSections, conflictGraph, students, {
    allowSaturdayForMath,
  })
  const portfolio =
    options?.cpsatPortfolio === undefined ? undefined : options.cpsatPortfolio
  emit({
    stage: 'schedule',
    message: `CP-SAT (OR-Tools): proving minimal clash weight · ${workers} CPU workers · LB clash ≥ ${structuralLb.min_clash_weight_lower_bound} · RED ≥ ${structuralLb.min_red_students_lower_bound} · ${weekdays} weekday sessions/week${allowSaturdayForMath ? '' : ' · Saturday blocked'}`,
    fraction: SCHEDULE_LO + 0.02,
    etaSeconds: null,
  })

  const cpsat = await runCpsatScheduler(
    courseSections,
    conflictGraph,
    facultyConstraints,
    students,
    {
      timeLimitSeconds: options?.cpsatTimeLimitSeconds,
      workers: options?.cpsatWorkers,
      hint: warm.hint,
      minClashWeightLowerBound: structuralLb.min_clash_weight_lower_bound,
      minRedStudentsLowerBound: structuralLb.min_red_students_lower_bound,
      portfolio,
      portfolioRaceSeconds: options?.cpsatPortfolioRaceSeconds,
      absoluteGap: options?.cpsatAbsoluteGap,
      provePlateauSeconds: options?.cpsatProvePlateauSeconds,
      fullProve: options?.cpsatFullProve,
      allowSaturdayForMath,
      seed: solverSeed,
      signal,
      onProgress: (evt) => {
        if (evt.type === 'progress' || evt.type === 'heartbeat') {
          const label = evt.phase_label ?? evt.phase
          const clash = evt.best_clash == null ? '—' : String(evt.best_clash)
          const red = evt.best_red == null ? '—' : String(evt.best_red)
          const activity =
            evt.activity === 'proving'
              ? 'proving bound'
              : evt.activity === 'improving'
                ? 'improving'
                : 'searching'
          const boundPart =
            evt.bound == null
              ? ''
              : evt.best_clash != null && evt.bound === evt.best_clash
                ? ` · gap 0`
                : ` · bound ${evt.bound}`
          emit({
            stage: 'schedule',
            message: `${label}: clash ${clash} · RED ${red}${boundPart} · ${activity} · ${evt.elapsed.toFixed(1)}s · ${evt.workers} workers`,
            fraction: mapSolverFraction(Math.min(0.99, 0.15 + Math.min(0.7, evt.elapsed / 120))),
            etaSeconds: null,
            cpsat: evt,
          })
        } else if (evt.type === 'phase') {
          emit({
            stage: 'schedule',
            message: evt.phase_label ?? `CP-SAT phase: ${evt.phase}`,
            fraction: SCHEDULE_LO + 0.05,
            etaSeconds: null,
            cpsat: evt,
          })
        } else if (evt.type === 'start') {
          const port = evt.portfolio
          const msg = port
            ? `Seed ${port.index}/${port.size} (seed ${port.seed}) · building model · ${port.member_workers}w`
            : `Building CP-SAT model · ${evt.courses} courses · ${evt.edges ?? '?'} edges · ${evt.workers} workers`
          emit({
            stage: 'schedule',
            message: msg,
            fraction: SCHEDULE_LO,
            etaSeconds: null,
            cpsat: evt,
          })
        } else if (evt.type === 'model_ready') {
          emit({
            stage: 'schedule',
            message: `Model ready · starting search`,
            fraction: SCHEDULE_LO + 0.02,
            etaSeconds: null,
            cpsat: evt,
          })
        }
      },
    },
  )
  throwIfAborted(signal)

  const slotAssignments = cpsat.slot_assignments
  const audit = auditScheduleHardConstraints(
    courseSections,
    slotAssignments,
    parallelHardCap(sectionCount),
    facultyConstraints,
    { allowSaturdayForMath },
  )
  const feasible = audit.feasible
  const hardViolations = audit.violations
  const primaryZero = cpsat.total_clash_weight === 0 && cpsat.red_students === 0
  const provenOptimal = cpsat.proven_optimal
  const provenLevels = cpsat.proven_levels
  const solverStatus = cpsat.status
  const solverMessage = cpsat.message
  const solverUsed = cpsat.solver_used
  const solverTimeSeconds = cpsat.solver_time_seconds

  const flatSectionsEarly = Object.values(courseSections).flat()
  const schedulingStatsPreview = computeSchedulingStats(
    flatSectionsEarly,
    slotAssignments,
    conflictGraph,
    { courseSections, students },
  )
  const lb = schedulingStatsPreview.lower_bounds
  let programNomenclatureMap: Record<string, string> | undefined = DEFAULT_PROGRAM_NOMENCLATURE_MAP as Record<
    string,
    string
  >

  if (options?.programNomenclatureXlsx) {
    const { nomenclatureToProgramAbbrevMap } = await import('../io/excelNomenclature')
    programNomenclatureMap = await nomenclatureToProgramAbbrevMap(options.programNomenclatureXlsx)
  }

  const pinnedSolverSeconds =
    solverSeed !== undefined ? 0 : solverTimeSeconds
  let schedule = buildSchedule(courseSections, slotAssignments, {
    solver_used: solverUsed,
    solver_time_seconds: pinnedSolverSeconds,
    hard_constraints_feasible: feasible,
    hard_constraint_violations: hardViolations,
    solver_primary_metrics_zero: primaryZero,
    min_red_students_lower_bound: lb?.min_red_students_lower_bound,
    min_clash_weight_lower_bound: lb?.min_clash_weight_lower_bound,
    zero_clash_structurally_impossible: lb?.zero_clash_structurally_impossible,
    lower_bound_notes: lb?.notes,
  }, { programNomenclature: programNomenclatureMap })
  const clashReport = computeClashReport(students, courseSections, slotAssignments)
  schedule = { ...schedule, total_clashes: clashReport.students_with_clashes }

  const schedulingSnapshot: SchedulingSnapshot = {
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: { ...slotAssignments },
    courseSections: deepCloneCourseSections(courseSections),
    students: cloneStudents(students),
    enrollmentRows: enrollmentRows.map((r) => ({ ...r })),
    ...(solverSeed !== undefined ? { seed: solverSeed } : {}),
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
      seed: solverSeed,
    })
    scheduleXlsx = built.scheduleXlsx
    clashXlsx = built.clashXlsx
    courseEmailsXlsx = built.courseEmailsXlsx
  }

  const sectionCountForStats = Object.values(courseSections).reduce((n, s) => n + s.length, 0)
  const provenNote = provenOptimal
    ? ' · clash weight proven optimal'
    : ' · best feasible (not fully proven)'
  emit({
    stage: 'done',
    message: `Run complete · ${solverUsed} ${solverTimeSeconds.toFixed(2)}s · ${sectionCountForStats} sections · hard-constraint audit ${feasible ? 'passed' : 'failed'}${provenNote}`,
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
      scheduling: schedulingStatsPreview,
    },
    schedule_export_blocked: false,
    schedule_export_block_reason: null,
    schedulingSnapshot,
    proven_optimal: provenOptimal,
    proven_levels: provenLevels,
    solver_status: solverStatus,
    solver_message: solverMessage,
  }
}

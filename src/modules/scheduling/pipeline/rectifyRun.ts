import { loadAndValidate, parseExcelRows } from '../parse/parser'
import {
  applyDistinctFacultyPerSection,
  assignStudentsToSections,
  buildConflictGraph,
  computeSectionSplits,
  extractFacultyConstraints,
} from '../preprocess/preprocessing'
import {
  buildFixedDays,
  computeEnrollmentDelta,
  freeCourseCodes,
  inferAllowSaturdayFromSnapshot,
  validateBaselineMatchesSnapshot,
  type BaselineValidationWarning,
  type EnrollmentDelta,
  type StudentEnrollmentChange,
} from '../merge/enrollmentDelta'
import {
  explainFacultyBlocking,
  placeFreeCourseWeekdays,
} from '../merge/rectifyPlacement'
import {
  cloneStudents,
  deepCloneCourseSections,
  WEEKDAY_SLOT_MODEL,
  type SchedulingSnapshot,
} from '../merge/snapshot'
import { computeSchedulingStats, type SchedulingStats } from '../solver/metrics'
import { sectionSlotsFromCourseSlots } from '../solver/cpsatInstance'
import type { ClashReport, CourseEmailGroup, EnrollmentRow, Schedule, ValidationResult } from '../types'
import { throwIfAborted } from './cancellation'
import {
  buildClashXlsxBuffer,
  buildCourseEmailsXlsxBuffer,
  buildScheduleXlsxBuffer,
  type PipelineExportKind,
} from './exports'
import { computeCourseEmailGroups, type PipelineProgressEvent } from './run'

import DEFAULT_PROGRAM_NOMENCLATURE_MAP from '../io/programNomenclatureMap.json'

export type RectificationReport = {
  changed_students: StudentEnrollmentChange[]
  new_course_codes: string[]
  removed_course_codes: string[]
  new_course_slots: Record<string, number>
  baseline_warnings: BaselineValidationWarning[]
  hard_constraints_feasible: boolean
  hard_constraint_violations: string[]
  previous_red_students?: number
  previous_clash_weight?: number
  new_red_students: number
  new_clash_weight: number
  solver_used: string
  cpsat_ran: boolean
}

export type RunRectifyOptions = {
  baselineRows?: EnrollmentRow[]
  previousSnapshot: SchedulingSnapshot
  previousSummary?: { red_students?: number; clash_weight?: number }
  cpsatTimeLimitSeconds?: number
  cpsatWorkers?: number
  cpsatPortfolio?: number
  cpsatPortfolioRaceSeconds?: number
  cpsatAbsoluteGap?: number
  cpsatProvePlateauSeconds?: number
  cpsatFullProve?: boolean
  allowSaturdayForMath?: boolean
  eagerExports?: boolean
  eagerExportKinds?: Partial<Record<PipelineExportKind, boolean>>
  programNomenclatureXlsx?: ArrayBuffer
  seed?: number
  signal?: AbortSignal
}

export type RectifyPipelineResult = {
  validation: ValidationResult
  schedule: Schedule | null
  clashReport: ClashReport | null
  scheduleXlsx: ArrayBuffer | null
  clashXlsx: ArrayBuffer | null
  courseEmailsXlsx: ArrayBuffer | null
  courseEmailsData: CourseEmailGroup[] | null
  stats: {
    studentCount: number
    courseCount: number
    sectionCount: number
    scheduling: SchedulingStats | null
  } | null
  schedulingSnapshot: SchedulingSnapshot | null
  rectificationReport: RectificationReport | null
  enrollmentDelta: EnrollmentDelta | null
  proven_optimal?: boolean
  proven_levels?: string[]
  solver_status?: string
  solver_message?: string
  infeasible?: boolean
  infeasible_reason?: string
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

export async function runRectifyPipeline(
  rectifiedArrayBuffer: ArrayBuffer,
  onProgress: (event: PipelineProgressEvent) => void,
  options: RunRectifyOptions,
): Promise<RectifyPipelineResult> {
  const emit = onProgress
  const signal = options?.signal
  const snapshot = options.previousSnapshot

  emit({ stage: 'read', message: 'Reading rectified enrollment workbook…', fraction: 0.02 })
  throwIfAborted(signal)
  const { readFirstSheetAsAoA } = await import('../io/excelIo')
  const aoa = await readFirstSheetAsAoA(rectifiedArrayBuffer)
  if (!aoa) {
    return emptyRectifyResult({
      is_valid: false,
      errors: [{ field: 'file', message: 'No sheets in rectified workbook' }],
      warnings: [],
      total_rows: 0,
      valid_rows: 0,
    })
  }

  emit({
    stage: 'read',
    message: `Rectified worksheet: ${aoa.length.toLocaleString()} rows`,
    fraction: READ_END,
  })

  emit({ stage: 'parse', message: 'Parsing rectified enrollment…', fraction: 0.09 })
  throwIfAborted(signal)
  const { rows, validation: parseValidation } = parseExcelRows(aoa)
  const { students, courses, enrollmentRows, validation } = loadAndValidate(rows, parseValidation)

  if (!validation.is_valid || Object.keys(students).length === 0) {
    emit({
      stage: 'parse',
      message: `Validation stopped: ${validation.errors.length} error(s).`,
      fraction: PARSE_END,
    })
    return emptyRectifyResult(validation)
  }

  const baselineRows = options.baselineRows ?? snapshot.enrollmentRows
  const enrollmentDelta = computeEnrollmentDelta(baselineRows, enrollmentRows)
  const baselineWarnings = options.baselineRows
    ? validateBaselineMatchesSnapshot(baselineRows, snapshot)
    : []

  emit({
    stage: 'parse',
    message: `${enrollmentDelta.changed_students.length} changed student(s) · ${enrollmentDelta.new_course_codes.length} new course(s) · ${enrollmentDelta.removed_course_codes.length} removed`,
    fraction: PARSE_END,
  })

  emit({
    stage: 'preprocess',
    message: 'Re-sectioning from rectified enrollment…',
    fraction: 0.15,
  })
  throwIfAborted(signal)
  let courseSections = computeSectionSplits(courses)
  applyDistinctFacultyPerSection(courses, courseSections)
  courseSections = assignStudentsToSections(students, courseSections, enrollmentRows)
  const conflictGraph = buildConflictGraph(students, courseSections)
  const facultyConstraints = extractFacultyConstraints(courseSections)

  const sectionCount = Object.values(courseSections).reduce((n, s) => n + s.length, 0)
  emit({
    stage: 'preprocess',
    message: `${sectionCount.toLocaleString()} sections · ${conflictGraph.edges.length.toLocaleString()} conflict edges`,
    fraction: PRE_END,
  })

  const allowSaturdayForMath =
    options.allowSaturdayForMath ?? inferAllowSaturdayFromSnapshot(snapshot)
  const newCourseCodes = new Set(Object.keys(courses))
  const fixedDays = buildFixedDays(snapshot, newCourseCodes)
  const freeCourses = freeCourseCodes(newCourseCodes, fixedDays)

  const { buildSchedule, computeClashReport, auditScheduleHardConstraints, parallelHardCap } =
    await import('../solver/scheduler')
  const { runCpsatScheduler } = await import('../solver/cpsatBridge')
  const { buildGreedyHint } = await import('../solver/greedyHint')
  throwIfAborted(signal)

  let slotByCourse: Record<string, number>
  let solverUsed = 'rectify-pinned'
  let solverTimeSeconds = 0
  let provenOptimal = false
  let provenLevels: string[] = []
  let solverStatus = 'PINNED'
  let solverMessage: string | undefined
  let cpsatRan = false

  if (freeCourses.length > 0) {
    emit({
      stage: 'schedule',
      message: `Placing ${freeCourses.length} new course(s) · ${Object.keys(fixedDays).length} weekdays pinned`,
      fraction: SCHEDULE_LO,
    })

    const greedy = placeFreeCourseWeekdays(
      freeCourses,
      fixedDays,
      courseSections,
      conflictGraph,
      facultyConstraints,
      allowSaturdayForMath,
    )

    if (greedy) {
      slotByCourse = greedy.slot_by_course
      solverUsed = 'rectify-greedy'
      emit({
        stage: 'schedule',
        message: `Greedy placement OK · clash weight ${greedy.clash_weight}`,
        fraction: SCHEDULE_LO + 0.4,
      })
    } else {
      const facultyNotes = explainFacultyBlocking(
        freeCourses,
        fixedDays,
        courseSections,
        facultyConstraints,
        allowSaturdayForMath,
      )
      emit({
        stage: 'schedule',
        message: 'Greedy placement failed — running partial CP-SAT…',
        fraction: SCHEDULE_LO + 0.1,
      })
      cpsatRan = true

      const warm = buildGreedyHint({
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        allowSaturdayForMath,
        seed: options?.seed ?? 42,
      })

      const cpsat = await runCpsatScheduler(
        courseSections,
        conflictGraph,
        facultyConstraints,
        students,
        {
          timeLimitSeconds: options?.cpsatTimeLimitSeconds ?? 120,
          workers: options?.cpsatWorkers,
          hint: warm.hint,
          fixedDays,
          minClashWeightLowerBound: 0,
          minRedStudentsLowerBound: 0,
          portfolio: 0,
          clashOnly: true,
          allowSaturdayForMath,
          seed: options?.seed,
          signal,
          onProgress: (evt) => {
            if (evt.type === 'progress' || evt.type === 'heartbeat') {
              emit({
                stage: 'schedule',
                message: evt.phase_label ?? evt.phase,
                fraction: mapSolverFraction(Math.min(0.99, 0.15 + Math.min(0.7, evt.elapsed / 120))),
                cpsat: evt,
              })
            } else if (evt.type === 'phase' || evt.type === 'start' || evt.type === 'model_ready') {
              emit({
                stage: 'schedule',
                message: evt.type === 'phase' ? (evt.phase_label ?? evt.phase) : 'CP-SAT rectify',
                fraction: SCHEDULE_LO + 0.05,
                cpsat: evt,
              })
            }
          },
        },
      )

      slotByCourse = cpsat.slot_by_course
      solverUsed = cpsat.solver_used
      solverTimeSeconds = cpsat.solver_time_seconds
      provenOptimal = cpsat.proven_optimal
      provenLevels = cpsat.proven_levels
      solverStatus = cpsat.status
      solverMessage = cpsat.message

      if (!slotByCourse || Object.keys(slotByCourse).length === 0) {
        const reason =
          facultyNotes.length > 0
            ? facultyNotes.join('; ')
            : solverMessage ?? 'CP-SAT could not place new courses with pinned weekdays.'
        return {
          ...emptyRectifyResult(validation),
          enrollmentDelta,
          infeasible: true,
          infeasible_reason: reason,
        }
      }
    }
  } else {
    emit({
      stage: 'schedule',
      message: 'No new courses — reusing pinned weekdays only',
      fraction: SCHEDULE_LO + 0.5,
    })
    slotByCourse = { ...fixedDays }
    for (const code of newCourseCodes) {
      if (!(code in slotByCourse)) {
        return {
          ...emptyRectifyResult(validation),
          enrollmentDelta,
          infeasible: true,
          infeasible_reason: `Course ${code} has no pinned weekday in the previous snapshot.`,
        }
      }
    }
  }

  const slotAssignments = sectionSlotsFromCourseSlots(courseSections, slotByCourse)
  const audit = auditScheduleHardConstraints(
    courseSections,
    slotAssignments,
    parallelHardCap(sectionCount),
    facultyConstraints,
    { allowSaturdayForMath },
  )

  if (!audit.feasible) {
    emit({
      stage: 'done',
      message: `Rectify infeasible: ${audit.violations.length} hard-constraint violation(s)`,
      fraction: 1,
    })
    const clashReport = computeClashReport(students, courseSections, slotAssignments)
    const flatForStats = Object.values(courseSections).flat()
    const infeasStats = computeSchedulingStats(flatForStats, slotAssignments, conflictGraph, {
      courseSections,
      students,
    })
    return {
      validation,
      schedule: null,
      clashReport,
      scheduleXlsx: null,
      clashXlsx: null,
      courseEmailsXlsx: null,
      courseEmailsData: computeCourseEmailGroups(enrollmentRows),
      stats: null,
      schedulingSnapshot: null,
      enrollmentDelta,
      infeasible: true,
      infeasible_reason: audit.violations.join('; '),
      rectificationReport: buildRectificationReport({
        enrollmentDelta,
        baselineWarnings,
        fixedDays,
        freeCourses,
        slotByCourse,
        audit,
        clashReport,
        clashWeight: infeasStats.total_clash_weight,
        previousSummary: options.previousSummary,
        solverUsed,
        cpsatRan,
      }),
    }
  }

  const flatSections = Object.values(courseSections).flat()
  const schedulingStatsPreview = computeSchedulingStats(
    flatSections,
    slotAssignments,
    conflictGraph,
    { courseSections, students },
  )
  const lb = schedulingStatsPreview.lower_bounds

  let programNomenclatureMap: Record<string, string> | undefined =
    DEFAULT_PROGRAM_NOMENCLATURE_MAP as Record<string, string>
  if (options?.programNomenclatureXlsx) {
    const { nomenclatureToProgramAbbrevMap } = await import('../io/excelNomenclature')
    programNomenclatureMap = await nomenclatureToProgramAbbrevMap(options.programNomenclatureXlsx)
  }

  const primaryZero =
    schedulingStatsPreview.total_clash_weight === 0 &&
    (computeClashReport(students, courseSections, slotAssignments).students_with_clashes ?? 0) ===
      0

  let schedule = buildSchedule(
    courseSections,
    slotAssignments,
    {
      solver_used: solverUsed,
      solver_time_seconds: solverTimeSeconds,
      hard_constraints_feasible: audit.feasible,
      hard_constraint_violations: audit.violations,
      solver_primary_metrics_zero: primaryZero,
      min_red_students_lower_bound: lb?.min_red_students_lower_bound,
      min_clash_weight_lower_bound: lb?.min_clash_weight_lower_bound,
      zero_clash_structurally_impossible: lb?.zero_clash_structurally_impossible,
      lower_bound_notes: lb?.notes,
    },
    { programNomenclature: programNomenclatureMap },
  )
  const clashReport = computeClashReport(students, courseSections, slotAssignments)
  schedule = { ...schedule, total_clashes: clashReport.students_with_clashes }

  const schedulingSnapshot: SchedulingSnapshot = {
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: { ...slotAssignments },
    courseSections: deepCloneCourseSections(courseSections),
    students: cloneStudents(students),
    enrollmentRows: enrollmentRows.map((r) => ({ ...r })),
    allowSaturdayForMath,
    ...(options?.seed !== undefined ? { seed: options.seed } : {}),
  }

  const rectificationReport = buildRectificationReport({
    enrollmentDelta,
    baselineWarnings,
    fixedDays,
    freeCourses,
    slotByCourse,
    audit,
    clashReport,
    clashWeight: schedulingStatsPreview.total_clash_weight,
    previousSummary: options.previousSummary,
    solverUsed,
    cpsatRan,
  })

  let scheduleXlsx: ArrayBuffer | null = null
  let clashXlsx: ArrayBuffer | null = null
  let courseEmailsXlsx: ArrayBuffer | null = null

  const eagerKinds = options?.eagerExportKinds ?? {
    schedule: true,
    clash: true,
    courseEmails: true,
  }

  if (options?.eagerExports) {
    emit({ stage: 'export', message: 'Building rectified exports…', fraction: 0.9 })
    throwIfAborted(signal)
    const exportOpts = options.seed !== undefined ? { seed: options.seed } : undefined
    if (eagerKinds.schedule && schedule) {
      scheduleXlsx = await buildScheduleXlsxBuffer(schedule, {
        snapshot: schedulingSnapshot,
        ...exportOpts,
      })
    }
    if (eagerKinds.clash && clashReport) {
      clashXlsx = await buildClashXlsxBuffer(clashReport, exportOpts)
    }
    if (eagerKinds.courseEmails && enrollmentRows.length > 0) {
      courseEmailsXlsx = await buildCourseEmailsXlsxBuffer(enrollmentRows, exportOpts)
    }
  }

  emit({
    stage: 'done',
    message: `Rectify complete · ${enrollmentDelta.changed_students.length} student change(s) · hard audit passed`,
    fraction: 1,
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
      sectionCount,
      scheduling: schedulingStatsPreview,
    },
    schedulingSnapshot,
    rectificationReport,
    enrollmentDelta,
    proven_optimal: provenOptimal,
    proven_levels: provenLevels,
    solver_status: solverStatus,
    solver_message: solverMessage,
  }
}

function buildRectificationReport(args: {
  enrollmentDelta: EnrollmentDelta
  baselineWarnings: BaselineValidationWarning[]
  fixedDays: Record<string, number>
  freeCourses: string[]
  slotByCourse: Record<string, number>
  audit: { feasible: boolean; violations: string[] }
  clashReport: ClashReport
  clashWeight: number
  previousSummary?: { red_students?: number; clash_weight?: number }
  solverUsed: string
  cpsatRan: boolean
}): RectificationReport {
  const newCourseSlots: Record<string, number> = {}
  for (const code of args.enrollmentDelta.new_course_codes) {
    if (args.slotByCourse[code] !== undefined) {
      newCourseSlots[code] = args.slotByCourse[code]!
    }
  }
  return {
    changed_students: args.enrollmentDelta.changed_students,
    new_course_codes: args.enrollmentDelta.new_course_codes,
    removed_course_codes: args.enrollmentDelta.removed_course_codes,
    new_course_slots: newCourseSlots,
    baseline_warnings: args.baselineWarnings,
    hard_constraints_feasible: args.audit.feasible,
    hard_constraint_violations: args.audit.violations,
    previous_red_students: args.previousSummary?.red_students,
    previous_clash_weight: args.previousSummary?.clash_weight,
    new_red_students: args.clashReport.students_with_clashes,
    new_clash_weight: args.clashWeight,
    solver_used: args.solverUsed,
    cpsat_ran: args.cpsatRan,
  }
}

function emptyRectifyResult(validation: ValidationResult): RectifyPipelineResult {
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
    rectificationReport: null,
    enrollmentDelta: null,
  }
}

export async function parseEnrollmentWorkbook(
  arrayBuffer: ArrayBuffer,
): Promise<{ rows: EnrollmentRow[]; validation: ValidationResult }> {
  const { readFirstSheetAsAoA } = await import('../io/excelIo')
  const aoa = await readFirstSheetAsAoA(arrayBuffer)
  if (!aoa) {
    return {
      rows: [],
      validation: {
        is_valid: false,
        errors: [{ field: 'file', message: 'No sheets in workbook' }],
        warnings: [],
        total_rows: 0,
        valid_rows: 0,
      },
    }
  }
  const { rows, validation: parseValidation } = parseExcelRows(aoa)
  const { enrollmentRows, validation } = loadAndValidate(rows, parseValidation)
  return { rows: enrollmentRows, validation }
}

export async function loadPreviousSummary(
  previousDir: string,
): Promise<{ red_students?: number; clash_weight?: number } | undefined> {
  try {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const raw = await readFile(path.join(previousDir, 'summary.json'), 'utf8')
    const summary = JSON.parse(raw) as { red_students?: number; clash_weight?: number }
    return summary
  } catch {
    return undefined
  }
}

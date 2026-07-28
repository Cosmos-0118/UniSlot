import { buildCanonicalData, loadAndValidate, parseExcelRows } from '../parse/parser'
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
import { placeFreeCourseWeekdays, preflightRectify } from '../merge/rectifyPlacement'
import {
  describePlacements,
  diffClashReports,
  diffSectionCounts,
  type ClashDiff,
  type CoursePlacement,
  type SectionCountChange,
} from '../merge/rectifyDiff'
import {
  cloneStudents,
  deepCloneCourseSections,
  WEEKDAY_SLOT_MODEL,
  type SchedulingSnapshot,
} from '../merge/snapshot'
import type { RunLogEntry } from '../merge/runLog'
import type { ClashProvenanceMap } from '../merge/clashProvenance'
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

/** How the free courses got their weekday. */
export type PlacementMethod = 'pinned-only' | 'cpsat' | 'greedy-fallback'

export type RectificationReport = {
  changed_students: StudentEnrollmentChange[]
  new_course_codes: string[]
  removed_course_codes: string[]
  /** Full placement detail for courses the solver had to position. */
  new_course_placements: CoursePlacement[]
  /** Kept for compatibility: course_code -> weekday index. */
  new_course_slots: Record<string, number>
  pinned_course_count: number
  section_count_changes: SectionCountChange[]
  baseline_warnings: BaselineValidationWarning[]
  /** Structural rules only — soft student clashes never block a rectify. */
  hard_constraints_feasible: boolean
  hard_constraint_violations: string[]
  new_clashes: ClashDiff['introduced']
  carried_over_clashes: ClashDiff['carried_over']
  resolved_clashes: ClashDiff['resolved']
  previous_red_students?: number
  previous_clash_weight?: number
  new_red_students: number
  new_clash_weight: number
  placement_method: PlacementMethod
  solver_used: string
  cpsat_ran: boolean
}

export type RunRectifyOptions = {
  baselineRows?: EnrollmentRow[]
  /** Pre-parsed rectified rows so the CLI does not have to read the workbook twice. */
  rectifiedRows?: EnrollmentRow[]
  previousSnapshot: SchedulingSnapshot
  previousSummary?: { red_students?: number; clash_weight?: number }
  cpsatTimeLimitSeconds?: number
  cpsatWorkers?: number
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
  /** Accumulated run trail including this rectify (empty when the run bailed out early). */
  runLog: RunLogEntry[]
  clashProvenance: ClashProvenanceMap
  allowSaturdayForMath?: boolean
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
/** Pinned models presolve to near-nothing; this only guards against pathological inputs. */
const DEFAULT_RECTIFY_TIME_LIMIT_SECONDS = 300
const DEFAULT_RECTIFY_PLATEAU_SECONDS = 20

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

  let enrollmentRows: EnrollmentRow[]
  let validation: ValidationResult

  if (options.rectifiedRows) {
    // The CLI already parsed and validated this workbook for the preview.
    enrollmentRows = options.rectifiedRows
    validation = {
      is_valid: true,
      errors: [],
      warnings: [],
      total_rows: enrollmentRows.length,
      valid_rows: enrollmentRows.length,
    }
    emit({
      stage: 'parse',
      message: `Reusing parsed enrollment · ${enrollmentRows.length.toLocaleString()} rows`,
      fraction: PARSE_END,
    })
  } else {
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
    const parsed = parseExcelRows(aoa)
    const loaded = loadAndValidate(parsed.rows, parsed.validation)
    enrollmentRows = loaded.enrollmentRows
    validation = loaded.validation
    if (!validation.is_valid) {
      emit({
        stage: 'parse',
        message: `Validation stopped: ${validation.errors.length} error(s).`,
        fraction: PARSE_END,
      })
      return emptyRectifyResult(validation)
    }
  }

  const { students, courses } = buildCanonicalData(enrollmentRows)
  if (Object.keys(students).length === 0) {
    return emptyRectifyResult({
      ...validation,
      is_valid: false,
      errors: [
        ...validation.errors,
        { field: 'file', message: 'No students found in rectified workbook' },
      ],
    })
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
  throwIfAborted(signal)

  const previousClashReport = computeClashReport(
    snapshot.students,
    snapshot.courseSections,
    snapshot.slot_assignments,
  )

  /** Stop before writing a schedule, but still hand back a report explaining why. */
  const failure = (reason: string): RectifyPipelineResult => ({
    ...emptyRectifyResult(validation),
    enrollmentDelta,
    allowSaturdayForMath,
    infeasible: true,
    infeasible_reason: reason,
    rectificationReport: buildRectificationReport({
      enrollmentDelta,
      baselineWarnings,
      fixedDays,
      courseSections,
      slotByCourse: fixedDays,
      structuralFeasible: false,
      structuralViolations: [reason],
      clashDiff: { introduced: [], carried_over: [], resolved: [] },
      redStudents: 0,
      clashWeight: 0,
      sectionCountChanges: diffSectionCounts(snapshot.courseSections, courseSections),
      previousSummary: options.previousSummary,
      placementMethod: 'pinned-only',
      solverUsed: 'none',
      cpsatRan: false,
    }),
  })

  let slotByCourse: Record<string, number>
  let placementMethod: PlacementMethod = 'pinned-only'
  let solverUsed = 'rectify-pinned'
  let solverTimeSeconds = 0
  let provenOptimal = false
  let provenLevels: string[] = []
  let solverStatus = 'PINNED'
  let solverMessage: string | undefined
  let cpsatRan = false

  if (freeCourses.length === 0) {
    emit({
      stage: 'schedule',
      message: 'No new courses — every weekday reused from the previous run',
      fraction: SCHEDULE_LO + 0.5,
    })
    slotByCourse = { ...fixedDays }
    const missing = [...newCourseCodes].filter((c) => !(c in slotByCourse))
    if (missing.length > 0) {
      return failure(
        `No pinned weekday in the previous snapshot for: ${missing.join(', ')}.`,
      )
    }
  } else {
    const preflight = preflightRectify({
      fixedDays,
      freeCourses,
      courseSections,
      facultyConstraints,
      allowSaturdayForMath,
    })
    if (!preflight.ok) {
      emit({
        stage: 'done',
        message: `Cannot place new course(s): ${preflight.blockers.length} blocker(s)`,
        fraction: 1,
      })
      return failure(preflight.blockers.join(' '))
    }

    emit({
      stage: 'schedule',
      message: `CP-SAT: placing ${freeCourses.length} new course(s) · ${Object.keys(fixedDays).length} weekdays frozen`,
      fraction: SCHEDULE_LO,
    })

    const solved = await solveWithPinnedDays({
      courseSections,
      conflictGraph,
      facultyConstraints,
      students,
      fixedDays,
      allowSaturdayForMath,
      options,
      emit,
      signal,
    })

    if (solved) {
      slotByCourse = solved.slot_by_course
      placementMethod = 'cpsat'
      cpsatRan = true
      solverUsed = solved.solver_used
      solverTimeSeconds = solved.solver_time_seconds
      provenOptimal = solved.proven_optimal
      provenLevels = solved.proven_levels
      solverStatus = solved.status
      solverMessage = solved.message
    } else {
      // CP-SAT unavailable or returned nothing: clash-only greedy keeps the run usable,
      // but weekday balance is no longer guaranteed, so the report says so.
      emit({
        stage: 'schedule',
        message: 'CP-SAT unavailable — falling back to greedy placement',
        fraction: SCHEDULE_LO + 0.5,
      })
      const greedy = placeFreeCourseWeekdays(
        freeCourses,
        fixedDays,
        courseSections,
        conflictGraph,
        facultyConstraints,
        allowSaturdayForMath,
      )
      if (!greedy) {
        return failure(
          `Could not place ${freeCourses.join(', ')} on any weekday without moving an existing course.`,
        )
      }
      slotByCourse = greedy.slot_by_course
      placementMethod = 'greedy-fallback'
      solverUsed = 'rectify-greedy'
    }
  }

  throwIfAborted(signal)

  const slotAssignments = sectionSlotsFromCourseSlots(courseSections, slotByCourse)
  const audit = auditScheduleHardConstraints(
    courseSections,
    slotAssignments,
    parallelHardCap(sectionCount),
    facultyConstraints,
    { allowSaturdayForMath },
  )

  const clashReport = computeClashReport(students, courseSections, slotAssignments)
  const clashDiff = diffClashReports(previousClashReport, clashReport)
  const sectionCountChanges = diffSectionCounts(snapshot.courseSections, courseSections)
  const flatSections = Object.values(courseSections).flat()
  const schedulingStats = computeSchedulingStats(flatSections, slotAssignments, conflictGraph, {
    courseSections,
    students,
  })

  const rectificationReport = buildRectificationReport({
    enrollmentDelta,
    baselineWarnings,
    fixedDays,
    courseSections,
    slotByCourse,
    structuralFeasible: audit.structuralFeasible,
    structuralViolations: audit.structuralViolations,
    clashDiff,
    redStudents: clashReport.students_with_clashes,
    clashWeight: schedulingStats.total_clash_weight,
    sectionCountChanges,
    previousSummary: options.previousSummary,
    placementMethod,
    solverUsed,
    cpsatRan,
  })

  // Only structural breakage blocks a rectify; student clashes are the soft objective.
  if (!audit.structuralFeasible) {
    emit({
      stage: 'done',
      message: `Rectify blocked: ${audit.structuralViolations.length} structural violation(s)`,
      fraction: 1,
    })
    return {
      ...emptyRectifyResult(validation),
      clashReport,
      courseEmailsData: computeCourseEmailGroups(enrollmentRows),
      enrollmentDelta,
      allowSaturdayForMath,
      rectificationReport,
      infeasible: true,
      infeasible_reason: audit.structuralViolations.join('; '),
    }
  }

  const lb = schedulingStats.lower_bounds

  let programNomenclatureMap: Record<string, string> | undefined =
    DEFAULT_PROGRAM_NOMENCLATURE_MAP as Record<string, string>
  if (options?.programNomenclatureXlsx) {
    const { nomenclatureToProgramAbbrevMap } = await import('../io/excelNomenclature')
    programNomenclatureMap = await nomenclatureToProgramAbbrevMap(options.programNomenclatureXlsx)
  }

  const primaryZero =
    schedulingStats.total_clash_weight === 0 && clashReport.students_with_clashes === 0

  let schedule = buildSchedule(
    courseSections,
    slotAssignments,
    {
      solver_used: solverUsed,
      solver_time_seconds: solverTimeSeconds,
      hard_constraints_feasible: audit.structuralFeasible,
      hard_constraint_violations: audit.structuralViolations,
      solver_primary_metrics_zero: primaryZero,
      min_red_students_lower_bound: lb?.min_red_students_lower_bound,
      min_clash_weight_lower_bound: lb?.min_clash_weight_lower_bound,
      zero_clash_structurally_impossible: lb?.zero_clash_structurally_impossible,
      lower_bound_notes: lb?.notes,
    },
    {
      programNomenclature: programNomenclatureMap,
      previousLanes: snapshot.section_lanes,
    },
  )
  schedule = { ...schedule, total_clashes: clashReport.students_with_clashes }

  const { createRunLogEntry, appendRunLog, nextRunSeq } = await import('../merge/runLog')
  const { updateClashProvenance } = await import('../merge/clashProvenance')
  const { sectionLanesFromEntries } = await import('../merge/snapshot')
  const runAt = new Date().toISOString()
  const seq = nextRunSeq(snapshot.run_log ?? [])
  const runEntry = createRunLogEntry({
    seq,
    at: runAt,
    mode: 'rectify',
    inputs: {},
    seed: options?.seed,
    solver_status: solverStatus,
    students_before: Object.keys(snapshot.students).length,
    students_after: Object.keys(students).length,
    students_added: Object.keys(students).length - Object.keys(snapshot.students).length,
    registrations_added: enrollmentDelta.changed_students.reduce(
      (n, s) => n + s.added.length,
      0,
    ),
    courses_added: enrollmentDelta.new_course_codes.length,
    sections_created: [],
    students_moved_between_sections: 0,
    capacity_waivers: [],
    parked: [],
    red_before: previousClashReport.students_with_clashes,
    red_after: clashReport.students_with_clashes,
    clashes_introduced: clashDiff.introduced.length,
    clashes_resolved: clashDiff.resolved.length,
    decisions: [],
    notes: [],
  })
  const runLog = appendRunLog(snapshot.run_log ?? [], runEntry)
  const clashProvenance = updateClashProvenance(snapshot.clash_provenance ?? {}, clashDiff, {
    seq,
    at: runAt,
    operation: 'rectify',
    newlyAddedCourses: enrollmentDelta.new_course_codes,
  })

  const schedulingSnapshot: SchedulingSnapshot = {
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: { ...slotAssignments },
    courseSections: deepCloneCourseSections(courseSections),
    students: cloneStudents(students),
    enrollmentRows: enrollmentRows.map((r) => ({ ...r })),
    allowSaturdayForMath,
    ...(options?.seed !== undefined ? { seed: options.seed } : {}),
    section_lanes: sectionLanesFromEntries(schedule.entries),
    run_log: runLog,
    clash_provenance: clashProvenance,
    late_enrollments: snapshot.late_enrollments,
  }

  let scheduleXlsx: ArrayBuffer | null = null
  let clashXlsx: ArrayBuffer | null = null
  let courseEmailsXlsx: ArrayBuffer | null = null

  const eagerKinds = options?.eagerExportKinds ?? {
    schedule: true,
    clash: true,
    courseEmails: true,
  }

  // Carry the late-enrollment history forward so rectified workbooks keep the Late Adds
  // column and amber tinting; batch 0 means "no new batch", so no detail sheet is emitted.
  const { buildLateMarking } = await import('../io/excelLateMarking')
  const lateMarking = snapshot.late_enrollments?.length
    ? buildLateMarking({
        records: snapshot.late_enrollments,
        batch: 0,
        students,
        clashReport,
      })
    : null

  if (options?.eagerExports) {
    emit({ stage: 'export', message: 'Building rectified exports…', fraction: 0.9 })
    throwIfAborted(signal)
    const exportOpts = {
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      lateMarking,
      runLog,
      clashProvenance,
    }
    if (eagerKinds.schedule) {
      scheduleXlsx = await buildScheduleXlsxBuffer(schedule, {
        snapshot: schedulingSnapshot,
        ...exportOpts,
      })
    }
    if (eagerKinds.clash) {
      clashXlsx = await buildClashXlsxBuffer(clashReport, exportOpts)
    }
    if (eagerKinds.courseEmails && enrollmentRows.length > 0) {
      courseEmailsXlsx = await buildCourseEmailsXlsxBuffer(enrollmentRows, exportOpts)
    }
  }

  emit({
    stage: 'done',
    message: `Rectify complete · ${enrollmentDelta.changed_students.length} student change(s) · ${clashDiff.introduced.length} new clash(es)`,
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
      scheduling: schedulingStats,
    },
    schedulingSnapshot,
    rectificationReport,
    enrollmentDelta,
    runLog,
    clashProvenance,
    allowSaturdayForMath,
    proven_optimal: provenOptimal,
    proven_levels: provenLevels,
    solver_status: solverStatus,
    solver_message: solverMessage,
  }
}

/**
 * Full lex CP-SAT solve with every continuing course pinned. Because only the new courses are
 * free, presolve collapses the model and weekday balance / parallel spread stay optimal.
 * Returns null when the solver cannot produce an assignment so the caller can fall back.
 */
async function solveWithPinnedDays(args: {
  courseSections: Record<string, import('../types').Section[]>
  conflictGraph: import('../types').ConflictGraph
  facultyConstraints: Record<string, string[]>
  students: Record<string, import('../types').Student>
  fixedDays: Record<string, number>
  allowSaturdayForMath: boolean
  options: RunRectifyOptions
  emit: (event: PipelineProgressEvent) => void
  signal?: AbortSignal
}) {
  const { runCpsatScheduler } = await import('../solver/cpsatBridge')
  const { buildGreedyHint } = await import('../solver/greedyHint')
  const { computeSchedulingLowerBounds } = await import('../solver/lowerBounds')
  const { options, emit } = args

  const warm = buildGreedyHint({
    courseSections: args.courseSections,
    conflictGraph: args.conflictGraph,
    facultyConstraints: args.facultyConstraints,
    students: args.students,
    allowSaturdayForMath: args.allowSaturdayForMath,
    seed: options.seed ?? 42,
  })
  // Pinned days win over the heuristic so the hint never contradicts the model.
  const hint = { ...warm.hint, ...args.fixedDays }

  const structuralLb = computeSchedulingLowerBounds(
    args.courseSections,
    args.conflictGraph,
    args.students,
    { allowSaturdayForMath: args.allowSaturdayForMath },
  )

  try {
    const cpsat = await runCpsatScheduler(
      args.courseSections,
      args.conflictGraph,
      args.facultyConstraints,
      args.students,
      {
        timeLimitSeconds: options.cpsatTimeLimitSeconds ?? DEFAULT_RECTIFY_TIME_LIMIT_SECONDS,
        workers: options.cpsatWorkers,
        hint,
        fixedDays: args.fixedDays,
        minClashWeightLowerBound: structuralLb.min_clash_weight_lower_bound,
        minRedStudentsLowerBound: structuralLb.min_red_students_lower_bound,
        // A near-fully-pinned model presolves instantly; racing seeds adds nothing.
        portfolio: 0,
        absoluteGap: options.cpsatAbsoluteGap,
        provePlateauSeconds:
          options.cpsatProvePlateauSeconds ??
          (options.cpsatFullProve ? undefined : DEFAULT_RECTIFY_PLATEAU_SECONDS),
        fullProve: options.cpsatFullProve,
        allowSaturdayForMath: args.allowSaturdayForMath,
        seed: options.seed,
        signal: args.signal,
        onProgress: (evt) => {
          if (evt.type === 'progress' || evt.type === 'heartbeat') {
            emit({
              stage: 'schedule',
              message: evt.phase_label ?? evt.phase,
              fraction: mapSolverFraction(Math.min(0.99, 0.15 + Math.min(0.7, evt.elapsed / 60))),
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
    if (!cpsat.slot_by_course || Object.keys(cpsat.slot_by_course).length === 0) return null
    return cpsat
  } catch (err) {
    if (err instanceof Error && err.name === 'PipelineCancelledError') throw err
    const { PipelineCancelledError } = await import('./cancellation')
    if (err instanceof PipelineCancelledError) throw err
    emit({
      stage: 'schedule',
      message: `CP-SAT failed: ${err instanceof Error ? err.message : String(err)}`,
      fraction: SCHEDULE_LO + 0.4,
    })
    return null
  }
}

function buildRectificationReport(args: {
  enrollmentDelta: EnrollmentDelta
  baselineWarnings: BaselineValidationWarning[]
  fixedDays: Record<string, number>
  courseSections: Record<string, import('../types').Section[]>
  slotByCourse: Record<string, number>
  structuralFeasible: boolean
  structuralViolations: string[]
  clashDiff: ClashDiff
  redStudents: number
  clashWeight: number
  sectionCountChanges: SectionCountChange[]
  previousSummary?: { red_students?: number; clash_weight?: number }
  placementMethod: PlacementMethod
  solverUsed: string
  cpsatRan: boolean
}): RectificationReport {
  const placements = describePlacements(
    args.enrollmentDelta.new_course_codes,
    args.courseSections,
    args.slotByCourse,
  )
  const newCourseSlots: Record<string, number> = {}
  for (const placement of placements) {
    newCourseSlots[placement.course_code] = placement.slot_index
  }

  return {
    changed_students: args.enrollmentDelta.changed_students,
    new_course_codes: args.enrollmentDelta.new_course_codes,
    removed_course_codes: args.enrollmentDelta.removed_course_codes,
    new_course_placements: placements,
    new_course_slots: newCourseSlots,
    pinned_course_count: Object.keys(args.fixedDays).length,
    section_count_changes: args.sectionCountChanges,
    baseline_warnings: args.baselineWarnings,
    hard_constraints_feasible: args.structuralFeasible,
    hard_constraint_violations: args.structuralViolations,
    new_clashes: args.clashDiff.introduced,
    carried_over_clashes: args.clashDiff.carried_over,
    resolved_clashes: args.clashDiff.resolved,
    previous_red_students: args.previousSummary?.red_students,
    previous_clash_weight: args.previousSummary?.clash_weight,
    new_red_students: args.redStudents,
    new_clash_weight: args.clashWeight,
    placement_method: args.placementMethod,
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
    runLog: [],
    clashProvenance: {},
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
    return JSON.parse(raw) as { red_students?: number; clash_weight?: number }
  } catch {
    return undefined
  }
}

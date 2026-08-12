import type {
  ClashReport,
  ConflictGraph,
  CourseEmailGroup,
  Schedule,
  Student,
  ValidationResult,
} from '../types'
import type { SchedulingStats } from '../solver/metrics'
import { buildConflictGraph, extractFacultyConstraints } from '../preprocess/preprocessing'
import {
  cloneSchedulingSnapshot,
  cloneStudents,
  deepCloneCourseSections,
  sectionLanesFromEntries,
  WEEKDAY_SLOT_MODEL,
  type SchedulingSnapshot,
} from '../merge/snapshot'
import {
  appendRunLog,
  createRunLogEntry,
  nextRunSeq,
  type RunLogClock,
  type RunLogEntry,
  type RunMode,
} from '../merge/runLog'
import {
  updateClashProvenance,
  type ClashProvenanceMap,
} from '../merge/clashProvenance'
import { diffClashReports } from '../merge/rectifyDiff'
import {
  dropStudentCourse,
  fixStudentCourse,
  type DropStudentCourseArgs,
  type FixStudentCourseArgs,
  type StudentCourseEditResult,
} from '../merge/studentCourseEdit'
import {
  buildFixedDays,
  freeCourseCodes,
  inferAllowSaturdayFromSnapshot,
} from '../merge/enrollmentDelta'
import { placeFreeCourseWeekdays, preflightRectify } from '../merge/rectifyPlacement'
import { sectionSlotsFromCourseSlots } from '../solver/cpsatInstance'
import {
  buildClashXlsxBuffer,
  buildCourseEmailsXlsxBuffer,
  buildScheduleXlsxBuffer,
} from './exports'
import { computeCourseEmailGroups, type PipelineProgressEvent } from './run'
import { throwIfAborted } from './cancellation'
import { enrollmentRowsToWorkbookBuffer } from '../io/excelEnrollment'
import DEFAULT_PROGRAM_NOMENCLATURE_MAP from '../io/programNomenclatureMap.json'

export type FixCourseMode = 'fix-course' | 'drop-course'

export type FixPlacementMethod = 'existing' | 'cpsat' | 'greedy-fallback'

export type RunFixOptions = {
  previousSnapshot: SchedulingSnapshot
  mode: FixCourseMode
  fix?: FixStudentCourseArgs
  drop?: DropStudentCourseArgs
  signal?: AbortSignal
  clock?: RunLogClock
  seed?: number
  inputFileName?: string
  previousDir?: string
  outputDir?: string
  programNomenclatureXlsx?: ArrayBuffer
  allowSaturdayForMath?: boolean
  saturdayExtraCourseCodes?: string[]
  cpsatTimeLimitSeconds?: number
  cpsatWorkers?: number
  cpsatAbsoluteGap?: number
  cpsatProvePlateauSeconds?: number
  cpsatFullProve?: boolean
}

export type FixEditReport = {
  mode: FixCourseMode
  register_number: string
  removed_course: string
  added_course?: string
  target_section_id?: string
  pruned_courses: string[]
  student_removed: boolean
  created_new_course: boolean
  placement_method: FixPlacementMethod
  new_course_slot?: number
  red_before: number
  red_after: number
}

export type FixPipelineResult = {
  validation: ValidationResult
  schedule: Schedule | null
  clashReport: ClashReport | null
  scheduleXlsx: ArrayBuffer | null
  clashXlsx: ArrayBuffer | null
  courseEmailsXlsx: ArrayBuffer | null
  courseEmailsData: CourseEmailGroup[] | null
  enrollmentXlsx: ArrayBuffer | null
  stats: {
    studentCount: number
    courseCount: number
    sectionCount: number
    scheduling: SchedulingStats | null
  } | null
  schedulingSnapshot: SchedulingSnapshot | null
  editReport: FixEditReport | null
  runLog: RunLogEntry[]
  clashProvenance: ClashProvenanceMap
  allowSaturdayForMath?: boolean
  saturdayExtraCourseCodes?: string[]
  solver_status?: string
  solver_message?: string
  infeasible?: boolean
  infeasible_reason?: string
}

const DEFAULT_FIX_TIME_LIMIT_SECONDS = 300
const DEFAULT_FIX_PLATEAU_SECONDS = 20

function emptyFixResult(validation: ValidationResult): FixPipelineResult {
  return {
    validation,
    schedule: null,
    clashReport: null,
    scheduleXlsx: null,
    clashXlsx: null,
    courseEmailsXlsx: null,
    courseEmailsData: null,
    enrollmentXlsx: null,
    stats: null,
    schedulingSnapshot: null,
    editReport: null,
    runLog: [],
    clashProvenance: {},
  }
}

/**
 * Surgical fix/drop: mutate one student–course assignment.
 * Existing target → rebuild exports with weekdays frozen.
 * Brand-new target → pin existing weekdays and place the new course via CP-SAT (greedy fallback).
 */
export async function runFixPipeline(
  onProgress: (event: PipelineProgressEvent) => void,
  options: RunFixOptions,
): Promise<FixPipelineResult> {
  const emit = onProgress
  const signal = options.signal
  const clock = options.clock ?? (() => new Date())
  const previous = options.previousSnapshot

  const validation: ValidationResult = {
    is_valid: true,
    errors: [],
    warnings: [],
    total_rows: previous.enrollmentRows.length,
    valid_rows: previous.enrollmentRows.length,
  }

  emit({ stage: 'parse', message: 'Applying surgical enrollment edit…', fraction: 0.1 })
  throwIfAborted(signal)

  let edit: StudentCourseEditResult
  if (options.mode === 'fix-course') {
    if (!options.fix) {
      return {
        ...emptyFixResult(validation),
        infeasible: true,
        infeasible_reason: 'fix-course requires from/to course arguments.',
        runLog: previous.run_log ?? [],
        clashProvenance: previous.clash_provenance ?? {},
      }
    }
    edit = fixStudentCourse(previous, options.fix)
  } else {
    if (!options.drop) {
      return {
        ...emptyFixResult(validation),
        infeasible: true,
        infeasible_reason: 'drop-course requires register and course arguments.',
        runLog: previous.run_log ?? [],
        clashProvenance: previous.clash_provenance ?? {},
      }
    }
    edit = dropStudentCourse(previous, options.drop)
  }

  const working = edit.snapshot
  throwIfAborted(signal)

  const allowSaturdayForMath =
    options.allowSaturdayForMath ?? inferAllowSaturdayFromSnapshot(previous)
  const saturdayExtraCourseCodes =
    options.saturdayExtraCourseCodes ?? previous.saturdayExtraCourseCodes ?? []

  let placementMethod: FixPlacementMethod = 'existing'
  let solverStatus = 'SNAPSHOT'
  let solverMessage = 'Surgical edit — timetable weekdays frozen'
  let solverUsed = 'snapshot-rebuild'
  let solverTimeSeconds = 0
  let newCourseSlot: number | undefined
  let ortoolsVersion: string | undefined
  let pythonVersion: string | undefined

  if (edit.created_new_course && edit.added_course) {
    emit({
      stage: 'schedule',
      message: `Placing new course ${edit.added_course} with existing weekdays frozen…`,
      fraction: 0.2,
    })

    const placed = await placeNewFixCourse({
      working,
      newCourseCode: edit.added_course,
      allowSaturdayForMath,
      saturdayExtraCourseCodes,
      options,
      emit,
      signal,
    })
    if (!placed.ok) {
      return {
        ...emptyFixResult(validation),
        infeasible: true,
        infeasible_reason: placed.reason,
        runLog: previous.run_log ?? [],
        clashProvenance: previous.clash_provenance ?? {},
      }
    }
    working.slot_assignments = placed.slot_assignments
    placementMethod = placed.placement_method
    solverStatus = placed.solver_status
    solverMessage = placed.solver_message
    solverUsed = placed.solver_used
    solverTimeSeconds = placed.solver_time_seconds
    newCourseSlot = placed.new_course_slot
    ortoolsVersion = placed.ortools_version
    pythonVersion = placed.python_version
  }

  emit({ stage: 'build', message: 'Rebuilding schedule and clash report…', fraction: 0.4 })

  const { buildSchedule, computeClashReport, auditScheduleHardConstraints, parallelHardCap } =
    await import('../solver/scheduler')
  const { computeSchedulingStats } = await import('../solver/metrics')

  const facultyConstraints = extractFacultyConstraints(working.courseSections)
  const sectionCount = Object.values(working.courseSections).reduce((n, s) => n + s.length, 0)

  const audit = auditScheduleHardConstraints(
    working.courseSections,
    working.slot_assignments,
    parallelHardCap(sectionCount),
    facultyConstraints,
    { allowSaturdayForMath, saturdayExtraCourseCodes },
  )

  if (!audit.structuralFeasible) {
    return {
      ...emptyFixResult(validation),
      infeasible: true,
      infeasible_reason: audit.structuralViolations.join('; '),
      runLog: previous.run_log ?? [],
      clashProvenance: previous.clash_provenance ?? {},
    }
  }

  const previousClashReport = computeClashReport(
    previous.students,
    previous.courseSections,
    previous.slot_assignments,
  )
  const clashReport = computeClashReport(
    working.students,
    working.courseSections,
    working.slot_assignments,
  )
  const clashDiff = diffClashReports(previousClashReport, clashReport)

  let programNomenclatureMap: Record<string, string> | undefined =
    DEFAULT_PROGRAM_NOMENCLATURE_MAP as Record<string, string>
  if (options.programNomenclatureXlsx) {
    const { nomenclatureToProgramAbbrevMap } = await import('../io/excelNomenclature')
    programNomenclatureMap = await nomenclatureToProgramAbbrevMap(options.programNomenclatureXlsx)
  }

  const conflictGraph = buildConflictGraph(working.students, working.courseSections)
  const flatSections = Object.values(working.courseSections).flat()
  const schedulingStats = computeSchedulingStats(flatSections, working.slot_assignments, conflictGraph, {
    courseSections: working.courseSections,
    students: working.students,
  })

  let schedule = buildSchedule(
    working.courseSections,
    working.slot_assignments,
    {
      solver_used: solverUsed,
      solver_time_seconds: solverTimeSeconds,
      hard_constraints_feasible: audit.structuralFeasible,
      hard_constraint_violations: audit.structuralViolations,
      solver_primary_metrics_zero:
        schedulingStats.total_clash_weight === 0 && clashReport.students_with_clashes === 0,
      min_red_students_lower_bound: schedulingStats.lower_bounds?.min_red_students_lower_bound,
      min_clash_weight_lower_bound: schedulingStats.lower_bounds?.min_clash_weight_lower_bound,
      zero_clash_structurally_impossible:
        schedulingStats.lower_bounds?.zero_clash_structurally_impossible,
      lower_bound_notes: schedulingStats.lower_bounds?.notes,
    },
    {
      programNomenclature: programNomenclatureMap,
      previousLanes: working.section_lanes ?? previous.section_lanes,
    },
  )
  schedule = { ...schedule, total_clashes: clashReport.students_with_clashes }

  const mode: RunMode = options.mode
  const seq = nextRunSeq(previous.run_log ?? [])
  const at = clock().toISOString()

  const clashProvenance = updateClashProvenance(previous.clash_provenance ?? {}, clashDiff, {
    seq,
    at,
    operation: mode,
    newlyAddedCourses: edit.created_new_course && edit.added_course ? [edit.added_course] : [],
  })

  const notes: string[] = [
    options.mode === 'fix-course'
      ? `Moved ${edit.register_number}: ${edit.removed_course} → ${edit.added_course}`
      : `Dropped ${edit.register_number} from ${edit.removed_course}`,
  ]
  if (edit.target_section_id) notes.push(`Placed into ${edit.target_section_id}`)
  if (edit.created_new_course && edit.added_course) {
    notes.push(
      `Created new course ${edit.added_course}` +
        (newCourseSlot !== undefined ? ` on weekday slot ${newCourseSlot}` : '') +
        ` via ${placementMethod}`,
    )
  }
  if (edit.pruned_courses.length) {
    notes.push(`Pruned empty course(s): ${edit.pruned_courses.join(', ')}`)
  }
  if (edit.student_removed) notes.push(`Removed student ${edit.register_number} (no courses left)`)

  const coursesAdded =
    (edit.created_new_course ? 1 : 0) - (edit.pruned_courses.length ? edit.pruned_courses.length : 0)

  const runEntry = createRunLogEntry(
    {
      seq,
      at,
      mode,
      inputs: {
        enrollment: options.inputFileName,
        previous_dir: options.previousDir,
      },
      output_dir: options.outputDir,
      seed: options.seed ?? previous.seed,
      solver_status: solverStatus,
      students_before: Object.keys(previous.students).length,
      students_after: Object.keys(working.students).length,
      students_added: 0,
      registrations_added: options.mode === 'fix-course' ? 0 : -1,
      courses_added: coursesAdded,
      sections_created: edit.created_new_course && edit.target_section_id ? [edit.target_section_id] : [],
      students_moved_between_sections: 0,
      capacity_waivers: [],
      parked: [],
      red_before: previousClashReport.students_with_clashes,
      red_after: clashReport.students_with_clashes,
      clashes_introduced: clashDiff.introduced.length,
      clashes_resolved: clashDiff.resolved.length,
      decisions: [
        {
          kind: 'other',
          subject: edit.register_number,
          choice: options.mode,
          detail:
            options.mode === 'fix-course'
              ? `${edit.removed_course}→${edit.added_course}` +
                (edit.created_new_course ? ` (new/${placementMethod})` : '')
              : edit.removed_course,
        },
      ],
      notes,
    },
    clock,
  )
  const runLog = appendRunLog(previous.run_log ?? [], runEntry)

  const schedulingSnapshot: SchedulingSnapshot = {
    ...cloneSchedulingSnapshot(working),
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: { ...working.slot_assignments },
    courseSections: deepCloneCourseSections(working.courseSections),
    students: cloneStudents(working.students),
    enrollmentRows: working.enrollmentRows.map((r) => ({ ...r })),
    allowSaturdayForMath,
    ...(saturdayExtraCourseCodes.length ? { saturdayExtraCourseCodes: [...saturdayExtraCourseCodes] } : {}),
    ...(options.seed !== undefined
      ? { seed: options.seed }
      : previous.seed !== undefined
        ? { seed: previous.seed }
        : {}),
    ...(previous.workers !== undefined ? { workers: previous.workers } : {}),
    ...(previous.portfolio !== undefined ? { portfolio: previous.portfolio } : {}),
    ...(ortoolsVersion
      ? { ortools_version: ortoolsVersion }
      : previous.ortools_version
        ? { ortools_version: previous.ortools_version }
        : {}),
    ...(pythonVersion
      ? { python_version: pythonVersion }
      : previous.python_version
        ? { python_version: previous.python_version }
        : {}),
    late_enrollments: working.late_enrollments?.map((r) => ({ ...r })),
    run_log: runLog,
    clash_provenance: clashProvenance,
    section_lanes: sectionLanesFromEntries(schedule.entries),
    facultyOverrides: working.facultyOverrides ? { ...working.facultyOverrides } : undefined,
  }

  emit({ stage: 'export', message: 'Writing Excel exports…', fraction: 0.75 })
  throwIfAborted(signal)

  const exportOpts = {
    ...(schedulingSnapshot.seed !== undefined ? { seed: schedulingSnapshot.seed } : {}),
    runLog,
    clashProvenance,
  }

  const scheduleXlsx = await buildScheduleXlsxBuffer(schedule, {
    snapshot: schedulingSnapshot,
    ...exportOpts,
  })
  const clashXlsx = await buildClashXlsxBuffer(clashReport, exportOpts)
  const courseEmailsXlsx = await buildCourseEmailsXlsxBuffer(working.enrollmentRows, exportOpts)
  const enrollmentXlsx = await enrollmentRowsToWorkbookBuffer(working.enrollmentRows, {
    seed: schedulingSnapshot.seed,
  })

  emit({
    stage: 'done',
    message: edit.created_new_course
      ? `Surgical edit complete · new course placed via ${placementMethod}`
      : 'Surgical edit complete',
    fraction: 1,
  })

  return {
    validation,
    schedule,
    clashReport,
    scheduleXlsx,
    clashXlsx,
    courseEmailsXlsx,
    courseEmailsData: computeCourseEmailGroups(working.enrollmentRows),
    enrollmentXlsx,
    stats: {
      studentCount: Object.keys(working.students).length,
      courseCount: Object.keys(working.courseSections).length,
      sectionCount,
      scheduling: schedulingStats,
    },
    schedulingSnapshot,
    editReport: {
      mode: options.mode,
      register_number: edit.register_number,
      removed_course: edit.removed_course,
      added_course: edit.added_course,
      target_section_id: edit.target_section_id,
      pruned_courses: edit.pruned_courses,
      student_removed: edit.student_removed,
      created_new_course: edit.created_new_course,
      placement_method: placementMethod,
      new_course_slot: newCourseSlot,
      red_before: previousClashReport.students_with_clashes,
      red_after: clashReport.students_with_clashes,
    },
    runLog,
    clashProvenance,
    allowSaturdayForMath,
    saturdayExtraCourseCodes,
    solver_status: solverStatus,
    solver_message: solverMessage,
  }
}

type PlaceNewFixResult =
  | {
      ok: true
      slot_assignments: Record<string, number>
      placement_method: 'cpsat' | 'greedy-fallback'
      solver_status: string
      solver_message: string
      solver_used: string
      solver_time_seconds: number
      new_course_slot: number
      ortools_version?: string
      python_version?: string
    }
  | { ok: false; reason: string }

async function placeNewFixCourse(args: {
  working: SchedulingSnapshot
  newCourseCode: string
  allowSaturdayForMath: boolean
  saturdayExtraCourseCodes: string[]
  options: RunFixOptions
  emit: (event: PipelineProgressEvent) => void
  signal?: AbortSignal
}): Promise<PlaceNewFixResult> {
  const {
    working,
    newCourseCode,
    allowSaturdayForMath,
    saturdayExtraCourseCodes,
    options,
    emit,
    signal,
  } = args

  const allCourseCodes = new Set(Object.keys(working.courseSections))
  // Pin from the post-edit working snapshot so pruned typo courses are not required,
  // and the brand-new code remains free for placement.
  const fixedDays = buildFixedDays(working, allCourseCodes)
  const free = freeCourseCodes(allCourseCodes, fixedDays)

  if (!free.includes(newCourseCode)) {
    return {
      ok: false,
      reason: `Expected ${newCourseCode} to need a weekday, but it was already pinned.`,
    }
  }
  if (free.length !== 1 || free[0] !== newCourseCode) {
    return {
      ok: false,
      reason: `Unexpected free courses during surgical fix: ${free.join(', ') || '(none)'}.`,
    }
  }

  const conflictGraph = buildConflictGraph(working.students, working.courseSections)
  const facultyConstraints = extractFacultyConstraints(working.courseSections)

  const preflight = preflightRectify({
    fixedDays,
    freeCourses: free,
    courseSections: working.courseSections,
    facultyConstraints,
    allowSaturdayForMath,
    saturdayExtraCourseCodes,
  })
  if (!preflight.ok) {
    return { ok: false, reason: preflight.blockers.join(' ') }
  }

  const solved = await solveNewFixCourse({
    courseSections: working.courseSections,
    conflictGraph,
    facultyConstraints,
    students: working.students,
    fixedDays,
    allowSaturdayForMath,
    saturdayExtraCourseCodes,
    options,
    emit,
    signal,
  })

  let slotByCourse: Record<string, number>
  let placement_method: 'cpsat' | 'greedy-fallback'
  let solver_status: string
  let solver_message: string
  let solver_used: string
  let solver_time_seconds = 0
  let ortools_version: string | undefined
  let python_version: string | undefined

  if (solved) {
    slotByCourse = solved.slot_by_course
    placement_method = 'cpsat'
    solver_status = solved.status
    solver_message = solved.message ?? `Placed new course ${newCourseCode} via CP-SAT`
    solver_used = solved.solver_used
    solver_time_seconds = solved.solver_time_seconds
    ortools_version = solved.ortools_version
    python_version = solved.python_version
  } else {
    emit({
      stage: 'schedule',
      message: 'CP-SAT unavailable — falling back to greedy placement',
      fraction: 0.35,
    })
    const greedy = placeFreeCourseWeekdays(
      free,
      fixedDays,
      working.courseSections,
      conflictGraph,
      facultyConstraints,
      allowSaturdayForMath,
      saturdayExtraCourseCodes,
    )
    if (!greedy) {
      return {
        ok: false,
        reason: `Could not place ${newCourseCode} on any weekday without moving an existing course.`,
      }
    }
    slotByCourse = greedy.slot_by_course
    placement_method = 'greedy-fallback'
    solver_status = 'GREEDY'
    solver_message = `Placed new course ${newCourseCode} via greedy fallback`
    solver_used = 'fix-greedy'
  }

  const new_course_slot = slotByCourse[newCourseCode]
  if (new_course_slot === undefined) {
    return { ok: false, reason: `Solver did not return a weekday for ${newCourseCode}.` }
  }

  return {
    ok: true,
    slot_assignments: sectionSlotsFromCourseSlots(working.courseSections, slotByCourse),
    placement_method,
    solver_status,
    solver_message,
    solver_used,
    solver_time_seconds,
    new_course_slot,
    ortools_version,
    python_version,
  }
}

async function solveNewFixCourse(args: {
  courseSections: Record<string, import('../types').Section[]>
  conflictGraph: ConflictGraph
  facultyConstraints: Record<string, string[]>
  students: Record<string, Student>
  fixedDays: Record<string, number>
  allowSaturdayForMath: boolean
  saturdayExtraCourseCodes: string[]
  options: RunFixOptions
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
    saturdayExtraCourseCodes: args.saturdayExtraCourseCodes,
    seed: options.seed ?? 42,
  })
  const hint = { ...warm.hint, ...args.fixedDays }

  const structuralLb = computeSchedulingLowerBounds(
    args.courseSections,
    args.conflictGraph,
    args.students,
    {
      allowSaturdayForMath: args.allowSaturdayForMath,
      saturdayExtraCourseCodes: args.saturdayExtraCourseCodes,
    },
  )

  try {
    const cpsat = await runCpsatScheduler(
      args.courseSections,
      args.conflictGraph,
      args.facultyConstraints,
      args.students,
      {
        timeLimitSeconds: options.cpsatTimeLimitSeconds ?? DEFAULT_FIX_TIME_LIMIT_SECONDS,
        workers: options.cpsatWorkers,
        hint,
        fixedDays: args.fixedDays,
        minClashWeightLowerBound: structuralLb.min_clash_weight_lower_bound,
        minRedStudentsLowerBound: structuralLb.min_red_students_lower_bound,
        portfolio: 0,
        absoluteGap: options.cpsatAbsoluteGap,
        provePlateauSeconds:
          options.cpsatProvePlateauSeconds ??
          (options.cpsatFullProve ? undefined : DEFAULT_FIX_PLATEAU_SECONDS),
        fullProve: options.cpsatFullProve,
        allowSaturdayForMath: args.allowSaturdayForMath,
        saturdayExtraCourseCodes: args.saturdayExtraCourseCodes,
        seed: options.seed,
        signal: args.signal,
        onProgress: (evt) => {
          if (evt.type === 'progress' || evt.type === 'heartbeat') {
            emit({
              stage: 'schedule',
              message: evt.phase_label ?? evt.phase,
              fraction: 0.2 + Math.min(0.15, (evt.elapsed ?? 0) / 120),
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
      fraction: 0.35,
    })
    return null
  }
}

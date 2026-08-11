import type {
  ClashReport,
  CourseEmailGroup,
  Schedule,
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
  buildClashXlsxBuffer,
  buildCourseEmailsXlsxBuffer,
  buildScheduleXlsxBuffer,
} from './exports'
import { computeCourseEmailGroups, type PipelineProgressEvent } from './run'
import { throwIfAborted } from './cancellation'
import { enrollmentRowsToWorkbookBuffer } from '../io/excelEnrollment'
import DEFAULT_PROGRAM_NOMENCLATURE_MAP from '../io/programNomenclatureMap.json'
import { inferAllowSaturdayFromSnapshot } from '../merge/enrollmentDelta'

export type FixCourseMode = 'fix-course' | 'drop-course'

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
}

export type FixEditReport = {
  mode: FixCourseMode
  register_number: string
  removed_course: string
  added_course?: string
  target_section_id?: string
  pruned_courses: string[]
  student_removed: boolean
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
 * Surgical fix/drop: mutate one student–course assignment on a frozen snapshot,
 * rebuild exports without re-solving weekdays.
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

  emit({ stage: 'build', message: 'Rebuilding schedule and clash report…', fraction: 0.4 })

  const { buildSchedule, computeClashReport, auditScheduleHardConstraints, parallelHardCap } =
    await import('../solver/scheduler')
  const { computeSchedulingStats } = await import('../solver/metrics')

  const facultyConstraints = extractFacultyConstraints(working.courseSections)
  const sectionCount = Object.values(working.courseSections).reduce((n, s) => n + s.length, 0)
  const allowSaturdayForMath =
    options.allowSaturdayForMath ?? inferAllowSaturdayFromSnapshot(previous)
  const saturdayExtraCourseCodes =
    options.saturdayExtraCourseCodes ?? previous.saturdayExtraCourseCodes ?? []

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
      solver_used: 'snapshot-rebuild',
      solver_time_seconds: 0,
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
    newlyAddedCourses: edit.added_course ? [edit.added_course] : [],
  })

  const notes: string[] = [
    options.mode === 'fix-course'
      ? `Moved ${edit.register_number}: ${edit.removed_course} → ${edit.added_course}`
      : `Dropped ${edit.register_number} from ${edit.removed_course}`,
  ]
  if (edit.target_section_id) notes.push(`Placed into ${edit.target_section_id}`)
  if (edit.pruned_courses.length) {
    notes.push(`Pruned empty course(s): ${edit.pruned_courses.join(', ')}`)
  }
  if (edit.student_removed) notes.push(`Removed student ${edit.register_number} (no courses left)`)

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
      solver_status: 'SNAPSHOT',
      students_before: Object.keys(previous.students).length,
      students_after: Object.keys(working.students).length,
      students_added: 0,
      registrations_added: options.mode === 'fix-course' ? 0 : -1,
      courses_added: edit.pruned_courses.length ? -edit.pruned_courses.length : 0,
      sections_created: [],
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
              ? `${edit.removed_course}→${edit.added_course}`
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
    ...(previous.ortools_version ? { ortools_version: previous.ortools_version } : {}),
    ...(previous.python_version ? { python_version: previous.python_version } : {}),
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

  emit({ stage: 'done', message: 'Surgical edit complete', fraction: 1 })

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
      red_before: previousClashReport.students_with_clashes,
      red_after: clashReport.students_with_clashes,
    },
    runLog,
    clashProvenance,
    allowSaturdayForMath,
    saturdayExtraCourseCodes,
    solver_status: 'SNAPSHOT',
    solver_message: 'Surgical edit — timetable weekdays frozen',
  }
}

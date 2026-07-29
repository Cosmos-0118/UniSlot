import {
  buildConflictGraph,
  extractFacultyConstraints,
} from '../preprocess/preprocessing'
import {
  buildFixedDays,
  freeCourseCodes,
  inferAllowSaturdayFromSnapshot,
  extractCourseSlotsFromSnapshot,
} from '../merge/enrollmentDelta'
import { placeFreeCourseWeekdays, preflightRectify } from '../merge/rectifyPlacement'
import { diffClashReports, type ClashDiff } from '../merge/rectifyDiff'
import {
  cloneStudents,
  deepCloneCourseSections,
  sectionLanesFromEntries,
  WEEKDAY_SLOT_MODEL,
  type LateEnrollmentRecord,
  type SchedulingSnapshot,
} from '../merge/snapshot'
import {
  assertFrozenInvariants,
  computeLateAdditions,
  mergeLateStudentsIntoSections,
  preflightLateCapacity,
  type CapacityDecision,
  type LateAddition,
  type LateAdditionsResult,
  type OnFullStrategy,
  type SectionAssignment,
} from '../merge/lateEnrollment'
import {
  buildCapacityPanel,
  buildClashPanel,
  predictLateClashes,
  type CapacityPanel,
  type ClashPanel,
  type PredictedClash,
} from '../merge/lateResolution'
import {
  appendRunLog,
  createRunLogEntry,
  nextLateBatch,
  nextRunSeq,
  type RunLogClock,
  type RunLogDecision,
  type RunLogEntry,
} from '../merge/runLog'
import {
  updateClashProvenance,
  type ClashProvenanceMap,
} from '../merge/clashProvenance'
import { computeSchedulingStats, type SchedulingStats } from '../solver/metrics'
import { sectionSlotsFromCourseSlots } from '../solver/cpsatInstance'
import { SINGLE_SECTION_MAX, SPLIT_SECTION_CAP } from '../solver/capacity'
import type {
  ClashReport,
  CourseEmailGroup,
  EnrollmentRow,
  Schedule,
  Section,
  Student,
  ValidationResult,
} from '../types'
import { throwIfAborted } from './cancellation'
import {
  buildClashXlsxBuffer,
  buildCourseEmailsXlsxBuffer,
  buildScheduleXlsxBuffer,
  type PipelineExportKind,
} from './exports'
import { computeCourseEmailGroups, type PipelineProgressEvent } from './run'
import { buildLateMarking, type LateMarking } from '../io/excelLateMarking'

import DEFAULT_PROGRAM_NOMENCLATURE_MAP from '../io/programNomenclatureMap.json'

export type ClashDecision = {
  register_number: string
  choice: 'accept' | 'drop-course' | 'park-student'
  drop_course_code?: string
}

export type LateEnrollmentReport = {
  batch: number
  run_seq: number
  additions_result: LateAdditionsResult
  capacity_conflicts: ReturnType<typeof preflightLateCapacity>
  capacity_decisions: CapacityDecision[]
  clash_decisions: ClashDecision[]
  predicted_clashes: PredictedClash[]
  assignments: SectionAssignment[]
  new_section_ids: string[]
  moved_students: { register_number: string; course_code: string; from: string; to: string }[]
  capacity_waivers: { section_id: string; enrollment: number; capacity: number }[]
  parked: { register_number: string; course_code: string; reason: string }[]
  new_course_codes: string[]
  new_course_slots: Record<string, number>
  clash_diff: ClashDiff
  red_before: number
  red_after: number
  frozen_violations: ReturnType<typeof assertFrozenInvariants>
  placement_method: 'pinned-only' | 'cpsat' | 'greedy-fallback'
}

export type RunLateOptions = {
  previousSnapshot: SchedulingSnapshot
  lateRows: EnrollmentRow[]
  /** Capacity decisions (from CLI panels or --on-full). */
  capacityDecisions?: CapacityDecision[]
  /** Clash decisions (from CLI panels or --on-clash). */
  clashDecisions?: ClashDecision[]
  /** Default strategy when a conflict has no explicit decision. */
  defaultOnFull?: OnFullStrategy
  defaultBuffer?: number
  defaultOnClash?: 'accept' | 'drop-course' | 'park-student'
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
  clock?: RunLogClock
  inputFileName?: string
  previousDir?: string
  outputDir?: string
  /**
   * Interactive hooks — when provided, the pipeline pauses for capacity/clash panels.
   * Non-interactive runs omit these and use defaults / pre-supplied decisions.
   */
  onCapacityConflicts?: (panels: CapacityPanel[]) => Promise<CapacityDecision[]>
  onPredictedClashes?: (panels: ClashPanel[]) => Promise<ClashDecision[]>
}

export type LatePipelineResult = {
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
  lateReport: LateEnrollmentReport | null
  lateMarking: LateMarking | null
  runLog: RunLogEntry[]
  clashProvenance: ClashProvenanceMap
  allowSaturdayForMath?: boolean
  proven_optimal?: boolean
  proven_levels?: string[]
  solver_status?: string
  solver_message?: string
  infeasible?: boolean
  infeasible_reason?: string
  ortools_version?: string
  python_version?: string
}

const DEFAULT_LATE_TIME_LIMIT_SECONDS = 300
const DEFAULT_LATE_PLATEAU_SECONDS = 20

function emptyLateResult(validation: ValidationResult): LatePipelineResult {
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
    lateReport: null,
    lateMarking: null,
    runLog: [],
    clashProvenance: {},
  }
}

/**
 * Absorb late enrollments into a frozen prior schedule.
 * Existing course weekdays never move. Capacity and clash conflicts are resolved
 * via supplied decisions or interactive hooks before anything is written.
 */
export async function runLatePipeline(
  onProgress: (event: PipelineProgressEvent) => void,
  options: RunLateOptions,
): Promise<LatePipelineResult> {
  const emit = onProgress
  const signal = options.signal
  const snapshot = options.previousSnapshot
  const clock = options.clock ?? (() => new Date())

  const validation: ValidationResult = {
    is_valid: true,
    errors: [],
    warnings: [],
    total_rows: options.lateRows.length,
    valid_rows: options.lateRows.length,
  }

  emit({ stage: 'parse', message: 'Classifying late enrollment rows…', fraction: 0.05 })
  throwIfAborted(signal)

  const additionsResult = computeLateAdditions(snapshot, options.lateRows)
  const { additions, unknown_course_codes } = additionsResult

  emit({
    stage: 'parse',
    message: `${additions.length} late registration(s) · ${unknown_course_codes.length} new course(s)`,
    fraction: 0.1,
  })

  if (additions.length === 0 && unknown_course_codes.length === 0) {
    emit({ stage: 'done', message: 'Nothing new to merge', fraction: 1 })
    return {
      ...emptyLateResult(validation),
      runLog: snapshot.run_log ?? [],
      clashProvenance: snapshot.clash_provenance ?? {},
    }
  }

  const allowSaturdayForMath =
    options.allowSaturdayForMath ?? inferAllowSaturdayFromSnapshot(snapshot)
  const slotByCourse = extractCourseSlotsFromSnapshot(snapshot)

  // --- Unknown courses: pin existing, place new via CP-SAT ---
  let workingSections = deepCloneCourseSections(snapshot.courseSections)
  let workingStudents = cloneStudents(snapshot.students)
  let workingSlots = { ...snapshot.slot_assignments }
  let placementMethod: LateEnrollmentReport['placement_method'] = 'pinned-only'
  let solverUsed = 'late-pinned'
  let solverTimeSeconds = 0
  let provenOptimal = false
  let provenLevels: string[] = []
  let solverStatus = 'PINNED'
  let solverMessage: string | undefined
  let ortoolsVersion: string | undefined
  let pythonVersion: string | undefined

  const unknownSet = new Set(unknown_course_codes)
  const unknownAdds = additions.filter((a) => unknownSet.has(a.course_code))

  if (unknown_course_codes.length > 0) {
    emit({
      stage: 'schedule',
      message: `Placing ${unknown_course_codes.length} new course(s) with existing weekdays frozen…`,
      fraction: 0.15,
    })

    // Provisional sections (with rosters) so the solver can see the new co-enrollment.
    for (const [code, secs] of Object.entries(buildSectionsForNewCourses(unknownAdds))) {
      workingSections[code] = secs
    }

    const allCourseCodes = new Set(Object.keys(workingSections))
    const fixedDays = buildFixedDays(snapshot, allCourseCodes)
    const free = freeCourseCodes(allCourseCodes, fixedDays)

    // Solver-only view of the students; the merged roster is rebuilt from decisions later.
    const solveStudents = cloneStudents(workingStudents)
    for (const a of unknownAdds) {
      let st = solveStudents[a.register_number]
      if (!st) {
        st = {
          register_number: a.register_number,
          name: a.student_name,
          program: a.program,
          email: a.email_id,
          mobile: a.mobile_number,
          enrolled_courses: [],
        }
        solveStudents[a.register_number] = st
      }
      if (!st.enrolled_courses.includes(a.course_code)) {
        st.enrolled_courses.push(a.course_code)
        st.enrolled_courses.sort()
      }
    }

    const conflictGraph = buildConflictGraph(solveStudents, workingSections)
    const facultyConstraints = extractFacultyConstraints(workingSections)

    const preflight = preflightRectify({
      fixedDays,
      freeCourses: free,
      courseSections: workingSections,
      facultyConstraints,
      allowSaturdayForMath,
    })
    if (!preflight.ok) {
      return {
        ...emptyLateResult(validation),
        infeasible: true,
        infeasible_reason: preflight.blockers.join(' '),
        runLog: snapshot.run_log ?? [],
        clashProvenance: snapshot.clash_provenance ?? {},
      }
    }

    const solved = await solveNewCourses({
      courseSections: workingSections,
      conflictGraph,
      facultyConstraints,
      students: solveStudents,
      fixedDays,
      allowSaturdayForMath,
      options,
      emit,
      signal,
    })

    let slotByCourseAll: Record<string, number>
    if (solved) {
      slotByCourseAll = solved.slot_by_course
      placementMethod = 'cpsat'
      solverUsed = solved.solver_used
      solverTimeSeconds = solved.solver_time_seconds
      provenOptimal = solved.proven_optimal
      provenLevels = solved.proven_levels
      solverStatus = solved.status
      solverMessage = solved.message
      ortoolsVersion = solved.ortools_version
      pythonVersion = solved.python_version
    } else {
      const greedy = placeFreeCourseWeekdays(
        free,
        fixedDays,
        workingSections,
        conflictGraph,
        facultyConstraints,
        allowSaturdayForMath,
      )
      if (!greedy) {
        return {
          ...emptyLateResult(validation),
          infeasible: true,
          infeasible_reason: `Could not place new courses: ${free.join(', ')}`,
          runLog: snapshot.run_log ?? [],
          clashProvenance: snapshot.clash_provenance ?? {},
        }
      }
      slotByCourseAll = greedy.slot_by_course
      placementMethod = 'greedy-fallback'
      solverUsed = 'late-greedy'
    }

    workingSlots = sectionSlotsFromCourseSlots(workingSections, slotByCourseAll)
    Object.assign(slotByCourse, slotByCourseAll)

    // The provisional rosters have served their purpose. Clear them so the merge below
    // is the single place that places students and honours park decisions.
    for (const code of unknown_course_codes) {
      for (const sec of workingSections[code] ?? []) {
        sec.enrolled_students = []
        sec.programs = []
      }
    }
  }

  // --- Capacity panel ---
  const capacityConflicts = preflightLateCapacity(workingSections, additions, slotByCourse)
  let capacityDecisions = [...(options.capacityDecisions ?? [])]

  if (capacityConflicts.length > 0) {
    const missing = capacityConflicts.filter(
      (c) => !capacityDecisions.some((d) => d.course_code === c.course_code),
    )
    if (missing.length > 0 && options.onCapacityConflicts) {
      const panels = missing.map((c) =>
        buildCapacityPanel(c, workingSections[c.course_code]!, options.defaultBuffer ?? 2),
      )
      const chosen = await options.onCapacityConflicts(panels)
      capacityDecisions = [...capacityDecisions, ...chosen]
    }
    // Fill defaults for any still-missing
    for (const c of capacityConflicts) {
      if (!capacityDecisions.some((d) => d.course_code === c.course_code)) {
        capacityDecisions.push({
          course_code: c.course_code,
          strategy: options.defaultOnFull ?? 'new-section',
          buffer_per_section: options.defaultBuffer ?? 2,
        })
      }
    }
  }

  // --- Clash panel (predicted against frozen weekdays) ---
  // Build a provisional student map with late courses added for prediction.
  const predStudents = cloneStudents(workingStudents)
  for (const a of additions) {
    let st = predStudents[a.register_number]
    if (!st) {
      st = {
        register_number: a.register_number,
        name: a.student_name,
        program: a.program,
        email: a.email_id,
        mobile: a.mobile_number,
        enrolled_courses: [],
      }
      predStudents[a.register_number] = st
    }
    if (!st.enrolled_courses.includes(a.course_code)) {
      st.enrolled_courses = [...st.enrolled_courses, a.course_code].sort()
    }
  }

  const predicted = predictLateClashes({
    additions,
    students: predStudents,
    slotByCourse,
    courseSections: workingSections,
  })

  let clashDecisions = [...(options.clashDecisions ?? [])]
  if (predicted.length > 0) {
    const missingClash = predicted.filter(
      (p) => !clashDecisions.some((d) => d.register_number === p.register_number),
    )
    if (missingClash.length > 0 && options.onPredictedClashes) {
      const panels = missingClash.map(buildClashPanel)
      const chosen = await options.onPredictedClashes(panels)
      clashDecisions = [...clashDecisions, ...chosen]
    }
    for (const p of predicted) {
      if (!clashDecisions.some((d) => d.register_number === p.register_number)) {
        clashDecisions.push({
          register_number: p.register_number,
          choice: options.defaultOnClash ?? 'accept',
        })
      }
    }
  }

  const parkedStudents = new Set<string>()
  const parkedPairs = new Set<string>()
  for (const d of clashDecisions) {
    if (d.choice === 'park-student') parkedStudents.add(d.register_number)
    if (d.choice === 'drop-course' && d.drop_course_code) {
      parkedPairs.add(`${d.register_number}:${d.drop_course_code}`)
    }
  }

  emit({ stage: 'preprocess', message: 'Merging late students into frozen sections…', fraction: 0.55 })
  throwIfAborted(signal)

  // Snapshot for merge must reflect working sections (incl. any new courses already sectioned).
  const mergeSnapshot: SchedulingSnapshot = {
    ...snapshot,
    courseSections: workingSections,
    students: workingStudents,
    slot_assignments: workingSlots,
  }

  const merged = mergeLateStudentsIntoSections({
    snapshot: mergeSnapshot,
    additions,
    decisions: capacityDecisions,
    parkedStudents,
    parkedPairs,
    defaultBuffer: options.defaultBuffer ?? 2,
  })

  // Brand-new courses: every section is new this batch, and a section left empty by park
  // decisions must not survive into the timetable.
  for (const code of unknown_course_codes) {
    const secs = merged.courseSections[code]
    if (!secs) continue
    for (const sec of secs.filter((s) => s.enrolled_students.length === 0)) {
      delete merged.slot_assignments[sec.section_id]
    }
    const kept = secs.filter((s) => s.enrolled_students.length > 0)
    if (kept.length === 0) delete merged.courseSections[code]
    else merged.courseSections[code] = kept
    for (const sec of kept) {
      if (!merged.new_section_ids.includes(sec.section_id)) {
        merged.new_section_ids.push(sec.section_id)
      }
    }
  }
  for (const asg of merged.assignments) {
    if (unknownSet.has(asg.course_code)) asg.how = 'new_section'
  }

  workingSections = merged.courseSections
  workingStudents = merged.students
  workingSlots = merged.slot_assignments

  // A new course whose every registration was parked never made it onto the timetable.
  const placedNewCourses = unknown_course_codes.filter((c) => c in workingSections)
  const placedNewCourseSlots = Object.fromEntries(
    placedNewCourses
      .map((c) => [c, slotByCourse[c]] as const)
      .filter(([, s]) => s !== undefined),
  ) as Record<string, number>

  const facultyConstraints = extractFacultyConstraints(workingSections)
  const waived = new Set(merged.capacity_waivers.map((w) => w.section_id))

  const { buildSchedule, computeClashReport, auditScheduleHardConstraints, parallelHardCap } =
    await import('../solver/scheduler')

  const sectionCount = Object.values(workingSections).reduce((n, s) => n + s.length, 0)
  const audit = auditScheduleHardConstraints(
    workingSections,
    workingSlots,
    parallelHardCap(sectionCount),
    facultyConstraints,
    { allowSaturdayForMath, waivedSectionIds: waived },
  )

  const previousClashReport = computeClashReport(
    snapshot.students,
    snapshot.courseSections,
    snapshot.slot_assignments,
  )
  const clashReport = computeClashReport(workingStudents, workingSections, workingSlots)
  const clashDiff = diffClashReports(previousClashReport, clashReport)

  const touched = new Set(additions.map((a) => a.register_number))
  const beforeReds = new Set(
    previousClashReport.reports.filter((r) => r.status === 'Red').map((r) => r.register_number),
  )
  const afterReds = new Set(
    clashReport.reports.filter((r) => r.status === 'Red').map((r) => r.register_number),
  )

  const frozenViolations = assertFrozenInvariants({
    before: snapshot,
    afterSections: workingSections,
    afterSlots: workingSlots,
    afterClashReds: afterReds,
    beforeClashReds: beforeReds,
    touchedRegisterNumbers: touched,
  })

  if (frozenViolations.length > 0) {
    emit({
      stage: 'done',
      message: `Late merge aborted: ${frozenViolations.length} freeze violation(s)`,
      fraction: 1,
    })
    return {
      ...emptyLateResult(validation),
      clashReport,
      infeasible: true,
      infeasible_reason: frozenViolations.map((v) => v.message).join('; '),
      lateReport: {
        batch: nextLateBatch(snapshot.run_log ?? []),
        run_seq: nextRunSeq(snapshot.run_log ?? []),
        additions_result: additionsResult,
        capacity_conflicts: capacityConflicts,
        capacity_decisions: capacityDecisions,
        clash_decisions: clashDecisions,
        predicted_clashes: predicted,
        assignments: merged.assignments,
        new_section_ids: merged.new_section_ids,
        moved_students: merged.moved_students,
        capacity_waivers: merged.capacity_waivers,
        parked: merged.parked,
        new_course_codes: placedNewCourses,
        new_course_slots: placedNewCourseSlots,
        clash_diff: clashDiff,
        red_before: previousClashReport.students_with_clashes,
        red_after: clashReport.students_with_clashes,
        frozen_violations: frozenViolations,
        placement_method: placementMethod,
      },
      runLog: snapshot.run_log ?? [],
      clashProvenance: snapshot.clash_provenance ?? {},
    }
  }

  if (!audit.structuralFeasible) {
    return {
      ...emptyLateResult(validation),
      clashReport,
      infeasible: true,
      infeasible_reason: audit.structuralViolations.join('; '),
      runLog: snapshot.run_log ?? [],
      clashProvenance: snapshot.clash_provenance ?? {},
    }
  }

  let programNomenclatureMap: Record<string, string> | undefined =
    DEFAULT_PROGRAM_NOMENCLATURE_MAP as Record<string, string>
  if (options.programNomenclatureXlsx) {
    const { nomenclatureToProgramAbbrevMap } = await import('../io/excelNomenclature')
    programNomenclatureMap = await nomenclatureToProgramAbbrevMap(options.programNomenclatureXlsx)
  }

  const conflictGraph = buildConflictGraph(workingStudents, workingSections)
  const flatSections = Object.values(workingSections).flat()
  const schedulingStats = computeSchedulingStats(flatSections, workingSlots, conflictGraph, {
    courseSections: workingSections,
    students: workingStudents,
  })

  const previousLanes = snapshot.section_lanes
  let schedule = buildSchedule(
    workingSections,
    workingSlots,
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
    { programNomenclature: programNomenclatureMap, previousLanes },
  )
  schedule = { ...schedule, total_clashes: clashReport.students_with_clashes }

  const batch = nextLateBatch(snapshot.run_log ?? [])
  const seq = nextRunSeq(snapshot.run_log ?? [])
  const at = clock().toISOString()

  const lateRecords: LateEnrollmentRecord[] = [
    ...(snapshot.late_enrollments ?? []),
    ...merged.assignments.map((a) => ({
      register_number: a.register_number,
      course_code: a.course_code,
      batch,
      section_id: a.section_id,
    })),
  ]

  const clashProvenance = updateClashProvenance(
    snapshot.clash_provenance ?? {},
    clashDiff,
    {
      seq,
      at,
      operation: 'late',
      batch,
      newlyAddedCourses: [
        ...new Set(merged.assignments.map((a) => a.course_code)),
        ...placedNewCourses,
      ],
    },
  )

  const decisions: RunLogDecision[] = [
    ...capacityDecisions.map((d) => ({
      kind: 'capacity' as const,
      subject: d.course_code,
      choice: d.strategy,
      detail: d.buffer_per_section != null ? `buffer=${d.buffer_per_section}` : undefined,
    })),
    ...clashDecisions.map((d) => ({
      kind: 'clash' as const,
      subject: d.register_number,
      choice: d.choice,
      detail: d.drop_course_code,
    })),
  ]

  const notes: string[] = []
  for (const c of additionsResult.classifications.filter((x) => x.kind === 'already_enrolled')) {
    notes.push(`Already enrolled: ${c.row.register_number} / ${c.row.course_code}`)
  }
  for (const d of additionsResult.contact_drift.slice(0, 20)) {
    notes.push(`Contact drift ${d.register_number} ${d.field}: ${d.before} → ${d.after}`)
  }
  for (const t of additionsResult.title_drift) {
    notes.push(`Title drift ${t.course_code}: kept "${t.snapshot_title}" (late said "${t.late_title}")`)
  }
  for (const r of additionsResult.removals_ignored.slice(0, 20)) {
    notes.push(`Ignored removal: ${r.register_number} / ${r.course_code}`)
  }

  const runEntry = createRunLogEntry(
    {
      seq,
      at,
      mode: 'late',
      batch,
      inputs: {
        late: options.inputFileName,
        previous_dir: options.previousDir,
      },
      output_dir: options.outputDir,
      seed: options.seed,
      solver_status: solverStatus,
      students_before: Object.keys(snapshot.students).length,
      students_after: Object.keys(workingStudents).length,
      students_added: Object.keys(workingStudents).length - Object.keys(snapshot.students).length,
      registrations_added: merged.assignments.length,
      courses_added: placedNewCourses.length,
      sections_created: merged.new_section_ids,
      students_moved_between_sections: merged.moved_students.length,
      capacity_waivers: merged.capacity_waivers,
      parked: merged.parked,
      red_before: previousClashReport.students_with_clashes,
      red_after: clashReport.students_with_clashes,
      clashes_introduced: clashDiff.introduced.length,
      clashes_resolved: clashDiff.resolved.length,
      decisions,
      notes,
    },
    clock,
  )
  const runLog = appendRunLog(snapshot.run_log ?? [], runEntry)

  const lateMarking = buildLateMarking({
    records: lateRecords,
    batch,
    students: workingStudents,
    clashReport,
    current: {
      assignments: merged.assignments,
      parked: merged.parked,
      moved: merged.moved_students,
      newSectionIds: merged.new_section_ids,
      names: additions,
    },
  })

  const schedulingSnapshot: SchedulingSnapshot = {
    slot_model: WEEKDAY_SLOT_MODEL,
    slot_assignments: { ...workingSlots },
    courseSections: deepCloneCourseSections(workingSections),
    students: cloneStudents(workingStudents),
    enrollmentRows: merged.enrollmentRows.map((r) => ({ ...r })),
    allowSaturdayForMath,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(ortoolsVersion ? { ortools_version: ortoolsVersion } : {}),
    ...(pythonVersion ? { python_version: pythonVersion } : {}),
    late_enrollments: lateRecords,
    run_log: runLog,
    clash_provenance: clashProvenance,
    section_lanes: sectionLanesFromEntries(schedule.entries),
  }

  const lateReport: LateEnrollmentReport = {
    batch,
    run_seq: seq,
    additions_result: additionsResult,
    capacity_conflicts: capacityConflicts,
    capacity_decisions: capacityDecisions,
    clash_decisions: clashDecisions,
    predicted_clashes: predicted,
    assignments: merged.assignments,
    new_section_ids: merged.new_section_ids,
    moved_students: merged.moved_students,
    capacity_waivers: merged.capacity_waivers,
    parked: merged.parked,
    new_course_codes: placedNewCourses,
    new_course_slots: placedNewCourseSlots,
    clash_diff: clashDiff,
    red_before: previousClashReport.students_with_clashes,
    red_after: clashReport.students_with_clashes,
    frozen_violations: frozenViolations,
    placement_method: placementMethod,
  }

  let scheduleXlsx: ArrayBuffer | null = null
  let clashXlsx: ArrayBuffer | null = null
  let courseEmailsXlsx: ArrayBuffer | null = null

  const eagerKinds = options.eagerExportKinds ?? {
    schedule: true,
    clash: true,
    courseEmails: true,
  }

  if (options.eagerExports) {
    emit({ stage: 'export', message: 'Building late-enrollment exports…', fraction: 0.9 })
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
    if (eagerKinds.courseEmails && merged.enrollmentRows.length > 0) {
      courseEmailsXlsx = await buildCourseEmailsXlsxBuffer(merged.enrollmentRows, exportOpts)
    }
  }

  emit({
    stage: 'done',
    message: `Late batch ${batch} complete · ${merged.assignments.length} placed · ${clashDiff.introduced.length} new clash(es)`,
    fraction: 1,
  })

  return {
    validation,
    schedule,
    clashReport,
    scheduleXlsx,
    clashXlsx,
    courseEmailsXlsx,
    courseEmailsData: computeCourseEmailGroups(merged.enrollmentRows),
    stats: {
      studentCount: Object.keys(workingStudents).length,
      courseCount: Object.keys(workingSections).length,
      sectionCount,
      scheduling: schedulingStats,
    },
    schedulingSnapshot,
    lateReport,
    lateMarking,
    runLog,
    clashProvenance,
    allowSaturdayForMath,
    proven_optimal: provenOptimal,
    proven_levels: provenLevels,
    solver_status: solverStatus,
    solver_message: solverMessage,
    ortools_version: ortoolsVersion,
    python_version: pythonVersion,
  }
}

/**
 * Provisional sections for courses that were not in the previous schedule.
 * Rosters are filled here so the conflict graph and CP-SAT objective see the real
 * co-enrollment; `runLatePipeline` clears them again before the merge, which is
 * what actually honours park decisions.
 */
function buildSectionsForNewCourses(adds: LateAddition[]): Record<string, Section[]> {
  const byCourse = new Map<string, LateAddition[]>()
  for (const a of adds) {
    if (!byCourse.has(a.course_code)) byCourse.set(a.course_code, [])
    byCourse.get(a.course_code)!.push(a)
  }
  const sections: Record<string, Section[]> = {}
  for (const [code, list] of byCourse) {
    const n = list.length
    const title = list[0]!.course_title
    const faculty = list[0]!.faculty
    const numSections = n <= SINGLE_SECTION_MAX ? 1 : Math.ceil(n / SPLIT_SECTION_CAP)
    const capacity = numSections === 1 ? SINGLE_SECTION_MAX : SPLIT_SECTION_CAP

    const secs: Section[] = []
    for (let i = 0; i < numSections; i++) {
      const sectionId = numSections > 1 ? `${code}_S${i + 1}` : code
      secs.push({
        section_id: sectionId,
        course_code: code,
        course_title: title,
        section_number: i + 1,
        faculty: faculty
          ? numSections > 1
            ? `${faculty} · Sec ${i + 1}`
            : faculty
          : `Planning:${sectionId}`,
        capacity,
        enrolled_students: [],
        programs: [],
      })
    }
    list.forEach((a, i) => {
      const sec = secs[i % secs.length]!
      if (!sec.enrolled_students.includes(a.register_number)) {
        sec.enrolled_students.push(a.register_number)
      }
      if (a.program && !sec.programs.includes(a.program)) sec.programs.push(a.program)
    })
    for (const sec of secs) sec.programs.sort()
    sections[code] = secs
  }
  return sections
}

async function solveNewCourses(args: {
  courseSections: Record<string, Section[]>
  conflictGraph: import('../types').ConflictGraph
  facultyConstraints: Record<string, string[]>
  students: Record<string, Student>
  fixedDays: Record<string, number>
  allowSaturdayForMath: boolean
  options: RunLateOptions
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
        timeLimitSeconds: options.cpsatTimeLimitSeconds ?? DEFAULT_LATE_TIME_LIMIT_SECONDS,
        workers: options.cpsatWorkers,
        hint,
        fixedDays: args.fixedDays,
        minClashWeightLowerBound: structuralLb.min_clash_weight_lower_bound,
        minRedStudentsLowerBound: structuralLb.min_red_students_lower_bound,
        portfolio: 0,
        absoluteGap: options.cpsatAbsoluteGap,
        provePlateauSeconds:
          options.cpsatProvePlateauSeconds ??
          (options.cpsatFullProve ? undefined : DEFAULT_LATE_PLATEAU_SECONDS),
        fullProve: options.cpsatFullProve,
        allowSaturdayForMath: args.allowSaturdayForMath,
        seed: options.seed,
        signal: args.signal,
        onProgress: (evt) => {
          if (evt.type === 'progress' || evt.type === 'heartbeat') {
            emit({
              stage: 'schedule',
              message: evt.phase_label ?? evt.phase,
              fraction: 0.2 + Math.min(0.3, (evt.elapsed ?? 0) / 120),
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
      fraction: 0.4,
    })
    return null
  }
}

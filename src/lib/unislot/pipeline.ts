import { loadAndValidate, parseExcelRows } from './parser'
import {
  assignStudentsToSections,
  buildConflictGraph,
  computeSectionSplits,
  extractFacultyConstraints,
} from './preprocessing'
import { buildSchedule, computeClashReport, runScheduler } from './scheduler'
import type { ClashReport, Schedule, ValidationResult } from './types'
import { clashReportToRichWorkbookBuffer } from './excelClashReport'
import { courseEmailsToWorkbookBuffer } from './excelCourseEmails'
import { readFirstSheetAsAoA, scheduleToWorkbookBuffer } from './excelIo'

export interface PipelineResult {
  validation: ValidationResult
  schedule: Schedule | null
  clashReport: ClashReport | null
  scheduleXlsx: ArrayBuffer | null
  clashXlsx: ArrayBuffer | null
  courseEmailsXlsx: ArrayBuffer | null
  stats: {
    studentCount: number
    courseCount: number
    sectionCount: number
  } | null
}

export async function runPipeline(
  arrayBuffer: ArrayBuffer,
  onProgress: (stage: string, message: string) => void,
): Promise<PipelineResult> {
  onProgress('read', 'Reading spreadsheet…')
  const aoa = await readFirstSheetAsAoA(arrayBuffer)
  if (!aoa) {
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
      stats: null,
    }
  }

  onProgress('parse', 'Parsing and validating rows…')
  const { rows, validation: parseValidation } = parseExcelRows(aoa)
  const { students, courses, enrollmentRows, validation } = loadAndValidate(rows, parseValidation)

  if (!validation.is_valid || Object.keys(students).length === 0) {
    return {
      validation,
      schedule: null,
      clashReport: null,
      scheduleXlsx: null,
      clashXlsx: null,
      courseEmailsXlsx: null,
      stats: null,
    }
  }

  onProgress('preprocess', 'Building sections and conflict graph…')
  let courseSections = computeSectionSplits(courses)
  courseSections = assignStudentsToSections(students, courseSections, enrollmentRows)
  const conflictGraph = buildConflictGraph(students, courseSections)
  const facultyConstraints = extractFacultyConstraints(courseSections)

  onProgress('schedule', 'Optimizing timetable in your browser…')
  const sched = runScheduler(courseSections, conflictGraph, facultyConstraints)
  let schedule = buildSchedule(courseSections, sched.slot_assignments, {
    solver_used: sched.solver_used,
    solver_time_seconds: sched.solver_time_seconds,
  })
  const clashReport = computeClashReport(students, courseSections, sched.slot_assignments)
  schedule = { ...schedule, total_clashes: clashReport.students_with_clashes }

  onProgress('export', 'Building Excel downloads…')
  const [scheduleXlsx, clashXlsx, courseEmailsXlsx] = await Promise.all([
    scheduleToWorkbookBuffer(schedule),
    clashReportToRichWorkbookBuffer(clashReport),
    courseEmailsToWorkbookBuffer(enrollmentRows),
  ])

  const sectionCount = Object.values(courseSections).reduce((n, s) => n + s.length, 0)

  onProgress('done', 'Complete')
  return {
    validation,
    schedule,
    clashReport,
    scheduleXlsx,
    clashXlsx,
    courseEmailsXlsx,
    stats: {
      studentCount: Object.keys(students).length,
      courseCount: Object.keys(courses).length,
      sectionCount,
    },
  }
}

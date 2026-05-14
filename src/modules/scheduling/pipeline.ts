import { loadAndValidate, parseExcelRows } from './parser'
import {
  applyDistinctFacultyPerSection,
  assignStudentsToSections,
  buildConflictGraph,
  computeSectionSplits,
  extractFacultyConstraints,
} from './preprocessing'
import { buildSchedule, computeClashReport, runScheduler } from './scheduler'
import { computeSchedulingStats, type SchedulingStats } from './engines/metrics'
import type { ClashReport, Schedule, ValidationResult } from './types'
import { clashReportToRichWorkbookBuffer } from './io/excelClashReport'
import { courseEmailsToWorkbookBuffer } from './io/excelCourseEmails'
import { readFirstSheetAsAoA, scheduleToWorkbookBuffer } from './io/excelIo'
import type { CourseEmailGroup, EnrollmentRow } from './types'

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
      courseEmailsData: null,
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
      courseEmailsData: null,
      stats: null,
    }
  }

  onProgress('preprocess', 'Building sections, faculty labels, and conflict graph…')
  let courseSections = computeSectionSplits(courses)
  applyDistinctFacultyPerSection(courses, courseSections)
  courseSections = assignStudentsToSections(students, courseSections, enrollmentRows)
  const conflictGraph = buildConflictGraph(students, courseSections)
  const facultyConstraints = extractFacultyConstraints(courseSections)

  onProgress('schedule', 'Optimizing timetable in your browser (ETA: ~2-5 mins)…')
  const sched = runScheduler(courseSections, conflictGraph, facultyConstraints, (msg) => {
    onProgress('schedule', msg)
  })
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
  const flatSections = Object.values(courseSections).flat()
  const schedulingStats = computeSchedulingStats(flatSections, sched.slot_assignments, conflictGraph)

  onProgress('done', 'Complete')
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
  }
}

import type { EnrollmentRow, ValidationError } from '../types'
import { buildCanonicalData, parseExcelRows, validateBusinessRules } from './parser'

export type IssueCategory =
  | 'schema'
  | 'missing_field'
  | 'duplicate'
  | 'faculty'
  | 'identity'
  | 'enrollment'

export type IssueSeverity = 'error' | 'warning'

export interface EnrollmentIssue {
  category: IssueCategory
  severity: IssueSeverity
  message: string
  row_number?: number
  field?: string
  value?: string
}

export interface IssueFinderReport {
  issues: EnrollmentIssue[]
  by_category: Record<IssueCategory, EnrollmentIssue[]>
  counts: Record<IssueCategory, number>
  total_issues: number
  error_count: number
  warning_count: number
  /** True when any error-severity issue is present (file not safe to schedule as-is). */
  blocking: boolean
  total_rows: number
  valid_rows: number
}

export const ISSUE_CATEGORY_ORDER: IssueCategory[] = [
  'schema',
  'missing_field',
  'duplicate',
  'faculty',
  'identity',
  'enrollment',
]

export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  schema: 'Schema',
  missing_field: 'Missing fields',
  duplicate: 'Duplicates',
  faculty: 'Faculty',
  identity: 'Identity',
  enrollment: 'Enrollment',
}

function emptyCounts(): Record<IssueCategory, number> {
  return {
    schema: 0,
    missing_field: 0,
    duplicate: 0,
    faculty: 0,
    identity: 0,
    enrollment: 0,
  }
}

function emptyByCategory(): Record<IssueCategory, EnrollmentIssue[]> {
  return {
    schema: [],
    missing_field: [],
    duplicate: [],
    faculty: [],
    identity: [],
    enrollment: [],
  }
}

export function categoryForValidationError(err: ValidationError): IssueCategory {
  switch (err.field) {
    case 'file':
    case 'columns':
      return 'schema'
    case 'duplicate':
      return 'duplicate'
    case 'faculty':
      return 'faculty'
    case 'enrollment':
      return 'enrollment'
    case 'program':
    case 'register_number':
    case 'student_name':
    case 'course_code':
    case 'course_title':
      if (/unknown course/i.test(err.message)) return 'enrollment'
      return 'missing_field'
    default:
      return 'missing_field'
  }
}

function mapValidationError(
  err: ValidationError,
  severity: IssueSeverity,
): EnrollmentIssue {
  return {
    category: categoryForValidationError(err),
    severity,
    message: err.message,
    row_number: err.row_number,
    field: err.field,
    value: err.value,
  }
}

function findIdentityIssues(rows: EnrollmentRow[]): EnrollmentIssue[] {
  const namesByReg = new Map<string, Set<string>>()
  const titlesByCourse = new Map<string, Set<string>>()

  for (const row of rows) {
    if (!namesByReg.has(row.register_number)) namesByReg.set(row.register_number, new Set())
    namesByReg.get(row.register_number)!.add(row.student_name)

    if (!titlesByCourse.has(row.course_code)) titlesByCourse.set(row.course_code, new Set())
    titlesByCourse.get(row.course_code)!.add(row.course_title)
  }

  const issues: EnrollmentIssue[] = []

  for (const [reg, names] of namesByReg) {
    if (names.size <= 1) continue
    issues.push({
      category: 'identity',
      severity: 'warning',
      message: `Register ${reg}: conflicting student names (${[...names].join(' · ')})`,
      field: 'student_name',
      value: reg,
    })
  }

  for (const [code, titles] of titlesByCourse) {
    if (titles.size <= 1) continue
    issues.push({
      category: 'identity',
      severity: 'warning',
      message: `Course ${code}: conflicting titles (${[...titles].join(' · ')})`,
      field: 'course_title',
      value: code,
    })
  }

  return issues
}

function findFacultyIssues(rows: EnrollmentRow[]): EnrollmentIssue[] {
  const facultyByCourse = new Map<string, Set<string>>()
  for (const row of rows) {
    const f = row.faculty?.trim()
    if (!f) continue
    if (!facultyByCourse.has(row.course_code)) facultyByCourse.set(row.course_code, new Set())
    facultyByCourse.get(row.course_code)!.add(f)
  }

  const issues: EnrollmentIssue[] = []
  for (const [code, set] of facultyByCourse) {
    if (set.size <= 1) continue
    issues.push({
      category: 'faculty',
      severity: 'warning',
      message: `Course ${code}: multiple distinct faculty names in the sheet (${[...set].join(' · ')})`,
      field: 'faculty',
      value: code,
    })
  }
  return issues
}

function findEnrollmentErrors(rows: EnrollmentRow[]): EnrollmentIssue[] {
  const { students, courses } = buildCanonicalData(rows)
  const issues: EnrollmentIssue[] = []

  for (const [reg, st] of Object.entries(students)) {
    if (st.enrolled_courses.length < 1) {
      issues.push({
        category: 'enrollment',
        severity: 'error',
        message: `Student ${reg} has no valid course registrations after deduplication`,
        field: 'enrollment',
        value: reg,
      })
    }
    for (const cc of st.enrolled_courses) {
      if (!courses[cc]) {
        issues.push({
          category: 'enrollment',
          severity: 'error',
          message: `Student ${reg} references unknown course code ${cc}`,
          field: 'course_code',
          value: `${reg}:${cc}`,
        })
      }
    }
  }

  return issues
}

function buildReport(
  issues: EnrollmentIssue[],
  totalRows: number,
  validRows: number,
): IssueFinderReport {
  const by_category = emptyByCategory()
  const counts = emptyCounts()
  let error_count = 0
  let warning_count = 0

  for (const issue of issues) {
    by_category[issue.category].push(issue)
    counts[issue.category] += 1
    if (issue.severity === 'error') error_count += 1
    else warning_count += 1
  }

  return {
    issues,
    by_category,
    counts,
    total_issues: issues.length,
    error_count,
    warning_count,
    blocking: error_count > 0,
    total_rows: totalRows,
    valid_rows: validRows,
  }
}

/**
 * Audit enrollment sheet rows for data-quality issues (no solver).
 * Accepts the same array-of-arrays shape as `parseExcelRows`.
 */
export function findEnrollmentIssues(sheetRows: unknown[][]): IssueFinderReport {
  const { rows, validation: parseValidation } = parseExcelRows(sheetRows)
  const issues: EnrollmentIssue[] = []

  for (const err of parseValidation.errors) {
    issues.push(mapValidationError(err, 'error'))
  }
  for (const warn of parseValidation.warnings) {
    issues.push(mapValidationError(warn, 'warning'))
  }

  const { rows: dedupedRows, validation: biz } = validateBusinessRules(rows)
  for (const err of biz.errors) {
    issues.push(mapValidationError(err, 'error'))
  }
  for (const warn of biz.warnings) {
    issues.push(mapValidationError(warn, 'warning'))
  }

  issues.push(...findFacultyIssues(dedupedRows))
  issues.push(...findEnrollmentErrors(dedupedRows))
  issues.push(...findIdentityIssues(rows))

  return buildReport(issues, parseValidation.total_rows, biz.valid_rows)
}

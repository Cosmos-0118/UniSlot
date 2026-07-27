import type {
  Course,
  EnrollmentRow,
  Student,
  ValidationResult,
} from '../types'

const COLUMN_MAPPINGS: Record<string, string> = {
  program: 'program',
  programme: 'program',
  branch: 'program',
  dept: 'program',
  department: 'program',
  course: 'program',
  degree: 'program',
  stream: 'program',
  'register number': 'register_number',
  'register no': 'register_number',
  'reg no': 'register_number',
  'registration number': 'register_number',
  'registration no': 'register_number',
  'student id': 'register_number',
  regno: 'register_number',
  'roll no': 'register_number',
  'roll number': 'register_number',
  id: 'register_number',
  'student name': 'student_name',
  name: 'student_name',
  'full name': 'student_name',
  student: 'student_name',
  'name of student': 'student_name',
  'mobile number': 'mobile_number',
  'mobile no': 'mobile_number',
  mobile: 'mobile_number',
  phone: 'mobile_number',
  contact: 'mobile_number',
  'email id': 'email_id',
  email: 'email_id',
  'email address': 'email_id',
  'course code': 'course_code',
  code: 'course_code',
  'subject code': 'course_code',
  'course id': 'course_code',
  'course title': 'course_title',
  title: 'course_title',
  'course name': 'course_title',
  subject: 'course_title',
  faculty: 'faculty',
  'faculty name': 'faculty',
  instructor: 'faculty',
  teacher: 'faculty',
  'registration type': 'registration_type',
  remarks: 'remarks',
  comments: 'remarks',
}

const REQUIRED_FIELDS = [
  'program',
  'register_number',
  'student_name',
  'course_code',
  'course_title',
] as const

function normalizeColumnName(col: string): string {
  const cleaned = String(col)
    .replace(/[^\w\s]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (COLUMN_MAPPINGS[cleaned]) return COLUMN_MAPPINGS[cleaned]
  for (const [key, value] of Object.entries(COLUMN_MAPPINGS)) {
    const keyClean = key.replace(/[^\w\s]/g, '').trim()
    if (cleaned === keyClean) return value
  }
  const colWords = new Set(cleaned.split(' '))
  for (const [key, value] of Object.entries(COLUMN_MAPPINGS)) {
    const keyWords = new Set(key.split(' '))
    if (keyWords.size && [...keyWords].every((w) => colWords.has(w))) {
      return value
    }
  }
  return cleaned.replace(/ /g, '_')
}

function cleanString(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value).trim().replace(/\s+/g, ' ')
  return s
    .split('')
    .map((c) => (c.charCodeAt(0) < 128 ? c : ''))
    .join('')
}

function cleanRegisterNumber(value: unknown): string {
  let s = cleanString(value)
  if (!s) return ''
  s = s.replace(/^(RA|SRM|REG|ID|NO|#|:|\s)+/i, '')
  s = s.replace(/[^A-Za-z0-9]/g, '')
  return s.toUpperCase()
}

function cleanCourseCode(value: unknown): string {
  let s = cleanString(value)
  if (!s) return ''
  s = s.replace(/\s+/g, '')
  return s.toUpperCase()
}

function cleanName(value: unknown): string {
  let s = cleanString(value)
  if (!s) return ''
  s = s.replace(/\b[A-Z]{2}\d+[A-Z]*\d*\b/gi, '')
  s = s.replace(/\S+@\S+\.\S+/g, '')
  s = s.replace(/\b\d{10,}\b/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

function cleanProgram(value: unknown): string {
  let s = cleanString(value)
  if (!s) return ''
  const replacements: [RegExp, string][] = [
    [/b\.?\s*tech\.?/gi, 'B.Tech'],
    [/m\.?\s*tech\.?/gi, 'M.Tech'],
    [/cse/gi, 'CSE'],
    [/ece/gi, 'ECE'],
    [/eee/gi, 'EEE'],
    [/\bit\b/gi, 'IT'],
    [/aiml/gi, 'AIML'],
  ]
  for (const [re, rep] of replacements) s = s.replace(re, rep)
  return s.trim()
}

function cleanMobile(value: unknown): string | null {
  const s = cleanString(value)
  if (!s) return null
  let digits = s.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 10) return digits
  return null
}

function cleanEmail(value: unknown): string | null {
  const s = cleanString(value).toLowerCase()
  if (!s) return null
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/)
  return m ? m[0] : null
}

function detectHeaderRow(rows: unknown[][]): number {
  for (let idx = 0; idx < Math.min(10, rows.length); idx++) {
    const row = rows[idx] ?? []
    const rowStr = row
      .map((v) => String(v ?? '').toLowerCase())
      .join(' ')
    const keywords = [
      'register',
      'name',
      'course',
      'code',
      'program',
      'student',
      'branch',
    ]
    const matches = keywords.filter((kw) => rowStr.includes(kw)).length
    if (matches >= 3) return idx
  }
  return 0
}

/** First sheet as AoA from Excel workbook */
export function parseExcelRows(sheetRows: unknown[][]): {
  rows: EnrollmentRow[]
  validation: ValidationResult
} {
  const result: ValidationResult = {
    is_valid: true,
    errors: [],
    warnings: [],
    total_rows: 0,
    valid_rows: 0,
  }
  const out: EnrollmentRow[] = []

  if (!sheetRows.length) {
    result.is_valid = false
    result.errors.push({
      field: 'file',
      message: 'Empty workbook',
    })
    return { rows: out, validation: result }
  }

  const headerIdx = detectHeaderRow(sheetRows)
  const headerCells = (sheetRows[headerIdx] ?? []).map((c) => normalizeColumnName(String(c ?? '')))
  const dataRows = sheetRows.slice(headerIdx + 1).filter((r) => (r ?? []).some((c) => String(c ?? '').trim() !== ''))

  let availableCols = new Set(headerCells.filter(Boolean))
  const rebuildColIndex = () => {
    const next: Record<string, number> = {}
    headerCells.forEach((name, i) => {
      if (name) next[name] = i
    })
    return next
  }

  for (const required of REQUIRED_FIELDS) {
    if (!availableCols.has(required)) {
      let found = false
      for (const col of [...availableCols]) {
        if (col.includes(required) || required.includes(col)) {
          const idx = headerCells.indexOf(col)
          if (idx >= 0) headerCells[idx] = required
          found = true
          break
        }
      }
      if (found) {
        availableCols = new Set(headerCells.filter(Boolean))
      }
    }
  }

  const colIndex = rebuildColIndex()

  const missing = REQUIRED_FIELDS.filter((f) => !headerCells.includes(f))
  if (missing.length) {
    result.is_valid = false
    result.errors.push({
      field: 'columns',
      message: `Missing required columns: ${missing.join(', ')}. Found: ${[...new Set(headerCells)].join(', ')}`,
    })
    return { rows: out, validation: result }
  }

  result.total_rows = dataRows.length

  const getCell = (row: unknown[], field: string): unknown => {
    const i = colIndex[field]
    return i === undefined ? '' : row[i]
  }

  for (let di = 0; di < dataRows.length; di++) {
    const row = dataRows[di]
    const rowNum = headerIdx + di + 2

    const program = cleanProgram(getCell(row, 'program'))
    const register_number = cleanRegisterNumber(getCell(row, 'register_number'))
    const student_name = cleanName(getCell(row, 'student_name'))
    const course_code = cleanCourseCode(getCell(row, 'course_code'))
    const course_title = cleanString(getCell(row, 'course_title'))

    let hasError = false
    if (!program) {
      result.errors.push({ row_number: rowNum, field: 'program', message: 'Program is empty' })
      hasError = true
    }
    if (!register_number) {
      result.errors.push({
        row_number: rowNum,
        field: 'register_number',
        message: 'Register number is empty',
      })
      hasError = true
    }
    if (!student_name) {
      result.errors.push({
        row_number: rowNum,
        field: 'student_name',
        message: 'Student name is empty',
      })
      hasError = true
    }
    if (!course_code) {
      result.errors.push({
        row_number: rowNum,
        field: 'course_code',
        message: 'Course code is empty',
      })
      hasError = true
    }
    if (!course_title) {
      result.errors.push({
        row_number: rowNum,
        field: 'course_title',
        message: 'Course title is empty',
      })
      hasError = true
    }
    if (hasError) continue

    out.push({
      program,
      register_number,
      student_name,
      mobile_number: cleanMobile(getCell(row, 'mobile_number')),
      email_id: cleanEmail(getCell(row, 'email_id')),
      course_code,
      course_title: course_title.replace(/\b\w/g, (c) => c.toUpperCase()),
      faculty: cleanString(getCell(row, 'faculty')) || null,
      registration_type: cleanString(getCell(row, 'registration_type')) || null,
      remarks: cleanString(getCell(row, 'remarks')) || null,
    })
    result.valid_rows += 1
  }

  const errorRate = result.total_rows ? result.errors.length / result.total_rows : 1
  const maxAbsoluteErrors = Math.max(12, Math.ceil(result.total_rows * 0.04))
  result.is_valid =
    errorRate <= 0.06 && result.errors.length <= maxAbsoluteErrors && result.valid_rows > 0

  return { rows: out, validation: result }
}

export function validateBusinessRules(rows: EnrollmentRow[]): {
  rows: EnrollmentRow[]
  validation: ValidationResult
} {
  const result: ValidationResult = {
    is_valid: true,
    errors: [],
    warnings: [],
    total_rows: rows.length,
    valid_rows: 0,
  }
  const studentCourses = new Map<string, Set<string>>()
  const seen = new Set<string>()
  const validRows: EnrollmentRow[] = []

  for (const row of rows) {
    const key = `${row.register_number}:${row.course_code}`
    if (seen.has(key)) {
      result.warnings.push({
        field: 'duplicate',
        message: `Duplicate registration: ${row.register_number} in ${row.course_code}`,
        value: key,
      })
      continue
    }
    seen.add(key)
    if (!studentCourses.has(row.register_number)) {
      studentCourses.set(row.register_number, new Set())
    }
    studentCourses.get(row.register_number)!.add(row.course_code)
    validRows.push(row)
  }

  result.valid_rows = validRows.length
  result.is_valid = result.errors.length === 0
  return { rows: validRows, validation: result }
}

export function buildCanonicalData(rows: EnrollmentRow[]): {
  students: Record<string, Student>
  courses: Record<string, Course>
} {
  const students: Record<string, Student> = {}
  const courses: Record<string, Course> = {}
  const courseEnrollments = new Map<string, string[]>()

  for (const row of rows) {
    if (!students[row.register_number]) {
      students[row.register_number] = {
        register_number: row.register_number,
        name: row.student_name,
        program: row.program,
        email: row.email_id,
        mobile: row.mobile_number,
        enrolled_courses: [],
      }
    }
    students[row.register_number].enrolled_courses.push(row.course_code)

    if (!courses[row.course_code]) {
      courses[row.course_code] = {
        code: row.course_code,
        title: row.course_title,
        enrollment_count: 0,
        faculty: null,
        section_count: 1,
      }
    }
    const fac = row.faculty?.trim() || null
    if (fac) {
      const c = courses[row.course_code]!
      if (!c.faculty) c.faculty = fac
    }
    if (!courseEnrollments.has(row.course_code)) {
      courseEnrollments.set(row.course_code, [])
    }
    courseEnrollments.get(row.course_code)!.push(row.register_number)
  }

  for (const [code, ids] of courseEnrollments) {
    courses[code].enrollment_count = new Set(ids).size
  }

  return { students, courses }
}

export function loadAndValidate(rows: EnrollmentRow[], parseValidation: ValidationResult): {
  students: Record<string, Student>
  courses: Record<string, Course>
  enrollmentRows: EnrollmentRow[]
  validation: ValidationResult
} {
  if (!parseValidation.is_valid) {
    return {
      students: {},
      courses: {},
      enrollmentRows: [],
      validation: parseValidation,
    }
  }

  const { rows: validRows, validation: biz } = validateBusinessRules(rows)
  const combined: ValidationResult = {
    is_valid: parseValidation.is_valid && biz.is_valid,
    errors: [...parseValidation.errors, ...biz.errors],
    warnings: [...parseValidation.warnings, ...biz.warnings],
    total_rows: parseValidation.total_rows,
    valid_rows: biz.valid_rows,
  }

  const { students, courses } = buildCanonicalData(validRows)

  const facultyByCourse = new Map<string, Set<string>>()
  for (const row of validRows) {
    const f = row.faculty?.trim()
    if (!f) continue
    if (!facultyByCourse.has(row.course_code)) facultyByCourse.set(row.course_code, new Set())
    facultyByCourse.get(row.course_code)!.add(f)
  }
  for (const [code, set] of facultyByCourse) {
    if (set.size > 1) {
      combined.warnings.push({
        field: 'faculty',
        message: `Course ${code}: multiple distinct faculty names in the sheet (${[...set].join(' · ')}). Using the first value encountered when building sections.`,
        value: code,
      })
    }
  }

  for (const [reg, st] of Object.entries(students)) {
    if (st.enrolled_courses.length < 1) {
      combined.errors.push({
        field: 'enrollment',
        message: `Student ${reg} has no valid course registrations after deduplication (minimum 1 course per Constraints.md §5.3).`,
        value: reg,
      })
    }
    for (const cc of st.enrolled_courses) {
      if (!courses[cc]) {
        combined.errors.push({
          field: 'course_code',
          message: `Student ${reg} references unknown course code ${cc}.`,
          value: `${reg}:${cc}`,
        })
      }
    }
  }

  combined.is_valid = combined.errors.length === 0

  return { students, courses, enrollmentRows: validRows, validation: combined }
}

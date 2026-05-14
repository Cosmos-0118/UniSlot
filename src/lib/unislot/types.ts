export type DayName =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'

export const INDEX_TO_DAY: Record<number, DayName> = {
  0: 'Monday',
  1: 'Tuesday',
  2: 'Wednesday',
  3: 'Thursday',
  4: 'Friday',
  5: 'Saturday',
}

export interface EnrollmentRow {
  program: string
  register_number: string
  student_name: string
  mobile_number: string | null
  email_id: string | null
  course_code: string
  course_title: string
  registration_type: string | null
  remarks: string | null
}

export interface Student {
  register_number: string
  name: string
  program: string
  email: string | null
  mobile: string | null
  enrolled_courses: string[]
}

export interface Course {
  code: string
  title: string
  enrollment_count: number
  faculty: string | null
  section_count: number
}

export interface Section {
  section_id: string
  course_code: string
  course_title: string
  section_number: number
  faculty: string | null
  capacity: number
  enrolled_students: string[]
  programs: string[]
}

export interface ConflictEdge {
  section_a: string
  section_b: string
  weight: number
  shared_students: string[]
}

export interface ConflictGraph {
  sections: string[]
  edges: ConflictEdge[]
}

export interface ValidationError {
  row_number?: number
  field: string
  message: string
  value?: string
}

export interface ValidationResult {
  is_valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
  total_rows: number
  valid_rows: number
}

export interface ScheduleEntry {
  section_id: string
  course_code: string
  course_title: string
  section_number: number
  day: DayName
  time: string
  faculty: string | null
  enrollment_count: number
  programs: string
}

export interface Schedule {
  entries: ScheduleEntry[]
  total_sections: number
  solver_used: string
  solver_time_seconds: number
  total_clashes: number
}

export type ClashStatus = 'Green' | 'Red'

export interface StudentClashReport {
  register_number: string
  student_name: string
  program: string
  enrolled_courses: string[]
  status: ClashStatus
  clashing_courses: [string, string][]
  clashing_day: DayName | null
}

export interface ClashReport {
  total_students: number
  students_with_clashes: number
  clash_free_students: number
  clash_percentage: number
  reports: StudentClashReport[]
}

export interface SchedulerResult {
  slot_assignments: Record<string, number>
  solver_used: string
  solver_time_seconds: number
  optimal: boolean
  feasible: boolean
  total_clash_weight: number
}

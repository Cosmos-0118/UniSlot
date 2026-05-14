export type DayName =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'

export interface EnrollmentRow {
  program: string
  register_number: string
  student_name: string
  mobile_number: string | null
  email_id: string | null
  course_code: string
  course_title: string
  /** Optional; when present, merged onto {@link Course.faculty} in canonical data (Constraints.md §5.2). */
  faculty: string | null
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
  /** Human-readable evening window + intra-day band (Constraints.md §4). */
  time: string
  /** Global slot 0..54 (Mon band1 .. Fri band11). */
  slot_index: number
  /** 1..11 within the weekday. */
  slot_band: number
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
  /** Post-solve audit: faculty, capacity, parallel cap, split same-slot (Constraints.md §13). */
  hard_constraints_feasible?: boolean
  hard_constraint_violations?: string[]
  /** True when hard audit passes and solver best had zero RED students and zero clash weight (not a global optimality proof). */
  solver_primary_metrics_zero?: boolean
}

export type ClashStatus = 'Green' | 'Red'

export interface StudentClashReport {
  register_number: string
  student_name: string
  program: string
  enrolled_courses: string[]
  status: ClashStatus
  clashing_courses: [string, string][]
  /** First weekday (by global slot order) where a clash occurs; null if Green. */
  clashing_day: DayName | null
  /** All weekdays on which this student has at least one overlapping slot (Constraints §5.3). */
  clashing_days: DayName[]
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
  /** Hard-constraint audit passed (Constraints.md §13). */
  feasible: boolean
  /**
   * Heuristic certificate: {@link feasible} and best solution has zero RED students and zero clash weight.
   * Does **not** imply a globally optimal timetable.
   */
  optimal: boolean
  total_clash_weight: number
  hard_constraint_violations: string[]
}

export interface CourseEmailGroup {
  course_code: string
  course_title: string
  student_count: number
  emails: string[]
}

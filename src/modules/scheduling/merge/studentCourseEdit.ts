import type { EnrollmentRow, Section, Student } from '../types'
import { cleanCourseCode, cleanRegisterNumber } from '../parse/parser'
import {
  cloneSchedulingSnapshot,
  type SchedulingSnapshot,
} from './snapshot'

export type StudentCourseRef = {
  course_code: string
  course_title: string
}

export type StudentCourseEditErrorCode =
  | 'unknown_student'
  | 'not_enrolled'
  | 'target_missing'
  | 'already_enrolled'
  | 'same_course'
  | 'invalid_input'

export class StudentCourseEditError extends Error {
  readonly code: StudentCourseEditErrorCode

  constructor(code: StudentCourseEditErrorCode, message: string) {
    super(message)
    this.name = 'StudentCourseEditError'
    this.code = code
  }
}

export type FixStudentCourseArgs = {
  register: string
  fromCode: string
  toCode: string
  toTitle?: string
}

export type DropStudentCourseArgs = {
  register: string
  courseCode: string
}

export type StudentCourseEditResult = {
  snapshot: SchedulingSnapshot
  register_number: string
  removed_course: string
  added_course?: string
  target_section_id?: string
  pruned_courses: string[]
  student_removed: boolean
}

function normalizeRegister(value: string): string {
  const reg = cleanRegisterNumber(value)
  if (!reg) {
    throw new StudentCourseEditError('invalid_input', 'Register number is required.')
  }
  return reg
}

function normalizeCode(value: string, label: string): string {
  const code = cleanCourseCode(value)
  if (!code) {
    throw new StudentCourseEditError('invalid_input', `${label} is required.`)
  }
  return code
}

function courseTitleFromSnapshot(snapshot: SchedulingSnapshot, code: string): string {
  const sections = snapshot.courseSections[code]
  if (sections?.length) {
    const titled = sections.find((s) => s.course_title)?.course_title
    if (titled) return titled
  }
  const row = snapshot.enrollmentRows.find((r) => r.course_code === code && r.course_title)
  return row?.course_title ?? ''
}

function recomputeSectionPrograms(section: Section, students: Record<string, Student>): void {
  const programs = new Set<string>()
  for (const reg of section.enrolled_students) {
    const program = students[reg]?.program
    if (program) programs.add(program)
  }
  section.programs = [...programs].sort()
}

function removeFromCourseRosters(
  courseSections: Record<string, Section[]>,
  students: Record<string, Student>,
  register: string,
  courseCode: string,
): void {
  const sections = courseSections[courseCode]
  if (!sections) return
  for (const sec of sections) {
    const before = sec.enrolled_students.length
    sec.enrolled_students = sec.enrolled_students.filter((r) => r !== register)
    if (sec.enrolled_students.length !== before) {
      recomputeSectionPrograms(sec, students)
    }
  }
}

function courseHasStudents(sections: Section[] | undefined): boolean {
  if (!sections?.length) return false
  return sections.some((s) => s.enrolled_students.length > 0)
}

/** Drop a course from the snapshot when no students remain (ghost typo courses). */
export function pruneEmptyCourse(snapshot: SchedulingSnapshot, courseCode: string): boolean {
  const sections = snapshot.courseSections[courseCode]
  if (!sections) return false
  if (courseHasStudents(sections)) return false

  for (const sec of sections) {
    delete snapshot.slot_assignments[sec.section_id]
    if (snapshot.facultyOverrides) delete snapshot.facultyOverrides[sec.section_id]
    if (snapshot.section_lanes) delete snapshot.section_lanes[sec.section_id]
  }
  delete snapshot.courseSections[courseCode]
  return true
}

function removeEnrollmentRow(
  rows: EnrollmentRow[],
  register: string,
  courseCode: string,
): EnrollmentRow | null {
  const idx = rows.findIndex(
    (r) => r.register_number === register && r.course_code === courseCode,
  )
  if (idx < 0) return null
  const [removed] = rows.splice(idx, 1)
  return removed ?? null
}

function removeFromEnrolledCourses(student: Student, courseCode: string): void {
  student.enrolled_courses = student.enrolled_courses.filter((c) => c !== courseCode)
}

function placeIntoLeastLoadedSection(
  sections: Section[],
  register: string,
  students: Record<string, Student>,
): Section {
  let best = 0
  let bestLoad = sections[0]!.enrolled_students.length
  for (let i = 1; i < sections.length; i++) {
    const load = sections[i]!.enrolled_students.length
    if (
      load < bestLoad ||
      (load === bestLoad && sections[i]!.section_number < sections[best]!.section_number)
    ) {
      bestLoad = load
      best = i
    }
  }
  const sec = sections[best]!
  if (!sec.enrolled_students.includes(register)) {
    sec.enrolled_students.push(register)
  }
  recomputeSectionPrograms(sec, students)
  return sec
}

function scrubLateEnrollments(
  snapshot: SchedulingSnapshot,
  register: string,
  courseCode: string,
): void {
  if (!snapshot.late_enrollments?.length) return
  snapshot.late_enrollments = snapshot.late_enrollments.filter(
    (r) => !(r.register_number === register && r.course_code === courseCode),
  )
}

/** Courses a student is enrolled in on this snapshot (code + title). */
export function listStudentCourses(
  snapshot: SchedulingSnapshot,
  registerInput: string,
): StudentCourseRef[] {
  const register = normalizeRegister(registerInput)
  const student = snapshot.students[register]
  if (!student) {
    throw new StudentCourseEditError(
      'unknown_student',
      `Register ${register} was not found in this schedule snapshot.`,
    )
  }
  return student.enrolled_courses.map((course_code) => ({
    course_code,
    course_title: courseTitleFromSnapshot(snapshot, course_code),
  }))
}

/**
 * Move one student from a wrong course onto an existing scheduled course.
 * Never creates new courses/sections or changes other students' placements.
 */
export function fixStudentCourse(
  input: SchedulingSnapshot,
  args: FixStudentCourseArgs,
): StudentCourseEditResult {
  const snapshot = cloneSchedulingSnapshot(input)
  const register = normalizeRegister(args.register)
  const fromCode = normalizeCode(args.fromCode, 'Wrong course code')
  const toCode = normalizeCode(args.toCode, 'Correct course code')

  if (fromCode === toCode) {
    throw new StudentCourseEditError(
      'same_course',
      `From and to course codes are the same (${fromCode}).`,
    )
  }

  const student = snapshot.students[register]
  if (!student) {
    throw new StudentCourseEditError(
      'unknown_student',
      `Register ${register} was not found in this schedule snapshot.`,
    )
  }
  if (!student.enrolled_courses.includes(fromCode)) {
    throw new StudentCourseEditError(
      'not_enrolled',
      `${register} is not enrolled in ${fromCode}.`,
    )
  }
  if (student.enrolled_courses.includes(toCode)) {
    throw new StudentCourseEditError(
      'already_enrolled',
      `${register} is already enrolled in ${toCode}.`,
    )
  }

  const targetSections = snapshot.courseSections[toCode]
  if (!targetSections?.length) {
    throw new StudentCourseEditError(
      'target_missing',
      `Course ${toCode} is not on this schedule. Use late or rectify to add a new course.`,
    )
  }

  const removedRow = removeEnrollmentRow(snapshot.enrollmentRows, register, fromCode)
  removeFromCourseRosters(snapshot.courseSections, snapshot.students, register, fromCode)
  removeFromEnrolledCourses(student, fromCode)
  scrubLateEnrollments(snapshot, register, fromCode)

  const pruned_courses: string[] = []
  if (pruneEmptyCourse(snapshot, fromCode)) pruned_courses.push(fromCode)

  const toTitle =
    (args.toTitle && String(args.toTitle).trim()) ||
    courseTitleFromSnapshot(snapshot, toCode) ||
    removedRow?.course_title ||
    ''

  const targetSection = placeIntoLeastLoadedSection(targetSections, register, snapshot.students)
  if (!student.enrolled_courses.includes(toCode)) {
    student.enrolled_courses.push(toCode)
    student.enrolled_courses.sort()
  }

  snapshot.enrollmentRows.push({
    program: removedRow?.program ?? student.program,
    register_number: register,
    student_name: removedRow?.student_name ?? student.name,
    mobile_number: removedRow?.mobile_number ?? student.mobile,
    email_id: removedRow?.email_id ?? student.email,
    course_code: toCode,
    course_title: toTitle,
    faculty: removedRow?.faculty ?? targetSection.faculty,
    registration_type: removedRow?.registration_type ?? null,
    remarks: removedRow?.remarks ?? null,
  })

  return {
    snapshot,
    register_number: register,
    removed_course: fromCode,
    added_course: toCode,
    target_section_id: targetSection.section_id,
    pruned_courses,
    student_removed: false,
  }
}

/**
 * Remove one student–course registration everywhere in the snapshot.
 * Empty courses are pruned from the timetable.
 */
export function dropStudentCourse(
  input: SchedulingSnapshot,
  args: DropStudentCourseArgs,
): StudentCourseEditResult {
  const snapshot = cloneSchedulingSnapshot(input)
  const register = normalizeRegister(args.register)
  const courseCode = normalizeCode(args.courseCode, 'Course code')

  const student = snapshot.students[register]
  if (!student) {
    throw new StudentCourseEditError(
      'unknown_student',
      `Register ${register} was not found in this schedule snapshot.`,
    )
  }
  if (!student.enrolled_courses.includes(courseCode)) {
    throw new StudentCourseEditError(
      'not_enrolled',
      `${register} is not enrolled in ${courseCode}.`,
    )
  }

  removeEnrollmentRow(snapshot.enrollmentRows, register, courseCode)
  removeFromCourseRosters(snapshot.courseSections, snapshot.students, register, courseCode)
  removeFromEnrolledCourses(student, courseCode)
  scrubLateEnrollments(snapshot, register, courseCode)

  const pruned_courses: string[] = []
  if (pruneEmptyCourse(snapshot, courseCode)) pruned_courses.push(courseCode)

  let student_removed = false
  if (student.enrolled_courses.length === 0) {
    delete snapshot.students[register]
    student_removed = true
  }

  return {
    snapshot,
    register_number: register,
    removed_course: courseCode,
    pruned_courses,
    student_removed,
  }
}

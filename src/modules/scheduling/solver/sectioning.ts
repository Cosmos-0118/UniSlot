import type { EnrollmentRow, Section, Student } from '../types'

/**
 * Assign each canonical course enrollment to exactly one section. Loads are
 * balanced first; program cohesion breaks ties between equally loaded sections.
 * Enrollment rows supply per-registration administrative program labels only.
 */
export function assignStudentsToSections(
  students: Record<string, Student>,
  courseSections: Record<string, Section[]>,
  enrollmentRows: EnrollmentRow[],
): Record<string, Section[]> {
  const programsByEnrollment = new Map<string, Set<string>>()
  for (const row of enrollmentRows) {
    const program = row.program?.trim()
    if (!program) continue
    const key = `${row.course_code}\0${row.register_number}`
    const programs = programsByEnrollment.get(key) ?? new Set<string>()
    programs.add(program)
    programsByEnrollment.set(key, programs)
  }

  for (const [courseCode, sections] of Object.entries(courseSections)) {
    for (const section of sections) {
      section.enrolled_students = []
      section.programs = []
    }
    if (!sections.length) continue

    const canonicalStudents: Array<{ id: string; program: string }> = []
    for (const [id, student] of Object.entries(students)) {
      if (id !== student.register_number) {
        throw new Error(
          `Cannot assign sections for ${courseCode}: student key "${id}" does not match register number "${student.register_number}".`,
        )
      }
      if (!new Set(student.enrolled_courses ?? []).has(courseCode)) continue
      const rowPrograms = programsByEnrollment.get(`${courseCode}\0${id}`)
      const program = rowPrograms?.size
        ? [...rowPrograms].sort((a, b) => a.localeCompare(b))[0]!
        : student.program?.trim() || 'Unknown'
      canonicalStudents.push({ id, program })
    }
    canonicalStudents.sort((a, b) => a.program.localeCompare(b.program) || a.id.localeCompare(b.id))

    const totalCapacity = sections.reduce((sum, section) => {
      if (!Number.isInteger(section.capacity) || section.capacity < 0) {
        throw new Error(
          `Cannot assign students to ${courseCode}: section ${section.section_id} has invalid capacity ${section.capacity}.`,
        )
      }
      return sum + section.capacity
    }, 0)
    if (canonicalStudents.length > totalCapacity) {
      throw new Error(
        `Cannot assign all students to sections for course ${courseCode}: ${canonicalStudents.length} canonical enrollment(s) exceed total capacity ${totalCapacity}.`,
      )
    }

    const programCounts = sections.map(() => new Map<string, number>())
    for (const student of canonicalStudents) {
      let bestIndex = -1
      let bestLoad = Number.POSITIVE_INFINITY
      let bestProgramCount = -1
      for (let index = 0; index < sections.length; index++) {
        const section = sections[index]!
        const load = section.enrolled_students.length
        if (load >= section.capacity) continue
        const inProgram = programCounts[index]!.get(student.program) ?? 0
        if (load < bestLoad || (load === bestLoad && inProgram > bestProgramCount)) {
          bestIndex = index
          bestLoad = load
          bestProgramCount = inProgram
        }
      }
      if (bestIndex < 0) {
        // The total-capacity check above makes this unreachable unless section
        // capacities changed while this synchronous assignment was running.
        throw new Error(
          `Cannot assign all students to sections for course ${courseCode}: capacity exhausted with ${student.id} remaining.`,
        )
      }
      const section = sections[bestIndex]!
      section.enrolled_students.push(student.id)
      programCounts[bestIndex]!.set(
        student.program,
        (programCounts[bestIndex]!.get(student.program) ?? 0) + 1,
      )
    }

    for (let index = 0; index < sections.length; index++) {
      sections[index]!.programs = [...programCounts[index]!.keys()].sort((a, b) => a.localeCompare(b))
    }
  }

  return courseSections
}

import type { Course, Section } from '../types'

const DEFAULT_MAX_CAPACITY = 65

/**
 * Phase 1 (research §10): capacity splits — each fragment is a schedulable section.
 * Faculty placeholders for splits are assigned in `faculty.ts`.
 */
export function computeSectionSplits(
  courses: Record<string, Course>,
  maxCapacity: number = DEFAULT_MAX_CAPACITY,
): Record<string, Section[]> {
  const courseSections: Record<string, Section[]> = {}

  for (const [code, course] of Object.entries(courses)) {
    const numSections =
      course.enrollment_count > 0 ? Math.ceil(course.enrollment_count / maxCapacity) : 1
    course.section_count = numSections

    const sections: Section[] = []
    for (let i = 0; i < numSections; i++) {
      const sectionId = numSections > 1 ? `${code}_S${i + 1}` : code
      sections.push({
        section_id: sectionId,
        course_code: code,
        course_title: course.title,
        section_number: i + 1,
        faculty: null,
        capacity: maxCapacity,
        enrolled_students: [],
        programs: [],
      })
    }
    courseSections[code] = sections
  }

  return courseSections
}

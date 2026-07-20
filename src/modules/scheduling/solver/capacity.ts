import type { Course, Section } from '../types'

/** Single-section courses may keep up to this many students without splitting. */
export const SINGLE_SECTION_MAX = 64
/** When splitting, each section hard-caps at this size (Constraints.md §6 preferred band). */
export const SPLIT_SECTION_CAP = 60

/**
 * Capacity splits — each fragment is a schedulable section.
 * - enrollment ≤ 64 → one section (capacity 64)
 * - enrollment ≥ 65 → ceil(n / 60) sections, each capacity 60
 * Faculty placeholders for splits are assigned in `faculty.ts`.
 */
export function computeSectionSplits(
  courses: Record<string, Course>,
): Record<string, Section[]> {
  const courseSections: Record<string, Section[]> = {}

  for (const [code, course] of Object.entries(courses)) {
    const n = course.enrollment_count
    let numSections: number
    let sectionCapacity: number

    if (n <= SINGLE_SECTION_MAX) {
      numSections = 1
      sectionCapacity = SINGLE_SECTION_MAX
    } else {
      numSections = Math.ceil(n / SPLIT_SECTION_CAP)
      sectionCapacity = SPLIT_SECTION_CAP
    }

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
        capacity: sectionCapacity,
        enrolled_students: [],
        programs: [],
      })
    }
    courseSections[code] = sections
  }

  return courseSections
}

/** Ideal balanced target size when splitting (ceil so totals fit). */
export function balancedTargetSize(enrollment: number, numSections: number): number {
  if (numSections <= 0) return enrollment
  return Math.ceil(enrollment / numSections)
}

import type { Course, Section } from '../types'

/**
 * Constraints §7.2 (different faculty per split) + §5.2 Rule 3 (no double-booking).
 *
 * A course-level instructor is a real resource identity and must remain unchanged
 * on one split section so other courses taught by that instructor stay mutually
 * exclusive. Additional sections need their own instructor; until staff are
 * assigned, represent those resources as `Planning:<section id>`.
 *
 * Explicit section-level assignments take precedence over the course-level name.
 * They are preserved exactly: if the same real instructor is assigned to two
 * synchronous sections, the hard-constraint audit must expose that collision.
 */
export function applyDistinctFacultyPerSection(
  courses: Record<string, Course>,
  courseSections: Record<string, Section[]>,
): void {
  for (const [code, sections] of Object.entries(courseSections)) {
    const base = courses[code]?.faculty?.trim() || null

    if (sections.length <= 1) {
      const section = sections[0]
      if (!section) continue
      section.faculty = section.faculty?.trim() || base || `Planning:${section.section_id}`
      continue
    }

    const baseAlreadyAssigned = base && sections.some((section) => section.faculty?.trim() === base)
    const firstUnassigned = sections.find((section) => !section.faculty?.trim())
    const firstPlaceholder = sections.find((section) => section.faculty?.trim().startsWith('Planning:'))
    if (base && !baseAlreadyAssigned) {
      const target = firstUnassigned ?? firstPlaceholder
      if (target) target.faculty = base
    }

    for (const section of sections) {
      if (!section.faculty?.trim()) {
        section.faculty = `Planning:${section.section_id}`
      }
    }
  }
}

export function extractFacultyConstraints(
  courseSections: Record<string, Section[]>,
): Record<string, string[]> {
  const facultySections: Record<string, string[]> = {}
  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      if (section.faculty) {
        if (!facultySections[section.faculty]) facultySections[section.faculty] = []
        facultySections[section.faculty].push(section.section_id)
      }
    }
  }
  return facultySections
}

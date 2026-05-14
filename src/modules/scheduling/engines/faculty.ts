import type { Course, Section } from '../types'

/**
 * Rule 7 / Constraints §7.2: each split section must have a distinct faculty label
 * for the hard “no faculty double-booking” rule. Synthetic labels when only one
 * name exists in source data.
 */
export function applyDistinctFacultyPerSection(
  courses: Record<string, Course>,
  courseSections: Record<string, Section[]>,
): void {
  for (const [code, sections] of Object.entries(courseSections)) {
    const base = courses[code]?.faculty?.trim() || null
    if (sections.length <= 1) {
      sections[0]!.faculty = base
      continue
    }
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]!
      if (base) {
        s.faculty = `${base} · Sec ${i + 1}`
      } else {
        s.faculty = `Course ${code} · Sec ${i + 1}`
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

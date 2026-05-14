import type { Course, Section } from '../types'

/**
 * Constraints §7.2 (different faculty per split) + §5.2 Rule 3 (no double-booking).
 *
 * When the spreadsheet has **no faculty column** (faculty assigned only after the
 * timetable), we still need a **unique resource id per section** so the solver can
 * treat “one instructor per slot” correctly. Each section gets a distinct
 * `Planning:…` label — replace these with real names after export; they are not
 * predictions of staff identity.
 */
export function applyDistinctFacultyPerSection(
  courses: Record<string, Course>,
  courseSections: Record<string, Section[]>,
): void {
  for (const [code, sections] of Object.entries(courseSections)) {
    const base = courses[code]?.faculty?.trim() || null
    if (sections.length <= 1) {
      const sec = sections[0]!
      sec.faculty = base ?? `Planning:${sec.section_id}`
      continue
    }
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]!
      if (base) {
        s.faculty = `${base} · Sec ${i + 1}`
      } else {
        s.faculty = `Planning:${s.section_id}`
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

import type { SavedScheduleRun } from '@/features/scheduling/storage/savedRunsStorage'

/** Strip a trailing locale date in parentheses from auto-generated titles. */
export function displayRunTitle(title: string): string {
  const withoutDate = title.replace(/\s*\(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\)\s*$/, '').trim()
  return withoutDate || title
}

export function formatSavedAt(iso: string): { primary: string; relative: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return { primary: iso, relative: '' }
  }
  const primary = d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const diffMs = Date.now() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  let relative = 'Today'
  if (diffDays === 1) relative = 'Yesterday'
  else if (diffDays > 1 && diffDays < 7) relative = `${diffDays} days ago`
  else if (diffDays >= 7 && diffDays < 30) relative = `${Math.floor(diffDays / 7)} wk ago`
  else if (diffDays >= 30) relative = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  return { primary, relative }
}

export function snapshotStats(s: SavedScheduleRun['snapshot']) {
  const sectionCount = Object.values(s.courseSections).reduce((n, arr) => n + arr.length, 0)
  const studentCount = Object.keys(s.students).length
  const courseCount = Object.keys(s.courseSections).length
  const facultyMapped = Object.keys(s.facultyOverrides ?? {}).length
  return { sectionCount, studentCount, courseCount, facultyMapped }
}

export function sourceFileLabel(name: string | null): string | null {
  if (!name) return null
  return name.replace(/\.xlsx$/i, '')
}

/** True when the saved title is just the workbook stem (auto-save naming). */
export function isTitleSameAsSourceFile(title: string, sourceFileName: string | null): boolean {
  const fileStem = sourceFileLabel(sourceFileName)
  if (!fileStem) return false
  return displayRunTitle(title).localeCompare(fileStem, undefined, { sensitivity: 'accent' }) === 0
}

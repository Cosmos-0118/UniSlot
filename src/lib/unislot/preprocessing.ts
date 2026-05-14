export {
  buildConflictGraph,
  buildAdjacency,
  computeClashWeight,
  sumConflictGraphWeights,
} from './engines/conflictGraph'
export { computeSectionSplits } from './engines/capacity'
export { assignStudentsToSections } from './engines/sectioning'
export { applyDistinctFacultyPerSection, extractFacultyConstraints } from './engines/faculty'

import type { Section } from './types'

export function getAllSections(courseSections: Record<string, Section[]>): Section[] {
  return Object.values(courseSections).flat()
}

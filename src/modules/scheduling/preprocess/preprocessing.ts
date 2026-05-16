export {
  buildConflictGraph,
  buildAdjacency,
  computeClashWeight,
  sumConflictGraphWeights,
} from '../solver/conflictGraph'
export { computeSectionSplits } from '../solver/capacity'
export { assignStudentsToSections } from '../solver/sectioning'
export { applyDistinctFacultyPerSection, extractFacultyConstraints } from '../solver/faculty'

import type { Section } from '../types'

export function getAllSections(courseSections: Record<string, Section[]>): Section[] {
  return Object.values(courseSections).flat()
}

import type { ConflictEdge, ConflictGraph, Section, Student } from '../types'

export interface ConflictAnalysis {
  conflictDensity: Record<string, number>
  adj: Map<string, Map<string, number>>
}

export function buildAdjacency(conflictGraph: ConflictGraph): ConflictAnalysis {
  const conflictDensity: Record<string, number> = {}
  const adj = new Map<string, Map<string, number>>()

  for (const edge of conflictGraph.edges) {
    conflictDensity[edge.section_a] = (conflictDensity[edge.section_a] ?? 0) + edge.weight
    conflictDensity[edge.section_b] = (conflictDensity[edge.section_b] ?? 0) + edge.weight
    if (!adj.has(edge.section_a)) adj.set(edge.section_a, new Map())
    if (!adj.has(edge.section_b)) adj.set(edge.section_b, new Map())
    adj.get(edge.section_a)!.set(edge.section_b, edge.weight)
    adj.get(edge.section_b)!.set(edge.section_a, edge.weight)
  }

  return { conflictDensity, adj }
}

export function buildConflictGraph(
  _students: Record<string, Student>,
  courseSections: Record<string, Section[]>,
): ConflictGraph {
  const studentSections = new Map<string, string[]>()
  const allSections: string[] = []

  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      allSections.push(section.section_id)
      for (const studentId of section.enrolled_students) {
        if (!studentSections.has(studentId)) studentSections.set(studentId, [])
        studentSections.get(studentId)!.push(section.section_id)
      }
    }
  }

  const edgeWeights = new Map<string, string[]>()

  for (const [studentId, sectionIds] of studentSections) {
    for (let i = 0; i < sectionIds.length; i++) {
      for (let j = i + 1; j < sectionIds.length; j++) {
        const a = sectionIds[i]
        const b = sectionIds[j]
        const s1 = a! < b! ? a! : b!
        const s2 = a! < b! ? b! : a!
        const key = `${s1}|${s2}`
        if (!edgeWeights.has(key)) edgeWeights.set(key, [])
        edgeWeights.get(key)!.push(studentId)
      }
    }
  }

  const edges: ConflictEdge[] = []
  for (const [key, shared] of edgeWeights) {
    const [s1, s2] = key.split('|') as [string, string]
    const unique = [...new Set(shared)]
    edges.push({
      section_a: s1,
      section_b: s2,
      weight: unique.length,
      shared_students: unique,
    })
  }

  return { sections: allSections, edges }
}

export function sumConflictGraphWeights(graph: ConflictGraph): number {
  return graph.edges.reduce((s, e) => s + e.weight, 0)
}

export function computeClashWeight(
  conflictGraph: ConflictGraph,
  assignments: Record<string, number>,
): number {
  let total = 0
  for (const edge of conflictGraph.edges) {
    if (assignments[edge.section_a] === assignments[edge.section_b]) {
      total += edge.weight
    }
  }
  return total
}

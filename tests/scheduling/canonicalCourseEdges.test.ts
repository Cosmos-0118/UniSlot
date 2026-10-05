import { describe, expect, it } from 'vitest'
import { buildConflictGraph } from '../../src/modules/scheduling/solver/conflictGraph'
import { buildCpsatInstance, sectionSlotsFromCourseSlots } from '../../src/modules/scheduling/solver/cpsatInstance'
import { computeClashWeight } from '../../src/modules/scheduling/solver/conflictGraph'
import type { Section, Student } from '../../src/modules/scheduling/types'

function section(id: string, course: string, roster: string[]): Section {
  return {
    section_id: id,
    course_code: course,
    course_title: course,
    section_number: 1,
    faculty: `Planning:${id}`,
    capacity: 100,
    enrolled_students: roster,
    programs: ['CS'],
  }
}

function makeStudents(memberships: Record<string, string[]>): Record<string, Student> {
  return Object.fromEntries(Object.entries(memberships).map(([id, courses]) => [id, {
    register_number: id,
    name: id,
    program: 'CS',
    email: null,
    mobile: null,
    enrolled_courses: courses,
  }]))
}

function expectedEdges(students: Record<string, Student>, modeledCourses: Set<string>) {
  const weights = new Map<string, number>()
  for (const student of Object.values(students)) {
    const courses = [...new Set(student.enrolled_courses.filter((course) => modeledCourses.has(course)))].sort()
    for (let i = 0; i < courses.length; i++) {
      for (let j = i + 1; j < courses.length; j++) {
        const key = `${courses[i]}|${courses[j]}`
        weights.set(key, (weights.get(key) ?? 0) + 1)
      }
    }
  }
  return [...weights].map(([key, weight]) => {
    const [course_a, course_b] = key.split('|') as [string, string]
    return { course_a, course_b, weight }
  })
}

function partitionedSections(
  students: Record<string, Student>,
  reversePartition: boolean,
): Record<string, Section[]> {
  const sections: Record<string, Section[]> = {}
  for (const course of ['A', 'B', 'C', 'D']) {
    sections[course] = [section(`${course}1`, course, []), section(`${course}2`, course, [])]
  }
  for (const [studentId, student] of Object.entries(students)) {
    for (const course of new Set(student.enrolled_courses)) {
      if (!sections[course]) continue
      const bit = Number(studentId.slice(1)) % 2
      sections[course]![reversePartition ? 1 - bit : bit]!.enrolled_students.push(studentId)
    }
  }
  return sections
}

const invalidRosters: Array<[string, Record<string, Section[]>, string[], RegExp]> = [
  ['missing canonical member', { A: [section('A1', 'A', [])] }, ['A'], /missing.*section/i],
  ['duplicate membership', { A: [section('A1', 'A', ['s1']), section('A2', 'A', ['s1'])] }, ['A'], /multiple sections/i],
  ['unknown roster id', { A: [section('A1', 'A', ['ghost'])] }, [], /unknown student/i],
  ['roster student not enrolled', { A: [section('A1', 'A', ['s1'])] }, ['B'], /not canonically enrolled/i],
]

describe('canonical course conflict edges', () => {
  it('is invariant to valid student section partitions and matches section-edge aggregation', () => {
    const memberships: Record<string, string[]> = {}
    for (let i = 0; i < 40; i++) {
      const courses = ['A', 'B', 'C', 'D'].filter((_, j) => ((i * 7 + j * 11) % 5) < 2)
      memberships[`s${i}`] = courses.length ? courses : ['A']
    }
    const students = makeStudents(memberships)
    const first = partitionedSections(students, false)
    const second = partitionedSections(students, true)
    const firstGraph = buildConflictGraph(students, first)
    const secondGraph = buildConflictGraph(students, second)
    const firstInstance = buildCpsatInstance(first, firstGraph, {}, students)
    const secondInstance = buildCpsatInstance(second, secondGraph, {}, students)

    expect(firstInstance.conflict_edges).toEqual(expectedEdges(students, new Set(Object.keys(first))))
    expect(secondInstance.conflict_edges).toEqual(firstInstance.conflict_edges)
    expect(firstInstance.students).toEqual(secondInstance.students)

    const assignment = { A: 0, B: 0, C: 1, D: 0 }
    const expectedCost = firstInstance.conflict_edges.reduce(
      (sum, edge) => sum + (assignment[edge.course_a as keyof typeof assignment] ===
        assignment[edge.course_b as keyof typeof assignment] ? edge.weight : 0),
      0,
    )
    expect(computeClashWeight(firstGraph, sectionSlotsFromCourseSlots(first, assignment))).toBe(expectedCost)
    expect(computeClashWeight(secondGraph, sectionSlotsFromCourseSlots(second, assignment))).toBe(expectedCost)
  })

  it.each(invalidRosters)('rejects %s before creating a model', (_label, courseSections, courses, error) => {
    const students = makeStudents({ s1: [...courses] })
    const graph = buildConflictGraph(students, courseSections)
    expect(() => buildCpsatInstance(courseSections, graph, {}, students)).toThrow(error)
  })

  it('deduplicates canonical courses and ignores unmodeled enrollment codes', () => {
    const students = makeStudents({ s1: ['A', 'A', 'B', 'unmodeled'] })
    const courseSections = { A: [section('A1', 'A', ['s1'])], B: [section('B1', 'B', ['s1'])] }
    const instance = buildCpsatInstance(courseSections, buildConflictGraph(students, courseSections), {}, students)
    expect(instance.students).toEqual([{ id: 's1', courses: ['A', 'B'] }])
    expect(instance.conflict_edges).toEqual([{ course_a: 'A', course_b: 'B', weight: 1 }])
  })
})

import type {
  ClashReport,
  ConflictGraph,
  DayName,
  Schedule,
  ScheduleEntry,
  Section,
  Student,
  StudentClashReport,
} from './types'
import { INDEX_TO_DAY } from './types'

const NUM_SLOTS = 5
const NUM_SLOTS_WITH_SATURDAY = 6
const LOCAL_SEARCH_ITERATIONS = 500
const MULTI_START_RUNS = 10
const LOAD_BALANCE_FACTOR = 5

function isMathCourse(courseCode: string): boolean {
  return courseCode.toUpperCase().includes('MAB')
}

function calculateParallelCap(numSections: number): number {
  const baseCap = Math.ceil(numSections / NUM_SLOTS)
  const buffer = Math.max(2, Math.floor(baseCap / 5))
  return baseCap + buffer
}

function computeClashWeight(
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

const PROGRAM_ABBREVIATIONS: [string, string][] = [
  ['computer science and engineering', 'CSE'],
  ['computer science', 'CS'],
  ['artificial intelligence and machine learning', 'AIML'],
  ['artificial intelligence', 'AI'],
  ['machine learning', 'ML'],
  ['data science', 'DS'],
  ['information technology', 'IT'],
  ['electronics and communication engineering', 'ECE'],
  ['electronics and communication', 'ECE'],
  ['electrical and electronics engineering', 'EEE'],
  ['mechanical engineering', 'MECH'],
  ['civil engineering', 'CIVIL'],
]

function abbreviateProgram(program: string): string {
  if (!program) return ''
  let lower = program.trim().toLowerCase()
  for (const prefix of ['b.tech.-', 'b.tech-', 'b.tech.', 'b.tech ']) {
    if (lower.startsWith(prefix)) {
      lower = lower.slice(prefix.length)
      break
    }
  }
  const sorted = [...PROGRAM_ABBREVIATIONS].sort((a, b) => b[0].length - a[0].length)
  for (const [key, abbr] of sorted) {
    if (lower.includes(key)) return abbr
  }
  const words = lower.split(/\s+/).filter(Boolean)
  const skip = new Set(['b', 'tech', 'm', 'of', 'and', 'in', 'the', 'with', 'engineering'])
  const caps = words
    .filter((w) => !skip.has(w) && w.length > 1 && /^[a-z]/i.test(w))
    .map((w) => w[0]!.toUpperCase())
  if (caps.length) return caps.slice(0, 4).join('')
  return program.slice(0, 6).toUpperCase() || 'UNK'
}

function formatPrograms(programs: string[]): string {
  const abbrs: string[] = []
  const seen = new Set<string>()
  for (const p of programs) {
    const a = abbreviateProgram(p)
    if (!seen.has(a)) {
      seen.add(a)
      abbrs.push(a)
    }
  }
  return abbrs.join(', ')
}

interface ConflictAnalysis {
  conflictDensity: Record<string, number>
  adj: Map<string, Map<string, number>>
}

function analyzeConflicts(_sections: Section[], conflictGraph: ConflictGraph): ConflictAnalysis {
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

function solveGreedy(
  sections: Section[],
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  parallelCap: number,
  randomize: boolean,
): {
  assignments: Record<string, number>
  slotLoads: number[]
  solverTime: number
  clashWeight: number
} {
  const t0 = performance.now() / 1000
  const { conflictDensity, adj } = analyzeConflicts(sections, conflictGraph)

  const sectionFaculty: Record<string, string | null> = {}
  for (const [faculty, sids] of Object.entries(facultyConstraints)) {
    for (const sid of sids) sectionFaculty[sid] = faculty
  }

  const mathSections = new Set(
    sections.filter((s) => isMathCourse(s.course_code)).map((s) => s.section_id),
  )

  function computePriority(section: Section): number {
    const sid = section.section_id
    const cw = conflictDensity[sid] ?? 0
    const degree = adj.get(sid)?.size ?? 0
    const enrollment = section.enrolled_students.length
    let score = cw * 100 + degree * 10 + enrollment
    if (randomize) score += (Math.random() - 0.5) * 100
    return score
  }

  const sortedSections = [...sections].sort((a, b) => computePriority(b) - computePriority(a))

  const assignments: Record<string, number> = {}
  const slotLoads = Array(NUM_SLOTS_WITH_SATURDAY).fill(0)
  const facultySlots = new Map<string, Set<number>>()

  for (const section of sortedSections) {
    const sid = section.section_id
    const faculty = sectionFaculty[sid] ?? section.faculty
    const maxSlot = mathSections.has(sid) ? NUM_SLOTS_WITH_SATURDAY : NUM_SLOTS

    const totalAssigned = slotLoads.slice(0, maxSlot).reduce((a, b) => a + b, 0)
    const targetLoad = maxSlot ? totalAssigned / maxSlot : 0

    const slotCosts: { cost: number; slot: number }[] = []
    for (let slot = 0; slot < maxSlot; slot++) {
      if (faculty && facultySlots.get(faculty)?.has(slot)) {
        slotCosts.push({ cost: Number.POSITIVE_INFINITY, slot })
      } else if (slotLoads[slot]! >= parallelCap) {
        slotCosts.push({ cost: Number.POSITIVE_INFINITY, slot })
      } else {
        let conflictCost = 0
        for (const [otherSid, assignedSlot] of Object.entries(assignments)) {
          if (assignedSlot === slot) {
            const w = adj.get(sid)?.get(otherSid)
            if (w) conflictCost += w
          }
        }
        const loadPenalty = Math.max(0, slotLoads[slot]! - targetLoad) * LOAD_BALANCE_FACTOR
        slotCosts.push({ cost: conflictCost + loadPenalty, slot })
      }
    }
    slotCosts.sort((a, b) => a.cost - b.cost || a.slot - b.slot)
    let bestSlot = slotCosts[0]!.slot
    if (slotCosts[0]!.cost === Number.POSITIVE_INFINITY) {
      bestSlot = [...Array(maxSlot).keys()].reduce((best, s) =>
        slotLoads[s]! < slotLoads[best]! ? s : best,
      0)
    }

    assignments[sid] = bestSlot
    slotLoads[bestSlot] = (slotLoads[bestSlot] ?? 0) + 1
    if (faculty) {
      if (!facultySlots.has(faculty)) facultySlots.set(faculty, new Set())
      facultySlots.get(faculty)!.add(bestSlot)
    }
  }

  const improved = localSearchImprove(
    { ...assignments },
    adj,
    facultyConstraints,
    [...slotLoads],
    parallelCap,
    mathSections,
  )

  const clashWeight = computeClashWeight(conflictGraph, improved)
  return {
    assignments: improved,
    slotLoads,
    solverTime: performance.now() / 1000 - t0,
    clashWeight,
  }
}

function localSearchImprove(
  assignments: Record<string, number>,
  adj: Map<string, Map<string, number>>,
  facultyConstraints: Record<string, string[]>,
  slotLoads: number[],
  parallelCap: number,
  mathSections: Set<string>,
): Record<string, number> {
  const sectionFaculty: Record<string, string | null> = {}
  for (const [faculty, sids] of Object.entries(facultyConstraints)) {
    for (const sid of sids) sectionFaculty[sid] = faculty
  }

  function computeClashCost(sid: string, slot: number): number {
    let cost = 0
    const neighbors = adj.get(sid)
    if (!neighbors) return 0
    for (const [otherSid, weight] of neighbors) {
      if (assignments[otherSid] === slot) cost += weight
    }
    return cost
  }

  function isMoveFeasible(sid: string, newSlot: number): boolean {
    const faculty = sectionFaculty[sid]
    const oldSlot = assignments[sid]!

    if (faculty) {
      for (const [other, f] of Object.entries(sectionFaculty)) {
        if (f === faculty && other !== sid && assignments[other] === newSlot) {
          return false
        }
      }
    }

    if (oldSlot !== newSlot && slotLoads[newSlot]! + 1 > parallelCap) {
      return false
    }
    return true
  }

  let improved = true
  let iterations = 0
  while (improved && iterations < LOCAL_SEARCH_ITERATIONS) {
    improved = false
    iterations++
    for (const sid of Object.keys(assignments)) {
      const currentSlot = assignments[sid]!
      const currentCost = computeClashCost(sid, currentSlot)
      if (currentCost === 0) continue

      const maxSlot = mathSections.has(sid) ? NUM_SLOTS_WITH_SATURDAY : NUM_SLOTS
      let bestSlot = currentSlot
      let bestCost = currentCost

      for (let newSlot = 0; newSlot < maxSlot; newSlot++) {
        if (newSlot === currentSlot) continue
        if (!isMoveFeasible(sid, newSlot)) continue
        const newCost = computeClashCost(sid, newSlot)
        if (newCost < bestCost) {
          bestCost = newCost
          bestSlot = newSlot
        }
      }

      if (bestSlot !== currentSlot) {
        slotLoads[currentSlot]!--
        slotLoads[bestSlot] = (slotLoads[bestSlot] ?? 0) + 1
        assignments[sid] = bestSlot
        improved = true
      }
    }
  }

  return assignments
}

function solveGreedyMultiStart(
  sections: Section[],
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  parallelCap: number,
): { assignments: Record<string, number>; clashWeight: number } {
  let best: { assignments: Record<string, number>; clashWeight: number } | null = null
  for (let i = 0; i < MULTI_START_RUNS; i++) {
    const r = solveGreedy(sections, conflictGraph, facultyConstraints, parallelCap, i > 0)
    if (!best || r.clashWeight < best.clashWeight) {
      best = { assignments: r.assignments, clashWeight: r.clashWeight }
    }
  }
  return best ?? { assignments: {}, clashWeight: 0 }
}

export function runScheduler(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
): {
  slot_assignments: Record<string, number>
  solver_used: string
  solver_time_seconds: number
  total_clash_weight: number
} {
  const t0 = performance.now() / 1000
  const sections = Object.values(courseSections).flat()
  const parallelCap = calculateParallelCap(sections.length)
  const { assignments, clashWeight } = solveGreedyMultiStart(
    sections,
    conflictGraph,
    facultyConstraints,
    parallelCap,
  )
  return {
    slot_assignments: assignments,
    solver_used: 'greedy-multi-start',
    solver_time_seconds: performance.now() / 1000 - t0,
    total_clash_weight: clashWeight,
  }
}

export function buildSchedule(
  courseSections: Record<string, Section[]>,
  slotAssignments: Record<string, number>,
  solverMeta: { solver_used: string; solver_time_seconds: number },
): Schedule {
  const entries: ScheduleEntry[] = []

  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      const slotIdx = slotAssignments[section.section_id] ?? 0
      const day = INDEX_TO_DAY[slotIdx] ?? 'Monday'
      entries.push({
        section_id: section.section_id,
        course_code: section.course_code,
        course_title: section.course_title,
        section_number: section.section_number,
        day,
        time: '5:00 PM - 7:00 PM',
        faculty: section.faculty,
        enrollment_count: section.enrolled_students.length,
        programs: formatPrograms(section.programs),
      })
    }
  }

  const dayOrder: DayName[] = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ]
  entries.sort(
    (a, b) =>
      dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day) ||
      a.course_code.localeCompare(b.course_code) ||
      a.section_number - b.section_number,
  )

  return {
    entries,
    total_sections: entries.length,
    solver_used: solverMeta.solver_used,
    solver_time_seconds: solverMeta.solver_time_seconds,
    total_clashes: 0,
  }
}

export function computeClashReport(
  students: Record<string, Student>,
  courseSections: Record<string, Section[]>,
  slotAssignments: Record<string, number>,
): ClashReport {
  const sectionToCourse = new Map<string, string>()
  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      sectionToCourse.set(section.section_id, section.course_code)
    }
  }

  const studentSectionsMap = new Map<string, string[]>()

  for (const sections of Object.values(courseSections)) {
    for (const section of sections) {
      for (const studentId of section.enrolled_students) {
        if (!studentSectionsMap.has(studentId)) studentSectionsMap.set(studentId, [])
        studentSectionsMap.get(studentId)!.push(section.section_id)
      }
    }
  }

  const reports: StudentClashReport[] = []
  let studentsWithClashes = 0

  for (const [studentId, student] of Object.entries(students)) {
    const sectionIds = studentSectionsMap.get(studentId) ?? []
    const slotSections = new Map<number, string[]>()
    for (const sid of sectionIds) {
      const slot = slotAssignments[sid] ?? -1
      if (!slotSections.has(slot)) slotSections.set(slot, [])
      slotSections.get(slot)!.push(sid)
    }

    const clashingPairs: [string, string][] = []
    let clashingDay: DayName | null = null

    for (const [slot, sids] of slotSections) {
      if (sids.length > 1 && slot >= 0) {
        const courses = sids.map((id) => sectionToCourse.get(id) ?? id)
        for (let i = 0; i < courses.length; i++) {
          for (let j = i + 1; j < courses.length; j++) {
            clashingPairs.push([courses[i]!, courses[j]!])
          }
        }
        clashingDay = INDEX_TO_DAY[slot] ?? null
      }
    }

    const status = clashingPairs.length ? 'Red' : 'Green'
    if (status === 'Red') studentsWithClashes++

    reports.push({
      register_number: studentId,
      student_name: student.name,
      program: student.program,
      enrolled_courses: student.enrolled_courses,
      status,
      clashing_courses: clashingPairs,
      clashing_day: clashingDay,
    })
  }

  reports.sort(
    (a, b) => (a.status === 'Red' ? 0 : 1) - (b.status === 'Red' ? 0 : 1) || a.register_number.localeCompare(b.register_number),
  )

  const total = reports.length
  return {
    total_students: total,
    students_with_clashes: studentsWithClashes,
    clash_free_students: total - studentsWithClashes,
    clash_percentage: total ? Math.round((studentsWithClashes / total) * 10000) / 100 : 0,
    reports,
  }
}

// Re-export INDEX_TO_DAY for buildSchedule - already imported SLOT_DAYS

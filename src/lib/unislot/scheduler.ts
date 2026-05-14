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
const LOAD_BALANCE_FACTOR = 5

/** Adaptive multi-start count (quality vs worker time). */
function multiStartRunCount(sectionCount: number): number {
  return Math.min(80, Math.max(18, Math.ceil(Math.sqrt(sectionCount) * 4)))
}

function solutionPoolSize(runCount: number): number {
  return Math.min(16, Math.max(4, Math.floor(runCount / 4)))
}

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

function sumConflictGraphWeights(graph: ConflictGraph): number {
  return graph.edges.reduce((s, e) => s + e.weight, 0)
}

function buildEnrollmentIndex(sections: Section[]) {
  const studentToSections = new Map<string, string[]>()
  const sectionToStudents = new Map<string, string[]>()
  for (const sec of sections) {
    sectionToStudents.set(sec.section_id, sec.enrolled_students)
    for (const st of sec.enrolled_students) {
      if (!studentToSections.has(st)) studentToSections.set(st, [])
      studentToSections.get(st)!.push(sec.section_id)
    }
  }
  return { studentToSections, sectionToStudents }
}

/** Students with ≥2 enrolled sections in the same slot (matches clash-report KPI). */
function countStudentsWithSlotClashes(
  studentToSections: Map<string, string[]>,
  assignments: Record<string, number>,
): number {
  let n = 0
  for (const st of studentToSections.keys()) {
    const tally = new Array(NUM_SLOTS_WITH_SATURDAY).fill(0)
    for (const secId of studentToSections.get(st)!) {
      const sl = assignments[secId]
      if (sl !== undefined && sl >= 0 && sl < NUM_SLOTS_WITH_SATURDAY) tally[sl]++
    }
    if (tally.some((c) => c >= 2)) n++
  }
  return n
}

function maxSlotForSection(sid: string, mathSections: Set<string>): number {
  return mathSections.has(sid) ? NUM_SLOTS_WITH_SATURDAY : NUM_SLOTS
}

function tabuAttrKey(sid: string, slot: number): string {
  return `${sid}\t${slot}`
}

/** Faculty → slot → section occupying that slot (at most one per slot per faculty when feasible). */
function buildFacultySlotMap(
  assignments: Record<string, number>,
  sectionFaculty: Record<string, string | null>,
): Map<string, Map<number, string>> {
  const m = new Map<string, Map<number, string>>()
  for (const sid of Object.keys(assignments)) {
    const f = sectionFaculty[sid]
    if (!f) continue
    const slot = assignments[sid]!
    if (!m.has(f)) m.set(f, new Map())
    m.get(f)!.set(slot, sid)
  }
  return m
}

function slotLoadsFromAssignments(assignments: Record<string, number>): number[] {
  const loads = Array(NUM_SLOTS_WITH_SATURDAY).fill(0)
  for (const slot of Object.values(assignments)) {
    loads[slot as number] = (loads[slot as number] ?? 0) + 1
  }
  return loads
}

function buildSectionFaculty(
  sections: Section[],
  facultyConstraints: Record<string, string[]>,
): Record<string, string | null> {
  const sectionFaculty: Record<string, string | null> = {}
  for (const [faculty, sids] of Object.entries(facultyConstraints)) {
    for (const sid of sids) sectionFaculty[sid] = faculty
  }
  for (const sec of sections) {
    if (sectionFaculty[sec.section_id] === undefined) {
      sectionFaculty[sec.section_id] = sec.faculty
    }
  }
  return sectionFaculty
}

function hybridSATabuImprove(
  initialAssignments: Record<string, number>,
  sections: Section[],
  conflictGraph: ConflictGraph,
  adj: Map<string, Map<string, number>>,
  facultyConstraints: Record<string, string[]>,
  parallelCap: number,
  mathSections: Set<string>,
  options?: { maxIterFactor?: number },
): Record<string, number> {
  const sectionFaculty = buildSectionFaculty(sections, facultyConstraints)

  const assignments: Record<string, number> = { ...initialAssignments }
  const sectionIds = Object.keys(assignments)
  const n = sectionIds.length
  const mEdges = conflictGraph.edges.length

  const slotLoads = slotLoadsFromAssignments(assignments)
  const facultySlots = buildFacultySlotMap(assignments, sectionFaculty)

  const maxIter = Math.min(
    400_000,
    Math.max(
      10_000,
      Math.floor((options?.maxIterFactor ?? 1) * (500 * n + 50 * mEdges + 3000)),
    ),
  )
  const baseTenure = Math.max(4, Math.min(40, Math.floor(5 + n / 8)))
  const coolPeriod = Math.max(40, Math.floor(25 + n / 3))
  const stagnationReheat = Math.max(250, Math.floor(180 + n * 4))

  const { studentToSections, sectionToStudents } = buildEnrollmentIndex(sections)
  const LEX_W = sumConflictGraphWeights(conflictGraph) + 1

  let totalClash = computeClashWeight(conflictGraph, assignments)
  let studentClash = countStudentsWithSlotClashes(studentToSections, assignments)
  let globalBestEdges = totalClash
  let globalBestStudents = studentClash
  const globalBestAssign: Record<string, number> = { ...assignments }

  let temperature = Math.max(50, studentClash * LEX_W * 0.06 + totalClash * 0.04)
  const t0 = temperature

  const tabuUntil = new Map<string, number>()
  let iterSinceGlobalBest = 0

  function isTabu(sid: string, toSlot: number, iter: number): boolean {
    return (tabuUntil.get(tabuAttrKey(sid, toSlot)) ?? 0) > iter
  }

  function clashDeltaSingleMove(sid: string, oldSlot: number, newSlot: number): number {
    let d = 0
    const neighbors = adj.get(sid)
    if (!neighbors) return 0
    for (const [v, w] of neighbors) {
      const sv = assignments[v]!
      d += w * ((sv === newSlot ? 1 : 0) - (sv === oldSlot ? 1 : 0))
    }
    return d
  }

  function feasibleSingleMove(sid: string, newSlot: number): boolean {
    const oldSlot = assignments[sid]!
    if (oldSlot === newSlot) return false
    const maxS = maxSlotForSection(sid, mathSections)
    if (newSlot < 0 || newSlot >= maxS) return false

    const f = sectionFaculty[sid]
    if (f) {
      const occ = facultySlots.get(f)?.get(newSlot)
      if (occ && occ !== sid) return false
    }

    if (slotLoads[newSlot]! + 1 > parallelCap) return false
    return true
  }

  function applySingleMove(sid: string, newSlot: number): void {
    const oldSlot = assignments[sid]!
    const f = sectionFaculty[sid]
    if (f) {
      if (!facultySlots.has(f)) facultySlots.set(f, new Map())
      const fm = facultySlots.get(f)!
      if (fm.get(oldSlot) === sid) fm.delete(oldSlot)
      fm.set(newSlot, sid)
    }
    slotLoads[oldSlot]!--
    slotLoads[newSlot] = (slotLoads[newSlot] ?? 0) + 1
    assignments[sid] = newSlot
  }

  function clashDeltaSwap(sid1: string, sid2: string): number | null {
    const A = assignments[sid1]!
    const B = assignments[sid2]!
    if (A === B) return null

    const f1 = sectionFaculty[sid1]
    const f2 = sectionFaculty[sid2]
    if (f1) {
      const occ = facultySlots.get(f1)?.get(B)
      if (occ && occ !== sid1 && occ !== sid2) return null
    }
    if (f2) {
      const occ = facultySlots.get(f2)?.get(A)
      if (occ && occ !== sid1 && occ !== sid2) return null
    }

    let d = 0
    const nbr1 = adj.get(sid1)
    if (nbr1) {
      for (const [v, w] of nbr1) {
        if (v === sid2) continue
        const sv = assignments[v]!
        d += w * ((sv === B ? 1 : 0) - (sv === A ? 1 : 0))
      }
    }
    const nbr2 = adj.get(sid2)
    if (nbr2) {
      for (const [v, w] of nbr2) {
        if (v === sid1) continue
        const sv = assignments[v]!
        d += w * ((sv === A ? 1 : 0) - (sv === B ? 1 : 0))
      }
    }
    return d
  }

  function applySwap(sid1: string, sid2: string): void {
    const A = assignments[sid1]!
    const B = assignments[sid2]!
    const f1 = sectionFaculty[sid1]
    const f2 = sectionFaculty[sid2]
    if (f1) {
      if (!facultySlots.has(f1)) facultySlots.set(f1, new Map())
      const fm = facultySlots.get(f1)!
      if (fm.get(A) === sid1) fm.delete(A)
      fm.set(B, sid1)
    }
    if (f2) {
      if (!facultySlots.has(f2)) facultySlots.set(f2, new Map())
      const fm = facultySlots.get(f2)!
      if (fm.get(B) === sid2) fm.delete(B)
      fm.set(A, sid2)
    }
    assignments[sid1] = B
    assignments[sid2] = A
  }

  function buildKempeComponent(startSid: string, c1: number, c2: number): string[] | null {
    const sc = assignments[startSid]
    if (sc !== c1 && sc !== c2) return null
    const stack = [startSid]
    const seen = new Set<string>([startSid])
    while (stack.length) {
      const u = stack.pop()!
      const neighbors = adj.get(u)
      if (!neighbors) continue
      for (const [v] of neighbors) {
        if (seen.has(v)) continue
        const col = assignments[v]
        if (col === c1 || col === c2) {
          seen.add(v)
          stack.push(v)
        }
      }
    }
    return [...seen]
  }

  function kempeDeltaAndFeasible(
    component: string[],
    c1: number,
    c2: number,
  ): { delta: number; ok: boolean } {
    const inComp = new Set(component)
    let other: number | null = null
    for (const sid of component) {
      const s = assignments[sid]!
      if (s !== c1) {
        other = s
        break
      }
    }
    if (other === null || other !== c2) return { delta: 0, ok: false }

    for (const sid of component) {
      const ns = assignments[sid] === c1 ? c2 : c1
      if (ns < 0 || ns >= maxSlotForSection(sid, mathSections)) return { delta: 0, ok: false }
    }

    let nAt1 = 0
    let nAt2 = 0
    for (const sid of component) {
      if (assignments[sid] === c1) nAt1++
      else nAt2++
    }
    const load1after = slotLoads[c1]! - nAt1 + nAt2
    const load2after = slotLoads[c2]! - nAt2 + nAt1
    if (load1after > parallelCap || load2after > parallelCap) return { delta: 0, ok: false }

    const faculties = new Set<string>()
    for (const sid of sectionIds) {
      const f = sectionFaculty[sid]
      if (f) faculties.add(f)
    }
    for (const f of faculties) {
      const bySlot = new Map<number, string[]>()
      for (const sid of sectionIds) {
        if (sectionFaculty[sid] !== f) continue
        let sl = assignments[sid]!
        if (inComp.has(sid)) sl = sl === c1 ? c2 : c1
        if (!bySlot.has(sl)) bySlot.set(sl, [])
        bySlot.get(sl)!.push(sid)
      }
      for (const [, arr] of bySlot) {
        if (arr.length > 1) return { delta: 0, ok: false }
      }
    }

    let delta = 0
    for (const u of component) {
      const oldU = assignments[u]!
      const newU = oldU === c1 ? c2 : c1
      const neighbors = adj.get(u)
      if (!neighbors) continue
      for (const [v, w] of neighbors) {
        if (u >= v) continue
        const oldV = assignments[v]!
        const newV = inComp.has(v) ? (oldV === c1 ? c2 : c1) : oldV
        delta += w * ((newU === newV ? 1 : 0) - (oldU === oldV ? 1 : 0))
      }
    }
    return { delta, ok: true }
  }

  function applyKempe(component: string[], c1: number, c2: number): void {
    for (const sid of component) {
      const oldS = assignments[sid]!
      const newS = oldS === c1 ? c2 : c1
      const f = sectionFaculty[sid]
      if (f) {
        if (!facultySlots.has(f)) facultySlots.set(f, new Map())
        const fm = facultySlots.get(f)!
        if (fm.get(oldS) === sid) fm.delete(oldS)
        fm.set(newS, sid)
      }
      slotLoads[oldS]!--
      slotLoads[newS] = (slotLoads[newS] ?? 0) + 1
      assignments[sid] = newS
    }
  }

  function studentClashUnder(slotOf: (secId: string) => number, st: string): boolean {
    const tally = new Array(NUM_SLOTS_WITH_SATURDAY).fill(0)
    for (const secId of studentToSections.get(st) ?? []) {
      const sl = slotOf(secId)
      if (sl >= 0 && sl < NUM_SLOTS_WITH_SATURDAY) tally[sl]++
    }
    return tally.some((c) => c >= 2)
  }

  function deltaStudentsSingleMove(sid: string, newSlot: number): number {
    const sts = sectionToStudents.get(sid)
    if (!sts?.length) return 0
    let d = 0
    for (const st of sts) {
      const before = studentClashUnder((secId) => assignments[secId]!, st)
      const after = studentClashUnder((secId) => (secId === sid ? newSlot : assignments[secId]!), st)
      d += (after ? 1 : 0) - (before ? 1 : 0)
    }
    return d
  }

  function deltaStudentsSwap(sid1: string, sid2: string): number {
    const A = assignments[sid1]!
    const B = assignments[sid2]!
    const affected = new Set<string>()
    for (const st of sectionToStudents.get(sid1) ?? []) affected.add(st)
    for (const st of sectionToStudents.get(sid2) ?? []) affected.add(st)
    let d = 0
    for (const st of affected) {
      const before = studentClashUnder((secId) => assignments[secId]!, st)
      const after = studentClashUnder(
        (secId) => (secId === sid1 ? B : secId === sid2 ? A : assignments[secId]!),
        st,
      )
      d += (after ? 1 : 0) - (before ? 1 : 0)
    }
    return d
  }

  function deltaStudentsKempe(component: string[], c1: number, c2: number): number {
    const inComp = new Set(component)
    const affected = new Set<string>()
    for (const sec of component) {
      for (const st of sectionToStudents.get(sec) ?? []) affected.add(st)
    }
    let d = 0
    for (const st of affected) {
      const before = studentClashUnder((secId) => assignments[secId]!, st)
      const after = studentClashUnder((secId) => {
        const s = assignments[secId]!
        return inComp.has(secId) ? (s === c1 ? c2 : c1) : s
      }, st)
      d += (after ? 1 : 0) - (before ? 1 : 0)
    }
    return d
  }

  function registerTabuMoveTo(sid: string, fromSlot: number, iter: number, tenure: number): void {
    tabuUntil.set(tabuAttrKey(sid, fromSlot), iter + tenure)
  }

  for (let iter = 0; iter < maxIter; iter++) {
    if (iter > 0 && iter % coolPeriod === 0) temperature *= 0.992

    const tenure = baseTenure + (iter % 5)
    const roll = Math.random()
    const canAccept = (dS: number, dE: number, tabuBlocked: boolean): boolean => {
      const newS = studentClash + dS
      const newE = totalClash + dE
      if (newS < globalBestStudents || (newS === globalBestStudents && newE < globalBestEdges)) {
        return true
      }
      if (tabuBlocked) return false
      const deltaF = dS * LEX_W + dE
      if (deltaF <= 0) return true
      return Math.random() < Math.exp(-deltaF / temperature)
    }

    if (roll < 0.5) {
      const sid = sectionIds[Math.floor(Math.random() * n)]!
      const maxS = maxSlotForSection(sid, mathSections)
      const newSlot = Math.floor(Math.random() * maxS)
      if (!feasibleSingleMove(sid, newSlot)) continue
      const oldSlot = assignments[sid]!
      const dE = clashDeltaSingleMove(sid, oldSlot, newSlot)
      const dS = deltaStudentsSingleMove(sid, newSlot)
      const tabuBlocked = isTabu(sid, newSlot, iter)
      if (!canAccept(dS, dE, tabuBlocked)) continue
      applySingleMove(sid, newSlot)
      totalClash += dE
      studentClash += dS
      registerTabuMoveTo(sid, oldSlot, iter, tenure)
    } else if (roll < 0.82) {
      const sid1 = sectionIds[Math.floor(Math.random() * n)]!
      const sid2 = sectionIds[Math.floor(Math.random() * n)]!
      if (sid1 === sid2) continue
      const dE = clashDeltaSwap(sid1, sid2)
      if (dE === null) continue
      const slot1 = assignments[sid1]!
      const slot2 = assignments[sid2]!
      if (slot1 === slot2) continue
      const dS = deltaStudentsSwap(sid1, sid2)
      const tabuBlocked = isTabu(sid1, slot2, iter) || isTabu(sid2, slot1, iter)
      if (!canAccept(dS, dE, tabuBlocked)) continue
      applySwap(sid1, sid2)
      totalClash += dE
      studentClash += dS
      registerTabuMoveTo(sid1, slot1, iter, tenure)
      registerTabuMoveTo(sid2, slot2, iter, tenure)
    } else {
      const startSid = sectionIds[Math.floor(Math.random() * n)]!
      const c1 = assignments[startSid]!
      const maxS = maxSlotForSection(startSid, mathSections)
      let c2 = Math.floor(Math.random() * maxS)
      if (c2 === c1) c2 = (c2 + 1) % maxS
      const comp = buildKempeComponent(startSid, c1, c2)
      if (!comp || comp.length < 2) continue
      const { delta: dE, ok } = kempeDeltaAndFeasible(comp, c1, c2)
      if (!ok) continue
      const dS = deltaStudentsKempe(comp, c1, c2)
      let tabuBlocked = false
      for (const sid of comp) {
        const to = assignments[sid] === c1 ? c2 : c1
        if (isTabu(sid, to, iter)) {
          tabuBlocked = true
          break
        }
      }
      if (!canAccept(dS, dE, tabuBlocked)) continue
      for (const sid of comp) {
        const from = assignments[sid]!
        registerTabuMoveTo(sid, from, iter, tenure)
      }
      applyKempe(comp, c1, c2)
      totalClash += dE
      studentClash += dS
    }

    if (
      studentClash < globalBestStudents ||
      (studentClash === globalBestStudents && totalClash < globalBestEdges)
    ) {
      globalBestStudents = studentClash
      globalBestEdges = totalClash
      for (const sid of sectionIds) globalBestAssign[sid] = assignments[sid]!
      iterSinceGlobalBest = 0
      if (globalBestStudents === 0 && globalBestEdges === 0) break
    } else {
      iterSinceGlobalBest++
      if (iterSinceGlobalBest >= stagnationReheat) {
        temperature = Math.min(t0 * 1.5, temperature * 1.35)
        iterSinceGlobalBest = 0
      }
    }
  }

  return globalBestAssign
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
    if (randomize) score += (Math.random() - 0.5) * (cw * 50 + 200)
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

    const FACULTY_VIOL = 1_000_000_000
    const CAP_VIOL = 10_000_000

    let bestSlot = 0
    let bestScore = Number.POSITIVE_INFINITY
    for (let slot = 0; slot < maxSlot; slot++) {
      let violation = 0
      if (faculty && facultySlots.get(faculty)?.has(slot)) violation += FACULTY_VIOL
      if (slotLoads[slot]! >= parallelCap) {
        violation += CAP_VIOL * (slotLoads[slot]! - parallelCap + 1)
      }

      let conflictCost = 0
      for (const [otherSid, assignedSlot] of Object.entries(assignments)) {
        if (assignedSlot === slot) {
          const w = adj.get(sid)?.get(otherSid)
          if (w) conflictCost += w
        }
      }
      const loadPenalty = Math.max(0, slotLoads[slot]! - targetLoad) * LOAD_BALANCE_FACTOR
      let score = violation + conflictCost + loadPenalty
      if (randomize) score += Math.random() * (conflictCost > 0 ? conflictCost * 0.5 + 2 : 2)
      if (score < bestScore) {
        bestScore = score
        bestSlot = slot
      }
    }

    assignments[sid] = bestSlot
    slotLoads[bestSlot] = (slotLoads[bestSlot] ?? 0) + 1
    if (faculty) {
      if (!facultySlots.has(faculty)) facultySlots.set(faculty, new Set())
      facultySlots.get(faculty)!.add(bestSlot)
    }
  }

  const improved = hybridSATabuImprove(
    { ...assignments },
    sections,
    conflictGraph,
    adj,
    facultyConstraints,
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

function solveGreedyMultiStart(
  sections: Section[],
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  parallelCap: number,
  onProgress?: (msg: string) => void,
): { assignments: Record<string, number>; clashWeight: number } {
  const { studentToSections } = buildEnrollmentIndex(sections)
  const runCount = multiStartRunCount(sections.length)
  const poolSize = solutionPoolSize(runCount)

  const runs: { assignments: Record<string, number>; clashWeight: number; students: number }[] = []

  if (onProgress) {
    onProgress(`Phase 1/2: Exploring ${runCount} different random configurations…`)
  }

  const progressStep = Math.max(1, Math.floor(runCount / 8))
  for (let i = 0; i < runCount; i++) {
    if (i % progressStep === 0 && i > 0 && onProgress) {
      onProgress(`Phase 1/2: Generated ${i}/${runCount} initial seeds…`)
    }
    const r = solveGreedy(sections, conflictGraph, facultyConstraints, parallelCap, i > 0)
    const students = countStudentsWithSlotClashes(studentToSections, r.assignments)
    runs.push({ assignments: { ...r.assignments }, clashWeight: r.clashWeight, students })
  }
  runs.sort((a, b) => a.students - b.students || a.clashWeight - b.clashWeight)
  let best = runs[0] ?? { assignments: {}, clashWeight: 0, students: 0 }

  const { adj } = analyzeConflicts(sections, conflictGraph)
  const mathSections = new Set(
    sections.filter((s) => isMathCourse(s.course_code)).map((s) => s.section_id),
  )

  const pool = Math.min(poolSize, runs.length)
  if (onProgress) {
    onProgress(`Phase 2/2: Refining top ${pool} candidate schedules (best: ${best.students} students / ${best.clashWeight} weight)…`)
  }

  for (let p = 1; p < pool; p++) {
    if (onProgress) {
      onProgress(`Phase 2/2: Refining candidate ${p}/${pool}…`)
    }
    const seed = runs[p]
    if (!seed) continue
    const refined = hybridSATabuImprove(
      { ...seed.assignments },
      sections,
      conflictGraph,
      adj,
      facultyConstraints,
      parallelCap,
      mathSections,
      { maxIterFactor: 2.0 },
    )
    const cw = computeClashWeight(conflictGraph, refined)
    const st = countStudentsWithSlotClashes(studentToSections, refined)
    if (st < best.students || (st === best.students && cw < best.clashWeight)) {
      best = { assignments: refined, clashWeight: cw, students: st }
    }
  }

  if (onProgress) {
    onProgress(`Done: ${best.students} students with overlaps, clash weight ${best.clashWeight}.`)
  }
  return { assignments: best.assignments, clashWeight: best.clashWeight }
}

export function runScheduler(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  onProgress?: (msg: string) => void,
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
    onProgress
  )
  return {
    slot_assignments: assignments,
    solver_used: 'hybrid-sa-tabu',
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

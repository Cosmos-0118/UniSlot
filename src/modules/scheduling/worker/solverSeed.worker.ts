/// <reference lib="webworker" />

import { PipelineCancelledError } from './cancellation'
import {
  unpackCourseAdj,
  unpackSectionCounts,
  type SolverPoolProblem,
  type SolverSeedRequest,
  type SolverSeedResponse,
} from './solverPoolTypes'

let problem: SolverPoolProblem | null = null
let aborted = false

self.onmessage = (ev: MessageEvent<SolverSeedRequest>) => {
  const msg = ev.data

  if (msg.type === 'cancel') {
    aborted = true
    return
  }

  if (msg.type === 'init') {
    problem = msg.problem
    aborted = false
    return
  }

  aborted = false
  const jobId = msg.jobId

  void (async () => {
    try {
      if (!problem) throw new Error('Solver seed worker not initialized')
      const { runPhase1SeedTask, runPhase2RefineTask, perturbEliteSlots } = await import('../solver/localSearchSolver')
      const { createRng } = await import('../solver/rng')
      const courseAdj = unpackCourseAdj(problem.courseAdj)
      const sectionCountByCourse = unpackSectionCounts(problem.sectionCountByCourse)
      const shouldAbort = () => aborted

      if (msg.type === 'seed') {
        const r = runPhase1SeedTask(
          problem.courseCodes,
          problem.sections,
          problem.conflictGraph,
          courseAdj,
          sectionCountByCourse,
          problem.conflictDensity,
          problem.parallelCap,
          msg.seedIndex,
          msg.baseSeed,
          shouldAbort,
          msg.effort ?? problem.effort ?? 'balanced',
        )
        if (aborted) {
          const out: SolverSeedResponse = { type: 'cancelled', jobId }
          self.postMessage(out)
          return
        }
        const out: SolverSeedResponse = {
          type: 'seedResult',
          jobId,
          seedIndex: r.seedIndex,
          slotByCourse: r.slotByCourse,
          clashWeight: r.clashWeight,
          students: r.students,
        }
        self.postMessage(out)
        return
      }

      if (msg.type === 'refine') {
        const r = runPhase2RefineTask(
          msg.slotByCourse,
          problem.courseCodes,
          problem.sections,
          problem.conflictGraph,
          courseAdj,
          sectionCountByCourse,
          problem.parallelCap,
          msg.refineIndex,
          msg.baseSeed,
          msg.maxIterFactor,
          shouldAbort,
          msg.effort ?? problem.effort ?? 'balanced',
        )
        if (aborted) {
          const out: SolverSeedResponse = { type: 'cancelled', jobId }
          self.postMessage(out)
          return
        }
        const out: SolverSeedResponse = {
          type: 'refineResult',
          jobId,
          refineIndex: r.seedIndex,
          slotByCourse: r.slotByCourse,
          clashWeight: r.clashWeight,
          students: r.students,
        }
        self.postMessage(out)
        return
      }

      if (msg.type === 'eliteRestart') {
        const sectionToCourse = new Map<string, string>()
        for (const sec of problem.sections) sectionToCourse.set(sec.section_id, sec.course_code)
        
        const perturbRng = createRng(
          msg.baseSeed === undefined ? undefined : (msg.baseSeed + 20_000 + msg.round * 100 + msg.eliteIndex) >>> 0,
        )
        const kicked = perturbEliteSlots(
          msg.slotByCourse,
          problem.courseCodes,
          problem.conflictGraph,
          courseAdj,
          sectionToCourse,
          perturbRng,
          Math.floor(3 + 3 * Math.log2(msg.round + 1)), // graduated kick strength
          msg.partnerSlotByCourse,
        )
        const r = runPhase2RefineTask(
          kicked,
          problem.courseCodes,
          problem.sections,
          problem.conflictGraph,
          courseAdj,
          sectionCountByCourse,
          problem.parallelCap,
          1000 + msg.round * 50 + msg.eliteIndex,
          msg.baseSeed,
          msg.maxIterFactor * 1.1,
          shouldAbort,
          msg.effort ?? problem.effort ?? 'balanced',
        )
        if (aborted) {
          const out: SolverSeedResponse = { type: 'cancelled', jobId }
          self.postMessage(out)
          return
        }
        const out: SolverSeedResponse = {
          type: 'eliteResult',
          jobId,
          round: msg.round,
          eliteIndex: msg.eliteIndex,
          slotByCourse: r.slotByCourse,
          clashWeight: r.clashWeight,
          students: r.students,
        }
        self.postMessage(out)
      }
    } catch (e) {
      if (e instanceof PipelineCancelledError || aborted) {
        const out: SolverSeedResponse = { type: 'cancelled', jobId }
        self.postMessage(out)
        return
      }
      const out: SolverSeedResponse = {
        type: 'error',
        jobId,
        message: e instanceof Error ? e.message : String(e),
      }
      self.postMessage(out)
    }
  })()
}

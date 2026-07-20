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
      const { runPhase1SeedTask, runPhase2RefineTask } = await import('../solver/localSearchSolver')
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

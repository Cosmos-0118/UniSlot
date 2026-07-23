import { PipelineCancelledError } from './cancellation'
import {
  packCourseAdj,
  type SolverPoolProblem,
  type SolverSeedRequest,
  type SolverSeedResponse,
} from './solverPoolTypes'
import type { ConflictGraph, Section } from '../types'
import type {
  SchedulerProgressEvent,
  SchedulerRunOptions,
  SchedulerRunResult,
  SeedRunResult,
} from '../solver/localSearchSolver'
import { buildAdjacency } from '../solver/conflictGraph'
import { TOTAL_WEEKLY_SLOTS } from '../solver/timeModel'

function createSeedWorker(): Worker {
  return new Worker(new URL('./solverSeed.worker.ts', import.meta.url), { type: 'module' })
}

function formatEtaSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '…'
  if (sec < 120) return `~${Math.max(1, Math.round(sec))}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `~${m}m ${s}s`
}

type PoolWorker = {
  worker: Worker
  busy: boolean
}

/**
 * Fan out seed/refine jobs across nested workers. Results are collected by job
 * index (not completion order) then reduced for determinism.
 */
export async function runSchedulerWithPool(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  onProgress: ((evt: SchedulerProgressEvent) => void) | undefined,
  options: SchedulerRunOptions & { poolWorkers: number },
): Promise<SchedulerRunResult> {
  const {
    buildCourseAdjacencyForPool,
    reduceSeedRuns,
    localSearchSeedPlan,
    parallelHardCap,
    finalizeSchedulerBest,
  } = await import('../solver/localSearchSolver')
  const { resolveEffort } = await import('../solver/effort')
  const { createRng } = await import('../solver/rng')

  const effortLevel = options.effort ?? 'balanced'
  const effort = resolveEffort(effortLevel)
  const t0 = performance.now() / 1000
  const sections = Object.values(courseSections).flat()
  const courseCodes = Object.keys(courseSections)
  const sectionToCourse = new Map<string, string>()
  const sectionCountByCourse = new Map<string, number>()
  for (const c of courseCodes) {
    const arr = courseSections[c]!
    sectionCountByCourse.set(c, arr.length)
    for (const s of arr) sectionToCourse.set(s.section_id, c)
  }

  const courseAdj = buildCourseAdjacencyForPool(conflictGraph, sectionToCourse)
  const { conflictDensity } = buildAdjacency(conflictGraph)
  const parallelCap = parallelHardCap(sections.length)
  const plan = localSearchSeedPlan(courseCodes.length, options.poolWorkers, effortLevel)
  const { runCount, poolSize, phase2IterFactor: maxIterFactor } = plan
  const shouldAbort = options.shouldAbort
  const baseSeed = options.randomSeed

  const problem: SolverPoolProblem = {
    courseCodes,
    sections,
    conflictGraph,
    courseAdj: packCourseAdj(courseAdj),
    sectionCountByCourse: [...sectionCountByCourse.entries()],
    conflictDensity,
    parallelCap,
    effort: effortLevel,
  }

  const workerCount = Math.min(options.poolWorkers, Math.max(1, runCount))
  const pool: PoolWorker[] = []
  for (let i = 0; i < workerCount; i++) {
    const worker = createSeedWorker()
    worker.postMessage({ type: 'init', problem } satisfies SolverSeedRequest)
    pool.push({ worker, busy: false })
  }

  const cancelAll = () => {
    for (const p of pool) {
      p.worker.postMessage({ type: 'cancel' } satisfies SolverSeedRequest)
    }
  }

  const push = (evt: SchedulerProgressEvent) => onProgress?.(evt)

  try {
    push({
      message: `Phase 1/2: ${runCount} seeds (${effortLevel}) across ${workerCount} workers (${TOTAL_WEEKLY_SLOTS} weekday sessions/week)`,
      etaSeconds: null,
      solverFraction: 0,
    })

    if (shouldAbort?.()) throw new PipelineCancelledError()

    const tPhase1 = performance.now()
    const seedResults = await mapPoolJobs<SeedRunResult>({
      pool,
      jobCount: runCount,
      shouldAbort,
      cancelAll,
      dispatch: (worker, jobId, index) => {
        worker.postMessage({
          type: 'seed',
          jobId,
          seedIndex: index,
          baseSeed,
          effort: effortLevel,
        } satisfies SolverSeedRequest)
      },
      match: (data, jobId) => {
        if (data.type === 'seedResult' && data.jobId === jobId) {
          return {
            seedIndex: data.seedIndex,
            slotByCourse: data.slotByCourse,
            clashWeight: data.clashWeight,
            students: data.students,
          }
        }
        if (data.type === 'error' && data.jobId === jobId) throw new Error(data.message)
        if (data.type === 'cancelled' && data.jobId === jobId) throw new PipelineCancelledError()
        return null
      },
      onProgressUnit: (done) => {
        const elapsed = (performance.now() - tPhase1) / 1000
        const etaSeconds = done >= 2 ? (elapsed / done) * (runCount - done) : null
        const progressStep = Math.max(1, Math.floor(runCount / 10))
        if (done === 1 || done === runCount || done % progressStep === 0) {
          push({
            message: `Phase 1/2: ${done}/${runCount} seeds · ${elapsed.toFixed(1)}s elapsed${
              etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0.5
                ? ` · ETA ${formatEtaSeconds(etaSeconds)}`
                : ''
            }`,
            etaSeconds:
              etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0.5
                ? etaSeconds
                : null,
            solverFraction: 0.55 * (done / runCount),
          })
        }
      },
    })

    const ranked = reduceSeedRuns(seedResults)
    let best = ranked[0]!
    const poolN = Math.min(poolSize, ranked.length)
    const refinementSteps = Math.max(1, poolN - 1)

    if (poolN <= 1) {
      push({
        message: `Phase 2/2 skipped (single seed). Best: ${best.students} overlaps · weight ${best.clashWeight}.`,
        etaSeconds: null,
        solverFraction: 0.92,
      })
    } else {
      push({
        message: `Phase 2/2: refine ${refinementSteps} candidates across ${workerCount} workers (factor ${maxIterFactor})`,
        etaSeconds: null,
        solverFraction: 0.55,
      })

      const refineIndices = Array.from({ length: refinementSteps }, (_, i) => i + 1)
      const tPhase2 = performance.now()
      const refined = await mapPoolJobs<SeedRunResult>({
        pool,
        jobCount: refineIndices.length,
        shouldAbort,
        cancelAll,
        dispatch: (worker, jobId, index) => {
          const p = refineIndices[index]!
          const seed = ranked[p]!
          worker.postMessage({
            type: 'refine',
            jobId,
            refineIndex: p,
            slotByCourse: seed.slotByCourse,
            baseSeed,
            maxIterFactor,
            effort: effortLevel,
          } satisfies SolverSeedRequest)
        },
        match: (data, jobId) => {
          if (data.type === 'refineResult' && data.jobId === jobId) {
            return {
              seedIndex: data.refineIndex,
              slotByCourse: data.slotByCourse,
              clashWeight: data.clashWeight,
              students: data.students,
            }
          }
          if (data.type === 'error' && data.jobId === jobId) throw new Error(data.message)
          if (data.type === 'cancelled' && data.jobId === jobId) throw new PipelineCancelledError()
          return null
        },
        onProgressUnit: (done) => {
          const elapsed = (performance.now() - tPhase2) / 1000
          const etaSeconds = done >= 1 ? (elapsed / done) * (refinementSteps - done) : null
          push({
            message: `Phase 2/2: refine ${done}/${refinementSteps} · ${elapsed.toFixed(1)}s${
              etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0.5
                ? ` · ETA ${formatEtaSeconds(etaSeconds)}`
                : ''
            }`,
            etaSeconds:
              etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0.5
                ? etaSeconds
                : null,
            solverFraction: 0.55 + 0.44 * (done / refinementSteps),
          })
        },
      })

      for (const r of refined) {
        if (
          r.students < best.students ||
          (r.students === best.students && r.clashWeight < best.clashWeight)
        ) {
          best = r
        }
      }
    }

    // Elite restart diversification on coordinator (balanced/max).
    if (effort.eliteRestartRounds > 0 && best.students > 0) {
      const elites = ranked.slice(0, Math.min(6, ranked.length))
      let stagnant = 0
      for (let round = 0; round < effort.eliteRestartRounds; round++) {
        if (shouldAbort?.()) throw new PipelineCancelledError()
        if (best.students === 0 && best.clashWeight === 0) break
        push({
          message: `Elite restart ${round + 1}/${effort.eliteRestartRounds} (best ${best.students} RED · weight ${best.clashWeight})`,
          etaSeconds: null,
          solverFraction: 0.9 + 0.05 * (round / effort.eliteRestartRounds),
        })
        const eliteResults = await mapPoolJobs<SeedRunResult>({
          pool,
          jobCount: elites.length,
          shouldAbort,
          cancelAll,
          dispatch: (worker, jobId, index) => {
            const elite = elites[index]!
            const perturbRng = createRng(
              baseSeed === undefined ? undefined : (baseSeed + 20_000 + round * 100 + index) >>> 0,
            )
            const partnerElite = elites[Math.floor(perturbRng() * elites.length)]!
            worker.postMessage({
              type: 'eliteRestart',
              jobId,
              round,
              eliteIndex: index,
              slotByCourse: elite.slotByCourse,
              partnerSlotByCourse: partnerElite.slotByCourse,
              baseSeed,
              maxIterFactor: maxIterFactor * 1.1,
              effort: effortLevel,
            } satisfies SolverSeedRequest)
          },
          match: (data, jobId) => {
            if (data.type === 'eliteResult' && data.jobId === jobId) {
              return {
                seedIndex: data.eliteIndex,
                slotByCourse: data.slotByCourse,
                clashWeight: data.clashWeight,
                students: data.students,
              }
            }
            if (data.type === 'error' && data.jobId === jobId) throw new Error(data.message)
            if (data.type === 'cancelled' && data.jobId === jobId) throw new PipelineCancelledError()
            return null
          },
          onProgressUnit: () => {},
        })

        let improved = false
        for (const refined of eliteResults) {
          if (
            refined.students < best.students ||
            (refined.students === best.students && refined.clashWeight < best.clashWeight)
          ) {
            best = refined
            improved = true
          }
        }
        if (!improved) {
          stagnant++
          if (stagnant >= effort.eliteStagnationStop) break
        } else {
          stagnant = 0
        }
      }
    }

    return finalizeSchedulerBest(
      courseSections,
      conflictGraph,
      facultyConstraints,
      best,
      {
        randomSeed: baseSeed,
        onProgress,
        solverUsed: `weekday-sa-tabu-pool-${effortLevel}`,
        elapsedAlreadySeconds: performance.now() / 1000 - t0,
      },
    )
  } finally {
    for (const p of pool) p.worker.terminate()
  }
}

async function mapPoolJobs<T>(args: {
  pool: PoolWorker[]
  jobCount: number
  shouldAbort?: () => boolean
  cancelAll: () => void
  dispatch: (worker: Worker, jobId: number, index: number) => void
  match: (data: SolverSeedResponse, jobId: number) => T | null
  onProgressUnit: (done: number) => void
}): Promise<T[]> {
  const { pool, jobCount, shouldAbort, cancelAll, dispatch, match, onProgressUnit } = args
  const results: (T | undefined)[] = new Array(jobCount)
  let nextIndex = 0
  let completed = 0
  let jobSeq = 1

  return new Promise<T[]>((resolve, reject) => {
    let settled = false
    const fail = (e: unknown) => {
      if (settled) return
      settled = true
      cancelAll()
      reject(e)
    }
    const succeed = () => {
      if (settled) return
      settled = true
      resolve(results as T[])
    }

    const pump = () => {
      if (settled) return
      if (shouldAbort?.()) {
        fail(new PipelineCancelledError())
        return
      }
      for (const slot of pool) {
        if (slot.busy) continue
        if (nextIndex >= jobCount) break
        const index = nextIndex++
        const jobId = jobSeq++
        slot.busy = true

        const onMessage = (ev: MessageEvent<SolverSeedResponse>) => {
          try {
            const hit = match(ev.data, jobId)
            if (hit == null) return
            slot.worker.removeEventListener('message', onMessage)
            slot.busy = false
            results[index] = hit
            completed++
            onProgressUnit(completed)
            if (completed === jobCount) succeed()
            else pump()
          } catch (e) {
            slot.worker.removeEventListener('message', onMessage)
            slot.busy = false
            fail(e)
          }
        }
        slot.worker.addEventListener('message', onMessage)
        try {
          dispatch(slot.worker, jobId, index)
        } catch (e) {
          slot.worker.removeEventListener('message', onMessage)
          slot.busy = false
          fail(e)
        }
      }
    }

    if (jobCount === 0) {
      succeed()
      return
    }
    pump()
  })
}

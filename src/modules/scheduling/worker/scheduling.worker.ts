/// <reference lib="webworker" />

import { PipelineCancelledError } from './cancellation'
import { slimClashReportForTransfer } from './clashReportTransfer'
import { createProgressThrottle } from './progressThrottle'
import type { PipelineProgressEvent, RunPipelineOptions } from '../pipeline/run'
import { buildPipelineExportBuffer, type PipelineExportKind } from '../pipeline/exports'
import { slimScheduleForTransfer } from './scheduleTransfer'
import {
  beginWorkerRun,
  cancelWorkerRun,
  endWorkerRun,
  getWorkerRunArtifacts,
  getWorkerRunSnapshot,
  isWorkerRunActive,
  patchWorkerRunArtifacts,
  setWorkerRunArtifacts,
  setWorkerRunSnapshot,
} from './runState'

export type WorkerRequest =
  | { type: 'warmup'; id: number; includeSolver?: boolean }
  | ({ type: 'run'; id: number; buffer: ArrayBuffer } & RunPipelineOptions)
  | { type: 'cancel'; id: number }
  | { type: 'export'; id: number; kind: PipelineExportKind }
  | { type: 'getSnapshot'; id: number }
  | { type: 'getScheduleEntries'; id: number }
  | {
      type: 'syncArtifacts'
      schedule?: import('../types').Schedule | null
      snapshot?: import('../merge/snapshot').SchedulingSnapshot | null
    }

export type WorkerResponse =
  | ({ type: 'progress'; id: number } & PipelineProgressEvent)
  | {
      type: 'result'
      id: number
      validation: import('../types').ValidationResult
      schedule: import('../types').Schedule | null
      clashReport: import('../types').ClashReport | null
      scheduleXlsx: ArrayBuffer | null
      clashXlsx: ArrayBuffer | null
      courseEmailsXlsx: ArrayBuffer | null
      courseEmailsData: import('../types').CourseEmailGroup[] | null
      stats: {
        studentCount: number
        courseCount: number
        sectionCount: number
        scheduling: import('../solver/metrics').SchedulingStats | null
      } | null
      schedule_export_blocked?: boolean
      schedule_export_block_reason?: string | null
      /** Deferred — fetch via `getSnapshot` when saving or editing faculty. */
      hasDeferredSnapshot: boolean
      /** Deferred — fetch via `getScheduleEntries` for timetable preview. */
      hasDeferredScheduleEntries: boolean
    }
  | { type: 'snapshot'; id: number; snapshot: import('../merge/snapshot').SchedulingSnapshot }
  | {
      type: 'scheduleEntries'
      id: number
      entries: import('../types').ScheduleEntry[]
    }
  | { type: 'exportResult'; id: number; kind: PipelineExportKind; buffer: ArrayBuffer }
  | { type: 'cancelled'; id: number }
  | { type: 'warmed'; id: number }
  | { type: 'error'; id: number; message: string }

let warmupPromise: Promise<void> | null = null

function warmupWorkerModules(includeSolver: boolean): Promise<void> {
  if (!warmupPromise) {
    warmupPromise = (async () => {
      await import('../pipeline/run')
      if (includeSolver) {
        await import('../solver/scheduler')
      }
    })()
  }
  return warmupPromise
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data

  if (msg.type === 'warmup') {
    void (async () => {
      try {
        await warmupWorkerModules(msg.includeSolver === true)
        const out: WorkerResponse = { type: 'warmed', id: msg.id }
        self.postMessage(out)
      } catch (e) {
        const err: WorkerResponse = {
          type: 'error',
          id: msg.id,
          message: e instanceof Error ? e.message : String(e),
        }
        self.postMessage(err)
      }
    })()
    return
  }

  if (msg.type === 'cancel') {
    if (cancelWorkerRun(msg.id)) {
      const cancelled: WorkerResponse = { type: 'cancelled', id: msg.id }
      self.postMessage(cancelled)
    }
    return
  }

  if (msg.type === 'getSnapshot') {
    const snapshot = getWorkerRunSnapshot()
    if (!snapshot) {
      const err: WorkerResponse = {
        type: 'error',
        id: msg.id,
        message: 'No scheduling snapshot is cached. Run the scheduler first.',
      }
      self.postMessage(err)
      return
    }
    const out: WorkerResponse = { type: 'snapshot', id: msg.id, snapshot }
    self.postMessage(out)
    return
  }

  if (msg.type === 'getScheduleEntries') {
    const entries = getWorkerRunArtifacts()?.schedule?.entries
    if (!entries?.length) {
      const err: WorkerResponse = {
        type: 'error',
        id: msg.id,
        message: 'Timetable rows are not available for this run.',
      }
      self.postMessage(err)
      return
    }
    const out: WorkerResponse = { type: 'scheduleEntries', id: msg.id, entries }
    self.postMessage(out)
    return
  }

  if (msg.type === 'syncArtifacts') {
    if (msg.schedule) {
      patchWorkerRunArtifacts({ schedule: msg.schedule })
    }
    if (msg.snapshot) {
      setWorkerRunSnapshot(msg.snapshot)
      patchWorkerRunArtifacts({ enrollmentRows: msg.snapshot.enrollmentRows })
    }
    return
  }

  if (msg.type === 'export') {
    void (async () => {
      try {
        const artifacts = getWorkerRunArtifacts()
        if (!artifacts) {
          throw new Error('No completed run is available for export. Run the scheduler first.')
        }
        const buffer = await buildPipelineExportBuffer(msg.kind, {
          ...artifacts,
          snapshot: getWorkerRunSnapshot(),
        })
        const out: WorkerResponse = { type: 'exportResult', id: msg.id, kind: msg.kind, buffer }
        self.postMessage(out, [buffer])
      } catch (e) {
        const err: WorkerResponse = {
          type: 'error',
          id: msg.id,
          message: e instanceof Error ? e.message : String(e),
        }
        self.postMessage(err)
      }
    })()
    return
  }

  if (msg.type !== 'run') return

  const { id, buffer, randomSeed, allowProvisionalScheduleExport, eagerExports, eagerExportKinds, effort } = msg
  const signal = beginWorkerRun(id)

  void (async () => {
    try {
      const { runPipeline } = await import('../pipeline/run')
      const emitProgress = createProgressThrottle((event) => {
        if (!isWorkerRunActive(id)) return
        const r: WorkerResponse = { type: 'progress', id, ...event }
        self.postMessage(r)
      })

      const result = await runPipeline(buffer, emitProgress, {
        randomSeed,
        allowProvisionalScheduleExport,
        eagerExports,
        eagerExportKinds,
        effort,
        signal,
      })

      if (!isWorkerRunActive(id)) return

      if (result.schedulingSnapshot) {
        setWorkerRunSnapshot(result.schedulingSnapshot)
      }

      if (result.schedule && result.clashReport) {
        setWorkerRunArtifacts({
          schedule: result.schedule,
          clashReport: result.clashReport,
          enrollmentRows: result.schedulingSnapshot?.enrollmentRows ?? null,
          allowScheduleXlsx: result.schedule_export_blocked !== true,
        })
      }

      const clashForUi = result.clashReport ? slimClashReportForTransfer(result.clashReport) : null
      const scheduleForUi = result.schedule ? slimScheduleForTransfer(result.schedule) : null

      const out: WorkerResponse = {
        type: 'result',
        id,
        validation: result.validation,
        schedule: scheduleForUi,
        clashReport: clashForUi,
        scheduleXlsx: result.scheduleXlsx,
        clashXlsx: result.clashXlsx,
        courseEmailsXlsx: result.courseEmailsXlsx,
        courseEmailsData: result.courseEmailsData,
        stats: result.stats,
        schedule_export_blocked: result.schedule_export_blocked,
        schedule_export_block_reason: result.schedule_export_block_reason,
        hasDeferredSnapshot: result.schedulingSnapshot != null,
        hasDeferredScheduleEntries: (result.schedule?.entries.length ?? 0) > 0,
      }
      const transfer: Transferable[] = []
      if (result.scheduleXlsx) transfer.push(result.scheduleXlsx)
      if (result.clashXlsx) transfer.push(result.clashXlsx)
      if (result.courseEmailsXlsx) transfer.push(result.courseEmailsXlsx)
      self.postMessage(out, transfer)
    } catch (e) {
      if (e instanceof PipelineCancelledError) {
        if (isWorkerRunActive(id)) {
          const cancelled: WorkerResponse = { type: 'cancelled', id }
          self.postMessage(cancelled)
        }
        return
      }
      if (!isWorkerRunActive(id)) return
      const err: WorkerResponse = {
        type: 'error',
        id,
        message: e instanceof Error ? e.message : String(e),
      }
      self.postMessage(err)
    } finally {
      endWorkerRun(id)
    }
  })()
}

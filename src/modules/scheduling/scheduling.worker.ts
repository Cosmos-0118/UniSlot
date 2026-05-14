/// <reference lib="webworker" />

import { runPipeline } from './pipeline'
import type { RunPipelineOptions } from './pipeline'

export type WorkerRequest = { type: 'run'; id: number; buffer: ArrayBuffer } & RunPipelineOptions

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; message: string }
  | {
      type: 'result'
      id: number
      validation: import('./types').ValidationResult
      schedule: import('./types').Schedule | null
      clashReport: import('./types').ClashReport | null
      scheduleXlsx: ArrayBuffer | null
      clashXlsx: ArrayBuffer | null
      courseEmailsXlsx: ArrayBuffer | null
      courseEmailsData: import('./types').CourseEmailGroup[] | null
      stats: {
        studentCount: number
        courseCount: number
        sectionCount: number
        scheduling: import('./engines/metrics').SchedulingStats | null
      } | null
      schedule_export_blocked?: boolean
      schedule_export_block_reason?: string | null
    }
  | { type: 'error'; id: number; message: string }

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  if (msg.type !== 'run') return
  const { id, buffer, randomSeed, allowProvisionalScheduleExport } = msg

  void (async () => {
    try {
      const result = await runPipeline(buffer, (stage, message) => {
        const r: WorkerResponse = { type: 'progress', id, stage, message }
        self.postMessage(r)
      }, { randomSeed, allowProvisionalScheduleExport })
      const out: WorkerResponse = {
        type: 'result',
        id,
        validation: result.validation,
        schedule: result.schedule,
        clashReport: result.clashReport,
        scheduleXlsx: result.scheduleXlsx,
        clashXlsx: result.clashXlsx,
        courseEmailsXlsx: result.courseEmailsXlsx,
        courseEmailsData: result.courseEmailsData,
        stats: result.stats,
        schedule_export_blocked: result.schedule_export_blocked,
        schedule_export_block_reason: result.schedule_export_block_reason,
      }
      const transfer: Transferable[] = []
      if (result.scheduleXlsx) transfer.push(result.scheduleXlsx)
      if (result.clashXlsx) transfer.push(result.clashXlsx)
      if (result.courseEmailsXlsx) transfer.push(result.courseEmailsXlsx)
      self.postMessage(out, transfer)
    } catch (e) {
      const err: WorkerResponse = {
        type: 'error',
        id,
        message: e instanceof Error ? e.message : String(e),
      }
      self.postMessage(err)
    }
  })()
}

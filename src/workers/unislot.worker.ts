/// <reference lib="webworker" />

import { runPipeline } from '../lib/unislot/pipeline'

export type WorkerRequest = { type: 'run'; id: number; buffer: ArrayBuffer }

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; message: string }
  | {
      type: 'result'
      id: number
      validation: import('../lib/unislot/types').ValidationResult
      schedule: import('../lib/unislot/types').Schedule | null
      clashReport: import('../lib/unislot/types').ClashReport | null
      scheduleXlsx: ArrayBuffer | null
      clashXlsx: ArrayBuffer | null
      courseEmailsXlsx: ArrayBuffer | null
      courseEmailsData: import('../lib/unislot/types').CourseEmailGroup[] | null
      stats: {
        studentCount: number
        courseCount: number
        sectionCount: number
        scheduling: import('../lib/unislot/engines/metrics').SchedulingStats | null
      } | null
    }
  | { type: 'error'; id: number; message: string }

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  if (msg.type !== 'run') return
  const { id, buffer } = msg

  void (async () => {
    try {
      const result = await runPipeline(buffer, (stage, message) => {
        const r: WorkerResponse = { type: 'progress', id, stage, message }
        self.postMessage(r)
      })
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

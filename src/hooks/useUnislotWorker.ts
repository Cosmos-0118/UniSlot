import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClashReport, Schedule, ValidationResult } from '../lib/unislot/types'
import type { SchedulingStats } from '../lib/unislot/engines/metrics'
import type { WorkerRequest, WorkerResponse } from '../workers/unislot.worker'

export interface PipelineOutput {
  validation: ValidationResult
  schedule: Schedule | null
  clashReport: ClashReport | null
  scheduleXlsx: ArrayBuffer | null
  clashXlsx: ArrayBuffer | null
  courseEmailsXlsx: ArrayBuffer | null
  courseEmailsData: import('../lib/unislot/types').CourseEmailGroup[] | null
  stats: {
    studentCount: number
    courseCount: number
    sectionCount: number
    scheduling: SchedulingStats | null
  } | null
}

export function useUnislotWorker() {
  const workerRef = useRef<Worker | null>(null)
  const [progress, setProgress] = useState<{ stage: string; message: string } | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/unislot.worker.ts', import.meta.url), {
      type: 'module',
    })
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const run = useCallback((file: File): Promise<PipelineOutput> => {
    const w = workerRef.current
    if (!w) return Promise.reject(new Error('Worker not ready'))

    return file.arrayBuffer().then((buffer) => {
      setRunning(true)
      setProgress({ stage: 'queued', message: 'Starting…' })
      const id = Math.floor(Math.random() * 1e9)

      return new Promise<PipelineOutput>((resolve, reject) => {
        const onMessage = (ev: MessageEvent<WorkerResponse>) => {
          const data = ev.data
          if ('id' in data && data.id !== id) return

          if (data.type === 'progress') {
            setProgress({ stage: data.stage, message: data.message })
            return
          }
          if (data.type === 'error') {
            w.removeEventListener('message', onMessage)
            setRunning(false)
            setProgress(null)
            reject(new Error(data.message))
            return
          }
          if (data.type === 'result') {
            w.removeEventListener('message', onMessage)
            setRunning(false)
            setProgress(null)
            resolve({
              validation: data.validation,
              schedule: data.schedule,
              clashReport: data.clashReport,
              scheduleXlsx: data.scheduleXlsx,
              clashXlsx: data.clashXlsx,
              courseEmailsXlsx: data.courseEmailsXlsx,
              courseEmailsData: data.courseEmailsData,
              stats: data.stats,
            })
          }
        }
        w.addEventListener('message', onMessage)
        const req: WorkerRequest = { type: 'run', id, buffer }
        w.postMessage(req, [buffer])
      })
    })
  }, [])

  return { run, running, progress }
}

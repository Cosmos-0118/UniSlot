import { useCallback, useRef, useState } from 'react'
import type {
  ClashReport,
  CourseEmailGroup,
  Schedule,
  ScheduleEntry,
  ValidationResult,
} from '@/modules/scheduling/types'
import type { SchedulingStats } from '@/modules/scheduling/solver/metrics'
import type { PipelineProgressEvent, RunPipelineOptions } from '@/modules/scheduling/pipeline/run'
import type { PipelineExportKind } from '@/modules/scheduling/pipeline/exports'
import type { SchedulingSnapshot } from '@/modules/scheduling/merge/snapshot'
import { scheduleWithEntries } from '@/modules/scheduling/worker/scheduleTransfer'
import type { WorkerRequest, WorkerResponse } from '@/modules/scheduling/worker/scheduling.worker'

export interface PipelineOutput {
  validation: ValidationResult
  schedule: Schedule | null
  clashReport: ClashReport | null
  scheduleXlsx: ArrayBuffer | null
  clashXlsx: ArrayBuffer | null
  courseEmailsXlsx: ArrayBuffer | null
  courseEmailsData: CourseEmailGroup[] | null
  stats: {
    studentCount: number
    courseCount: number
    sectionCount: number
    scheduling: SchedulingStats | null
  } | null
  schedule_export_blocked?: boolean
  schedule_export_block_reason?: string | null
  schedulingSnapshot: SchedulingSnapshot | null
  hasDeferredSnapshot?: boolean
  hasDeferredScheduleEntries?: boolean
}

function createWorker(): Worker {
  return new Worker(new URL('../../../modules/scheduling/worker/scheduling.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function workerRequest<T>(
  w: Worker,
  req: WorkerRequest,
  match: (data: WorkerResponse) => T | null,
): Promise<T> {
  const id = 'id' in req && typeof req.id === 'number' ? req.id : Math.floor(Math.random() * 1e9)

  return new Promise<T>((resolve, reject) => {
    const onMessage = (ev: MessageEvent<WorkerResponse>) => {
      const data = ev.data
      if ('id' in data && data.id !== id) return

      if (data.type === 'error') {
        w.removeEventListener('message', onMessage)
        reject(new Error(data.message))
        return
      }

      const hit = match(data)
      if (hit != null) {
        w.removeEventListener('message', onMessage)
        resolve(hit)
      }
    }
    w.addEventListener('message', onMessage)
    const payload = 'id' in req ? req : ({ ...req, id } as WorkerRequest)
    w.postMessage(payload)
  })
}

export function useUnislotWorker() {
  const workerRef = useRef<Worker | null>(null)
  const activeRunIdRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const [progress, setProgress] = useState<PipelineProgressEvent | null>(null)
  const [running, setRunning] = useState(false)

  const ensureWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = createWorker()
    }
    return workerRef.current
  }, [])

  const warmupWorker = useCallback(() => {
    void import('@/modules/scheduling/pipeline/run').then(() => {
      ensureWorker()
    })
  }, [ensureWorker])

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    activeRunIdRef.current = null
  }, [])

  const cancel = useCallback(() => {
    const id = activeRunIdRef.current
    if (id == null) return
    ensureWorker().postMessage({ type: 'cancel', id } satisfies WorkerRequest)
  }, [ensureWorker])

  const exportXlsx = useCallback(
    (kind: PipelineExportKind): Promise<ArrayBuffer> => {
      const w = ensureWorker()
      const id = Math.floor(Math.random() * 1e9)
      return workerRequest(w, { type: 'export', id, kind }, (data) =>
        data.type === 'exportResult' && data.kind === kind ? data.buffer : null,
      )
    },
    [ensureWorker],
  )

  const fetchSchedulingSnapshot = useCallback((): Promise<SchedulingSnapshot> => {
    const w = ensureWorker()
    const id = Math.floor(Math.random() * 1e9)
    return workerRequest(w, { type: 'getSnapshot', id }, (data) =>
      data.type === 'snapshot' ? data.snapshot : null,
    )
  }, [ensureWorker])

  const fetchScheduleEntries = useCallback((): Promise<ScheduleEntry[]> => {
    const w = ensureWorker()
    const id = Math.floor(Math.random() * 1e9)
    return workerRequest(w, { type: 'getScheduleEntries', id }, (data) =>
      data.type === 'scheduleEntries' ? data.entries : null,
    )
  }, [ensureWorker])

  const syncWorkerArtifacts = useCallback(
    (patch: { schedule?: Schedule; snapshot?: SchedulingSnapshot }) => {
      ensureWorker().postMessage({ type: 'syncArtifacts', ...patch } satisfies WorkerRequest)
    },
    [ensureWorker],
  )

  const run = useCallback(
    (file: File, pipelineOptions?: RunPipelineOptions): Promise<PipelineOutput> => {
      if (runningRef.current) {
        return Promise.reject(new Error('A scheduling run is already in progress.'))
      }

      const w = ensureWorker()

      return file.arrayBuffer().then((buffer) => {
        runningRef.current = true
        setRunning(true)
        setProgress({
          stage: 'queued',
          message: 'Handing file to Web Worker thread…',
          fraction: 0.005,
          etaSeconds: null,
        })
        const id = Math.floor(Math.random() * 1e9)
        activeRunIdRef.current = id

        return new Promise<PipelineOutput>((resolve, reject) => {
          const finish = () => {
            activeRunIdRef.current = null
            runningRef.current = false
            setRunning(false)
            setProgress(null)
          }

          const onMessage = (ev: MessageEvent<WorkerResponse>) => {
            const data = ev.data
            if ('id' in data && data.id !== id) return

            if (data.type === 'progress') {
              setProgress({
                stage: data.stage,
                message: data.message,
                fraction: data.fraction,
                etaSeconds: data.etaSeconds,
              })
              return
            }
            if (data.type === 'cancelled') {
              w.removeEventListener('message', onMessage)
              finish()
              reject(new Error('Scheduling run was cancelled.'))
              return
            }
            if (data.type === 'error') {
              w.removeEventListener('message', onMessage)
              finish()
              reject(new Error(data.message))
              return
            }
            if (data.type === 'result') {
              w.removeEventListener('message', onMessage)
              finish()
              resolve({
                validation: data.validation,
                schedule: data.schedule,
                clashReport: data.clashReport,
                scheduleXlsx: data.scheduleXlsx,
                clashXlsx: data.clashXlsx,
                courseEmailsXlsx: data.courseEmailsXlsx,
                courseEmailsData: data.courseEmailsData,
                stats: data.stats,
                schedule_export_blocked: data.schedule_export_blocked,
                schedule_export_block_reason: data.schedule_export_block_reason,
                schedulingSnapshot: null,
                hasDeferredSnapshot: data.hasDeferredSnapshot,
                hasDeferredScheduleEntries: data.hasDeferredScheduleEntries,
              })
            }
          }
          w.addEventListener('message', onMessage)
          const req: WorkerRequest = {
            type: 'run',
            id,
            buffer,
            ...pipelineOptions,
          }
          w.postMessage(req, [buffer])
        })
      })
    },
    [ensureWorker],
  )

  return {
    run,
    cancel,
    exportXlsx,
    fetchSchedulingSnapshot,
    fetchScheduleEntries,
    syncWorkerArtifacts,
    warmupWorker,
    running,
    progress,
    terminateWorker,
  }
}

export { scheduleWithEntries }

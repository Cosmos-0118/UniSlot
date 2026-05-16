import { createContext } from 'react'
import type { LogLine } from '@/components/ui/processingTerminalModel'
import type { PipelineProgressEvent, RunPipelineOptions } from '@/modules/scheduling/pipeline/run'
import type { PipelineOutput } from '@/features/scheduling/hooks/useUnislotWorker'
import type { PipelineExportKind } from '@/modules/scheduling/pipeline/exports'
import type { SchedulingSnapshot } from '@/modules/scheduling/merge/snapshot'
import type { Schedule, ScheduleEntry } from '@/modules/scheduling/types'

export type SchedulerViewMode = 'idle' | 'processing' | 'actions' | 'details'

export type SchedulingSessionValue = {
  result: PipelineOutput | null
  setResult: (r: PipelineOutput | null) => void
  fileName: string | null
  setFileName: (name: string | null) => void
  viewMode: SchedulerViewMode
  setViewMode: (mode: SchedulerViewMode) => void
  run: (file: File, pipelineOptions?: RunPipelineOptions) => Promise<PipelineOutput>
  cancelRun: () => void
  exportXlsx: (kind: PipelineExportKind) => Promise<ArrayBuffer>
  fetchSchedulingSnapshot: () => Promise<SchedulingSnapshot>
  fetchScheduleEntries: () => Promise<ScheduleEntry[]>
  syncWorkerArtifacts: (patch: { schedule?: Schedule; snapshot?: SchedulingSnapshot }) => void
  warmupWorker: (options?: { includeSolver?: boolean }) => void
  running: boolean
  progress: PipelineProgressEvent | null
  resetSession: () => void
  /** Pipeline terminal transcript (persists across sidebar navigation). */
  terminalLines: LogLine[]
  terminalTypingIdx: number
  onTerminalLineTypeDone: () => void
  resetTerminalLog: () => void
}

export const SchedulingSessionContext = createContext<SchedulingSessionValue | null>(null)

import { createContext } from 'react'
import type { LogLine } from '@/components/ui/processingTerminalModel'
import type { PipelineOutput } from '@/hooks/useUnislotWorker'

export type SchedulerViewMode = 'idle' | 'processing' | 'actions' | 'details'

export type SchedulingSessionValue = {
  result: PipelineOutput | null
  setResult: (r: PipelineOutput | null) => void
  fileName: string | null
  setFileName: (name: string | null) => void
  viewMode: SchedulerViewMode
  setViewMode: (mode: SchedulerViewMode) => void
  run: (file: File) => Promise<PipelineOutput>
  running: boolean
  progress: { stage: string; message: string } | null
  resetSession: () => void
  /** Pipeline terminal transcript (persists across sidebar navigation). */
  terminalLines: LogLine[]
  terminalTypingIdx: number
  onTerminalLineTypeDone: () => void
  resetTerminalLog: () => void
}

export const SchedulingSessionContext = createContext<SchedulingSessionValue | null>(null)

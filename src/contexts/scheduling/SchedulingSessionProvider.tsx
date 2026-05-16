import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useSchedulingTerminalLog } from '@/hooks/useSchedulingTerminalLog'
import { useUnislotWorker } from '@/hooks/useUnislotWorker'
import {
  SchedulingSessionContext,
  type SchedulingSessionValue,
  type SchedulerViewMode,
} from './schedulingSessionContext'

export function SchedulingSessionProvider({ children }: { children: ReactNode }) {
  const {
    run,
    cancel,
    exportXlsx,
    fetchSchedulingSnapshot,
    fetchScheduleEntries,
    syncWorkerArtifacts,
    warmupWorker,
    running,
    progress,
  } = useUnislotWorker()
  const [result, setResult] = useState<SchedulingSessionValue['result']>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<SchedulerViewMode>('idle')

  const {
    lines: terminalLines,
    typingIdx: terminalTypingIdx,
    handleTypeDone: onTerminalLineTypeDone,
    reset: resetTerminalLog,
  } = useSchedulingTerminalLog(progress)

  useEffect(() => {
    if (!running) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [running])

  const resetSession = useCallback(() => {
    cancel()
    setResult(null)
    setFileName(null)
    setViewMode('idle')
    resetTerminalLog()
  }, [cancel, resetTerminalLog])

  const value = useMemo<SchedulingSessionValue>(
    () => ({
      result,
      setResult,
      fileName,
      setFileName,
      viewMode,
      setViewMode,
      run,
      cancelRun: cancel,
      exportXlsx,
      fetchSchedulingSnapshot,
      fetchScheduleEntries,
      syncWorkerArtifacts,
      warmupWorker,
      running,
      progress,
      resetSession,
      terminalLines,
      terminalTypingIdx,
      onTerminalLineTypeDone,
      resetTerminalLog,
    }),
    [
      result,
      fileName,
      viewMode,
      run,
      cancel,
      exportXlsx,
      fetchSchedulingSnapshot,
      fetchScheduleEntries,
      syncWorkerArtifacts,
      warmupWorker,
      running,
      progress,
      resetSession,
      terminalLines,
      terminalTypingIdx,
      onTerminalLineTypeDone,
      resetTerminalLog,
    ],
  )

  return (
    <SchedulingSessionContext.Provider value={value}>{children}</SchedulingSessionContext.Provider>
  )
}

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
  const { run, running, progress } = useUnislotWorker()
  const [result, setResult] = useState<SchedulingSessionValue['result']>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<SchedulerViewMode>('idle')

  const stage = progress?.stage ?? null
  const message = progress?.message ?? null
  const {
    lines: terminalLines,
    typingIdx: terminalTypingIdx,
    handleTypeDone: onTerminalLineTypeDone,
    reset: resetTerminalLog,
  } = useSchedulingTerminalLog(stage, message)

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
    setResult(null)
    setFileName(null)
    setViewMode('idle')
    resetTerminalLog()
  }, [resetTerminalLog])

  const value = useMemo<SchedulingSessionValue>(
    () => ({
      result,
      setResult,
      fileName,
      setFileName,
      viewMode,
      setViewMode,
      run,
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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useSchedulingTerminalLog } from '@/features/scheduling/hooks/useSchedulingTerminalLog'
import {
  scheduleWithEntries,
  useUnislotWorker,
  type PipelineOutput,
} from '@/features/scheduling/hooks/useUnislotWorker'
import type { RunPipelineOptions } from '@/modules/scheduling/pipeline/run'
import type { ScheduleEntry } from '@/modules/scheduling/types'
import type { SchedulingSnapshot } from '@/modules/scheduling/merge/snapshot'
import {
  clearLiveSession,
  loadLiveSession,
  saveLiveSession,
} from '@/features/scheduling/storage/liveSessionStorage'
import {
  SchedulingSessionContext,
  type SchedulingSessionValue,
  type SchedulerViewMode,
} from './context'

const WEB_LOCK_NAME = 'unislot-scheduling'
const DEFAULT_TITLE = 'UniSlot'

async function enrichResultForPersist(
  out: PipelineOutput,
  fetchSchedulingSnapshot: () => Promise<SchedulingSnapshot>,
  fetchScheduleEntries: () => Promise<ScheduleEntry[]>,
): Promise<PipelineOutput> {
  let next = out
  if (out.hasDeferredSnapshot && !out.schedulingSnapshot) {
    try {
      const snapshot = await fetchSchedulingSnapshot()
      next = { ...next, schedulingSnapshot: snapshot, hasDeferredSnapshot: false }
    } catch (e) {
      console.warn('Could not fetch snapshot for live session persist', e)
    }
  }
  if (
    next.schedule &&
    next.hasDeferredScheduleEntries &&
    next.schedule.entries.length === 0
  ) {
    try {
      const entries = await fetchScheduleEntries()
      next = {
        ...next,
        schedule: scheduleWithEntries(next.schedule, entries),
        hasDeferredScheduleEntries: false,
      }
    } catch (e) {
      console.warn('Could not fetch schedule entries for live session persist', e)
    }
  }
  return next
}

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
  const [backgroundThrottled, setBackgroundThrottled] = useState(false)
  const [displayEtaSeconds, setDisplayEtaSeconds] = useState<number | null>(null)

  const baseTitleRef = useRef(
    typeof document !== 'undefined' ? document.title || DEFAULT_TITLE : DEFAULT_TITLE,
  )

  const {
    lines: terminalLines,
    typingIdx: terminalTypingIdx,
    handleTypeDone: onTerminalLineTypeDone,
    reset: resetTerminalLog,
    flush: flushTerminalLog,
  } = useSchedulingTerminalLog(progress)

  useEffect(() => {
    let cancelled = false
    void loadLiveSession().then((rec) => {
      if (cancelled || !rec) return
      setResult(rec.result)
      setFileName(rec.fileName)
      setViewMode(rec.viewMode)
      const snap = rec.result.schedulingSnapshot
      const sched = rec.result.schedule
      if (snap || sched) {
        syncWorkerArtifacts({
          ...(sched ? { schedule: sched } : {}),
          ...(snap ? { snapshot: snap } : {}),
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [syncWorkerArtifacts])

  useEffect(() => {
    if (!running) return
    if (typeof navigator === 'undefined' || !navigator.locks?.request) return

    let release: (() => void) | null = null
    let cancelled = false

    void navigator.locks.request(WEB_LOCK_NAME, { mode: 'exclusive' }, () => {
      return new Promise<void>((resolve) => {
        if (cancelled) {
          resolve()
          return
        }
        release = resolve
      })
    })

    return () => {
      cancelled = true
      release?.()
    }
  }, [running])

  useEffect(() => {
    const syncVisibility = () => {
      const hidden = document.visibilityState === 'hidden'
      if (running) {
        setBackgroundThrottled(hidden)
        if (hidden) flushTerminalLog()
      } else {
        setBackgroundThrottled(false)
      }
    }
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => document.removeEventListener('visibilitychange', syncVisibility)
  }, [running, flushTerminalLog])

  useEffect(() => {
    if (!running) {
      setDisplayEtaSeconds(null)
      return
    }
    if (document.visibilityState === 'hidden') return
    const eta = progress?.etaSeconds ?? null
    setDisplayEtaSeconds(eta != null && Number.isFinite(eta) && eta > 0 ? eta : null)
  }, [running, progress?.etaSeconds])

  useEffect(() => {
    if (!running) {
      document.title = baseTitleRef.current || DEFAULT_TITLE
      return
    }
    const frac = progress?.fraction
    const pct =
      frac != null && Number.isFinite(frac)
        ? Math.round(Math.max(0, Math.min(1, frac)) * 100)
        : null
    document.title = pct != null ? `(${pct}%) ${DEFAULT_TITLE}` : `Running… ${DEFAULT_TITLE}`
    return () => {
      document.title = baseTitleRef.current || DEFAULT_TITLE
    }
  }, [running, progress?.fraction])

  useEffect(() => {
    if (!running) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [running])

  const fileNameRef = useRef(fileName)
  fileNameRef.current = fileName
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const resultRef = useRef(result)
  resultRef.current = result

  // Keep IndexedDB draft viewMode in sync when user toggles actions ↔ details.
  useEffect(() => {
    if (viewMode !== 'actions' && viewMode !== 'details') return
    const r = resultRef.current
    if (!r) return
    void saveLiveSession({
      savedAt: new Date().toISOString(),
      viewMode,
      fileName: fileNameRef.current,
      result: r,
    }).catch((e) => console.warn('Failed to update live session viewMode', e))
  }, [viewMode])

  const setResultPersisted = useCallback((r: PipelineOutput | null) => {
    setResult(r)
    if (!r) {
      void clearLiveSession()
      return
    }
    const mode = viewModeRef.current
    if (mode !== 'actions' && mode !== 'details') return
    void saveLiveSession({
      savedAt: new Date().toISOString(),
      viewMode: mode,
      fileName: fileNameRef.current,
      result: r,
    }).catch((e) => console.warn('Failed to update live session', e))
  }, [])

  const persistCompleted = useCallback(
    async (out: PipelineOutput, mode: 'actions' | 'details', name: string | null) => {
      try {
        const enriched = await enrichResultForPersist(
          out,
          fetchSchedulingSnapshot,
          fetchScheduleEntries,
        )
        setResult(enriched)
        await saveLiveSession({
          savedAt: new Date().toISOString(),
          viewMode: mode,
          fileName: name,
          result: enriched,
        })
      } catch (e) {
        console.warn('Failed to persist live scheduling session', e)
        setResult(out)
      }
    },
    [fetchSchedulingSnapshot, fetchScheduleEntries],
  )

  const resetSession = useCallback(() => {
    cancel()
    setResult(null)
    setFileName(null)
    setViewMode('idle')
    setDisplayEtaSeconds(null)
    setBackgroundThrottled(false)
    resetTerminalLog()
    void clearLiveSession()
  }, [cancel, resetTerminalLog])

  const beginNewRun = useCallback(() => {
    setResult(null)
    setViewMode('idle')
    setDisplayEtaSeconds(null)
    resetTerminalLog()
    void clearLiveSession()
  }, [resetTerminalLog])

  const startRun = useCallback(
    async (file: File, pipelineOptions?: RunPipelineOptions): Promise<PipelineOutput> => {
      resetTerminalLog()
      setFileName(file.name)
      setResult(null)
      setViewMode('processing')
      setDisplayEtaSeconds(null)
      void clearLiveSession()

      try {
        const out = await run(file, pipelineOptions)
        const mode: 'actions' | 'details' = out.validation.is_valid ? 'actions' : 'details'
        setViewMode(mode)
        await persistCompleted(out, mode, file.name)
        return out
      } catch (e) {
        resetTerminalLog()
        setViewMode('idle')
        setResult(null)
        void clearLiveSession()
        throw e
      }
    },
    [run, resetTerminalLog, persistCompleted],
  )

  const value = useMemo<SchedulingSessionValue>(
    () => ({
      result,
      setResult: setResultPersisted,
      fileName,
      setFileName,
      viewMode,
      setViewMode,
      startRun,
      cancelRun: cancel,
      exportXlsx,
      fetchSchedulingSnapshot,
      fetchScheduleEntries,
      syncWorkerArtifacts,
      warmupWorker,
      running,
      progress,
      displayEtaSeconds,
      backgroundThrottled,
      resetSession,
      beginNewRun,
      terminalLines,
      terminalTypingIdx,
      onTerminalLineTypeDone,
      resetTerminalLog,
      flushTerminalLog,
    }),
    [
      result,
      setResultPersisted,
      fileName,
      viewMode,
      startRun,
      cancel,
      exportXlsx,
      fetchSchedulingSnapshot,
      fetchScheduleEntries,
      syncWorkerArtifacts,
      warmupWorker,
      running,
      progress,
      displayEtaSeconds,
      backgroundThrottled,
      resetSession,
      beginNewRun,
      terminalLines,
      terminalTypingIdx,
      onTerminalLineTypeDone,
      resetTerminalLog,
      flushTerminalLog,
    ],
  )

  return (
    <SchedulingSessionContext.Provider value={value}>{children}</SchedulingSessionContext.Provider>
  )
}

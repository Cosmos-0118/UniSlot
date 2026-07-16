import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipelineProgressEvent } from '@/modules/scheduling/pipeline/run'
import { STAGE_SUMMARY, type LineType, type LogLine } from '@/components/ui/processingTerminalModel'

/**
 * Terminal transcript + typewriter queue. Lives in {@link SchedulingSessionProvider}
 * so log state survives navigating away from the scheduler view.
 */
export function useSchedulingTerminalLog(progress: PipelineProgressEvent | null) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [typingIdx, setTypingIdx] = useState(-1)
  const prevStage = useRef<string | null>(null)
  const prevMessage = useRef<string | null>(null)
  const pendingQueue = useRef<LogLine[]>([])
  const isTyping = useRef(false)
  const drainTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    if (drainTimeoutRef.current) {
      clearTimeout(drainTimeoutRef.current)
      drainTimeoutRef.current = null
    }
    setLines([])
    setTypingIdx(-1)
    prevStage.current = null
    prevMessage.current = null
    pendingQueue.current = []
    isTyping.current = false
  }, [])

  /** Append all pending lines immediately (no typewriter) — used when tab is hidden or UI unmounts. */
  const flush = useCallback(() => {
    if (drainTimeoutRef.current) {
      clearTimeout(drainTimeoutRef.current)
      drainTimeoutRef.current = null
    }
    isTyping.current = false
    setTypingIdx(-1)
    const pending = pendingQueue.current
    pendingQueue.current = []
    if (pending.length === 0) return
    setLines((prev) => [...prev, ...pending])
  }, [])

  function drainNext() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      const pending = pendingQueue.current
      pendingQueue.current = []
      isTyping.current = false
      setTypingIdx(-1)
      if (pending.length > 0) {
        setLines((prev) => [...prev, ...pending])
      }
      return
    }
    if (isTyping.current || pendingQueue.current.length === 0) return
    isTyping.current = true
    const next = pendingQueue.current.shift()!
    setLines((prev) => {
      const idx = prev.length
      setTypingIdx(idx)
      return [...prev, next]
    })
  }

  const pushLine = useCallback((line: LogLine) => {
    pendingQueue.current.push(line)
    drainNext()
  }, [])

  const handleTypeDone = useCallback(() => {
    isTyping.current = false
    setTypingIdx(-1)
    drainTimeoutRef.current = setTimeout(() => {
      drainTimeoutRef.current = null
      drainNext()
    }, 28)
  }, [])

  useEffect(() => {
    if (!progress?.stage) return

    if (progress.stage !== prevStage.current) {
      prevStage.current = progress.stage
      prevMessage.current = null
      const headline = STAGE_SUMMARY[progress.stage] ?? `▸ ${progress.stage}`
      pushLine({ text: headline, type: 'stage' })
    }

    if (!progress.message || progress.message === prevMessage.current) return
    prevMessage.current = progress.message

    const isDone = progress.stage === 'done'
    const isSchedule = progress.stage === 'schedule'
    const type: LineType = isDone ? 'ok' : isSchedule ? 'progress' : 'info'
    const prefix = isDone ? '  ✓ ' : '  └─ '
    pushLine({ text: `${prefix}${progress.message}`, type })
  }, [progress, pushLine])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [flush])

  return { lines, typingIdx, handleTypeDone, reset, flush }
}

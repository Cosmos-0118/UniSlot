import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FILLER,
  STAGE_LINES,
  type LineType,
  type LogLine,
} from '@/components/ui/processingTerminalModel'

/**
 * Terminal transcript + typewriter queue. Lives in {@link SchedulingSessionProvider}
 * so log state survives navigating away from the scheduler view.
 */
export function useSchedulingTerminalLog(stage: string | null, message: string | null) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [typingIdx, setTypingIdx] = useState(-1)
  const prevStage = useRef<string | null>(null)
  const prevMessage = useRef<string | null>(null)
  const fillerIdx = useRef(0)
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
    fillerIdx.current = 0
    pendingQueue.current = []
    isTyping.current = false
  }, [])

  function drainNext() {
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
    }, 30)
  }, [])

  useEffect(() => {
    if (!stage || stage === prevStage.current) return
    prevStage.current = stage

    const staged = STAGE_LINES[stage] ?? [`▸ ${message ?? stage} …`]

    for (const text of staged) {
      const type: LineType =
        text.includes('✓') || text.includes('complete')
          ? 'ok'
          : text.startsWith('  ')
            ? 'info'
            : 'stage'
      pushLine({ text, type })

      if (Math.random() > 0.6 && fillerIdx.current < FILLER.length) {
        const f = FILLER[fillerIdx.current++]
        pushLine({ text: f, type: 'info' })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stage transitions only (matches legacy terminal)
  }, [stage, pushLine])

  useEffect(() => {
    if (!message || !stage) return
    if (stage !== prevStage.current) return
    if (message === prevMessage.current) return
    prevMessage.current = message

    const isDone = message.toLowerCase().startsWith('done')
    const isPhase = /phase \d/i.test(message)
    const type: LineType = isDone ? 'ok' : isPhase ? 'progress' : 'stage'
    const prefix = isDone ? '  ✓ ' : '  └─ '

    pushLine({ text: `${prefix}${message}`, type })
  }, [message, stage, pushLine])

  return { lines, typingIdx, handleTypeDone, reset }
}

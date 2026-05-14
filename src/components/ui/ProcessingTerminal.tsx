import { useEffect, useRef, useState, useCallback } from 'react'
import { cn } from '../../lib/cn'

/* ── stage‑to‑cinematic‑messages map ────────────────────────── */
const STAGE_LINES: Record<string, string[]> = {
  queued: [
    '▸ UniSlot Engine v3.2.1 — cold start',
    '▸ Allocating worker thread …',
    '▸ Mounting virtual file-system …',
  ],
  read: [
    '▸ Ingesting workbook binary stream …',
    '▸ Decompressing OOXML archive …',
    '▸ Extracting sheet → SharedStrings table …',
  ],
  parse: [
    '▸ Tokenising enrollment rows …',
    '▸ Validating schema constraints (strict mode) …',
    '▸ Cross-referencing student ↔ course mappings …',
    '▸ Flagging anomalies …',
  ],
  preprocess: [
    '▸ Computing optimal section splits …',
    '▸ Assigning students → sections (bin-packing) …',
    '▸ Building conflict adjacency graph …',
    '▸ Extracting faculty time-constraints …',
    '▸ Indexing edge weights …',
  ],
  schedule: [
    '▸ Initialising constraint-satisfaction engine …',
    '▸ Seeding population (genetic solver) …',
    '▸ Running graph-colouring heuristic …',
    '▸ Iterating generations — minimising clashes …',
  ],
  export: [
    '▸ Serialising schedule → XLSX workbook …',
    '▸ Generating rich clash report …',
    '▸ Building course-email directory …',
  ],
  done: [
    '▸ All systems nominal ✓',
    '▸ Pipeline complete — ready for download.',
  ],
}

const FILLER = [
  '  ├─ heap: 12.4 MB used / 256 MB limit',
  '  ├─ cache hit ratio: 94.2 %',
  '  ├─ threads active: 1 (Web Worker)',
  '  ├─ constraint matrix density: sparse',
  '  ├─ adjacency list built — 0 orphan nodes',
]

type LineType = 'sys' | 'stage' | 'info' | 'ok' | 'progress'

interface LogLine {
  text: string
  type: LineType
}

/* ── Typewriter line ────────────────────────────────────────── */

function TypewriterLine({
  line,
  animate,
  onDone,
}: {
  line: LogLine
  animate: boolean
  onDone?: () => void
}) {
  const [charIdx, setCharIdx] = useState(0)
  const rafRef = useRef<number | null>(null)
  const lastTime = useRef(0)

  // chars per second — fast enough to feel snappy, slow enough to read
  const CPS = 65

  useEffect(() => {
    if (!animate) return
    lastTime.current = 0

    const step = (ts: number) => {
      if (!lastTime.current) lastTime.current = ts
      const elapsed = ts - lastTime.current
      const next = Math.min(line.text.length, Math.floor(elapsed * CPS / 1000))
      setCharIdx(next)
      if (next < line.text.length) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        onDone?.()
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [line.text, animate, onDone])

  const visible = !animate ? line.text : line.text.slice(0, charIdx)
  const showCursor = animate && charIdx < line.text.length

  return (
    <div
      className={cn(
        'terminal-line',
        line.type === 'ok' && 'line-ok',
        line.type === 'info' && 'line-info',
        line.type === 'stage' && 'line-stage',
        line.type === 'sys' && 'line-sys',
        line.type === 'progress' && 'line-progress',
      )}
    >
      {visible}
      {showCursor && <span className="typewriter-caret">▌</span>}
    </div>
  )
}

/* ── Main terminal ──────────────────────────────────────────── */

interface Props {
  stage: string | null
  message: string | null
  done: boolean
}

export function ProcessingTerminal({ stage, message, done }: Props) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [typingIdx, setTypingIdx] = useState(-1) // index of line currently typing
  const prevStage = useRef<string | null>(null)
  const prevMessage = useRef<string | null>(null)
  const fillerIdx = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingQueue = useRef<LogLine[]>([])
  const isTyping = useRef(false)

  const pushLine = useCallback((line: LogLine) => {
    pendingQueue.current.push(line)
    drainNext()
  }, [])

  function drainNext() {
    if (isTyping.current || pendingQueue.current.length === 0) return
    isTyping.current = true
    const next = pendingQueue.current.shift()!
    setLines(prev => {
      const idx = prev.length
      setTypingIdx(idx)
      return [...prev, next]
    })
  }

  const handleTypeDone = useCallback(() => {
    isTyping.current = false
    setTypingIdx(-1)
    // tiny delay between lines for realistic feel
    setTimeout(() => drainNext(), 30)
  }, [])

  /* whenever stage changes, queue the cinematic lines */
  useEffect(() => {
    if (!stage || stage === prevStage.current) return
    prevStage.current = stage

    const staged = STAGE_LINES[stage] ?? [`▸ ${message ?? stage} …`]

    for (const text of staged) {
      const type: LineType = text.includes('✓') || text.includes('complete') ? 'ok'
        : text.startsWith('  ') ? 'info'
        : 'stage'
      pushLine({ text, type })

      // occasionally inject a filler line for texture
      if (Math.random() > 0.6 && fillerIdx.current < FILLER.length) {
        const f = FILLER[fillerIdx.current++]
        pushLine({ text: f, type: 'info' })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  /* progressive scheduler messages */
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

  /* auto-scroll */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, typingIdx])

  return (
    <div className="terminal-root">
      <div className="terminal-scanlines" />

      {/* title bar */}
      <div className="terminal-titlebar">
        <div className="terminal-dots">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>
        <span className="terminal-title">unislot — engine</span>
        <div className="terminal-status">
          {done ? (
            <span className="status-done">COMPLETE</span>
          ) : (
            <span className="status-running">
              <span className="pulse-dot" /> RUNNING
            </span>
          )}
        </div>
      </div>

      {/* terminal body */}
      <div className="terminal-body">
        {lines.map((l, i) => (
          <TypewriterLine
            key={`${i}-${l.text}-${i === typingIdx ? 'play' : 'idle'}`}
            line={l}
            animate={i === typingIdx}
            onDone={i === typingIdx ? handleTypeDone : undefined}
          />
        ))}

        {/* idle blinking cursor when nothing is typing */}
        {!done && typingIdx === -1 && (
          <div className="terminal-cursor">
            <span className="cursor-char">█</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* progress bar */}
      {!done && (
        <div className="terminal-progress">
          <div className="terminal-progress-bar" />
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
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

/* filler lines shown between real stages for visual texture */
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

interface Props {
  stage: string | null
  message: string | null
  done: boolean
}

export function ProcessingTerminal({ stage, message, done }: Props) {
  const [lines, setLines] = useState<LogLine[]>([])
  const prevStage = useRef<string | null>(null)
  const prevMessage = useRef<string | null>(null)
  const fillerIdx = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const stageQueue = useRef<string[]>([])
  const draining = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  /* whenever stage changes, queue the cinematic lines */
  useEffect(() => {
    if (!stage || stage === prevStage.current) return
    prevStage.current = stage

    const staged = STAGE_LINES[stage] ?? [`▸ ${message ?? stage} …`]
    stageQueue.current.push(...staged)

    if (!draining.current) {
      draining.current = true
      drainQueue()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  /* whenever the scheduler emits a new progress message within the same stage,
     append it as a new terminal line so users see incremental progress */
  useEffect(() => {
    if (!message || !stage) return
    // skip if this is the very first message for a new stage (already handled above)
    if (stage !== prevStage.current) return
    // skip duplicate messages
    if (message === prevMessage.current) return
    prevMessage.current = message

    // classify the message
    const isDone = message.toLowerCase().startsWith('done')
    const isPhase = /phase \d/i.test(message)
    const type: LineType = isDone ? 'ok' : isPhase ? 'progress' : 'stage'

    const prefix = isDone ? '  ✓ ' : '  └─ '
    const line: LogLine = { text: `${prefix}${message}`, type }

    setLines(prev => [...prev, line])
  }, [message, stage])

  function addLine(line: LogLine) {
    setLines(prev => [...prev, line])
  }

  function drainQueue() {
    if (stageQueue.current.length === 0) {
      draining.current = false
      return
    }
    const next = stageQueue.current.shift()!
    const type: LineType = next.includes('✓') || next.includes('complete') ? 'ok'
      : next.startsWith('  ') ? 'info'
      : next.startsWith('▸') ? 'stage'
      : 'sys'

    addLine({ text: next, type })

    /* occasionally inject a filler line for texture */
    if (Math.random() > 0.6 && fillerIdx.current < FILLER.length) {
      const f = FILLER[fillerIdx.current++]
      stageQueue.current.unshift(f)
    }

    setTimeout(drainQueue, 60 + Math.random() * 90)
  }

  /* auto-scroll */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="terminal-root" ref={rootRef}>
      {/* scanline overlay */}
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
          <div
            key={i}
            className={cn(
              'terminal-line',
              l.type === 'ok' && 'line-ok',
              l.type === 'info' && 'line-info',
              l.type === 'stage' && 'line-stage',
              l.type === 'sys' && 'line-sys',
              l.type === 'progress' && 'line-progress',
            )}
            style={{ animationDelay: `${i * 0.02}s` }}
          >
            {l.text}
          </div>
        ))}

        {/* blinking cursor */}
        {!done && (
          <div className="terminal-cursor">
            <span className="cursor-char">█</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* progress glow bar at bottom */}
      {!done && (
        <div className="terminal-progress">
          <div className="terminal-progress-bar" />
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/utils/cn'
import type { LogLine } from '@/components/ui/processingTerminalModel'

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

  const CPS = 65

  useEffect(() => {
    if (!animate) return
    lastTime.current = 0

    const step = (ts: number) => {
      if (!lastTime.current) lastTime.current = ts
      const elapsed = ts - lastTime.current
      const next = Math.min(line.text.length, Math.floor((elapsed * CPS) / 1000))
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

interface Props {
  lines: LogLine[]
  typingIdx: number
  onLineTypeDone: () => void
  done: boolean
  /** 0–1 overall pipeline when the worker reports it; otherwise the bar stays indeterminate. */
  progressFraction?: number | null
  /** Latest worker status line (shown under the bar). */
  progressMessage?: string | null
  /** Estimated seconds remaining when the worker provides it. */
  progressEta?: number | null
  /** Optional file name shown in the footer while processing. */
  fileLabel?: string | null
}

export function ProcessingTerminal({
  lines,
  typingIdx,
  onLineTypeDone,
  done,
  progressFraction,
  progressMessage,
  progressEta,
  fileLabel,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  const determinate =
    progressFraction != null && Number.isFinite(progressFraction) && progressFraction >= 0
  const pct = determinate ? Math.round(Math.max(0, Math.min(1, progressFraction)) * 100) : null
  const etaLabel =
    progressEta != null && Number.isFinite(progressEta) && progressEta > 0
      ? progressEta >= 120
        ? `~${Math.round(progressEta / 60)}m left`
        : `~${Math.max(1, Math.round(progressEta))}s left`
      : null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, typingIdx])

  return (
    <div className="terminal-root">
      <div className="terminal-scanlines" />

      <div className="terminal-titlebar">
        <div className="terminal-dots">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>
        <span className="terminal-title">scheduling — engine</span>
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

      <div className="terminal-body">
        {lines.map((l, i) => (
          <TypewriterLine
            key={`${i}-${l.text}-${i === typingIdx ? 'play' : 'idle'}`}
            line={l}
            animate={i === typingIdx}
            onDone={i === typingIdx ? onLineTypeDone : undefined}
          />
        ))}

        {!done && typingIdx === -1 && (
          <div className="terminal-cursor">
            <span className="cursor-char">█</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!done && (
        <div className="terminal-footer" aria-busy="true" aria-live="polite">
          <div
            className={cn('terminal-progress-track', !determinate && 'terminal-progress-track--indeterminate')}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
            aria-valuetext={
              determinate
                ? `${pct}% — ${progressMessage ?? 'Working'}`
                : progressMessage ?? 'In progress'
            }
          >
            {!determinate && <div className="terminal-progress-shimmer" aria-hidden />}
            <div
              className={cn('terminal-progress-fill', determinate && 'terminal-progress-fill--determinate')}
              style={determinate ? { width: `${pct}%` } : undefined}
            />
          </div>
          <div className="terminal-footer-meta">
            <div className="terminal-footer-left">
              {determinate ? (
                <span className="terminal-progress-pct">{pct}%</span>
              ) : (
                <span className="terminal-progress-pulse">
                  <span className="terminal-progress-dot" />
                  <span className="terminal-progress-dot" />
                  <span className="terminal-progress-dot" />
                </span>
              )}
              {(progressMessage ?? '').trim() ? (
                <span className="terminal-progress-msg" title={progressMessage ?? undefined}>
                  {progressMessage}
                </span>
              ) : (
                <span className="terminal-progress-msg terminal-progress-msg--muted">Initializing…</span>
              )}
            </div>
            <div className="terminal-footer-right">
              {etaLabel && <span className="terminal-progress-eta">{etaLabel}</span>}
              {fileLabel ? (
                <span className="terminal-progress-file" title={fileLabel}>
                  {fileLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

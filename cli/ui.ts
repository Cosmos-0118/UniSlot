import * as p from '@clack/prompts'
import { SelectPrompt, TextPrompt, type State } from '@clack/core'
import chalk from 'chalk'
import { cpus } from 'node:os'
import type { Writable } from 'node:stream'
import type { CpsatProgressEvent } from '../src/modules/scheduling/solver/cpsatInstance.ts'
import { box, glyphs, pad, palette, strWidth, truncateVisible, wrapAnsi } from './theme.ts'

/**
 * True when Clack prompts can be shown: they read from stdin, so piped/CI
 * stdin must never reach a prompt (it would hang or crash). Native OS file
 * dialogs do NOT need this — they work headless and fail soft to null.
 */
export function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY)
}

type PickerOption<Value> = {
  value: Value
  label?: string
  hint?: string
  disabled?: boolean
}

type PickerFrameOptions<Value> = {
  message: string
  options: PickerOption<Value>[]
  cursor: number
  state: State
  columns?: number
  rows?: number
  maxItems?: number
  showInstructions?: boolean
  withGuide?: boolean
}

function cleanPickerText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** Pure renderer for the custom picker, exported so its layout stays regression-tested. */
export function renderSelectFrame<Value>(opts: PickerFrameOptions<Value>): string {
  const withGuide = opts.withGuide ?? true
  const selected = opts.options[opts.cursor]
  const selectedLabel = cleanPickerText(selected?.label ?? selected?.value)
  const messageWidth = Math.max(20, (opts.columns ?? 80) - 6)
  const message = truncateVisible(cleanPickerText(opts.message), messageWidth)

  if (opts.state === 'submit') {
    return [
      `${palette.ok('◇')}  ${palette.dim(message)}`,
      withGuide ? palette.dim(glyphs.box.v) : '',
      `${palette.ok(glyphs.box.bl)}  ${palette.ok('✓')} ${palette.bold(selectedLabel)}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (opts.state === 'cancel') {
    return [
      `${palette.bad('■')}  ${palette.dim(message)}`,
      withGuide ? palette.dim(glyphs.box.v) : '',
      `${palette.bad(glyphs.box.bl)}  ${chalk.dim.strikethrough(selectedLabel)}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  // Explicit colors avoid terminal themes mapping bold/default text to neon colors.
  const ink = chalk.hex('#E2E8F0')
  const muted = chalk.hex('#94A3B8')
  const border = chalk.hex('#475569')
  const highlight = chalk.bgHex('#164E63').hex('#ECFEFF')
  const longestLabel = Math.max(0, ...opts.options.map((option) => strWidth(cleanPickerText(option.label ?? option.value))))
  const width = Math.max(12, Math.min(Math.max(62, longestLabel + 10), 100, (opts.columns || 80) - 3))
  const inner = width - 2
  const textWidth = inner - 4
  const row = (text = '') => ` ${border('│')}${pad(text, inner)}${border('│')}`
  const content = (text: string) => row(`  ${text}  `)
  const rule = (left: string, right: string) => ` ${border(left + '─'.repeat(inner) + right)}`
  const titleRows = wrapAnsi(cleanPickerText(opts.message), textWidth)
  const detailRows = wrapAnsi(cleanPickerText(selected?.hint), textWidth)
  const showDetails = Boolean(selected?.hint) && (opts.rows || 24) >= 16
  const showFooter = opts.showInstructions ?? true
  const overhead = 5 + titleRows.length + (showDetails ? detailRows.length + 1 : 0) + (showFooter ? 1 : 0)
  const maxByTerminal = Math.max(1, (opts.rows || 24) - overhead - 1)
  const maxItems = Math.max(1, Math.min(opts.maxItems ?? maxByTerminal, maxByTerminal))
  const labels = opts.options.map((option) => wrapAnsi(cleanPickerText(option.label ?? option.value), inner - 7))
  // Allocate physical rows, not item counts: wrapped options must remain inside the viewport.
  let start = opts.cursor
  let finish = Math.min(opts.options.length, start + 1)
  let used = labels[start]?.length ?? 0
  while (finish - start < maxItems) {
    const before = start > 0 ? labels[start - 1]!.length : Infinity
    const after = finish < labels.length ? labels[finish]!.length : Infinity
    if (used + Math.min(before, after) > maxByTerminal) break
    if (start > 0 && used + before <= maxByTerminal && (opts.cursor - start <= finish - opts.cursor - 1 || used + after > maxByTerminal)) {
      start--
      used += before
    } else {
      finish++
      used += after
    }
  }
  const position = `${opts.cursor + 1} / ${opts.options.length}${start > 0 ? '  ↑' : ''}${finish < opts.options.length ? '  ↓' : ''}`
  const lines = [
    rule('┌', '┐'),
    ...titleRows.map((line) => content(ink(line))),
    content(muted(position)),
    row(),
  ]
  for (let index = start; index < finish; index++) {
    const option = opts.options[index]!
    const active = index === opts.cursor
    for (const [lineIndex, label] of labels[index]!.entries()) {
      const text = pad(` ${active && lineIndex === 0 ? '›' : ' '} ${label}`, inner - 2)
      lines.push(row(` ${active && !option.disabled ? highlight(text) : option.disabled ? muted(text) : ink(text)} `))
    }
  }
  lines.push(row())
  if (showDetails) {
    lines.push(rule('├', '┤'), ...detailRows.map((line) => content(muted(line))))
  }
  lines.push(rule('└', '┘'))
  if (showFooter) {
    const help = width >= 48 ? '↑↓ Navigate    Enter Select    Esc Back' : '↑↓ Move · Enter OK · Esc Back'
    lines.push(`   ${muted(truncateVisible(help, width - 3))}`)
  }
  return lines.join('\n')
}

/** A responsive, Clack-powered picker with UniSlot's own compact visual language. */
export function selectPrompt<Value>(opts: p.SelectOptions<Value>): Promise<Value | symbol> {
  const output = (opts.output ?? process.stdout) as Writable & { columns?: number; rows?: number }
  const options = opts.options as PickerOption<Value>[]
  return new SelectPrompt({
    options,
    signal: opts.signal,
    input: opts.input,
    output,
    initialValue: opts.initialValue,
    render() {
      return renderSelectFrame({
        message: opts.message,
        options,
        cursor: this.cursor,
        state: this.state,
        columns: output.columns,
        rows: output.rows,
        maxItems: opts.maxItems,
        showInstructions: opts.showInstructions,
        withGuide: opts.withGuide,
      })
    },
  }).prompt() as Promise<Value | symbol>
}

type InputFrameOptions = {
  message: string
  value: string
  cursor: number
  state: State
  placeholder?: string
  defaultValue?: string
  error?: string
  columns?: number
}

/** Single-line input viewport. Cursor positions from readline are UTF-16 offsets. */
export function renderTextFrame(opts: InputFrameOptions): string {
  const ink = chalk.hex('#E2E8F0')
  const muted = chalk.hex('#94A3B8')
  const accent = chalk.hex(opts.state === 'error' ? '#FBBF24' : '#22D3EE')
  const border = chalk.hex('#475569')
  const field = chalk.bgHex('#164E63').hex('#ECFEFF')
  const width = Math.max(8, Math.min(72, (opts.columns || 80) - 3))
  const inner = width - 2
  const contentWidth = Math.max(1, inner - 4)
  const row = (text = '') => ` ${border('│')}${pad(text, inner)}${border('│')}`
  const content = (text: string) => row(`  ${text}  `)
  const rule = (left: string, right: string) => ` ${border(left + '─'.repeat(inner) + right)}`
  const title = wrapAnsi(cleanPickerText(opts.message), contentWidth)

  if (opts.state === 'submit' || opts.state === 'cancel') {
    const cancelled = opts.state === 'cancel'
    return [
      ...title.map((line, index) => ` ${index === 0 ? (cancelled ? muted('×') : accent('✓')) : ' '} ${ink(line)}`),
      ...wrapAnsi(cancelled ? 'Input cancelled' : cleanPickerText(opts.value) || 'Not set', contentWidth)
        .map((line) => `   ${muted(line)}`),
    ].join('\n')
  }

  // Keep a stable, one-row field even when pasted values exceed the terminal width.
  const chars = Array.from(opts.value)
  const cursor = Array.from(opts.value.slice(0, Math.max(0, opts.cursor))).length
  const cell = (char: string) => /\p{Cc}/u.test(char) ? ' ' : char
  const cells = chars.map(cell)
  cells.push(' ')
  const caret = Math.min(cursor, cells.length - 1)
  const budget = Math.max(1, contentWidth - 2)
  let start = caret
  let used = strWidth(cells[caret]!)
  while (start > 0 && used + strWidth(cells[start - 1]!) <= budget) {
    used += strWidth(cells[--start]!)
  }
  let end = caret + 1
  while (end < cells.length && used + strWidth(cells[end]!) <= budget) {
    used += strWidth(cells[end++]!)
  }
  const visible = cells.slice(start, end).map((char, index) =>
    start + index === caret ? chalk.bgHex('#67E8F9').hex('#083344')(char) : char,
  ).join('')
  const placeholder = opts.placeholder || opts.defaultValue || 'Type here…'
  const entry = opts.value
    ? `${start > 0 ? '‹' : ' '}${visible}${end < cells.length ? '›' : ' '}`
    : ` ${chalk.bgHex('#67E8F9').hex('#083344')(' ')}${muted(truncateVisible(placeholder, Math.max(1, contentWidth - 2)))}`
  const lines = [
    rule('┌', '┐'),
    ...title.map((line) => content(ink(line))),
    row(),
    row(` ${accent('›')} ${field(pad(entry, contentWidth))} `),
    row(),
  ]
  if (opts.state === 'error' && opts.error) {
    lines.push(...wrapAnsi(`! ${cleanPickerText(opts.error)}`, contentWidth).map((line) => content(accent(line))))
  } else if (opts.defaultValue) {
    lines.push(...wrapAnsi(`Default: ${cleanPickerText(opts.defaultValue)}`, contentWidth).map((line) => content(muted(line))))
  }
  lines.push(rule('└', '┘'))
  lines.push(`   ${muted(truncateVisible('Enter Continue   Esc Cancel', width - 3))}`)
  return lines.join('\n')
}

/** Preserve Clack's editing, validation, defaults and cancellation; customize only presentation. */
export function textPrompt(opts: p.TextOptions): Promise<string | symbol> {
  const output = (opts.output ?? process.stdout) as Writable & { columns?: number }
  return new TextPrompt({
    validate: opts.validate,
    placeholder: opts.placeholder,
    defaultValue: opts.defaultValue,
    initialValue: opts.initialValue,
    input: opts.input,
    output,
    signal: opts.signal,
    render() {
      return renderTextFrame({
        message: opts.message,
        value: this.state === 'submit' ? this.value ?? '' : this.userInput,
        cursor: this.cursor,
        state: this.state,
        placeholder: opts.placeholder,
        defaultValue: opts.defaultValue,
        error: this.error,
        columns: output.columns,
      })
    },
  }).prompt() as Promise<string | symbol>
}

/** One friendly line when a command skips its wizard because stdin is piped. */
export function noteSkippedPrompts(): void {
  p.log.warn('stdin is not a TTY — skipping interactive prompts and using defaults.')
}

/**
 * Sanitize a numeric CLI flag. Returns undefined for missing, NaN, infinite,
 * or below-min values so callers fall back to defaults (and can warn).
 */
export function cleanFlagNumber(
  value: number | undefined,
  opts: { min?: number; integer?: boolean } = {},
): number | undefined {
  if (value === undefined || value === null) return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  const v = opts.integer ? Math.floor(n) : n
  if (opts.min !== undefined && v < opts.min) return undefined
  return v
}

export type LiveSolveState = {
  phase: string
  phaseLabel: string
  bestClash: number | null
  bestRed: number | null
  bestBalance: number | null
  bestParallelExcess: number | null
  bound: number | null
  solverElapsed: number
  solverElapsedAt: number
  workers: number
  solutions: number
  activity: 'searching' | 'improving' | 'proving' | 'idle'
  secondsSinceImprove: number
}

/**
 * Named solver milestones. Kept as stable string keys so callers and tests
 * can reference them; each maps to one short spinner message, not an
 * animation. See TRANSITION_TICKS for the (single) frame each plays.
 */
export type TransitionName =
  | 'scan'
  | 'assemble'
  | 'clash_enter'
  | 'red_enter'
  | 'balance_enter'
  | 'write'
  | 'stamp'
  | 'burst'

export const TRANSITION_TICKS: Record<TransitionName, number> = {
  scan: 8,
  assemble: 9,
  clash_enter: 7,
  red_enter: 7,
  balance_enter: 8,
  write: 8,
  stamp: 6,
  burst: 7,
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0.0s'
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}m ${s.toFixed(0).padStart(2, '0')}s`
}

function liveOf(elapsed: number, elapsedAt: number): number {
  return elapsed + Math.max(0, (Date.now() - elapsedAt) / 1000)
}

function activityWord(activity: LiveSolveState['activity']): string {
  switch (activity) {
    case 'improving':
      return 'improving'
    case 'proving':
      return 'proving'
    case 'searching':
      return 'searching'
    default:
      return 'idle'
  }
}

function metric(value: number | null): string {
  return value == null ? '—' : String(value)
}

/**
 * Pure single-frame descriptions — exported for tests. Each transition is
 * one plain-text frame (no Braille motion, no cursor math) so piped logs
 * stay readable and TTY output never flickers.
 */
export function transitionFrame(name: TransitionName, t: number, totalTicks: number): string[] {
  const step = totalTicks <= 1 ? 1 : `${Math.min(t + 1, totalTicks)}/${totalTicks}`
  switch (name) {
    case 'scan':
      return [`Reading workbook (${step})`, '']
    case 'assemble':
      return [`Building model (${step})`, '']
    case 'clash_enter':
      return [`1/3 Clash · minimize clash weight`, '']
    case 'red_enter':
      return [`2/3 RED · minimize students with clashes`, '']
    case 'balance_enter':
      return [`3/3 Balance · spread load across weekdays`, '']
    case 'write':
      return [`Writing exports (${step})`, '']
    case 'stamp':
      return [`Status · stamping result (${step})`, '']
    case 'burst':
      return [`Done (${step})`, '']
    default:
      return ['']
  }
}

/**
 * Play a short milestone on a TTY. No-op when stdout is not a TTY.
 * Returns the number of frames that would play (useful for tests).
 * Paints through Clack's spinner message line instead of raw ANSI so the
 * terminal never sees cursor-up/clear sequences from this CLI.
 */
export async function playTransition(
  name: TransitionName,
  opts: { isTty?: boolean; paint?: (lines: string[]) => void } = {},
): Promise<number> {
  const total = TRANSITION_TICKS[name]
  const isTty = opts.isTty ?? Boolean(process.stdout.isTTY)
  if (!isTty) return 0

  if (opts.paint) {
    for (let t = 0; t < total; t++) {
      opts.paint(transitionFrame(name, t, total))
    }
    return total
  }

  const spin = p.spinner()
  for (let t = 0; t < total; t++) {
    const [line] = transitionFrame(name, t, total)
    if (t === 0) spin.start(line ?? name)
    else spin.message(line ?? name)
    if (t < total - 1) {
      await new Promise<void>((r) => setTimeout(r, 60))
    }
  }
  spin.stop('')
  return total
}

type Stage = 'pipeline' | 'race' | 'clash' | 'red' | 'balance'

function lexStageFromPhase(phase: string): Stage | null {
  if (phase === 'minimize_clash') return 'clash'
  if (phase === 'minimize_red') return 'red'
  if (phase === 'minimize_balance') return 'balance'
  return null
}

const PROGRESS_THROTTLE_MS = 250

/**
 * Clack-native solve status. One spinner for the whole run; phase changes
 * checkpoint to scrollback via pause/resume so progress survives as plain
 * log lines. No raw ANSI, no per-tick repaint — safe on Windows, quiet
 * when piped.
 */
export function createSolveSpinner(workers = cpus().length) {
  const spin = p.spinner()
  const state: LiveSolveState = {
    phase: 'starting',
    phaseLabel: 'Starting',
    bestClash: null,
    bestRed: null,
    bestBalance: null,
    bestParallelExcess: null,
    bound: null,
    solverElapsed: 0,
    solverElapsedAt: Date.now(),
    workers,
    solutions: 0,
    activity: 'idle',
    secondsSinceImprove: 0,
  }

  let stage: Stage = 'pipeline'
  let started = false
  let stopped = false
  let paused = false
  let lastPushed = 0
  let lastMessage = ''
  let raceBest: { clash: number | null; red: number | null; seeds: number } | null = null
  let clashProven = false
  let redProven = false
  const checkpointed = { clash: false, red: false, race: false }
  const elapsed = () => liveOf(state.solverElapsed, state.solverElapsedAt)

  function line(): string {
    const time = formatDuration(elapsed())
    const act = activityWord(state.activity)
    if (stage === 'race' && raceBest) {
      return (
        `Portfolio race · ${raceBest.seeds} seeds · best clash ${metric(raceBest.clash)}` +
        ` · RED ${metric(raceBest.red)} · ${time}`
      )
    }
    if (stage === 'clash') {
      const gap =
        state.bestClash != null && state.bound != null
          ? ` · bound ${state.bound} · gap ${state.bestClash - state.bound}`
          : ''
      return `1/3 Clash · clash ${metric(state.bestClash)} · RED ${metric(state.bestRed)}${gap} · ${act} · ${time}`
    }
    if (stage === 'red') {
      const locked = state.bestClash != null ? ` · locked clash ${state.bestClash}` : ''
      return `2/3 RED · RED ${metric(state.bestRed)}${locked} · ${act} · ${time}`
    }
    if (stage === 'balance') {
      return (
        `3/3 Balance · balance ${metric(state.bestBalance)}` +
        ` · parallel ${metric(state.bestParallelExcess)} · ${act} · ${time}`
      )
    }
    return `${state.phaseLabel} · ${time}`
  }

  function push(force = false): void {
    if (!started || stopped || paused) return
    const now = Date.now()
    const msg = line()
    if (!force && (msg === lastMessage || now - lastPushed < PROGRESS_THROTTLE_MS)) return
    lastMessage = msg
    lastPushed = now
    spin.message(msg)
  }

  /**
   * Clack's stop() is a no-op when the spinner is already idle (after pause).
   * Restart just long enough to stamp a final line.
   */
  function stampClack(message: string): void {
    if (paused) {
      paused = false
      spin.start(message)
    }
    spin.stop(message)
  }

  function pauseSpinner(message?: string): void {
    if (!started || stopped || paused) return
    paused = true
    spin.stop(message ?? line())
  }

  function resumeSpinner(message?: string): void {
    if (stopped) return
    if (message) state.phaseLabel = message
    if (paused) {
      paused = false
      started = true
      spin.start(line())
      lastPushed = Date.now()
      lastMessage = line()
      return
    }
    if (!started) {
      started = true
      spin.start(line())
      lastPushed = Date.now()
      lastMessage = line()
      return
    }
    push(true)
  }

  function checkpoint(message: string): void {
    // Clack stop() already commits the line to scrollback — restart below it.
    pauseSpinner(message)
    resumeSpinner()
  }

  function enterStage(next: Stage, label?: string): void {
    if (next === stage) {
      if (label) {
        state.phaseLabel = label
        push(true)
      }
      return
    }
    if (stage === 'race' && !checkpointed.race) {
      checkpointed.race = true
      const c = raceBest?.clash ?? state.bestClash
      const r = raceBest?.red ?? state.bestRed
      checkpoint(`Portfolio race · best clash ${metric(c)} · RED ${metric(r)}`)
    }
    if (stage === 'clash' && (next === 'red' || next === 'balance') && !checkpointed.clash) {
      checkpointed.clash = true
      checkpoint(
        `1/3 Clash · clash ${metric(state.bestClash)}` +
          (clashProven ? ' · proven minimal' : ' · best feasible'),
      )
    }
    if (stage === 'red' && next === 'balance' && !checkpointed.red) {
      checkpointed.red = true
      checkpoint(
        `2/3 RED · RED ${metric(state.bestRed)}` +
          (redProven ? ' · proven minimal' : ' · best feasible'),
      )
    }
    stage = next
    if (label) state.phaseLabel = label
    if (next === 'red') {
      state.bound = null
      state.solutions = 0
    }
    if (next === 'balance') {
      state.bound = null
      state.bestBalance = null
      state.bestParallelExcess = null
      state.solutions = 0
    }
    state.activity = 'searching'
    state.secondsSinceImprove = 0
    push(true)
  }

  return {
    start(message = 'CP-SAT searching…') {
      state.phaseLabel = message
      state.activity = 'searching'
      state.solverElapsedAt = Date.now()
      if (!started) {
        started = true
        spin.start(line())
        lastPushed = Date.now()
        lastMessage = line()
      } else {
        push(true)
      }
    },
    updateFromPipeline(message: string) {
      state.phaseLabel = message
      if (!started) {
        started = true
        if (!paused) {
          spin.start(line())
          lastPushed = Date.now()
          lastMessage = line()
        }
      }
      push()
    },
    applyCpsat(evt: CpsatProgressEvent) {
      if (evt.type === 'phase' && evt.phase === 'portfolio_race') {
        const seeds = evt.portfolio_seeds ?? []
        stage = 'race'
        checkpointed.race = false
        raceBest = { clash: null, red: null, seeds: seeds.length || 1 }
        state.phase = evt.phase
        state.phaseLabel = evt.phase_label ?? 'Portfolio race'
        if (typeof evt.workers === 'number' && evt.workers > 0) state.workers = evt.workers
        push(true)
        return
      }

      if (evt.type === 'phase' && evt.phase === 'portfolio_best') {
        if (raceBest) {
          raceBest.clash = evt.clash_weight ?? raceBest.clash
          raceBest.red = evt.red_students ?? raceBest.red
        }
        if (evt.clash_weight != null) state.bestClash = evt.clash_weight
        if (evt.red_students != null) state.bestRed = evt.red_students
        push(true)
        return
      }

      if (evt.type === 'phase' && evt.phase === 'rehint') {
        if (typeof evt.workers === 'number' && evt.workers > 0) state.workers = evt.workers
        return
      }

      if (evt.portfolio) {
        // Per-lane race events collapse to a single best line.
        if (!raceBest) raceBest = { clash: null, red: null, seeds: 1 }
        if (evt.type === 'progress' || evt.type === 'heartbeat') {
          if (evt.best_clash != null) {
            if (raceBest.clash == null || evt.best_clash < raceBest.clash) {
              raceBest.clash = evt.best_clash
              state.bestClash = evt.best_clash
            }
          }
          if (evt.best_red != null) {
            if (
              raceBest.red == null ||
              (raceBest.clash != null &&
                evt.best_clash === raceBest.clash &&
                evt.best_red < raceBest.red)
            ) {
              raceBest.red = evt.best_red
            }
            state.bestRed = evt.best_red
          }
        } else if (evt.type === 'done') {
          if (evt.clash_weight != null) {
            if (raceBest.clash == null || evt.clash_weight < raceBest.clash) {
              raceBest.clash = evt.clash_weight
            }
          }
          if (evt.red_students != null) raceBest.red = evt.red_students
        }
        stage = 'race'
        push()
        return
      }

      if (evt.type === 'start') {
        enterStage('clash', 'Building model')
        state.activity = 'searching'
        state.workers = evt.workers
        state.solverElapsedAt = Date.now()
        push(true)
        return
      }

      if (evt.type === 'model_ready') {
        enterStage('clash', '1/3 Minimizing clashes')
        push(true)
        return
      }

      if (evt.type === 'phase') {
        const lex = lexStageFromPhase(evt.phase)
        if (lex === 'clash') enterStage('clash', evt.phase_label ?? '1/3 Minimizing clashes')
        else if (lex) enterStage(lex, evt.phase_label)
        else {
          state.phase = evt.phase
          state.phaseLabel = evt.phase_label ?? evt.phase
          push(true)
        }
        if (typeof evt.workers === 'number' && evt.workers > 0) state.workers = evt.workers
        if (typeof evt.elapsed === 'number') {
          state.solverElapsed = evt.elapsed
          state.solverElapsedAt = Date.now()
        }
        return
      }

      if (evt.type === 'progress' || evt.type === 'heartbeat') {
        const lex = lexStageFromPhase(evt.phase)
        if (lex && lex !== stage && (lex === 'red' || lex === 'balance')) {
          enterStage(lex, evt.phase_label)
        } else if (lex === 'clash' && stage === 'race') {
          enterStage('clash', evt.phase_label ?? '1/3 Minimizing clashes')
        }
        state.phase = evt.phase
        if (evt.phase_label) state.phaseLabel = evt.phase_label
        if (evt.best_clash != null) state.bestClash = evt.best_clash
        if (evt.best_red != null) state.bestRed = evt.best_red
        if (evt.best_balance_l1_scaled != null) state.bestBalance = evt.best_balance_l1_scaled
        if (evt.best_parallel_excess != null) state.bestParallelExcess = evt.best_parallel_excess
        if (evt.bound !== undefined && evt.bound !== null) state.bound = evt.bound
        state.solverElapsed = evt.elapsed
        state.solverElapsedAt = Date.now()
        state.workers = evt.workers
        state.solutions = evt.solutions
        state.activity = evt.activity ?? state.activity
        state.secondsSinceImprove = evt.seconds_since_improve ?? state.secondsSinceImprove

        if (evt.event === 'phase_end') {
          if (evt.phase === 'minimize_clash' && evt.solver_status === 'OPTIMAL') clashProven = true
          if (evt.phase === 'minimize_red' && evt.solver_status === 'OPTIMAL') redProven = true
        }
        push()
      }
    },
    async stop(finalMessage?: string) {
      if (!started || stopped) return
      stopped = true
      const summary =
        finalMessage ??
        (stage === 'race' && raceBest
          ? `Portfolio · best clash ${metric(raceBest.clash)} · RED ${metric(raceBest.red)}`
          : `${state.phaseLabel} · clash ${metric(state.bestClash)} · RED ${metric(state.bestRed)} · ${state.workers}w`)
      stampClack(summary)
    },
    /**
     * Pause the spinner for a mid-run prompt (late-mode capacity/clash
     * decisions). Unlike `stop`, this does NOT end the run — `resume`
     * continues the same spinner. (The wrapper's `start` after `stop` is a
     * no-op, which used to kill progress updates for the rest of the run.)
     */
    pause(message?: string) {
      pauseSpinner(message)
    },
    /** Continue after `pause` without losing spinner state. */
    resume(message?: string) {
      resumeSpinner(message)
    },
    /** Result stamp as a plain log line (TTY and piped logs identical). */
    async playStamp(status: string) {
      p.log.success(`Status [${status}]`)
    },
    cancel() {
      if (!started || stopped) return
      stopped = true
      stampClack('Cancelled')
    },
    state,
  }
}

/**
 * Undo cursor-hide / raw-mode leftovers after ANSI UI or native file dialogs.
 * (Unchanged — Windows Clack workaround documented below is load-bearing.)
 */
export function restoreCliTerminal(options: { prepareForPrompt?: boolean } = {}): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?25h\x1b[0m')
  }
  if (!process.stdin.isTTY) return
  if (process.platform !== 'win32') {
    try {
      process.stdin.setRawMode?.(false)
    } catch {
      /* ignore */
    }
  }
  if (options.prepareForPrompt && !process.stdin.isPaused()) {
    return
  }
  try {
    process.stdin.pause()
    let drained = 0
    while (process.stdin.read() !== null) {
      if (++drained > 10_000) break
    }
    if (options.prepareForPrompt) process.stdin.resume()
  } catch {
    /* ignore */
  }
}

/**
 * Last-resort safety net: guarantee the terminal is never left with a
 * hidden cursor or stuck in raw mode if the process goes down unexpectedly.
 */
export function installTerminalSafetyNet(): void {
  let restored = false
  process.once('exit', () => {
    if (restored) return
    restored = true
    try {
      if (process.stdout.isTTY) process.stdout.write('\x1b[?25h\x1b[0m')
      if (process.stdin.isTTY && process.platform !== 'win32') {
        process.stdin.setRawMode?.(false)
      }
    } catch {
      /* best effort — the process is going down regardless */
    }
  })
}

let bannerShown = false

/** One-line banner — Clack intro chrome only, no draw-in animation. */
export async function bannerAnimated(): Promise<void> {
  if (bannerShown) return
  bannerShown = true
  p.intro(palette.accent('▲ UniSlot') + palette.dim(' · terminal CP-SAT scheduler'))
}

export async function outroSuccess(lines: string[]): Promise<void> {
  p.outro(lines.join('\n'))
}

/** Kept as a no-op milestone: callers already own their write spinners. */
export async function playWriteSweep(): Promise<void> {
  if (!process.stdout.isTTY) return
}

function levelMark(ok: boolean): string {
  return ok ? palette.ok(`${glyphs.check} proven`) : palette.warn('best found (not proven)')
}

/** Inner metrics lines (no box). Use with `showPanel` or `box`. */
export function formatMetricsLines(opts: {
  clashWeight: number
  red: number
  proven: boolean
  provenLevels?: string[]
  status: string
  seconds: number
  workers: number
  structuralImpossible?: boolean
}): string[] {
  const levels = new Set(opts.provenLevels ?? [])
  const clashOk = levels.has('clash_weight') || opts.proven
  const redOk = levels.has('red_students')
  const balOk = levels.has('balance_and_parallel')
  const fullLex = clashOk && redOk && balOk
  const proof = fullLex
    ? palette.ok('full lex optimal — clash, RED, and balance are all proven minimal')
    : opts.proven
      ? palette.warn('clash proven · later lex levels not fully proven')
      : palette.warn('best feasible (clash not fully proven)')
  const row = (label: string, value: string, mark: string) => {
    const left = `${palette.bold(label.padEnd(10))} ${value.padEnd(6)}`
    return mark ? `${left}  ${mark}` : left
  }
  const aligned = [
    row('Status', opts.status, ''),
    row('Clash wt', String(opts.clashWeight), levelMark(clashOk)),
    row('RED', String(opts.red), levelMark(redOk)),
    row('Balance', '', levelMark(balOk)),
    `${palette.bold('Proof'.padEnd(10))} ${proof}`,
    `${palette.bold('Time'.padEnd(10))} ${opts.seconds.toFixed(2)}s · ${opts.workers} workers`,
  ]
  if (opts.structuralImpossible) {
    aligned.push(
      palette.dim('Note: structural lower bounds say zero-clash is impossible for this enrollment.'),
    )
  }
  return aligned
}

export function formatMetrics(opts: {
  clashWeight: number
  red: number
  proven: boolean
  provenLevels?: string[]
  status: string
  seconds: number
  workers: number
  structuralImpossible?: boolean
}): string {
  return box('Result', formatMetricsLines(opts))
}

const PANEL_DEFAULT_MAX_LINES = 100

/**
 * One panel shape for every summary. TTY renders Clack's note chrome (body
 * pre-wrapped to the terminal width so long lines never overflow); piped
 * runs fall back to the bordered box. Bodies are capped with an explicit
 * "+N more" tail so huge lists (placements, violations, issues) can't flood
 * scrollback — full detail already lives in the exported JSON/XLSX files.
 */
export function showPanel(
  title: string,
  body: string,
  opts: { maxLines?: number } = {},
): void {
  const maxLines = opts.maxLines ?? PANEL_DEFAULT_MAX_LINES
  let lines = body.split('\n')
  while (lines.length > 0 && lines[0]!.trim() === '') lines = lines.slice(1)
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines = lines.slice(0, -1)
  if (lines.length === 0) {
    p.log.info(palette.dim(`(${title}: nothing to show)`))
    return
  }
  if (process.stdout.isTTY) {
    const rawColumns = process.stdout.columns ?? 0
    // Clack note reserves its left chrome. Never assume a 40-column terminal:
    // on a narrow TTY that assumption is exactly what caused panels to spill.
    const wrapWidth = Math.max(4, (rawColumns > 0 ? rawColumns : 100) - 10)
    const wrapped = lines.flatMap((line) => wrapAnsi(line, wrapWidth))
    const shown =
      wrapped.length > maxLines
        ? [
            ...wrapped.slice(0, maxLines),
            palette.dim(`… +${wrapped.length - maxLines} more lines (full detail in exported files)`),
          ]
        : wrapped
    p.note(
      shown.join('\n'),
      truncateVisible(title, wrapWidth),
    )
    return
  }
  if (lines.length > maxLines) {
    lines = [
      ...lines.slice(0, maxLines),
      palette.dim(`… +${lines.length - maxLines} more lines (full detail in exported files)`),
    ]
  }
  process.stdout.write('\n' + box(title, lines) + '\n')
}

/** Grouped Saturday-policy prompt (t3-style): one confirm + one text. */
export async function promptSaturdayPolicy(opts: {
  initialAllow: boolean
  initialExtras: string[]
}): Promise<{ allowSaturdayForMath: boolean; extras: string[] } | 'cancelled'> {
  const allow = await p.confirm({
    message: 'Use Saturday slot for maths courses? (temporarily blocked by default)',
    initialValue: opts.initialAllow,
  })
  if (p.isCancel(allow)) return 'cancelled'
  const extrasAnswer = await textPrompt({
    message: 'Extra course codes allowed on Saturday (comma-separated, optional)',
    placeholder: 'e.g. 21CSE101T, 21ECE202T',
    initialValue: opts.initialExtras.length ? opts.initialExtras.join(', ') : '',
  })
  if (p.isCancel(extrasAnswer)) return 'cancelled'
  const { normalizeSaturdayExtraCodes } = await import(
    '../src/modules/scheduling/solver/timeModel.ts'
  )
  return {
    allowSaturdayForMath: Boolean(allow),
    extras: normalizeSaturdayExtraCodes(String(extrasAnswer ?? '')),
  }
}

export { pad };

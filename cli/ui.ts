import * as p from '@clack/prompts'
import chalk from 'chalk'
import { cpus } from 'node:os'
import type { CpsatProgressEvent } from '../src/modules/scheduling/solver/cpsatInstance.ts'

export type LiveSolveState = {
  phase: string
  phaseLabel: string
  bestClash: number | null
  bestRed: number | null
  bound: number | null
  /** Last elapsed reported by the solver (may stall between heartbeats). */
  solverElapsed: number
  /** Wall clock when solverElapsed was last updated. */
  solverElapsedAt: number
  workers: number
  solutions: number
  activity: 'searching' | 'improving' | 'proving' | 'idle'
  secondsSinceImprove: number
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0.0s'
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}m ${s.toFixed(0).padStart(2, '0')}s`
}

function activityText(activity: LiveSolveState['activity'], idle: number): string {
  switch (activity) {
    case 'improving':
      return chalk.green('improving')
    case 'proving':
      return chalk.yellow(`proving (${formatDuration(idle)} since last improve)`)
    case 'searching':
      return chalk.cyan('searching')
    default:
      return chalk.dim('…')
  }
}

export function createSolveSpinner(workers = cpus().length) {
  const spin = p.spinner()
  const state: LiveSolveState = {
    phase: 'starting',
    phaseLabel: 'Starting',
    bestClash: null,
    bestRed: null,
    bound: null,
    solverElapsed: 0,
    solverElapsedAt: Date.now(),
    workers,
    solutions: 0,
    activity: 'idle',
    secondsSinceImprove: 0,
  }

  /** raw = one-off pipeline message; cpsat = live solver line (ticker refreshes). */
  let mode: 'raw' | 'cpsat' = 'raw'
  let rawMessage = 'Working…'
  let tickTimer: ReturnType<typeof setInterval> | null = null

  const liveElapsed = () => {
    const drift = (Date.now() - state.solverElapsedAt) / 1000
    return state.solverElapsed + Math.max(0, drift)
  }

  const cpsatLabel = () => {
    const clash = state.bestClash == null ? '—' : chalk.bold(String(state.bestClash))
    const red = state.bestRed == null ? '—' : chalk.bold(String(state.bestRed))
    let gap = ''
    if (state.bound != null && state.bestClash != null) {
      const g = state.bestClash - state.bound
      gap =
        g <= 0
          ? chalk.dim(' · gap 0')
          : chalk.dim(` · bound ${state.bound} · gap ${g}`)
    }
    return (
      `${chalk.cyan(state.phaseLabel)}  ` +
      `clash ${clash}  RED ${red}${gap}  ` +
      `${activityText(state.activity, state.secondsSinceImprove)}  ` +
      chalk.dim(`${formatDuration(liveElapsed())} · ${state.workers}w`)
    )
  }

  const refresh = () => {
    if (mode === 'cpsat') spin.message(cpsatLabel())
    else spin.message(rawMessage)
  }

  return {
    start(message = 'CP-SAT searching…') {
      mode = 'raw'
      rawMessage = message
      spin.start(message)
      if (!tickTimer) {
        tickTimer = setInterval(refresh, 250)
        tickTimer.unref?.()
      }
    },
    updateFromPipeline(message: string) {
      mode = 'raw'
      rawMessage = message
      spin.message(message)
    },
    applyCpsat(evt: CpsatProgressEvent) {
      mode = 'cpsat'
      if (evt.type === 'phase') {
        state.phase = evt.phase
        state.phaseLabel = evt.phase_label ?? evt.phase
        state.activity = 'searching'
        if (typeof evt.elapsed === 'number') {
          state.solverElapsed = evt.elapsed
          state.solverElapsedAt = Date.now()
        }
        refresh()
        return
      }
      if (evt.type === 'progress' || evt.type === 'heartbeat') {
        state.phase = evt.phase
        state.phaseLabel = evt.phase_label ?? evt.phase
        if (evt.best_clash !== undefined) state.bestClash = evt.best_clash
        if (evt.best_red !== undefined) state.bestRed = evt.best_red
        if (evt.bound !== undefined && evt.bound !== null) state.bound = evt.bound
        state.solverElapsed = evt.elapsed
        state.solverElapsedAt = Date.now()
        state.workers = evt.workers
        state.solutions = evt.solutions
        state.activity = evt.activity ?? state.activity
        state.secondsSinceImprove = evt.seconds_since_improve ?? state.secondsSinceImprove
        refresh()
        return
      }
      if (evt.type === 'start') {
        state.phaseLabel = 'Building model'
        state.activity = 'searching'
        state.workers = evt.workers
        refresh()
        return
      }
      if (evt.type === 'model_ready') {
        state.phaseLabel = '1/3 Minimizing clashes'
        state.activity = 'searching'
        refresh()
      }
    },
    stop(finalMessage?: string) {
      if (tickTimer) {
        clearInterval(tickTimer)
        tickTimer = null
      }
      spin.stop(finalMessage ?? (mode === 'cpsat' ? cpsatLabel() : rawMessage))
    },
    state,
  }
}

export function banner(): void {
  p.intro(chalk.bold.magenta('UniSlot') + chalk.dim(' · terminal CP-SAT scheduler'))
}

export function outroSuccess(lines: string[]): void {
  p.outro(lines.join('\n'))
}

export function formatMetrics(opts: {
  clashWeight: number
  red: number
  proven: boolean
  status: string
  seconds: number
  workers: number
  structuralImpossible?: boolean
}): string {
  const proof = opts.proven
    ? chalk.green('proven optimal — clashes cannot be reduced further')
    : chalk.yellow('best feasible (search not fully proven)')
  const structural = opts.structuralImpossible
    ? chalk.dim('\n  Note: structural lower bounds say zero-clash is impossible for this enrollment.')
    : ''
  return [
    `${chalk.bold('Status')}     ${opts.status}`,
    `${chalk.bold('Clash wt')}   ${opts.clashWeight}`,
    `${chalk.bold('RED')}        ${opts.red}`,
    `${chalk.bold('Proof')}      ${proof}`,
    `${chalk.bold('Time')}       ${opts.seconds.toFixed(2)}s · ${opts.workers} workers`,
    structural,
  ]
    .filter(Boolean)
    .join('\n')
}

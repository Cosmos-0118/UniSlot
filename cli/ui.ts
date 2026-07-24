import * as p from '@clack/prompts'
import chalk from 'chalk'
import { cpus } from 'node:os'
import type {
  CpsatPortfolioMeta,
  CpsatProgressEvent,
} from '../src/modules/scheduling/solver/cpsatInstance.ts'

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

type RaceLane = {
  index: number
  seed: number
  workers: number
  clash: number | null
  red: number | null
  bound: number | null
  activity: LiveSolveState['activity']
  elapsed: number
  elapsedAt: number
  secondsSinceImprove: number
  done: boolean
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

function laneStatus(activity: LiveSolveState['activity'], idle: number, done: boolean): string {
  if (done) return chalk.dim('done')
  switch (activity) {
    case 'improving':
      return chalk.green('improving')
    case 'proving':
      return chalk.yellow(`proving ${formatDuration(idle)}`)
    case 'searching':
      return chalk.cyan('searching')
    default:
      return chalk.dim('waiting')
  }
}

function liveOf(elapsed: number, elapsedAt: number): number {
  return elapsed + Math.max(0, (Date.now() - elapsedAt) / 1000)
}

function padClash(n: number | null): string {
  if (n == null) return chalk.dim('—'.padStart(4))
  return chalk.bold(String(n).padStart(4))
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

  /** Portfolio race lanes (null when not racing). */
  let race: {
    size: number
    memberWorkers: number
    raceSeconds: number
    lanes: Map<number, RaceLane>
    bestClash: number | null
    bestRed: number | null
  } | null = null

  /** raw = one-off pipeline message; cpsat = live solver line (ticker refreshes). */
  let mode: 'raw' | 'cpsat' = 'raw'
  let rawMessage = 'Working…'
  let tickTimer: ReturnType<typeof setInterval> | null = null

  const clearRace = () => {
    race = null
  }

  const ensureLane = (meta: CpsatPortfolioMeta): RaceLane => {
    if (!race) {
      race = {
        size: meta.size,
        memberWorkers: meta.member_workers,
        raceSeconds: meta.race_seconds ?? 0,
        lanes: new Map(),
        bestClash: null,
        bestRed: null,
      }
    }
    let lane = race.lanes.get(meta.index)
    if (!lane) {
      lane = {
        index: meta.index,
        seed: meta.seed,
        workers: meta.member_workers,
        clash: null,
        red: null,
        bound: null,
        activity: 'searching',
        elapsed: 0,
        elapsedAt: Date.now(),
        secondsSinceImprove: 0,
        done: false,
      }
      race.lanes.set(meta.index, lane)
    }
    return lane
  }

  const recomputeRaceBest = () => {
    if (!race) return
    let bestC: number | null = null
    let bestR: number | null = null
    for (const lane of race.lanes.values()) {
      if (lane.clash == null) continue
      if (
        bestC == null ||
        lane.clash < bestC ||
        (lane.clash === bestC && (lane.red ?? Infinity) < (bestR ?? Infinity))
      ) {
        bestC = lane.clash
        bestR = lane.red
      }
    }
    race.bestClash = bestC
    race.bestRed = bestR
  }

  const liveElapsed = () => liveOf(state.solverElapsed, state.solverElapsedAt)

  const proveLabel = () => {
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

  const portfolioLabel = (): string => {
    if (!race) return proveLabel()
    const headerBest =
      race.bestClash == null
        ? chalk.dim('best —')
        : `best clash ${chalk.bold(String(race.bestClash))}  RED ${chalk.bold(String(race.bestRed ?? '—'))}`
    const budget =
      race.raceSeconds > 0 ? chalk.dim(` · ${race.raceSeconds}s budget`) : ''
    const totalW = race.size * race.memberWorkers
    const lines: string[] = [
      `${chalk.magenta('Portfolio race')} · ${race.size} seeds × ${race.memberWorkers}w` +
        chalk.dim(` (${totalW} workers)`) +
        `${budget}  ${headerBest}`,
    ]

    const ordered = [...race.lanes.values()].sort((a, b) => a.index - b.index)
    const width = Math.max(1, String(race.size).length)

    for (const lane of ordered) {
      const isBest =
        lane.clash != null &&
        race.bestClash != null &&
        lane.clash === race.bestClash &&
        (lane.red ?? null) === (race.bestRed ?? null)
      const tag = String(lane.index).padStart(width)
      const seedLabel = `seed ${lane.seed}`.padEnd(10)
      const mark = isBest ? chalk.green('★') : ' '
      const status = laneStatus(lane.activity, lane.secondsSinceImprove, lane.done)
      const time = formatDuration(liveOf(lane.elapsed, lane.elapsedAt)).padStart(6)
      lines.push(
        `  ${mark}${chalk.dim(`#${tag}`)} ${seedLabel}  ` +
          `clash ${padClash(lane.clash)}  RED ${padClash(lane.red)}  ` +
          `${status}  ` +
          chalk.dim(`${time} · ${lane.workers}w`),
      )
    }
    return lines.join('\n')
  }

  const cpsatLabel = () => (race ? portfolioLabel() : proveLabel())

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

      if (evt.type === 'phase' && evt.phase === 'portfolio_race') {
        const seeds = evt.portfolio_seeds ?? []
        const memberWorkers = evt.portfolio_member_workers ?? 2
        const raceSeconds = evt.portfolio_race_seconds ?? 0
        race = {
          size: seeds.length || (evt.workers ? Math.max(1, Math.floor((evt.workers ?? 2) / memberWorkers)) : 5),
          memberWorkers,
          raceSeconds,
          lanes: new Map(),
          bestClash: null,
          bestRed: null,
        }
        seeds.forEach((seed, i) => {
          race!.lanes.set(i + 1, {
            index: i + 1,
            seed,
            workers: memberWorkers,
            clash: null,
            red: null,
            bound: null,
            activity: 'searching',
            elapsed: 0,
            elapsedAt: Date.now(),
            secondsSinceImprove: 0,
            done: false,
          })
        })
        state.phase = evt.phase
        state.phaseLabel = evt.phase_label ?? evt.phase
        state.workers = evt.workers ?? race.size * memberWorkers
        state.activity = 'searching'
        refresh()
        return
      }

      if (evt.type === 'phase' && evt.phase === 'portfolio_best') {
        if (race) {
          race.bestClash = evt.clash_weight ?? race.bestClash
          race.bestRed = evt.red_students ?? race.bestRed
        }
        state.phaseLabel = evt.phase_label ?? 'Portfolio best'
        refresh()
        return
      }

      // Leaving the race → prove phase (events without portfolio meta).
      if (evt.portfolio) {
        const lane = ensureLane(evt.portfolio)
        if (evt.type === 'progress' || evt.type === 'heartbeat') {
          if (evt.best_clash !== undefined) lane.clash = evt.best_clash
          if (evt.best_red !== undefined) lane.red = evt.best_red
          if (evt.bound !== undefined && evt.bound !== null) lane.bound = evt.bound
          lane.elapsed = evt.elapsed
          lane.elapsedAt = Date.now()
          lane.workers = evt.workers || evt.portfolio.member_workers
          lane.activity = evt.activity ?? lane.activity
          lane.secondsSinceImprove = evt.seconds_since_improve ?? lane.secondsSinceImprove
          if (evt.event === 'phase_end' || evt.solver_status) lane.done = true
          recomputeRaceBest()
        } else if (evt.type === 'start' || evt.type === 'model_ready' || evt.type === 'phase') {
          lane.activity = 'searching'
          lane.workers = evt.portfolio.member_workers
        } else if (evt.type === 'done') {
          lane.done = true
          if (evt.clash_weight != null) lane.clash = evt.clash_weight
          if (evt.red_students != null) lane.red = evt.red_students
          recomputeRaceBest()
        }
        refresh()
        return
      }

      // Normal prove / single-solver path
      if (race && (evt.type === 'start' || evt.type === 'phase' || evt.type === 'model_ready')) {
        clearRace()
      }

      if (evt.type === 'phase') {
        state.phase = evt.phase
        state.phaseLabel = evt.phase_label ?? evt.phase
        state.activity = 'searching'
        if (typeof evt.workers === 'number' && evt.workers > 0) state.workers = evt.workers
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

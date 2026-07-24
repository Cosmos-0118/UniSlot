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
  solverElapsed: number
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

type Stage = 'pipeline' | 'race' | 'prove'

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
const PULSE = ['·', '◦', '●', '◦'] as const
/** Paint / animation rate — keep low to avoid flicker. */
const TICK_MS = 100
/** Pad every frame to this many columns so leftovers never ghost. */
const COLS = 88

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0.0s'
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}m ${s.toFixed(0).padStart(2, '0')}s`
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

function padNum(n: number | null, width = 4): string {
  if (n == null) return chalk.dim('—'.padStart(width))
  return chalk.bold(String(n).padStart(width))
}

/** Visible length ignoring ANSI CSI sequences. */
function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length
}

function padLine(s: string, width = COLS): string {
  const len = visibleLen(s)
  if (len >= width) return s
  return s + ' '.repeat(width - len)
}

/**
 * Smooth in-place panel: fixed-height, line-diff updates, no full-screen erase.
 * (Full `\x1b[0J` clears caused visible flicker against the terminal background.)
 */
function createLivePanel() {
  let prev: string[] = []
  let hidden = false
  const out = process.stdout
  const isTty = Boolean(out.isTTY)

  const hideCursor = () => {
    if (isTty && !hidden) {
      out.write('\x1b[?25l')
      hidden = true
    }
  }

  const showCursor = () => {
    if (isTty && hidden) {
      out.write('\x1b[?25h')
      hidden = false
    }
  }

  const clear = () => {
    if (!isTty || prev.length === 0) {
      prev = []
      return
    }
    out.write(`\x1b[${prev.length}A`)
    for (let i = 0; i < prev.length; i++) {
      out.write('\x1b[2K\n')
    }
    out.write(`\x1b[${prev.length}A`)
    prev = []
  }

  const paint = (rawLines: string[]) => {
    hideCursor()
    const lines = rawLines.map((l) => padLine(l))
    if (!isTty) {
      out.write(lines.join('\n') + '\n')
      return
    }

    if (prev.length > 0) {
      out.write(`\x1b[${prev.length}A`)
    }

    const height = Math.max(prev.length, lines.length)
    const nextFrame: string[] = []
    for (let i = 0; i < height; i++) {
      const next = lines[i] ?? padLine('')
      nextFrame.push(next)
      if (prev[i] === next) {
        out.write('\x1b[1B')
      } else {
        out.write(`\x1b[2K\r${next}\n`)
      }
    }
    prev = nextFrame.slice(0, Math.max(lines.length, 1))
  }

  return {
    paint,
    clear,
    finish(finalLine?: string) {
      clear()
      showCursor()
      if (finalLine) p.log.step(finalLine)
    },
    discard() {
      clear()
      showCursor()
    },
    isTty,
  }
}

export function createSolveSpinner(workers = cpus().length) {
  const panel = createLivePanel()
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

  let stage: Stage = 'pipeline'
  let race: {
    size: number
    memberWorkers: number
    raceSeconds: number
    startedAt: number
    lanes: Map<number, RaceLane>
    bestClash: number | null
    bestRed: number | null
  } | null = null

  /** Snapshot kept after race so prove panel keeps seed rows visible. */
  let warmClash: number | null = null
  let warmRed: number | null = null

  let rawMessage = 'Working…'
  let tick = 0
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let dirty = true
  let lastNonTtyKey = ''

  /** Fixed panel height so race → prove never collapses (no “rows vanished” jump). */
  const panelHeight = () => {
    const seeds = race?.size ?? 0
    // header + meta + N lanes (+ blank pad to at least 3)
    return 2 + Math.max(seeds, 1)
  }

  const ensureLane = (meta: CpsatPortfolioMeta): RaceLane => {
    if (!race) {
      race = {
        size: meta.size,
        memberWorkers: meta.member_workers,
        raceSeconds: meta.race_seconds ?? 0,
        startedAt: Date.now(),
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
  const spinGlyph = () => chalk.magenta(SPINNER[tick % SPINNER.length])
  const pulseGlyph = () => chalk.magenta(PULSE[Math.floor(tick / 2) % PULSE.length])

  const sparkRow = (n: number, activeHint?: number): string => {
    const cells: string[] = []
    const traveling = tick % Math.max(1, n)
    for (let i = 0; i < n; i++) {
      if (activeHint != null && i + 1 === activeHint) cells.push(chalk.green('●'))
      else if (i === traveling && stage === 'race') cells.push(chalk.magenta('●'))
      else cells.push(chalk.dim('·'))
    }
    return cells.join(' ')
  }

  const bestLaneIndex = (): number | undefined => {
    if (!race || race.bestClash == null) return undefined
    for (const lane of race.lanes.values()) {
      if (lane.clash === race.bestClash && (lane.red ?? null) === (race.bestRed ?? null)) {
        return lane.index
      }
    }
    return undefined
  }

  const laneLines = (): string[] => {
    if (!race) return [chalk.dim('  (waiting for solver…)')]
    const ordered = [...race.lanes.values()].sort((a, b) => a.index - b.index)
    const width = Math.max(1, String(race.size).length)
    return ordered.map((lane) => {
      const isBest =
        lane.clash != null &&
        race!.bestClash != null &&
        lane.clash === race!.bestClash &&
        (lane.red ?? null) === (race!.bestRed ?? null)
      const tag = String(lane.index).padStart(width)
      const seedLabel = `seed ${lane.seed}`.padEnd(10)
      const mark = isBest ? chalk.green('★') : chalk.dim('·')
      const status = laneStatus(lane.activity, lane.secondsSinceImprove, lane.done)
      const time = formatDuration(liveOf(lane.elapsed, lane.elapsedAt)).padStart(6)
      return (
        `  ${mark} ${chalk.dim(`#${tag}`)} ${seedLabel} ` +
        `clash ${padNum(lane.clash)}  RED ${padNum(lane.red)}  ` +
        `${status}  ` +
        chalk.dim(`${time} · ${lane.workers}w`)
      )
    })
  }

  const buildFrame = (): string[] => {
    if (stage === 'pipeline') {
      const lines = [`${spinGlyph()} ${rawMessage}`]
      while (lines.length < panelHeight()) lines.push('')
      return lines
    }

    if (!race) {
      const lines = [
        `${spinGlyph()} ${chalk.cyan(state.phaseLabel)} ${pulseGlyph()} ` +
          chalk.dim(`${state.workers}w · ${formatDuration(liveElapsed())}`),
        `  clash ${padNum(state.bestClash)}  RED ${padNum(state.bestRed)}`,
      ]
      while (lines.length < panelHeight()) lines.push('')
      return lines
    }

    const lanes = laneLines()
    const bestIdx = bestLaneIndex()

    if (stage === 'race') {
      const wall = (Date.now() - race.startedAt) / 1000
      const budget =
        race.raceSeconds > 0
          ? chalk.dim(
              ` · ${formatDuration(Math.min(wall, race.raceSeconds))} / ${race.raceSeconds}s`,
            )
          : chalk.dim(` · ${formatDuration(wall)}`)
      const headerBest =
        race.bestClash == null
          ? chalk.dim('best —')
          : `best ${chalk.bold.green(String(race.bestClash))} / RED ${chalk.bold.green(String(race.bestRed ?? '—'))}`
      const totalW = race.size * race.memberWorkers
      return [
        `${spinGlyph()} ${chalk.magenta('Portfolio race')} ${pulseGlyph()} ` +
          `${race.size} seeds × ${race.memberWorkers}w` +
          chalk.dim(` (${totalW} workers)`) +
          `${budget}`,
        `  ${sparkRow(race.size, bestIdx)}   ${headerBest}`,
        ...lanes,
      ]
    }

    // Prove — keep seed rows (frozen) so the panel never collapses.
    const clash = state.bestClash
    const red = state.bestRed
    let gapPart = chalk.dim('gap —')
    if (state.bound != null && clash != null) {
      const g = clash - state.bound
      gapPart =
        g <= 0
          ? chalk.green('gap 0')
          : chalk.dim(`bound ${state.bound} · gap ${g}`)
    }
    const act =
      state.activity === 'improving'
        ? chalk.green('improving')
        : state.activity === 'proving'
          ? chalk.yellow(`proving ${formatDuration(state.secondsSinceImprove)}`)
          : chalk.cyan('searching')
    const warm =
      warmClash != null
        ? chalk.dim(`warm ${warmClash}/${warmRed ?? '—'}`)
        : chalk.dim('warm —')

    return [
      `${spinGlyph()} ${chalk.cyan('Prove')} ${pulseGlyph()} ` +
        `${state.phaseLabel}` +
        chalk.dim(` · ${state.workers}w · ${formatDuration(liveElapsed())}`),
      `  ${sparkRow(race.size, bestIdx)}   ${warm}  →  ` +
        `clash ${padNum(clash)}  RED ${padNum(red)}  ${gapPart}  ${act}`,
      ...lanes,
    ]
  }

  const paint = () => {
    if (!dirty && stage !== 'race' && stage !== 'prove' && stage !== 'pipeline') return
    // Always paint on tick while live so spinner/pulse animate; dirty forces immediate.
    const lines = buildFrame()
    if (!panel.isTty) {
      const key = lines.join('\n').replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏·◦●]/g, '')
      if (key === lastNonTtyKey) return
      lastNonTtyKey = key
    }
    panel.paint(lines)
    dirty = false
  }

  const markDirty = () => {
    dirty = true
  }

  const freezeRaceForProve = () => {
    if (!race) return
    warmClash = race.bestClash
    warmRed = race.bestRed
    for (const lane of race.lanes.values()) {
      lane.done = true
      lane.activity = 'idle'
    }
    stage = 'prove'
    // Seed prove metrics from warm start until first progress arrives.
    if (state.bestClash == null && warmClash != null) state.bestClash = warmClash
    if (state.bestRed == null && warmRed != null) state.bestRed = warmRed
    markDirty()
  }

  const refresh = () => {
    tick++
    dirty = true // animate spinner/pulse every tick
    paint()
  }

  return {
    start(message = 'CP-SAT searching…') {
      stage = 'pipeline'
      rawMessage = message
      markDirty()
      if (!tickTimer) {
        tickTimer = setInterval(refresh, TICK_MS)
        tickTimer.unref?.()
      }
      paint()
    },
    updateFromPipeline(message: string) {
      stage = 'pipeline'
      rawMessage = message
      markDirty()
      // Don't paint here — timer will pick it up (smoother).
    },
    applyCpsat(evt: CpsatProgressEvent) {
      if (evt.type === 'phase' && evt.phase === 'portfolio_race') {
        const seeds = evt.portfolio_seeds ?? []
        const memberWorkers = evt.portfolio_member_workers ?? 2
        const raceSeconds = evt.portfolio_race_seconds ?? 0
        stage = 'race'
        race = {
          size:
            seeds.length ||
            (evt.workers ? Math.max(1, Math.floor((evt.workers ?? 2) / memberWorkers)) : 5),
          memberWorkers,
          raceSeconds,
          startedAt: Date.now(),
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
        markDirty()
        return
      }

      if (evt.type === 'phase' && evt.phase === 'portfolio_best') {
        if (race) {
          race.bestClash = evt.clash_weight ?? race.bestClash
          race.bestRed = evt.red_students ?? race.bestRed
          warmClash = race.bestClash
          warmRed = race.bestRed
          for (const lane of race.lanes.values()) {
            lane.done = true
          }
        }
        state.phaseLabel = evt.phase_label ?? 'Portfolio best'
        markDirty()
        return
      }

      if (evt.portfolio) {
        stage = 'race'
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
        markDirty()
        return
      }

      // Prove-phase events (no portfolio meta) — keep seed rows, switch header.
      if (race && (evt.type === 'start' || evt.type === 'phase' || evt.type === 'model_ready')) {
        freezeRaceForProve()
      } else if (!race) {
        stage = 'prove'
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
        markDirty()
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
        markDirty()
        return
      }
      if (evt.type === 'start') {
        state.phaseLabel = 'Building model'
        state.activity = 'searching'
        state.workers = evt.workers
        markDirty()
        return
      }
      if (evt.type === 'model_ready') {
        state.phaseLabel = '1/3 Minimizing clashes'
        state.activity = 'searching'
        markDirty()
      }
    },
    stop(finalMessage?: string) {
      if (tickTimer) {
        clearInterval(tickTimer)
        tickTimer = null
      }
      let summary = finalMessage
      if (!summary) {
        if (stage === 'race' && race) {
          summary = `Portfolio · best clash ${race.bestClash ?? '—'} · RED ${race.bestRed ?? '—'}`
        } else if (stage === 'prove') {
          summary = `${state.phaseLabel} · clash ${state.bestClash ?? '—'} · RED ${state.bestRed ?? '—'} · ${state.workers}w`
        } else {
          summary = rawMessage
        }
      }
      panel.finish(summary)
    },
    cancel() {
      if (tickTimer) {
        clearInterval(tickTimer)
        tickTimer = null
      }
      panel.discard()
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

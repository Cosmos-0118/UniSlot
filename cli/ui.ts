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

type RaceLane = {
  index: number
  seed: number
  workers: number
  clash: number | null
  red: number | null
  bound: number | null
  activity: LiveSolveState['activity']
  /** Frozen wall time once the lane is done (seconds). */
  elapsed: number
  elapsedAt: number
  secondsSinceImprove: number
  done: boolean
}

/** Live panel stage: race seeds, clash prove (+ seeds), then compact lex steps. */
type Stage = 'pipeline' | 'race' | 'clash' | 'red' | 'balance'

/**
 * Ambient paint rate. Line-diff rendering keeps this flicker-free;
 * ~12.5 FPS is enough for smooth Braille motion without stealing CPU from CP-SAT.
 */
const TICK_MS = 80
/** Pad every frame to this many columns so leftovers never ghost. */
const COLS = 88

/** Soft Braille spinner — one cell, low visual noise. */
const BRAILLE_SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
/** Density ramp for indeterminate Braille ribbons (empty → full). */
const BRAILLE_LEVEL = ['⠀', '⢀', '⢠', '⢰', '⢸', '⣸', '⣼', '⣾', '⣿'] as const
const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const
const HISTORY_CAP = 24

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

function padNum(n: number | null, width = 4): string {
  if (n == null) return chalk.dim('—'.padStart(width))
  return chalk.bold(String(n).padStart(width))
}

function activityLabel(activity: LiveSolveState['activity'], idle: number): string {
  switch (activity) {
    case 'improving':
      return chalk.green('improving')
    case 'proving':
      return chalk.yellow(`proving ${formatDuration(idle)}`)
    case 'searching':
      return chalk.cyan('searching')
    default:
      return chalk.dim('idle')
  }
}

function laneStatus(activity: LiveSolveState['activity'], idle: number, done: boolean): string {
  if (done) return chalk.dim('done')
  return activityLabel(activity, idle)
}

function gapLabel(value: number | null, bound: number | null): string {
  if (value == null || bound == null) return chalk.dim('gap —')
  const g = value - bound
  return g <= 0 ? chalk.green('gap 0') : chalk.dim(`bound ${bound} · gap ${g}`)
}

/** Visible length ignoring ANSI CSI sequences. */
function visibleLen(s: string): number {
  // Build without a literal ESC so eslint no-control-regex stays clean.
  return s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '').length
}

function padLine(s: string, width = COLS): string {
  const len = visibleLen(s)
  if (len >= width) return s
  return s + ' '.repeat(width - len)
}

/** Strip decorative motion glyphs so non-TTY logs stay quiet. */
function stripMotion(s: string): string {
  return s.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠀⢀⢠⢰⢸⣸⣼⣾⣿▁▂▃▄▅▆▇█●○★·]/g, '')
}

/**
 * Sliding Braille ribbon — ambient “still working” motion that never hard-loops
 * the same shape (phase drifts with tick; soft Gaussian hotspot).
 */
function brailleRibbon(tick: number, width = 18, tone: 'cyan' | 'green' | 'yellow' | 'dim' = 'cyan'): string {
  const cells: string[] = []
  const center = ((tick * 0.35) % (width + 6)) - 3
  for (let i = 0; i < width; i++) {
    const dist = Math.abs(i - center)
    const falloff = Math.max(0, 1 - dist / 4.2)
    const breathe = 0.35 + 0.65 * falloff
    const idx = Math.min(BRAILLE_LEVEL.length - 1, Math.floor(breathe * (BRAILLE_LEVEL.length - 1) + 0.001))
    cells.push(BRAILLE_LEVEL[idx]!)
  }
  const raw = cells.join('')
  switch (tone) {
    case 'green':
      return chalk.green(raw)
    case 'yellow':
      return chalk.yellow(raw)
    case 'dim':
      return chalk.dim(raw)
    default:
      return chalk.cyan(raw)
  }
}

/** Determinate bar with Braille sub-cell fill. */
function progressBar(frac: number, width = 18): string {
  const t = Math.max(0, Math.min(1, frac))
  const exact = t * width
  const full = Math.floor(exact)
  const partial = exact - full
  let bar = ''
  for (let i = 0; i < width; i++) {
    if (i < full) {
      bar += '⣿'
    } else if (i === full && partial > 0.02) {
      const idx = Math.max(
        1,
        Math.min(BRAILLE_LEVEL.length - 1, Math.round(partial * (BRAILLE_LEVEL.length - 1))),
      )
      bar += BRAILLE_LEVEL[idx]!
    } else {
      bar += '⠀'
    }
  }
  const colored =
    t >= 1 ? chalk.green(bar) : t > 0.75 ? chalk.yellow(bar) : chalk.cyan(bar)
  return colored
}

function sparkline(history: number[], width = 16): string {
  if (history.length === 0) return chalk.dim('░'.repeat(Math.min(width, 8)))
  const slice = history.slice(-width)
  const min = Math.min(...slice)
  const max = Math.max(...slice)
  const span = Math.max(1e-9, max - min)
  // Lower objective is better → invert so improvements rise visually.
  return slice
    .map((v) => {
      const norm = 1 - (v - min) / span
      const idx = Math.min(SPARK.length - 1, Math.floor(norm * (SPARK.length - 1) + 0.001))
      return chalk.cyan(SPARK[idx]!)
    })
    .join('')
}

function activityTone(activity: LiveSolveState['activity']): 'cyan' | 'green' | 'yellow' | 'dim' {
  switch (activity) {
    case 'improving':
      return 'green'
    case 'proving':
      return 'yellow'
    case 'searching':
      return 'cyan'
    default:
      return 'dim'
  }
}

function pushHistory(buf: number[], value: number | null | undefined): void {
  if (value == null || !Number.isFinite(value)) return
  const last = buf[buf.length - 1]
  if (last === value && buf.length > 0) return
  buf.push(value)
  if (buf.length > HISTORY_CAP) buf.shift()
}

function stepTrack(active: 1 | 2 | 3): string {
  const mark = (n: 1 | 2 | 3, label: string) => {
    if (n < active) return chalk.dim(`✓ ${n}/3 ${label}`)
    if (n === active) return chalk.cyan(`● ${n}/3 ${label}`)
    return chalk.dim(`○ ${n}/3 ${label}`)
  }
  return `  ${mark(1, 'clash')}  ${mark(2, 'RED')}  ${mark(3, 'balance')}`
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
    /** Commit a completed step to scrollback, then resume the live panel below. */
    checkpoint(message: string) {
      clear()
      showCursor()
      p.log.step(message)
      prev = []
    },
    discard() {
      clear()
      showCursor()
    },
    isTty,
  }
}

function lexStageFromPhase(phase: string): Stage | null {
  if (phase === 'minimize_clash') return 'clash'
  if (phase === 'minimize_red') return 'red'
  if (phase === 'minimize_balance') return 'balance'
  return null
}

export function createSolveSpinner(workers = cpus().length) {
  const panel = createLivePanel()
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
  let race: {
    size: number
    memberWorkers: number
    raceSeconds: number
    startedAt: number
    lanes: Map<number, RaceLane>
    bestClash: number | null
    bestRed: number | null
  } | null = null

  /** Snapshot kept after race so clash prove can show warm start. */
  let warmClash: number | null = null
  let warmRed: number | null = null
  let clashProven = false
  let redProven = false
  let raceCheckpointed = false

  let rawMessage = 'Working…'
  let tick = 0
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let dirty = true
  let lastNonTtyKey = ''
  const clashHistory: number[] = []
  const redHistory: number[] = []

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

  const freezeLaneClocks = () => {
    if (!race) return
    for (const lane of race.lanes.values()) {
      if (!lane.done) continue
      lane.elapsed = liveOf(lane.elapsed, lane.elapsedAt)
      lane.elapsedAt = Date.now()
      lane.activity = 'idle'
    }
  }

  const liveElapsed = () => liveOf(state.solverElapsed, state.solverElapsedAt)
  const spinGlyph = () => chalk.cyan(BRAILLE_SPIN[tick % BRAILLE_SPIN.length])

  const laneLines = (): string[] => {
    if (!race) return [chalk.dim('  waiting for solver…')]
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
      const secs = lane.done ? lane.elapsed : liveOf(lane.elapsed, lane.elapsedAt)
      const time = formatDuration(secs).padStart(6)
      return (
        `  ${mark} ${chalk.dim(`#${tag}`)} ${seedLabel} ` +
        `clash ${padNum(lane.clash)}  RED ${padNum(lane.red)}  ` +
        `${status}  ` +
        chalk.dim(time)
      )
    })
  }

  const header = (title: string, detail: string) =>
    `${spinGlyph()} ${chalk.bold(title)}` +
    (detail ? chalk.dim(`  ${detail}`) : '') +
    chalk.dim(`  ·  ${state.workers}w  ·  ${formatDuration(liveElapsed())}`)

  const buildRaceFrame = (): string[] => {
    if (!race) return [`${spinGlyph()}  ${rawMessage}`, `  ${brailleRibbon(tick, 20)}`]
    const lanes = laneLines()
    const wall = (Date.now() - race.startedAt) / 1000
    const totalW = race.size * race.memberWorkers
    const timeBit =
      race.raceSeconds > 0
        ? chalk.dim(
            `${formatDuration(Math.min(wall, race.raceSeconds))} / ${race.raceSeconds}s`,
          )
        : chalk.dim(formatDuration(wall))
    const headerBest =
      race.bestClash == null
        ? chalk.dim('best —')
        : `best ${chalk.bold.green(String(race.bestClash))} · RED ${chalk.bold.green(String(race.bestRed ?? '—'))}`

    const ribbon =
      race.raceSeconds > 0
        ? `${progressBar(Math.min(1, wall / race.raceSeconds), 20)}  ${timeBit}`
        : `${brailleRibbon(tick, 20)}  ${timeBit}`

    return [
      `${spinGlyph()} ${chalk.bold('Portfolio race')}  ` +
        chalk.dim(`${race.size} seeds × ${race.memberWorkers}w · ${totalW} workers`),
      `  ${ribbon}    ${headerBest}`,
      ...lanes,
    ]
  }

  const buildClashFrame = (): string[] => {
    const clash = state.bestClash
    const red = state.bestRed
    const act = activityLabel(state.activity, state.secondsSinceImprove)
    const warm =
      warmClash != null
        ? chalk.dim(`warm ${warmClash}/${warmRed ?? '—'}`)
        : chalk.dim('warm —')
    const tone = activityTone(state.activity)
    const motion =
      clashHistory.length > 1
        ? `${brailleRibbon(tick, 10, tone)}  ${sparkline(clashHistory, 14)}`
        : brailleRibbon(tick, 16, tone)
    return [
      header('1/3 Clash', 'minimize clash weight'),
      `  ${motion}  ${warm}  →  clash ${padNum(clash)}  RED ${padNum(red)}  ` +
        `${gapLabel(clash, state.bound)}  ${act}`,
      stepTrack(1),
    ]
  }

  const buildRedFrame = (): string[] => {
    const red = state.bestRed
    const act = activityLabel(state.activity, state.secondsSinceImprove)
    const locked =
      state.bestClash != null
        ? chalk.dim(`locked clash ${state.bestClash}${clashProven ? ' ✓' : ''}`)
        : chalk.dim('locked clash —')
    const tone = activityTone(state.activity)
    const motion =
      redHistory.length > 1
        ? `${brailleRibbon(tick, 10, tone)}  ${sparkline(redHistory, 14)}`
        : brailleRibbon(tick, 16, tone)
    return [
      header('2/3 RED', 'minimize students with clashes'),
      `  ${motion}  ${locked}  →  RED ${padNum(red)}  ${gapLabel(red, state.bound)}  ${act}`,
      stepTrack(2),
    ]
  }

  const buildBalanceFrame = (): string[] => {
    const act = activityLabel(state.activity, state.secondsSinceImprove)
    const locked = chalk.dim(
      `locked clash ${state.bestClash ?? '—'}${clashProven ? ' ✓' : ''}` +
        ` · RED ${state.bestRed ?? '—'}${redProven ? ' ✓' : ''}`,
    )
    const ribbon = brailleRibbon(tick, 14, activityTone(state.activity))
    return [
      header('3/3 Balance', 'spread load across weekdays'),
      `  ${ribbon}  ${locked}  →  balance ${padNum(state.bestBalance)}  parallel ${padNum(state.bestParallelExcess)}  ${act}`,
      stepTrack(3),
    ]
  }

  const buildFrame = (): string[] => {
    if (stage === 'pipeline') {
      return [
        `${spinGlyph()}  ${rawMessage}`,
        `  ${brailleRibbon(tick, 22)}`,
        '',
      ]
    }
    if (stage === 'race') return buildRaceFrame()
    if (stage === 'clash') return buildClashFrame()
    if (stage === 'red') return buildRedFrame()
    if (stage === 'balance') return buildBalanceFrame()

    return [
      header(state.phaseLabel, ''),
      `  ${brailleRibbon(tick, 14, activityTone(state.activity))}  ` +
        `clash ${padNum(state.bestClash)}  RED ${padNum(state.bestRed)}  ` +
        `balance ${padNum(state.bestBalance)}  ${activityLabel(state.activity, state.secondsSinceImprove)}`,
      '',
    ]
  }

  const paint = () => {
    if (!dirty && stage === 'pipeline') return
    const lines = buildFrame()
    if (!panel.isTty) {
      const key = stripMotion(lines.join('\n'))
      if (key === lastNonTtyKey) return
      lastNonTtyKey = key
    }
    panel.paint(lines)
    dirty = false
  }

  const markDirty = () => {
    dirty = true
  }

  const checkpointRace = () => {
    if (raceCheckpointed) return
    raceCheckpointed = true
    freezeLaneClocks()
    const c = race?.bestClash ?? warmClash
    const r = race?.bestRed ?? warmRed
    panel.checkpoint(
      chalk.bold('Portfolio race') +
        chalk.dim(' · ') +
        `best clash ${c ?? '—'} · RED ${r ?? '—'}`,
    )
  }

  const enterClashProve = () => {
    if (race) {
      warmClash = race.bestClash ?? warmClash
      warmRed = race.bestRed ?? warmRed
      for (const lane of race.lanes.values()) {
        lane.done = true
      }
      freezeLaneClocks()
      checkpointRace()
    }
    stage = 'clash'
    if (state.bestClash == null && warmClash != null) state.bestClash = warmClash
    if (state.bestRed == null && warmRed != null) state.bestRed = warmRed
    pushHistory(clashHistory, state.bestClash)
    pushHistory(redHistory, state.bestRed)
    markDirty()
  }

  const enterLexStage = (next: Stage, phase: string, phaseLabel?: string) => {
    if (next === 'red' && stage === 'clash') {
      panel.checkpoint(
        chalk.cyan('1/3 Clash') +
          chalk.dim(' · ') +
          `clash ${state.bestClash ?? '—'}` +
          (clashProven ? chalk.green(' · proven minimal') : chalk.dim(' · best feasible')),
      )
      state.bound = null
      state.activity = 'searching'
      state.secondsSinceImprove = 0
      state.solutions = 0
      clashHistory.length = 0
      redHistory.length = 0
    } else if (next === 'balance' && (stage === 'red' || stage === 'clash')) {
      if (stage === 'clash') {
        // Skipped red somehow — still checkpoint clash.
        panel.checkpoint(
          chalk.cyan('1/3 Clash') +
            chalk.dim(' · ') +
            `clash ${state.bestClash ?? '—'}`,
        )
      }
      panel.checkpoint(
        chalk.cyan('2/3 RED') +
          chalk.dim(' · ') +
          `RED ${state.bestRed ?? '—'}` +
          (redProven ? chalk.green(' · proven minimal') : chalk.dim(' · best feasible')),
      )
      state.bound = null
      state.bestBalance = null
      state.bestParallelExcess = null
      state.activity = 'searching'
      state.secondsSinceImprove = 0
      state.solutions = 0
    }

    stage = next
    state.phase = phase
    state.phaseLabel = phaseLabel ?? phase
    markDirty()
  }

  const refresh = () => {
    tick++
    dirty = true
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
    },
    applyCpsat(evt: CpsatProgressEvent) {
      if (evt.type === 'phase' && evt.phase === 'portfolio_race') {
        const seeds = evt.portfolio_seeds ?? []
        const memberWorkers = evt.portfolio_member_workers ?? 2
        const raceSeconds = evt.portfolio_race_seconds ?? 0
        stage = 'race'
        raceCheckpointed = false
        clashHistory.length = 0
        redHistory.length = 0
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
          freezeLaneClocks()
        }
        state.phaseLabel = evt.phase_label ?? 'Portfolio best'
        markDirty()
        return
      }

      if (evt.type === 'phase' && evt.phase === 'rehint') {
        // Warm-start handoff between lex levels — keep current stage visuals.
        if (typeof evt.workers === 'number' && evt.workers > 0) state.workers = evt.workers
        markDirty()
        return
      }

      if (evt.portfolio) {
        stage = 'race'
        const lane = ensureLane(evt.portfolio)
        if (evt.type === 'progress' || evt.type === 'heartbeat') {
          if (evt.best_clash != null) lane.clash = evt.best_clash
          if (evt.best_red != null) lane.red = evt.best_red
          if (evt.bound !== undefined && evt.bound !== null) lane.bound = evt.bound
          lane.elapsed = evt.elapsed
          lane.elapsedAt = Date.now()
          lane.workers = evt.workers || evt.portfolio.member_workers
          lane.activity = evt.activity ?? lane.activity
          lane.secondsSinceImprove = evt.seconds_since_improve ?? lane.secondsSinceImprove
          if (evt.event === 'phase_end' || evt.solver_status) {
            lane.done = true
            lane.elapsed = liveOf(lane.elapsed, lane.elapsedAt)
            lane.elapsedAt = Date.now()
            lane.activity = 'idle'
          }
          recomputeRaceBest()
          pushHistory(clashHistory, race?.bestClash)
          pushHistory(redHistory, race?.bestRed)
        } else if (evt.type === 'start' || evt.type === 'model_ready' || evt.type === 'phase') {
          lane.activity = 'searching'
          lane.workers = evt.portfolio.member_workers
        } else if (evt.type === 'done') {
          lane.done = true
          lane.elapsed = liveOf(lane.elapsed, lane.elapsedAt)
          lane.elapsedAt = Date.now()
          if (evt.clash_weight != null) lane.clash = evt.clash_weight
          if (evt.red_students != null) lane.red = evt.red_students
          recomputeRaceBest()
          pushHistory(clashHistory, race?.bestClash)
          pushHistory(redHistory, race?.bestRed)
        }
        markDirty()
        return
      }

      // Prove / lex phases (no portfolio meta).
      if (evt.type === 'start' || evt.type === 'model_ready') {
        if (race && stage === 'race') enterClashProve()
        else if (!race && stage === 'pipeline') stage = 'clash'
        if (evt.type === 'start') {
          state.phaseLabel = 'Building model'
          state.activity = 'searching'
          state.workers = evt.workers
        } else {
          state.phaseLabel = '1/3 Minimizing clashes'
          state.activity = 'searching'
        }
        markDirty()
        return
      }

      if (evt.type === 'phase') {
        const lex = lexStageFromPhase(evt.phase)
        if (lex === 'clash') {
          if (stage === 'race' || (race && stage === 'pipeline')) enterClashProve()
          else stage = 'clash'
        } else if (lex === 'red' || lex === 'balance') {
          enterLexStage(lex, evt.phase, evt.phase_label)
          if (typeof evt.workers === 'number' && evt.workers > 0) state.workers = evt.workers
          if (typeof evt.elapsed === 'number') {
            state.solverElapsed = evt.elapsed
            state.solverElapsedAt = Date.now()
          }
          return
        } else {
          state.phase = evt.phase
          state.phaseLabel = evt.phase_label ?? evt.phase
        }
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
        const lex = lexStageFromPhase(evt.phase)
        if (lex && lex !== stage && (lex === 'red' || lex === 'balance')) {
          enterLexStage(lex, evt.phase, evt.phase_label)
        } else if (lex === 'clash' && stage === 'race') {
          enterClashProve()
        }

        state.phase = evt.phase
        state.phaseLabel = evt.phase_label ?? evt.phase
        // Never wipe established metrics with null mid-phase heartbeats.
        if (evt.best_clash != null) {
          state.bestClash = evt.best_clash
          pushHistory(clashHistory, evt.best_clash)
        }
        if (evt.best_red != null) {
          state.bestRed = evt.best_red
          pushHistory(redHistory, evt.best_red)
        }
        if (evt.best_balance_l1_scaled != null) state.bestBalance = evt.best_balance_l1_scaled
        if (evt.best_parallel_excess != null) {
          state.bestParallelExcess = evt.best_parallel_excess
        }
        if (evt.bound !== undefined && evt.bound !== null) state.bound = evt.bound
        state.solverElapsed = evt.elapsed
        state.solverElapsedAt = Date.now()
        state.workers = evt.workers
        state.solutions = evt.solutions
        state.activity = evt.activity ?? state.activity
        state.secondsSinceImprove = evt.seconds_since_improve ?? state.secondsSinceImprove

        if (evt.event === 'phase_end') {
          if (evt.phase === 'minimize_clash' && evt.solver_status === 'OPTIMAL') {
            clashProven = true
          }
          if (evt.phase === 'minimize_red' && evt.solver_status === 'OPTIMAL') {
            redProven = true
          }
        }
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
        } else {
          summary =
            `${state.phaseLabel} · clash ${state.bestClash ?? '—'} · RED ${state.bestRed ?? '—'}` +
            ` · ${state.workers}w`
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

let bannerShown = false

/** Idempotent: the mode menu prints the banner before commander re-dispatches into a subcommand. */
export function banner(): void {
  if (bannerShown) return
  bannerShown = true
  p.intro(chalk.bold.cyan('UniSlot') + chalk.dim(' · terminal CP-SAT scheduler'))
}

export function outroSuccess(lines: string[]): void {
  p.outro(lines.join('\n'))
}

function levelMark(ok: boolean): string {
  return ok ? chalk.green('✓ proven') : chalk.yellow('best found (not proven)')
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
  const levels = new Set(opts.provenLevels ?? [])
  const clashOk = levels.has('clash_weight') || opts.proven
  const redOk = levels.has('red_students')
  const balOk = levels.has('balance_and_parallel')
  const fullLex = clashOk && redOk && balOk
  const proof = fullLex
    ? chalk.green('full lex optimal — clash, RED, and balance are all proven minimal')
    : opts.proven
      ? chalk.yellow('clash proven · later lex levels not fully proven')
      : chalk.yellow('best feasible (clash not fully proven)')
  const structural = opts.structuralImpossible
    ? chalk.dim('\n  Note: structural lower bounds say zero-clash is impossible for this enrollment.')
    : ''
  return [
    `${chalk.bold('Status')}     ${opts.status}`,
    `${chalk.bold('Clash wt')}   ${opts.clashWeight}  ${levelMark(clashOk)}`,
    `${chalk.bold('RED')}        ${opts.red}  ${levelMark(redOk)}`,
    `${chalk.bold('Balance')}    ${levelMark(balOk)}`,
    `${chalk.bold('Proof')}      ${proof}`,
    `${chalk.bold('Time')}       ${opts.seconds.toFixed(2)}s · ${opts.workers} workers`,
    structural,
  ]
    .filter(Boolean)
    .join('\n')
}

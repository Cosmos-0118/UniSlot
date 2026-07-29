import * as p from '@clack/prompts'
import { cpus } from 'node:os'
import type {
  CpsatPortfolioMeta,
  CpsatProgressEvent,
} from '../src/modules/scheduling/solver/cpsatInstance.ts'
import {
  box,
  divider,
  glyphs,
  palette,
  visibleLen,
  type Tone,
} from './theme.ts'

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

/** Named stage transitions — one short animation each. */
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

function padNum(n: number | null, width = 4): string {
  if (n == null) return palette.dim('—'.padStart(width))
  return palette.bold(String(n).padStart(width))
}

function activityLabel(activity: LiveSolveState['activity'], idle: number): string {
  switch (activity) {
    case 'improving':
      return palette.ok('improving')
    case 'proving':
      return palette.warn(`proving ${formatDuration(idle)}`)
    case 'searching':
      return palette.brand('searching')
    default:
      return palette.dim('idle')
  }
}

function laneStatus(activity: LiveSolveState['activity'], idle: number, done: boolean): string {
  if (done) return palette.dim('done')
  return activityLabel(activity, idle)
}

function gapLabel(value: number | null, bound: number | null): string {
  if (value == null || bound == null) return palette.dim('gap —')
  const g = value - bound
  return g <= 0 ? palette.ok('gap 0') : palette.dim(`bound ${bound} · gap ${g}`)
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

function toneColor(tone: Tone | 'cyan' | 'green' | 'yellow' | 'dim'): (s: string) => string {
  switch (tone) {
    case 'ok':
    case 'green':
      return palette.ok
    case 'warn':
    case 'yellow':
      return palette.warn
    case 'dim':
      return palette.dim
    case 'bad':
      return palette.bad
    case 'accent':
      return palette.accent
    default:
      return palette.brand
  }
}

/**
 * Sliding Braille ribbon — ambient “still working” motion that never hard-loops
 * the same shape (phase drifts with tick; soft Gaussian hotspot).
 */
function brailleRibbon(
  tick: number,
  width = 18,
  tone: 'cyan' | 'green' | 'yellow' | 'dim' | Tone = 'brand',
): string {
  const cells: string[] = []
  const center = ((tick * 0.35) % (width + 6)) - 3
  for (let i = 0; i < width; i++) {
    const dist = Math.abs(i - center)
    const falloff = Math.max(0, 1 - dist / 4.2)
    const breathe = 0.35 + 0.65 * falloff
    const idx = Math.min(BRAILLE_LEVEL.length - 1, Math.floor(breathe * (BRAILLE_LEVEL.length - 1) + 0.001))
    cells.push(BRAILLE_LEVEL[idx]!)
  }
  return toneColor(tone)(cells.join(''))
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
  const colored = t >= 1 ? palette.ok(bar) : t > 0.75 ? palette.warn(bar) : palette.brand(bar)
  return colored
}

function sparkline(history: number[], width = 16): string {
  if (history.length === 0) return palette.dim('░'.repeat(Math.min(width, 8)))
  const slice = history.slice(-width)
  const min = Math.min(...slice)
  const max = Math.max(...slice)
  const span = Math.max(1e-9, max - min)
  // Lower objective is better → invert so improvements rise visually.
  return slice
    .map((v) => {
      const norm = 1 - (v - min) / span
      const idx = Math.min(SPARK.length - 1, Math.floor(norm * (SPARK.length - 1) + 0.001))
      return palette.brand(SPARK[idx]!)
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

function stepTrack(active: 1 | 2 | 3): string[] {
  const mark = (n: 1 | 2 | 3, label: string) => {
    if (n < active) return palette.dim(`${glyphs.step.done} ${n}/3 ${label}`)
    if (n === active) return palette.brand(`${glyphs.step.active} ${n}/3 ${label}`)
    return palette.dim(`${glyphs.step.pending} ${n}/3 ${label}`)
  }
  return [
    `  ${mark(1, 'clash')}  ${mark(2, 'RED')}  ${mark(3, 'balance')}`,
    `  ${divider(40)}`,
  ]
}

/**
 * Pure transition frames — exported for tests. `t` is 0..totalTicks-1.
 */
export function transitionFrame(name: TransitionName, t: number, totalTicks: number): string[] {
  const frac = totalTicks <= 1 ? 1 : t / (totalTicks - 1)
  switch (name) {
    case 'scan': {
      const width = 28
      const pos = Math.floor(frac * (width - 1))
      let row = ''
      for (let i = 0; i < width; i++) {
        const d = Math.abs(i - pos)
        row += d === 0 ? '⣿' : d === 1 ? '⣼' : d === 2 ? '⢠' : '⠀'
      }
      return [
        `${palette.brand(BRAILLE_SPIN[t % BRAILLE_SPIN.length]!)}  ${palette.bold('Reading workbook')}`,
        `  ${palette.brand(row)}  ${palette.dim('scanning rows…')}`,
        '',
      ]
    }
    case 'assemble': {
      const blocks = Math.min(8, Math.max(1, Math.floor(frac * 8) + 1))
      const bar = '⣿'.repeat(blocks) + '⠀'.repeat(8 - blocks)
      return [
        `${palette.brand(BRAILLE_SPIN[t % BRAILLE_SPIN.length]!)}  ${palette.bold('Building model')}`,
        `  ${palette.brand(bar)}  ${palette.dim('encoding courses · edges · students')}`,
        '',
      ]
    }
    case 'clash_enter': {
      const glow = frac < 0.5 ? palette.accent : palette.brand
      return [
        `${glow(`${glyphs.step.active} 1/3 Clash`)}  ${palette.dim('minimize clash weight')}`,
        `  ${brailleRibbon(t, 16, 'cyan')}  ${palette.dim('starting lex level 1…')}`,
        ...stepTrack(1),
      ]
    }
    case 'red_enter': {
      const glow = frac < 0.5 ? palette.accent : palette.brand
      return [
        `${glow(`${glyphs.step.active} 2/3 RED`)}  ${palette.dim('minimize students with clashes')}`,
        `  ${brailleRibbon(t, 16, 'cyan')}  ${palette.dim('starting lex level 2…')}`,
        ...stepTrack(2),
      ]
    }
    case 'balance_enter': {
      // Scale settling: left/right bars converge toward center.
      const span = Math.max(0, 6 - Math.floor(frac * 6))
      const mid = '⣿⣿'
      const left = '⠀'.repeat(span) + '⣼'.repeat(Math.min(2, 6 - span))
      const right = '⣿'.repeat(Math.min(2, 6 - span)) + '⠀'.repeat(span)
      const scale = left.slice(-6).padStart(6, '⠀') + mid + right.slice(0, 6).padEnd(6, '⠀')
      return [
        `${palette.brand(`${glyphs.step.active} 3/3 Balance`)}  ${palette.dim('spread load across weekdays')}`,
        `  ${palette.brand(scale)}  ${palette.dim('settling weekday load…')}`,
        ...stepTrack(3),
      ]
    }
    case 'write': {
      const width = 24
      const filled = Math.floor(frac * width)
      const bar = '━'.repeat(filled) + '─'.repeat(width - filled)
      return [
        `${palette.brand(BRAILLE_SPIN[t % BRAILLE_SPIN.length]!)}  ${palette.bold('Writing exports')}`,
        `  ${palette.ok(bar)}  ${palette.dim(`${Math.round(frac * 100)}%`)}`,
        '',
      ]
    }
    case 'stamp': {
      const labels = ['[ ······ ]', '[ ·· ·· ]', '[ OPT·· ]', '[ OPTIM ]', '[OPTIMAL]', '[OPTIMAL]']
      const label = labels[Math.min(t, labels.length - 1)]!
      const glow = t < totalTicks - 2 ? palette.accent(label) : palette.ok(label)
      return [
        `${palette.bold('Status')}     ${glow}`,
        palette.dim('  stamping result…'),
        '',
      ]
    }
    case 'burst': {
      const stars = ['    ★    ', '  ★ · ★  ', '★ · ★ · ★', ' · ★ · ★ ', '  · ★ ·  ', '    ·    ', '         ']
      const frame = stars[Math.min(t, stars.length - 1)]!
      return [palette.ok(frame), palette.dim('  done'), '']
    }
    default:
      return ['']
  }
}

/**
 * Play a short transition on a TTY. No-op when stdout is not a TTY.
 * Returns the number of frames that would play (useful for tests).
 * Uses in-place line updates so the terminal does not fill with scrollback junk.
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
      if (t < total - 1) {
        await new Promise<void>((r) => setTimeout(r, TICK_MS))
      }
    }
    return total
  }

  const out = process.stdout
  out.write('\x1b[?25l')
  let prev = 0
  for (let t = 0; t < total; t++) {
    const lines = transitionFrame(name, t, total).map((l) => padLine(l))
    if (prev > 0) {
      out.write(`\x1b[${prev}A`)
    }
    const height = Math.max(prev, lines.length)
    for (let i = 0; i < height; i++) {
      const next = lines[i] ?? padLine('')
      out.write(`\x1b[2K\r${next}\n`)
    }
    prev = lines.length
    if (t < total - 1) {
      await new Promise<void>((r) => setTimeout(r, TICK_MS))
    }
  }
  // Clear the transition block before returning control to Clack.
  if (prev > 0) {
    out.write(`\x1b[${prev}A`)
    for (let i = 0; i < prev; i++) out.write('\x1b[2K\n')
    out.write(`\x1b[${prev}A`)
  }
  out.write('\x1b[?25h')
  return total
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

  /** Overlay transition played on the same tick loop (never blocks solver events). */
  let transition: { name: TransitionName; tick: number; total: number } | null = null
  /** Brief count-drop pop when clash/RED first improves. */
  let popClashTicks = 0
  let popRedTicks = 0
  let prevBestClash: number | null = null
  let prevBestRed: number | null = null
  let scanPlayed = false
  let assemblePlayed = false

  const startTransition = (name: TransitionName) => {
    if (!panel.isTty) return
    transition = { name, tick: 0, total: TRANSITION_TICKS[name] }
    dirty = true
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
  const spinGlyph = () => palette.brand(BRAILLE_SPIN[tick % BRAILLE_SPIN.length])

  const laneLines = (): string[] => {
    if (!race) return [palette.dim('  waiting for solver…')]
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
      const mark = isBest ? palette.ok(glyphs.star) : palette.dim(glyphs.dot)
      const status = laneStatus(lane.activity, lane.secondsSinceImprove, lane.done)
      const secs = lane.done ? lane.elapsed : liveOf(lane.elapsed, lane.elapsedAt)
      const time = formatDuration(secs).padStart(6)
      return (
        `  ${mark} ${palette.dim(`#${tag}`)} ${seedLabel} ` +
        `clash ${padNum(lane.clash)}  RED ${padNum(lane.red)}  ` +
        `${status}  ` +
        palette.dim(time)
      )
    })
  }

  const header = (title: string, detail: string) =>
    `${spinGlyph()} ${palette.bold(title)}` +
    (detail ? palette.dim(`  ${detail}`) : '') +
    palette.dim(`  ${glyphs.dot}  ${state.workers}w  ${glyphs.dot}  ${formatDuration(liveElapsed())}`)

  const metricClash = (clash: number | null, popping: boolean) => {
    const v = padNum(clash)
    return popping ? palette.accent(String(clash ?? '—').padStart(4)) : v
  }

  const metricRed = (red: number | null, popping: boolean) => {
    const v = padNum(red)
    return popping ? palette.accent(String(red ?? '—').padStart(4)) : v
  }

  const buildRaceFrame = (): string[] => {
    if (!race) return [`${spinGlyph()}  ${rawMessage}`, `  ${brailleRibbon(tick, 20)}`]
    const lanes = laneLines()
    const wall = (Date.now() - race.startedAt) / 1000
    const totalW = race.size * race.memberWorkers
    const timeBit =
      race.raceSeconds > 0
        ? palette.dim(
            `${formatDuration(Math.min(wall, race.raceSeconds))} / ${race.raceSeconds}s`,
          )
        : palette.dim(formatDuration(wall))
    const headerBest =
      race.bestClash == null
        ? palette.dim('best —')
        : `best ${palette.ok(String(race.bestClash))} · RED ${palette.ok(String(race.bestRed ?? '—'))}`

    const ribbon =
      race.raceSeconds > 0
        ? `${progressBar(Math.min(1, wall / race.raceSeconds), 20)}  ${timeBit}`
        : `${brailleRibbon(tick, 20)}  ${timeBit}`

    return [
      `${spinGlyph()} ${palette.bold('Portfolio race')}  ` +
        palette.dim(`${race.size} seeds × ${race.memberWorkers}w · ${totalW} workers`),
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
        ? palette.dim(`warm ${warmClash}/${warmRed ?? '—'}`)
        : palette.dim('warm —')
    const tone = activityTone(state.activity)
    const motion =
      clashHistory.length > 1
        ? `${brailleRibbon(tick, 10, tone)}  ${sparkline(clashHistory, 14)}`
        : brailleRibbon(tick, 16, tone)
    return [
      header('1/3 Clash', 'minimize clash weight'),
      `  ${motion}  ${warm}  ${glyphs.arrow}  clash ${metricClash(clash, popClashTicks > 0)}  ` +
        `RED ${metricRed(red, false)}  ${gapLabel(clash, state.bound)}  ${act}`,
      ...stepTrack(1),
    ]
  }

  const buildRedFrame = (): string[] => {
    const red = state.bestRed
    const act = activityLabel(state.activity, state.secondsSinceImprove)
    const locked =
      state.bestClash != null
        ? palette.dim(`locked clash ${state.bestClash}${clashProven ? ` ${glyphs.check}` : ''}`)
        : palette.dim('locked clash —')
    const tone = activityTone(state.activity)
    const motion =
      redHistory.length > 1
        ? `${brailleRibbon(tick, 10, tone)}  ${sparkline(redHistory, 14)}`
        : brailleRibbon(tick, 16, tone)
    return [
      header('2/3 RED', 'minimize students with clashes'),
      `  ${motion}  ${locked}  ${glyphs.arrow}  RED ${metricRed(red, popRedTicks > 0)}  ` +
        `${gapLabel(red, state.bound)}  ${act}`,
      ...stepTrack(2),
    ]
  }

  const buildBalanceFrame = (): string[] => {
    const act = activityLabel(state.activity, state.secondsSinceImprove)
    const locked = palette.dim(
      `locked clash ${state.bestClash ?? '—'}${clashProven ? ` ${glyphs.check}` : ''}` +
        ` · RED ${state.bestRed ?? '—'}${redProven ? ` ${glyphs.check}` : ''}`,
    )
    const ribbon = brailleRibbon(tick, 14, activityTone(state.activity))
    return [
      header('3/3 Balance', 'spread load across weekdays'),
      `  ${ribbon}  ${locked}  ${glyphs.arrow}  ` +
        `balance ${padNum(state.bestBalance)}  parallel ${padNum(state.bestParallelExcess)}  ${act}`,
      ...stepTrack(3),
    ]
  }

  const buildFrame = (): string[] => {
    if (transition && transition.tick < transition.total) {
      return transitionFrame(transition.name, transition.tick, transition.total)
    }
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
    if (!dirty && stage === 'pipeline' && !transition) return
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
      palette.bold('Portfolio race') +
        palette.dim(` ${glyphs.dot} `) +
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
    startTransition('clash_enter')
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
        palette.brand('1/3 Clash') +
          palette.dim(` ${glyphs.dot} `) +
          `clash ${state.bestClash ?? '—'}` +
          (clashProven ? palette.ok(' · proven minimal') : palette.dim(' · best feasible')),
      )
      state.bound = null
      state.activity = 'searching'
      state.secondsSinceImprove = 0
      state.solutions = 0
      clashHistory.length = 0
      redHistory.length = 0
      startTransition('red_enter')
    } else if (next === 'balance' && (stage === 'red' || stage === 'clash')) {
      if (stage === 'clash') {
        panel.checkpoint(
          palette.brand('1/3 Clash') +
            palette.dim(` ${glyphs.dot} `) +
            `clash ${state.bestClash ?? '—'}`,
        )
      }
      panel.checkpoint(
        palette.brand('2/3 RED') +
          palette.dim(` ${glyphs.dot} `) +
          `RED ${state.bestRed ?? '—'}` +
          (redProven ? palette.ok(' · proven minimal') : palette.dim(' · best feasible')),
      )
      state.bound = null
      state.bestBalance = null
      state.bestParallelExcess = null
      state.activity = 'searching'
      state.secondsSinceImprove = 0
      state.solutions = 0
      startTransition('balance_enter')
    }

    stage = next
    state.phase = phase
    state.phaseLabel = phaseLabel ?? phase
    markDirty()
  }

  const refresh = () => {
    tick++
    if (transition) {
      transition.tick++
      if (transition.tick >= transition.total) {
        transition = null
      }
    }
    if (popClashTicks > 0) popClashTicks--
    if (popRedTicks > 0) popRedTicks--
    dirty = true
    paint()
  }

  return {
    start(message = 'CP-SAT searching…') {
      stage = 'pipeline'
      rawMessage = message
      if (!scanPlayed && /reading|workbook|enrollment/i.test(message)) {
        scanPlayed = true
        startTransition('scan')
      }
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
          if (!assemblePlayed) {
            assemblePlayed = true
            startTransition('assemble')
          }
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
          else {
            if (stage !== 'clash') startTransition('clash_enter')
            stage = 'clash'
          }
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
          if (prevBestClash != null && evt.best_clash < prevBestClash) {
            popClashTicks = 6
          }
          prevBestClash = evt.best_clash
          state.bestClash = evt.best_clash
          pushHistory(clashHistory, evt.best_clash)
        }
        if (evt.best_red != null) {
          if (prevBestRed != null && evt.best_red < prevBestRed) {
            popRedTicks = 6
          }
          prevBestRed = evt.best_red
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
    async stop(finalMessage?: string) {
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
    /** Play the result stamp animation (TTY only), then return. */
    async playStamp(status: string) {
      if (!panel.isTty) return
      const total = TRANSITION_TICKS.stamp
      // Customize last frames with actual status.
      for (let t = 0; t < total; t++) {
        const lines = transitionFrame('stamp', t, total)
        if (t >= total - 2) {
          lines[0] = `${palette.bold('Status')}     ${palette.ok(`[${status}]`)}`
        }
        panel.paint(lines.map((l) => padLine(l)))
        if (t < total - 1) await new Promise<void>((r) => setTimeout(r, TICK_MS))
      }
      panel.clear()
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

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms))
}

function drawBannerFrame(step: number): string[] {
  const width = 40
  const { tl, tr, bl, br, h, v } = glyphs.box
  const title = ' UniSlot '
  const subtitle = '  terminal CP-SAT scheduler'
  // step 0: left corner + growing top rule
  // step 1: top complete + title
  // step 2: body line
  // step 3: bottom rule
  const topFill = Math.max(0, width - 2 - visibleLen(title) - 1)
  const top = `${tl}${h}${title}${h.repeat(topFill)}${tr}`
  const mid = `${v}${subtitle.padEnd(width - 2)}${v}`
  const bot = `${bl}${h.repeat(width - 2)}${br}`

  if (step <= 0) {
    const grow = Math.min(width - 2, 8)
    return [palette.brand(`${tl}${h.repeat(grow)}`)]
  }
  if (step === 1) {
    return [palette.brand(top)]
  }
  if (step === 2) {
    return [palette.brand(top), palette.dim(mid)]
  }
  return [palette.brand(top), palette.dim(mid), palette.dim(bot)]
}

/** Animated banner draw-in (TTY). Falls back to a static intro on non-TTY. */
export async function bannerAnimated(): Promise<void> {
  if (bannerShown) return
  bannerShown = true
  const isTty = Boolean(process.stdout.isTTY)
  if (isTty) {
    process.stdout.write('\x1b[?25l')
    let prevLines = 0
    for (let step = 0; step <= 3; step++) {
      const lines = drawBannerFrame(step)
      if (prevLines > 0) {
        process.stdout.write(`\x1b[${prevLines}A`)
        for (let i = 0; i < prevLines; i++) process.stdout.write('\x1b[2K\n')
        process.stdout.write(`\x1b[${prevLines}A`)
      }
      process.stdout.write(lines.join('\n') + '\n')
      prevLines = lines.length
      await sleep(150)
    }
    process.stdout.write('\x1b[?25h')
  }
  p.intro(palette.accent('UniSlot') + palette.dim(' · terminal CP-SAT scheduler'))
}

export async function outroSuccess(lines: string[]): Promise<void> {
  const isTty = Boolean(process.stdout.isTTY)
  if (isTty) {
    const total = TRANSITION_TICKS.burst
    process.stdout.write('\x1b[?25l')
    let prev = 0
    for (let t = 0; t < total; t++) {
      const frame = transitionFrame('burst', t, total)
      if (prev > 0) {
        process.stdout.write(`\x1b[${prev}A`)
        for (let i = 0; i < prev; i++) process.stdout.write('\x1b[2K\n')
        process.stdout.write(`\x1b[${prev}A`)
      }
      process.stdout.write(frame.join('\n') + '\n')
      prev = frame.length
      if (t < total - 1) await sleep(TICK_MS)
    }
    // Clear burst before outro.
    process.stdout.write(`\x1b[${prev}A`)
    for (let i = 0; i < prev; i++) process.stdout.write('\x1b[2K\n')
    process.stdout.write(`\x1b[${prev}A`)
    process.stdout.write('\x1b[?25h')
  }
  p.outro(lines.join('\n'))
}

/** Play write-exports sweep (TTY). Used around the export spinner stop. */
export async function playWriteSweep(): Promise<void> {
  await playTransition('write')
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

/** Print a boxed panel to stdout (replaces p.note for result summaries). */
export function showPanel(title: string, body: string): void {
  const lines = body.split('\n').filter((l, i, arr) => !(l === '' && (i === 0 || i === arr.length - 1)))
  // If body is already a box (starts with ╭), print as-is; otherwise wrap.
  if (body.trimStart().startsWith(glyphs.box.tl) || body.trimStart().startsWith('╭')) {
    process.stdout.write('\n' + body + '\n')
    return
  }
  process.stdout.write('\n' + box(title, lines) + '\n')
}

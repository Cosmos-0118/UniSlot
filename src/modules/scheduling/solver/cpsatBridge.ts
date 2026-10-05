import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConflictGraph, Section, Student } from '../types'
import { PipelineCancelledError } from '../pipeline/cancellation'
import {
  buildCpsatInstance,
  sectionSlotsFromCourseSlots,
  type CpsatInstance,
  type CpsatProgressEvent,
  type CpsatSolution,
} from './cpsatInstance'
import { derivePortfolioSeeds } from './seedUtils'
import {
  resolveSystemPython,
  formatPythonSetupHelp,
} from './resolvePython'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
/** Repo root: src/modules/scheduling/solver → ../../../../ */
export const REPO_ROOT = path.resolve(MODULE_DIR, '../../../..')
export const CPSAT_DIR = path.join(REPO_ROOT, 'solver', 'cpsat')
export const CPSAT_SOLVE_PY = path.join(CPSAT_DIR, 'solve.py')

/** Default portfolio race size (independent seeds). 0 disables — keeps seeded runs reproducible. */
export const DEFAULT_PORTFOLIO_SIZE = 0
/** Wall-clock budget for each portfolio race member (RED-only). */
export const DEFAULT_PORTFOLIO_RACE_SECONDS = 45

/** Workers per race member so `k * workers ≤ totalWorkers` (1 worker/member allowed). */
export function portfolioMemberWorkers(totalWorkers: number, k: number): number {
  const n = Math.max(1, Math.floor(k))
  const budget = Math.max(1, totalWorkers)
  return Math.max(1, Math.floor(budget / n))
}

/** OR-Tools Solve() ignores SIGTERM until it returns to Python; cancel must SIGKILL. */
const SIGTERM_GRACE_MS = 1500

/** Live Python solver children — for Ctrl+C / force-quit / process.exit cleanup. */
const activeChildren = new Set<ChildProcess>()
/** PIDs kept separately so we can still kill after the ChildProcess handle is gone. */
const activePids = new Set<number>()
let exitGuardInstalled = false

/** Track a solver child so cancel / process.exit can SIGKILL it. Exported for tests. */
export function trackCpsatChild(child: ChildProcess): void {
  activeChildren.add(child)
  if (child.pid) activePids.add(child.pid)
  installCpsatExitGuard()
}

function untrackCpsatChild(child: ChildProcess): void {
  activeChildren.delete(child)
  if (child.pid) activePids.delete(child.pid)
}

export type RunCpsatOptions = {
  timeLimitSeconds?: number
  workers?: number
  hint?: Record<string, number>
  minClashWeightLowerBound?: number
  minRedStudentsLowerBound?: number
  boundsPrecomputed?: boolean
  cliqueCuts?: string[][]
  /** Primary RED-prove CP-SAT portfolio: stock | core (default) | core_linear. */
  proveStrategy?: 'core' | 'stock' | 'core_linear'
  /** Independent RED-only race members (default 0). Pass k>0 to race (non-reproducible). */
  portfolio?: number
  /** Seconds per portfolio race member (default 45). */
  portfolioRaceSeconds?: number
  seed?: number
  /** Stop primary RED prove when incumbent−bound ≤ this (CP-SAT absolute_gap_limit). */
  absoluteGap?: number
  /** Stop primary RED prove when incumbent and bound are both flat for N seconds. */
  provePlateauSeconds?: number
  /** Disable plateau/gap escapes; chase a full RED certificate. */
  fullProve?: boolean
  /** When false, Saturday is excluded for maths courses. Default true. */
  allowSaturdayForMath?: boolean
  /** Extra course codes independently allowed on Saturday. */
  saturdayExtraCourseCodes?: string[]
  /** Hard-pinned course→weekday (rectification). */
  fixedDays?: Record<string, number>
  /** Clash-only solve (skip RED/balance prove phases). */
  clashOnly?: boolean
  /** Minimize primary RED only (portfolio race); omit pair/balance phases. */
  primaryOnly?: boolean
  signal?: AbortSignal
  onProgress?: (event: CpsatProgressEvent) => void
  /** Override python executable (default: solver/cpsat/.venv, else system Python). */
  pythonPath?: string
}

export type CpsatSchedulerResult = {
  slot_assignments: Record<string, number>
  slot_by_course: Record<string, number>
  solver_used: string
  solver_time_seconds: number
  total_clash_weight: number
  red_students: number
  proven_optimal: boolean
  proven_levels: string[]
  status: string
  message?: string
  num_workers: number
  ortools_version?: string
  python_version?: string
  clash_bound?: number | null
  clash_gap?: number | null
  red_bound?: number | null
  red_gap?: number | null
  timings?: Record<string, number>
  model_stats?: { variables: number; constraints: number }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function resolveCpsatPython(override?: string): Promise<string> {
  if (override) return override
  const venvUnix = path.join(CPSAT_DIR, '.venv', 'bin', 'python')
  const venvWin = path.join(CPSAT_DIR, '.venv', 'Scripts', 'python.exe')
  if (await pathExists(venvUnix)) return venvUnix
  if (await pathExists(venvWin)) return venvWin
  try {
    const resolved = await resolveSystemPython({
      allowUnsupported: true,
    })
    return resolved.executable
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      [
        'CP-SAT Python not found (no venv and no system Python 3.11–3.13).',
        'Run: npm run setup:cpsat',
        '',
        detail.includes('No suitable Python') || detail.includes('UNISLOT_PYTHON')
          ? detail
          : formatPythonSetupHelp(),
      ].join('\n'),
      { cause: err },
    )
  }
}

function parseProgressLine(line: string): CpsatProgressEvent | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const obj = JSON.parse(trimmed) as CpsatProgressEvent
    if (obj && typeof obj === 'object' && 'type' in obj) return obj
  } catch {
    return null
  }
  return null
}

export async function ensureCpsatReady(pythonPath?: string): Promise<{ python: string }> {
  const python = await resolveCpsatPython(pythonPath)
  if (!(await pathExists(CPSAT_SOLVE_PY))) {
    throw new Error(`CP-SAT solver not found at ${CPSAT_SOLVE_PY}`)
  }
  return { python }
}

/**
 * Synchronously kill a PID and its process group.
 *
 * Must stay sync: Clack's spinner puts stdin in raw mode and calls
 * `process.exit(0)` on Esc/Ctrl+C, which skips SIGINT handlers and
 * unref'd timers. Only an `exit` listener can still reap detached
 * OR-Tools children before Node disappears (parent becomes launchd).
 *
 * Never skip because `child.killed` is true — that flag is set as soon
 * as `child.kill()` is *called*, even when the native Solve() loop
 * swallows SIGTERM.
 */
export function killPidTreeSync(pid: number): void {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5000,
      })
    } catch {
      try {
        process.kill(pid)
      } catch {
        /* already gone */
      }
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    /* not a group leader yet, or already gone */
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

export function killChildTreeSync(child: ChildProcess): void {
  if (child.pid) killPidTreeSync(child.pid)
  try {
    child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}

/** Send signal to the child process group (Unix) or the process tree (Windows). */
function signalChildTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return
  if (signal === 'SIGKILL') {
    killChildTreeSync(child)
    return
  }
  if (process.platform === 'win32') {
    killChildTreeSync(child)
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch {
    /* no group yet */
  }
  try {
    process.kill(child.pid, signal)
  } catch {
    /* already gone */
  }
  try {
    child.kill(signal)
  } catch {
    /* already gone */
  }
}

/**
 * SIGTERM, then SIGKILL if the OR-Tools process is stuck inside native Solve().
 * Cancel paths should prefer {@link killChildTreeSync} / a short grace:
 * SIGTERM is deferred for the entire C++ search.
 */
export function terminateChild(child: ChildProcess, graceMs = SIGTERM_GRACE_MS): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid || child.exitCode != null || child.signalCode) {
      untrackCpsatChild(child)
      resolve()
      return
    }

    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      untrackCpsatChild(child)
      resolve()
    }

    child.once('exit', done)
    child.once('error', done)

    if (graceMs <= 0) {
      killChildTreeSync(child)
      setTimeout(done, 250).unref?.()
      return
    }

    signalChildTree(child, 'SIGTERM')

    // Do not unref: if this timer is unref'd and something calls process.exit
    // before it fires, SIGKILL never runs. The process.exit guard is the
    // backstop, but awaited cancel should still wait for the kill.
    const timer = setTimeout(() => {
      killChildTreeSync(child)
      setTimeout(done, 250).unref?.()
    }, graceMs)
    void timer
  })
}

/** Immediate SIGKILL of every tracked CP-SAT child. Safe inside `process.on('exit')`. */
export function killAllCpsatChildrenSync(): void {
  for (const child of [...activeChildren]) {
    killChildTreeSync(child)
  }
  for (const pid of [...activePids]) {
    killPidTreeSync(pid)
  }
}

/**
 * Last-resort reap: Clack spinner cancel calls `process.exit(0)` without
 * giving us a chance to await {@link killAllCpsatChildren}.
 */
export function installCpsatExitGuard(): void {
  if (exitGuardInstalled) return
  exitGuardInstalled = true
  process.on('exit', () => {
    killAllCpsatChildrenSync()
  })
}

/** Force-kill every tracked CP-SAT child (Ctrl+C / hard quit). */
export async function killAllCpsatChildren(): Promise<void> {
  const kids = [...activeChildren]
  killAllCpsatChildrenSync()
  await Promise.all(kids.map((c) => terminateChild(c, 0)))
}

type SpawnSolveOpts = RunCpsatOptions & {
  /** Internal absolute monotonic deadline, including setup and process startup. */
  deadlineMs?: number
  seed?: number
  clashOnly?: boolean
  /** Attach portfolio lane metadata to every progress event. */
  portfolioMeta?: import('./cpsatInstance').CpsatPortfolioMeta
}

function rankSolution(a: CpsatSolution, b: CpsatSolution): CpsatSolution {
  const clashOnly = a.objective_policy === 'clash-only' && b.objective_policy === 'clash-only'
  const primary = clashOnly ? ['clash_weight', 'red_students'] as const
    : ['red_students', 'clash_weight'] as const
  for (const key of [...primary, 'weekday_balance_l1_scaled', 'parallel_excess'] as const) {
    const av = a[key] ?? Number.POSITIVE_INFINITY
    const bv = b[key] ?? Number.POSITIVE_INFINITY
    if (av !== bv) return av < bv ? a : b
  }
  if (a.proven_optimal && !b.proven_optimal) return a
  if (b.proven_optimal && !a.proven_optimal) return b
  return a
}

export function betterSolution(a: CpsatSolution, b: CpsatSolution): CpsatSolution {
  const best = rankSolution(a, b)
  if (best.objective_policy === 'clash-only') return best
  const other = best === a ? b : a
  // Certificates concern an objective value, so keep a proven primary minimum
  // when another solve finds better tie-breakers at that same minimum.
  if (best.red_students == null || best.red_students !== other.red_students ||
    !other.proven_optimal) return best
  const levels = new Set(best.proven_levels ?? [])
  levels.add('red_students')
  if (best.clash_weight === other.clash_weight && other.proven_levels?.includes('clash_weight')) {
    levels.add('clash_weight')
    if (best.weekday_balance_l1_scaled != null &&
      best.weekday_balance_l1_scaled === other.weekday_balance_l1_scaled &&
      best.parallel_excess === other.parallel_excess &&
      other.proven_levels.includes('balance_and_parallel')) levels.add('balance_and_parallel')
  }
  const provenLevels = ['red_students', 'clash_weight', 'balance_and_parallel'].filter((level) => levels.has(level))
  if (best.proven_optimal && provenLevels.length === best.proven_levels?.length) return best
  const fullLex = provenLevels.length === 3
  return { ...best, proven_optimal: true, red_bound: best.red_students, red_gap: 0,
    ...(levels.has('clash_weight') ? { clash_bound: best.clash_weight, clash_gap: 0 } : {}),
    status: fullLex ? 'OPTIMAL' : 'FEASIBLE', proven_levels: provenLevels,
    message: fullLex ? 'Full RED-first lexicographic objective proven optimal.'
      : 'Minimum affected-student count proven; remaining tie-breakers may be unproven.' }
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof PipelineCancelledError ||
    (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message)))
  )
}

function deadlineFromSeconds(started: number, seconds: number | undefined): number | undefined {
  if (seconds == null) return undefined
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error('CP-SAT time limit must be a finite non-negative number')
  }
  return started + seconds * 1000
}

/**
 * Spawn the Python CP-SAT solver on a prepared instance.
 * Progress NDJSON is read from stderr.
 */
export async function spawnCpsatSolve(
  instance: CpsatInstance,
  options?: SpawnSolveOpts,
): Promise<CpsatSolution> {
  const started = performance.now()
  const configuredDeadline = deadlineFromSeconds(started, options?.timeLimitSeconds)
  const deadline = options?.deadlineMs ?? configuredDeadline
  if (deadline != null && !Number.isFinite(deadline)) throw new Error('CP-SAT deadline must be finite')
  return new Promise((resolve, reject) => {
    void (async () => {
      let workDir: string | undefined
      let child: ChildProcess | undefined
      let aborted = Boolean(options?.signal?.aborted)
      let timedOut = false
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined
      const remainingMs = () => deadline == null ? undefined : Math.max(0, deadline - performance.now())
      const checkDeadline = () => {
        if (remainingMs() === 0) throw new Error('CP-SAT time budget expired before a solver incumbent was available')
      }
      const watchDeadline = () => {
        const left = remainingMs()
        if (left == null) return
        deadlineTimer = setTimeout(() => {
          if (remainingMs() !== 0) { watchDeadline(); return }
          timedOut = true
          if (child) killChildTreeSync(child)
        }, Math.min(2_147_483_647, Math.max(1, left)))
      }

      const onAbort = () => {
        aborted = true
        if (child) killChildTreeSync(child)
      }

      try {
        checkDeadline()
        watchDeadline()
        if (options?.signal?.aborted) {
          throw new PipelineCancelledError()
        }
        options?.signal?.addEventListener('abort', onAbort, { once: true })

        const { python } = await ensureCpsatReady(options?.pythonPath)
        checkDeadline()
        workDir = await mkdtemp(path.join(tmpdir(), 'unislot-cpsat-'))
        const instancePath = path.join(workDir, 'instance.json')
        const outputPath = path.join(workDir, 'solution.json')
        await writeFile(instancePath, JSON.stringify(instance), 'utf8')
        checkDeadline()

        if (options?.signal?.aborted) {
          throw new PipelineCancelledError()
        }

        const args = [
          CPSAT_SOLVE_PY,
          '--instance',
          instancePath,
          '--output',
          outputPath,
        ]
        const searchSeconds = remainingMs()
        if (searchSeconds != null) {
          args.push('--time-limit', String(searchSeconds / 1000))
        }
        if (options?.workers != null && options.workers > 0) {
          args.push('--workers', String(options.workers))
        }
        if (options?.seed != null && options.seed >= 0) {
          args.push('--seed', String(options.seed))
        }
        if (options?.clashOnly) {
          args.push('--clash-only')
        }
        if (options?.primaryOnly) args.push('--primary-only')
        if (options?.absoluteGap != null && options.absoluteGap >= 0) {
          args.push('--absolute-gap', String(options.absoluteGap))
        }
        if (options?.provePlateauSeconds != null && options.provePlateauSeconds > 0) {
          args.push('--prove-plateau', String(options.provePlateauSeconds))
        }
        if (options?.fullProve) {
          args.push('--prove')
        }
        if (options?.proveStrategy) {
          args.push('--prove-strategy', options.proveStrategy)
        }

        child = spawn(python, args, {
          cwd: CPSAT_DIR,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            // Deterministic Python hash iteration across machines/processes.
            PYTHONHASHSEED: '0',
            // CP-SAT parallelism is driven by num_search_workers; keep native
            // BLAS single-threaded so linear-algebra ordering does not vary.
            OMP_NUM_THREADS: '1',
            MKL_NUM_THREADS: '1',
            OPENBLAS_NUM_THREADS: '1',
            NUMEXPR_NUM_THREADS: '1',
          },
          // Own process group so Ctrl+C is owned by Node and we can kill the tree.
          detached: process.platform !== 'win32',
          windowsHide: true,
        })
        trackCpsatChild(child)

        if (options?.signal?.aborted) {
          killChildTreeSync(child)
          throw new PipelineCancelledError()
        }

        // Keep the tail of non-NDJSON stderr (tracebacks, OR-Tools aborts) for failure messages.
        const stderrTail: string[] = []
        const STDERR_TAIL_LINES = 20

        const rl = createInterface({ input: child.stderr! })
        rl.on('line', (line) => {
          if (aborted) return
          const evt = parseProgressLine(line)
          if (!evt) {
            const trimmed = line.trim()
            if (trimmed) {
              stderrTail.push(trimmed)
              if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift()
            }
            return
          }
          if (evt.type === 'error') {
            const detail = [evt.message, evt.traceback].filter(Boolean).join('\n')
            if (detail) {
              stderrTail.push(detail)
              if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift()
            }
          }
          if (options?.portfolioMeta) {
            options.onProgress?.({ ...evt, portfolio: options.portfolioMeta })
            return
          }
          options?.onProgress?.(evt)
        })

        const exitCode: number = await new Promise((res, rej) => {
          child!.on('error', rej)
          child!.on('close', (code) => res(code ?? 1))
        })
        clearTimeout(deadlineTimer)

        options?.signal?.removeEventListener('abort', onAbort)
        untrackCpsatChild(child)
        rl.close()

        if (aborted || options?.signal?.aborted) {
          throw new PipelineCancelledError()
        }

        let solution: CpsatSolution
        try {
          let final: CpsatSolution | undefined
          let checkpoint: CpsatSolution | undefined
          try { final = JSON.parse(await readFile(outputPath, 'utf8')) as CpsatSolution } catch { /* optional on timeout */ }
          try { checkpoint = JSON.parse(await readFile(outputPath + '.incumbent.json', 'utf8')) as CpsatSolution } catch { /* optional */ }
          const complete = (candidate: CpsatSolution | undefined) => candidate &&
            instance.courses.every((course) => {
              const day = candidate.slot_by_course?.[course.code]
              return day != null && Number.isInteger(day) && day >= 0 && day < instance.num_weekdays &&
                (course.is_math || day !== instance.saturday_index) &&
                (instance.fixed_days?.[course.code] == null || day === instance.fixed_days[course.code])
            }) && instance.faculty_groups.every((group) =>
              new Set(group.course_codes.map((code) => candidate.slot_by_course[code])).size === group.course_codes.length)
          if (!complete(final)) final = undefined
          if (!complete(checkpoint)) checkpoint = undefined
          if (!final && !checkpoint) throw new Error('No complete feasible incumbent')
          solution = final && checkpoint
            ? betterSolution(final, checkpoint) : (final ?? checkpoint)!
          if (timedOut) solution = { ...solution,
            message: 'Time budget expired; returning the best complete solver incumbent.' }
        } catch {
          let detail = ''
          try {
            const raw = await readFile(outputPath, 'utf8')
            const partial = JSON.parse(raw) as CpsatSolution
            if (partial.error) detail = partial.error
            else if (partial.status) {
              detail = `${partial.status}${partial.message ? `: ${partial.message}` : ''}`
            }
          } catch {
            /* ignore */
          }
          const tail = stderrTail.length ? `\nSolver output:\n  ${stderrTail.join('\n  ')}` : ''
          throw new Error(
            (exitCode !== 0
              ? `CP-SAT solver failed (exit ${exitCode})${detail ? ` — ${detail}` : ' with no solution file'}`
              : 'CP-SAT solver produced no solution file') + tail,
          )
        }

        if (!solution.slot_by_course || Object.keys(solution.slot_by_course).length === 0) {
          const tail = stderrTail.length ? `\nSolver output:\n  ${stderrTail.join('\n  ')}` : ''
          throw new Error(
            (solution.error ||
              solution.message ||
              `CP-SAT solver returned empty assignment (status=${solution.status})`) + tail,
          )
        }

        resolve(solution)
      } catch (err) {
        if (child) {
          killChildTreeSync(child)
          await terminateChild(child, 0).catch(() => undefined)
        }
        if (aborted || options?.signal?.aborted || isAbortError(err)) {
          reject(new PipelineCancelledError())
        } else {
          reject(err)
        }
      } finally {
        clearTimeout(deadlineTimer)
        options?.signal?.removeEventListener('abort', onAbort)
        if (child) untrackCpsatChild(child)
        if (workDir) {
          await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
        }
      }
    })()
  })
}

const PORTFOLIO_SEEDS = [1, 5, 12, 88, 421, 7, 99, 256, 777, 1337]

async function runPortfolioRace(
  instance: CpsatInstance,
  options: SpawnSolveOpts,
  k: number,
  raceSeconds: number,
  memberWorkers: number,
): Promise<CpsatSolution | null> {
  if (options.signal?.aborted) throw new PipelineCancelledError()

  const seeds =
    options.seed != null && options.seed >= 0
      ? derivePortfolioSeeds(options.seed, k)
      : PORTFOLIO_SEEDS.slice(0, Math.max(1, k))
  options.onProgress?.({
    type: 'phase',
    phase: 'portfolio_race',
    phase_label: `Portfolio race · ${seeds.length} seeds × ${memberWorkers} workers each`,
    workers: seeds.length * memberWorkers,
    portfolio_seeds: seeds,
    portfolio_member_workers: memberWorkers,
    portfolio_race_seconds: raceSeconds,
  })

  const settled = await Promise.allSettled(
    seeds.map(async (seed, i) => {
      const portfolioMeta = {
        index: i + 1,
        size: seeds.length,
        seed,
        member_workers: memberWorkers,
        race_seconds: raceSeconds,
      }
      return spawnCpsatSolve(instance, {
        ...options,
        workers: memberWorkers,
        timeLimitSeconds: raceSeconds,
        deadlineMs: Math.min(options.deadlineMs ?? Infinity, performance.now() + raceSeconds * 1000),
        seed,
        clashOnly: false,
        primaryOnly: true,
        // Race is primal-first — no prove escapes / full-prove flags.
        absoluteGap: undefined,
        provePlateauSeconds: undefined,
        fullProve: false,
        portfolioMeta,
      })
    }),
  )

  if (options.signal?.aborted) throw new PipelineCancelledError()

  const results: Array<CpsatSolution | null> = settled.map((s) => {
    if (s.status === 'fulfilled') return s.value
    if (isAbortError(s.reason)) return null
    return null
  })

  // If every member aborted/failed because of cancel, surface it.
  if (
    settled.every(
      (s) => s.status === 'rejected' && isAbortError(s.reason),
    )
  ) {
    throw new PipelineCancelledError()
  }

  let best: CpsatSolution | null = null
  for (const r of results) {
    if (!r) continue
    best = best ? betterSolution(best, r) : r
  }
  if (best) {
    options.onProgress?.({
      type: 'phase',
      phase: 'portfolio_best',
      phase_label: `Portfolio best · clash ${best.clash_weight ?? '—'} · RED ${best.red_students ?? '—'}`,
      workers: options.workers,
      clash_weight: best.clash_weight ?? undefined,
      red_students: best.red_students ?? undefined,
    })
  }
  return best
}

export async function runCpsatScheduler(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  students: Record<string, Student>,
  options?: RunCpsatOptions,
): Promise<CpsatSchedulerResult> {
  const t0 = performance.now()
  const deadline = deadlineFromSeconds(t0, options?.timeLimitSeconds)
  const totalWorkers =
    options?.workers && options.workers > 0 ? options.workers : cpus().length

  if (options?.signal?.aborted) throw new PipelineCancelledError()

  let hint = options?.hint
  const portfolioK =
    options?.clashOnly ? 0 : options?.portfolio === undefined
      ? DEFAULT_PORTFOLIO_SIZE
      : Math.max(0, Math.floor(options.portfolio))
  const raceSeconds =
    options?.portfolioRaceSeconds && options.portfolioRaceSeconds > 0
      ? options.portfolioRaceSeconds
      : DEFAULT_PORTFOLIO_RACE_SECONDS

  const instance = buildCpsatInstance(
    courseSections,
    conflictGraph,
    facultyConstraints,
    students,
    {
      hint,
      fixed_days: options?.fixedDays,
      min_clash_weight_lower_bound: options?.minClashWeightLowerBound,
      min_red_students_lower_bound: options?.minRedStudentsLowerBound,
      bounds_precomputed:
        options?.boundsPrecomputed ?? options?.minClashWeightLowerBound != null,
      clique_cuts: options?.cliqueCuts,
      allowSaturdayForMath: options?.allowSaturdayForMath,
      saturdayExtraCourseCodes: options?.saturdayExtraCourseCodes,
    },
  )

  let raceBest: CpsatSolution | null = null
  if (portfolioK > 0) {
    // Distribute all available CPUs across race members instead of
    // hardcoding 2 per seed — utilise the user's full hardware.
    const memberWorkers = portfolioMemberWorkers(totalWorkers, portfolioK)
    raceBest = await runPortfolioRace(
      instance,
      { ...options, deadlineMs: deadline },
      portfolioK,
      options?.timeLimitSeconds && options.timeLimitSeconds > 0
        ? Math.min(raceSeconds, options.timeLimitSeconds / 2)
        : raceSeconds,
      memberWorkers,
    )
    if (options?.signal?.aborted) throw new PipelineCancelledError()
    if (raceBest?.slot_by_course) {
      hint = raceBest.slot_by_course
      instance.hint = hint
    }
  }

  if (options?.signal?.aborted) throw new PipelineCancelledError()

  // Remaining time for full lex prove (if an overall limit was set).
  let proveLimit = options?.timeLimitSeconds
  if (deadline != null) proveLimit = Math.max(0, (deadline - performance.now()) / 1000)

  let solution: CpsatSolution
  if (raceBest && proveLimit === 0) {
    solution = raceBest
  } else {
    if (proveLimit === 0) {
      throw new Error('CP-SAT time budget expired without a portfolio incumbent')
    }
    try {
      const final = await spawnCpsatSolve(instance, {
        ...options, hint, workers: totalWorkers, timeLimitSeconds: proveLimit,
        deadlineMs: deadline,
        seed: options?.seed, clashOnly: options?.clashOnly ?? false,
      })
      solution = raceBest ? betterSolution(final, raceBest) : final
    } catch (err) {
      if (!raceBest || isAbortError(err) || options?.signal?.aborted) throw err
      solution = raceBest
    }
  }

  if (options?.signal?.aborted) throw new PipelineCancelledError()

  const slot_assignments = sectionSlotsFromCourseSlots(
    courseSections,
    solution.slot_by_course,
  )

  return {
    slot_assignments,
    slot_by_course: solution.slot_by_course,
    solver_used: `cpsat-ortools-${solution.num_workers}w`,
    solver_time_seconds: (performance.now() - t0) / 1000,
    total_clash_weight: solution.clash_weight ?? 0,
    red_students: solution.red_students ?? 0,
    proven_optimal: Boolean(solution.proven_optimal),
    proven_levels: solution.proven_levels ?? [],
    status: solution.status,
    message: solution.message,
    num_workers: solution.num_workers,
    ortools_version: solution.ortools_version,
    python_version: solution.python_version,
    clash_bound: solution.clash_bound,
    clash_gap: solution.clash_gap,
    red_bound: solution.red_bound,
    red_gap: solution.red_gap,
    timings: solution.timings,
    model_stats: solution.model_stats,
  }
}

/** Ensure the project venv exists (best-effort helper for CLI setup messaging). */
export async function cpsatVenvPythonPath(): Promise<string | null> {
  const unix = path.join(CPSAT_DIR, '.venv', 'bin', 'python')
  const win = path.join(CPSAT_DIR, '.venv', 'Scripts', 'python.exe')
  if (await pathExists(unix)) return unix
  if (await pathExists(win)) return win
  return null
}

export async function writeInstanceForDebug(
  instance: CpsatInstance,
  outDir: string,
): Promise<string> {
  await mkdir(outDir, { recursive: true })
  const p = path.join(outDir, 'cpsat-instance.json')
  await writeFile(p, JSON.stringify(instance, null, 2), 'utf8')
  return p
}

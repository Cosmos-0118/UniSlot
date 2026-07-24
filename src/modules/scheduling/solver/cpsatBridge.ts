import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConflictGraph, Section, Student } from '../types'
import {
  buildCpsatInstance,
  sectionSlotsFromCourseSlots,
  type CpsatInstance,
  type CpsatProgressEvent,
  type CpsatSolution,
} from './cpsatInstance'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
/** Repo root: src/modules/scheduling/solver → ../../../../ */
export const REPO_ROOT = path.resolve(MODULE_DIR, '../../../..')
export const CPSAT_DIR = path.join(REPO_ROOT, 'solver', 'cpsat')
export const CPSAT_SOLVE_PY = path.join(CPSAT_DIR, 'solve.py')

export type RunCpsatOptions = {
  timeLimitSeconds?: number
  workers?: number
  hint?: Record<string, number>
  signal?: AbortSignal
  onProgress?: (event: CpsatProgressEvent) => void
  /** Override python executable (default: solver/cpsat/.venv or python3). */
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
  return process.env.UNISLOT_PYTHON?.trim() || 'python3'
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
 * Spawn the Python CP-SAT solver on a prepared instance.
 * Progress NDJSON is read from stderr.
 */
export function spawnCpsatSolve(
  instance: CpsatInstance,
  options?: RunCpsatOptions,
): Promise<CpsatSolution> {
  return new Promise((resolve, reject) => {
    void (async () => {
      let workDir: string | undefined
      let child: ReturnType<typeof spawn> | undefined
      const onAbort = () => {
        child?.kill('SIGTERM')
      }

      try {
        const { python } = await ensureCpsatReady(options?.pythonPath)
        workDir = await mkdtemp(path.join(tmpdir(), 'unislot-cpsat-'))
        const instancePath = path.join(workDir, 'instance.json')
        const outputPath = path.join(workDir, 'solution.json')
        await writeFile(instancePath, JSON.stringify(instance), 'utf8')

        const args = [
          CPSAT_SOLVE_PY,
          '--instance',
          instancePath,
          '--output',
          outputPath,
        ]
        if (options?.timeLimitSeconds != null && options.timeLimitSeconds > 0) {
          args.push('--time-limit', String(options.timeLimitSeconds))
        }
        if (options?.workers != null && options.workers > 0) {
          args.push('--workers', String(options.workers))
        }

        child = spawn(python, args, {
          cwd: CPSAT_DIR,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        })

        if (options?.signal) {
          if (options.signal.aborted) {
            child.kill('SIGTERM')
            throw new Error('Aborted')
          }
          options.signal.addEventListener('abort', onAbort, { once: true })
        }

        const rl = createInterface({ input: child.stderr! })
        rl.on('line', (line) => {
          const evt = parseProgressLine(line)
          if (evt) options?.onProgress?.(evt)
        })

        const exitCode: number = await new Promise((res, rej) => {
          child!.on('error', rej)
          child!.on('close', (code) => res(code ?? 1))
        })

        options?.signal?.removeEventListener('abort', onAbort)

        let solution: CpsatSolution
        try {
          const raw = await readFile(outputPath, 'utf8')
          solution = JSON.parse(raw) as CpsatSolution
        } catch {
          throw new Error(
            exitCode !== 0
              ? `CP-SAT solver failed (exit ${exitCode}) with no solution file`
              : 'CP-SAT solver produced no solution file',
          )
        }

        if (!solution.slot_by_course || Object.keys(solution.slot_by_course).length === 0) {
          throw new Error(
            solution.error ||
              solution.message ||
              `CP-SAT solver returned empty assignment (status=${solution.status})`,
          )
        }

        resolve(solution)
      } catch (err) {
        reject(err)
      } finally {
        if (workDir) {
          await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
        }
      }
    })()
  })
}

export async function runCpsatScheduler(
  courseSections: Record<string, Section[]>,
  conflictGraph: ConflictGraph,
  facultyConstraints: Record<string, string[]>,
  students: Record<string, Student>,
  options?: RunCpsatOptions,
): Promise<CpsatSchedulerResult> {
  const instance = buildCpsatInstance(
    courseSections,
    conflictGraph,
    facultyConstraints,
    students,
    { hint: options?.hint },
  )
  const solution = await spawnCpsatSolve(instance, options)
  const slot_assignments = sectionSlotsFromCourseSlots(
    courseSections,
    solution.slot_by_course,
  )

  return {
    slot_assignments,
    slot_by_course: solution.slot_by_course,
    solver_used: `cpsat-ortools-${solution.num_workers}w`,
    solver_time_seconds: solution.solver_time_seconds,
    total_clash_weight: solution.clash_weight ?? 0,
    red_students: solution.red_students ?? 0,
    proven_optimal: Boolean(solution.proven_optimal),
    proven_levels: solution.proven_levels ?? [],
    status: solution.status,
    message: solution.message,
    num_workers: solution.num_workers,
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

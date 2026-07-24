#!/usr/bin/env node
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { Command } from 'commander'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus } from 'node:os'
import { assertReadableFile, pickEnrollmentFile, pickOutputFolder } from './fileDialog.ts'
import { banner, createSolveSpinner, formatMetrics, outroSuccess } from './ui.ts'
import {
  CPSAT_DIR,
  cpsatVenvPythonPath,
  killAllCpsatChildren,
  resolveCpsatPython,
} from '../src/modules/scheduling/solver/cpsatBridge.ts'
import { PipelineCancelledError } from '../src/modules/scheduling/pipeline/cancellation.ts'
import { runPipeline } from '../src/modules/scheduling/pipeline/run.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function ensurePythonReady(): Promise<string> {
  const existing = await cpsatVenvPythonPath()
  if (existing) {
    try {
      await resolveCpsatPython(existing)
      return existing
    } catch {
      /* fall through */
    }
  }
  p.log.warn(
    `OR-Tools venv not found. Create it with:\n` +
      chalk.cyan(`  python3 -m venv ${path.join(CPSAT_DIR, '.venv')}\n`) +
      chalk.cyan(`  ${path.join(CPSAT_DIR, '.venv', 'bin', 'pip')} install -r ${path.join(CPSAT_DIR, 'requirements.txt')}`),
  )
  const python = await resolveCpsatPython()
  return python
}

async function writeExports(
  outDir: string,
  result: Awaited<ReturnType<typeof runPipeline>>,
): Promise<string[]> {
  await mkdir(outDir, { recursive: true })
  const written: string[] = []
  if (result.scheduleXlsx) {
    const fp = path.join(outDir, 'schedule.xlsx')
    await writeFile(fp, Buffer.from(result.scheduleXlsx))
    written.push(fp)
  }
  if (result.clashXlsx) {
    const fp = path.join(outDir, 'clash-report.xlsx')
    await writeFile(fp, Buffer.from(result.clashXlsx))
    written.push(fp)
  }
  if (result.courseEmailsXlsx) {
    const fp = path.join(outDir, 'course-emails.xlsx')
    await writeFile(fp, Buffer.from(result.courseEmailsXlsx))
    written.push(fp)
  }
  if (result.schedulingSnapshot) {
    const fp = path.join(outDir, 'snapshot.json')
    await writeFile(fp, JSON.stringify(result.schedulingSnapshot, null, 2), 'utf8')
    written.push(fp)
  }
  const summary = {
    status: result.solver_status,
    proven_optimal: result.proven_optimal,
    proven_levels: result.proven_levels,
    message: result.solver_message,
    clash_weight: result.stats?.scheduling?.total_clash_weight,
    red_students: result.clashReport?.students_with_clashes,
    lower_bounds: result.stats?.scheduling?.lower_bounds,
    solver_used: result.schedule?.solver_used,
    solver_time_seconds: result.schedule?.solver_time_seconds,
  }
  const summaryPath = path.join(outDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  written.push(summaryPath)
  return written
}

async function runSolve(opts: {
  input?: string
  output?: string
  timeLimit?: number
  workers?: number
  portfolio?: number
  interactive: boolean
}): Promise<number> {
  banner()
  const python = await ensurePythonReady()
  p.log.info(`Python · ${python}`)
  const cpuN = cpus().length
  const workersLabel = opts.workers && opts.workers > 0 ? String(opts.workers) : String(cpuN)
  const portfolioK = opts.portfolio === undefined ? 5 : opts.portfolio
  if (portfolioK > 0) {
    const totalW = opts.workers && opts.workers > 0 ? opts.workers : cpuN
    const memberW = Math.max(2, Math.floor(totalW / portfolioK))
    p.log.info(
      `CPUs   · ${cpuN} logical · race ${portfolioK} seeds × ${memberW} workers (${portfolioK * memberW}w) → prove ${workersLabel}w`,
    )
  } else {
    p.log.info(`CPUs   · ${cpuN} logical · prove ${workersLabel}w (portfolio off)`)
  }

  let inputPath = opts.input
  if (!inputPath) {
    if (!opts.interactive) {
      p.log.error('Missing --input. Pass -i enroll.xlsx or run without flags for interactive mode.')
      return 1
    }
    const pick = p.spinner()
    pick.start('Opening file picker…')
    inputPath = (await pickEnrollmentFile()) ?? undefined
    pick.stop(inputPath ? `Selected ${path.basename(inputPath)}` : 'Cancelled')
    if (!inputPath) {
      p.cancel('No enrollment file selected.')
      return 1
    }
  }

  try {
    await assertReadableFile(inputPath)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  const buffer = await readFile(inputPath)
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  )

  const ac = new AbortController()
  let forceQuit = false
  let quitting = false
  const spin = createSolveSpinner(opts.workers && opts.workers > 0 ? opts.workers : cpus().length)

  const onSigInt = () => {
    if (forceQuit) {
      // Second Ctrl+C — hard kill every solver child and exit.
      void killAllCpsatChildren().finally(() => {
        spin.cancel()
        p.cancel('Force quit.')
        process.exit(130)
      })
      return
    }
    forceQuit = true
    if (!quitting) {
      quitting = true
      p.log.warn('Cancelling… stopping solver processes (Ctrl+C again to force quit)')
      ac.abort()
      void killAllCpsatChildren()
    }
  }
  process.on('SIGINT', onSigInt)
  process.on('SIGTERM', onSigInt)

  spin.start('Reading enrollment workbook…')

  try {
    const result = await runPipeline(
      arrayBuffer,
      (evt) => {
        if (ac.signal.aborted) return
        if (evt.cpsat) {
          spin.applyCpsat(evt.cpsat)
          return
        }
        if (evt.stage === 'schedule') {
          spin.updateFromPipeline(evt.message)
        } else {
          spin.updateFromPipeline(evt.message)
        }
      },
      {
        cpsatTimeLimitSeconds: opts.timeLimit,
        cpsatWorkers: opts.workers,
        cpsatPortfolio: opts.portfolio,
        eagerExports: true,
        eagerExportKinds: { schedule: true, clash: true, courseEmails: true },
        signal: ac.signal,
      },
    )

    process.off('SIGINT', onSigInt)
    process.off('SIGTERM', onSigInt)

    if (!result.validation.is_valid || !result.schedule) {
      spin.stop('Validation failed')
      for (const e of result.validation.errors.slice(0, 12)) {
        p.log.error(`${e.field}: ${e.message}`)
      }
      return 1
    }

    const clashWeight = result.stats?.scheduling?.total_clash_weight ?? 0
    const red = result.clashReport?.students_with_clashes ?? 0
    const proven = Boolean(result.proven_optimal)
    const provenLevels = result.proven_levels ?? []
    const fullLex =
      provenLevels.includes('clash_weight') &&
      provenLevels.includes('red_students') &&
      provenLevels.includes('balance_and_parallel')
    const workersUsed =
      Number(/(\d+)w$/.exec(result.schedule.solver_used)?.[1]) ||
      (opts.workers && opts.workers > 0 ? opts.workers : cpus().length)
    spin.stop(
      fullLex
        ? chalk.green('CP-SAT finished — full lex optimal (clash · RED · balance)')
        : proven
          ? chalk.green('CP-SAT finished — clash weight proven optimal')
          : chalk.yellow('CP-SAT finished — best feasible solution'),
    )

    p.note(
      formatMetrics({
        clashWeight,
        red,
        proven,
        provenLevels,
        status: result.solver_status ?? result.schedule.solver_used,
        seconds: result.schedule.solver_time_seconds,
        workers: workersUsed,
        structuralImpossible: result.schedule.zero_clash_structurally_impossible,
      }),
      'Result',
    )

    if (result.schedule.lower_bound_notes?.length) {
      p.note(result.schedule.lower_bound_notes.join('\n'), 'Lower bounds')
    }

    let outDir = opts.output
    if (!outDir) {
      if (opts.interactive) {
        const usePicker = await p.confirm({
          message: 'Pick an output folder with a system dialog?',
          initialValue: true,
        })
        if (p.isCancel(usePicker)) {
          p.cancel('Cancelled')
          return 1
        }
        if (usePicker) {
          const folderSpin = p.spinner()
          folderSpin.start('Opening folder picker…')
          outDir = (await pickOutputFolder()) ?? undefined
          folderSpin.stop(outDir ? outDir : 'Cancelled — using ./unislot-out')
        }
      }
      outDir = outDir || path.join(process.cwd(), 'unislot-out')
    }

    const writeSpin = p.spinner()
    writeSpin.start(`Writing exports to ${outDir}…`)
    const files = await writeExports(outDir, result)
    writeSpin.stop(`Wrote ${files.length} file(s)`)

    outroSuccess([
      chalk.green('Done.'),
      ...files.map((f) => chalk.dim('  · ') + f),
      fullLex
        ? chalk.green(
            'Full lex optimal — clash, RED, and weekday balance are all proven best under this model.',
          )
        : proven
          ? chalk.green(
              'Clash weight is proven minimal — it is not possible to reduce clashes further under this model.',
            )
          : chalk.yellow('Run again without --time-limit to chase a full optimality proof.'),
    ])
    return 0
  } catch (err) {
    process.off('SIGINT', onSigInt)
    process.off('SIGTERM', onSigInt)
    await killAllCpsatChildren().catch(() => undefined)

    const cancelled =
      ac.signal.aborted || err instanceof PipelineCancelledError

    if (cancelled) {
      spin.cancel()
      p.cancel('Solve cancelled — solver processes stopped.')
      return 130
    }

    spin.stop('Failed')
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}

async function main(): Promise<void> {
  const program = new Command()
  program
    .name('unislot')
    .description('UniSlot terminal scheduler — max-resource CP-SAT, proven clash optimality')
    .version('0.1.0')

  program
    .command('solve', { isDefault: true })
    .description('Parse enrollment Excel, solve with CP-SAT, write schedule exports')
    .option('-i, --input <file>', 'Enrollment .xlsx path')
    .option('-o, --output <dir>', 'Output directory for exports')
    .option('--time-limit <seconds>', 'Optional wall-clock limit (escape hatch only)', (v) =>
      Number(v),
    )
    .option('--workers <n>', 'CP-SAT workers for the prove phase (default: all CPUs)', (v) =>
      Number(v),
    )
    .option(
      '--portfolio <k>',
      'Multi-seed clash race before prove (default: 5; 0 disables)',
      (v) => Number(v),
    )
    .option('-y, --yes', 'Non-interactive when paths are provided', false)
    .action(async (flags: {
      input?: string
      output?: string
      timeLimit?: number
      workers?: number
      portfolio?: number
      yes?: boolean
    }) => {
      const interactive = !flags.yes && (!flags.input || !flags.output)
      const code = await runSolve({
        input: flags.input,
        output: flags.output,
        timeLimit: flags.timeLimit,
        workers: flags.workers,
        portfolio: flags.portfolio,
        interactive: interactive || !flags.input,
      })
      process.exitCode = code
    })

  program
    .command('doctor')
    .description('Check Python / OR-Tools / CP-SAT readiness')
    .action(async () => {
      banner()
      const python = await ensurePythonReady()
      p.log.success(`Python: ${python}`)
      p.log.info(`Solver: ${path.join(CPSAT_DIR, 'solve.py')}`)
      p.log.info(`Repo:   ${REPO_ROOT}`)
      p.outro('Ready to schedule.')
    })

  await program.parseAsync(process.argv)
}

void main()

#!/usr/bin/env node
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { Command } from 'commander'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus } from 'node:os'
import { assertReadableFile, pickEnrollmentFile, pickOutputFolder, pickPreviousOutputFolder, assertSnapshotFolder } from './fileDialog.ts'
import { parseSeedInput, resolveRunSeed } from './seedPrompt.ts'
import { banner, createSolveSpinner, formatMetrics, outroSuccess } from './ui.ts'
import {
  CPSAT_DIR,
  cpsatVenvPythonPath,
  killAllCpsatChildren,
  resolveCpsatPython,
} from '../src/modules/scheduling/solver/cpsatBridge.ts'
import { PipelineCancelledError } from '../src/modules/scheduling/pipeline/cancellation.ts'
import { runPipeline } from '../src/modules/scheduling/pipeline/run.ts'
import {
  loadPreviousSummary,
  parseEnrollmentWorkbook,
  runRectifyPipeline,
  type RectifyPipelineResult,
} from '../src/modules/scheduling/pipeline/rectifyRun.ts'
import { loadSchedulingSnapshot } from '../src/modules/scheduling/merge/snapshot.ts'
import {
  buildFixedDays,
  computeEnrollmentDelta,
  formatEnrollmentDeltaSummary,
  freeCourseCodes,
  inferAllowSaturdayFromSnapshot,
} from '../src/modules/scheduling/merge/enrollmentDelta.ts'

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
  meta: { seed: number; workers: number; portfolio: number },
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
    const snapshot = {
      ...result.schedulingSnapshot,
      seed: meta.seed,
      workers: meta.workers,
      portfolio: meta.portfolio,
    }
    await writeFile(fp, JSON.stringify(snapshot, null, 2), 'utf8')
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
    solver_time_seconds: 0,
    seed: meta.seed,
    workers: meta.workers,
    portfolio: meta.portfolio,
  }
  const summaryPath = path.join(outDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  written.push(summaryPath)
  return written
}

async function writeRectifyExports(
  outDir: string,
  result: RectifyPipelineResult,
  meta: { workers: number },
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
  if (result.rectificationReport) {
    const fp = path.join(outDir, 'rectification-report.json')
    await writeFile(fp, JSON.stringify(result.rectificationReport, null, 2), 'utf8')
    written.push(fp)
  }
  const summary = {
    mode: 'rectify',
    status: result.solver_status,
    proven_optimal: result.proven_optimal,
    message: result.solver_message,
    clash_weight: result.stats?.scheduling?.total_clash_weight,
    red_students: result.clashReport?.students_with_clashes,
    changed_students: result.enrollmentDelta?.changed_students.length ?? 0,
    new_courses: result.enrollmentDelta?.new_course_codes ?? [],
    infeasible: result.infeasible ?? false,
    workers: meta.workers,
  }
  const summaryPath = path.join(outDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  written.push(summaryPath)
  return written
}

async function promptRunMode(): Promise<'solve' | 'rectify' | null> {
  const mode = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'solve', label: 'Create schedule' },
      { value: 'rectify', label: 'Rectify schedule (after registration changes)' },
    ],
  })
  if (p.isCancel(mode)) return null
  return mode as 'solve' | 'rectify'
}

async function runRectify(opts: {
  baseline?: string
  rectified?: string
  previous?: string
  output?: string
  nomenclature?: string
  timeLimit?: number
  workers?: number
  portfolio?: number
  absoluteGap?: number
  provePlateau?: number
  prove?: boolean
  saturday?: boolean
  seed?: number
  skipPrompts?: boolean
  interactive: boolean
}): Promise<number> {
  banner()
  const python = await ensurePythonReady()
  p.log.info(`Python · ${python}`)
  const cpuN = cpus().length
  const requestedWorkers = opts.workers && opts.workers > 0 ? opts.workers : cpuN
  const portfolioK = opts.portfolio === undefined ? 0 : Math.max(0, Math.floor(opts.portfolio))

  let baselinePath = opts.baseline
  let rectifiedPath = opts.rectified
  let previousDir = opts.previous
  let outDir = opts.output

  if (!baselinePath && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick original registration workbook…')
    baselinePath = (await pickEnrollmentFile('Select original registration Excel')) ?? undefined
    pick.stop(baselinePath ? path.basename(baselinePath) : 'Cancelled')
  }
  if (!rectifiedPath && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick rectified registration workbook…')
    rectifiedPath =
      (await pickEnrollmentFile('Select rectified (updated) registration Excel')) ?? undefined
    pick.stop(rectifiedPath ? path.basename(rectifiedPath) : 'Cancelled')
  }
  if (!previousDir && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick previous output folder…')
    previousDir = (await pickPreviousOutputFolder()) ?? undefined
    pick.stop(previousDir ? path.basename(previousDir) : 'Cancelled')
  }
  if (!outDir && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick new output folder…')
    outDir = (await pickOutputFolder('Choose folder for rectified exports')) ?? undefined
    pick.stop(outDir ? path.basename(outDir) : 'Cancelled — using ./unislot-out-rectified')
    outDir = outDir || path.join(process.cwd(), 'unislot-out-rectified')
  }

  if (!baselinePath || !rectifiedPath || !previousDir) {
    p.log.error(
      'Rectify requires --baseline, --rectified, and --previous (or interactive pickers).',
    )
    return 1
  }
  outDir = outDir || path.join(process.cwd(), 'unislot-out-rectified')

  try {
    await assertReadableFile(baselinePath)
    await assertReadableFile(rectifiedPath)
    await assertSnapshotFolder(previousDir)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  let snapshot
  try {
    snapshot = await loadSchedulingSnapshot(previousDir)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  const inferredSaturday = inferAllowSaturdayFromSnapshot(snapshot)
  let allowSaturdayForMath = opts.saturday
  if (allowSaturdayForMath === undefined) {
    if (opts.interactive && !opts.skipPrompts) {
      const answer = await p.confirm({
        message: `Use Saturday slot for maths courses? (previous run: ${inferredSaturday ? 'enabled' : 'blocked'})`,
        initialValue: inferredSaturday,
      })
      if (p.isCancel(answer)) {
        p.cancel('Cancelled')
        return 1
      }
      allowSaturdayForMath = Boolean(answer)
    } else {
      allowSaturdayForMath = inferredSaturday
    }
  }

  let programNomenclatureXlsx: ArrayBuffer | undefined
  if (opts.nomenclature) {
    try {
      await assertReadableFile(opts.nomenclature)
      const nomBuffer = await readFile(opts.nomenclature)
      programNomenclatureXlsx = nomBuffer.buffer.slice(
        nomBuffer.byteOffset,
        nomBuffer.byteOffset + nomBuffer.byteLength,
      )
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err))
      return 1
    }
  }

  const baselineBuffer = await readFile(baselinePath)
  const baselineParsed = await parseEnrollmentWorkbook(
    baselineBuffer.buffer.slice(
      baselineBuffer.byteOffset,
      baselineBuffer.byteOffset + baselineBuffer.byteLength,
    ),
  )

  const rectifiedBuffer = await readFile(rectifiedPath)
  const rectifiedArrayBuffer = rectifiedBuffer.buffer.slice(
    rectifiedBuffer.byteOffset,
    rectifiedBuffer.byteOffset + rectifiedBuffer.byteLength,
  )

  const rectifiedParsed = await parseEnrollmentWorkbook(rectifiedArrayBuffer)
  if (!rectifiedParsed.validation.is_valid) {
    p.log.error('Rectified workbook failed validation:')
    for (const e of rectifiedParsed.validation.errors.slice(0, 12)) {
      p.log.error(`${e.field}: ${e.message}`)
    }
    return 1
  }

  const enrollmentDelta = computeEnrollmentDelta(baselineParsed.rows, rectifiedParsed.rows)
  const newCourseCodes = new Set(
    rectifiedParsed.rows.map((r) => r.course_code).filter(Boolean),
  )
  const fixedDays = buildFixedDays(snapshot, newCourseCodes)
  const free = freeCourseCodes(newCourseCodes, fixedDays)

  p.note(
    formatEnrollmentDeltaSummary(enrollmentDelta, free, Object.keys(fixedDays).length),
    'Rectify preview',
  )

  if (opts.interactive && !opts.skipPrompts) {
    const proceed = await p.confirm({
      message: 'Apply these changes and write rectified exports?',
      initialValue: true,
    })
    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Cancelled')
      return 1
    }
  }

  const previousSummary = await loadPreviousSummary(previousDir)

  const ac = new AbortController()
  const spin = createSolveSpinner(requestedWorkers)
  process.on('SIGINT', () => {
    ac.abort()
    void killAllCpsatChildren()
  })

  spin.start('Rectifying schedule…')

  try {
    const result = await runRectifyPipeline(
      rectifiedArrayBuffer,
      (evt) => {
        if (ac.signal.aborted) return
        if (evt.cpsat) spin.applyCpsat(evt.cpsat)
        else spin.updateFromPipeline(evt.message)
      },
      {
        baselineRows: baselineParsed.rows,
        previousSnapshot: snapshot,
        previousSummary,
        cpsatTimeLimitSeconds: opts.timeLimit,
        cpsatWorkers: opts.workers,
        cpsatPortfolio: portfolioK,
        cpsatAbsoluteGap: opts.absoluteGap,
        cpsatProvePlateauSeconds: opts.provePlateau,
        cpsatFullProve: opts.prove,
        allowSaturdayForMath,
        programNomenclatureXlsx,
        seed: opts.seed,
        eagerExports: true,
        eagerExportKinds: { schedule: true, clash: true, courseEmails: true },
        signal: ac.signal,
      },
    )

    if (!result.validation.is_valid) {
      spin.stop('Validation failed')
      for (const e of result.validation.errors.slice(0, 12)) {
        p.log.error(`${e.field}: ${e.message}`)
      }
      return 1
    }

    if (result.infeasible) {
      spin.stop('Rectify infeasible')
      p.log.error(result.infeasible_reason ?? 'Hard constraints violated')
      if (result.rectificationReport?.hard_constraint_violations.length) {
        p.note(result.rectificationReport.hard_constraint_violations.join('\n'), 'Violations')
      }
      const files = await writeRectifyExports(outDir, result, { workers: requestedWorkers })
      p.log.warn(`Partial report written to ${outDir} (${files.length} file(s))`)
      return 1
    }

    if (!result.schedule) {
      spin.stop('Rectify failed')
      return 1
    }

    spin.stop(chalk.green('Rectify complete'))

    const delta = result.enrollmentDelta
    if (delta) {
      p.note(
        [
          `${delta.changed_students.length} student(s) changed`,
          `${delta.new_course_codes.length} new course(s): ${delta.new_course_codes.join(', ') || '—'}`,
          `${delta.removed_course_codes.length} removed course(s): ${delta.removed_course_codes.join(', ') || '—'}`,
        ].join('\n'),
        'Changes',
      )
    }

    if (result.rectificationReport?.baseline_warnings.length) {
      p.log.warn(
        result.rectificationReport.baseline_warnings.map((w) => w.message).join('\n'),
      )
    }

    const writeSpin = p.spinner()
    writeSpin.start(`Writing rectified exports to ${outDir}…`)
    const files = await writeRectifyExports(outDir, result, { workers: requestedWorkers })
    writeSpin.stop(`Wrote ${files.length} file(s)`)

    outroSuccess([
      chalk.green('Rectified schedule written.'),
      chalk.dim(`Previous folder unchanged: ${previousDir}`),
      ...files.map((f) => chalk.dim('  · ') + f),
    ])
    return 0
  } catch (err) {
    await killAllCpsatChildren().catch(() => undefined)
    if (ac.signal.aborted || err instanceof PipelineCancelledError) {
      spin.cancel()
      p.cancel('Rectify cancelled.')
      return 130
    }
    spin.stop('Failed')
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}

async function runSolve(opts: {
  input?: string
  output?: string
  nomenclature?: string
  timeLimit?: number
  workers?: number
  portfolio?: number
  absoluteGap?: number
  provePlateau?: number
  prove?: boolean
  /** undefined = ask in interactive mode; default blocked when non-interactive. */
  saturday?: boolean
  /** Explicit --seed; skips the seed prompt when set. */
  seed?: number
  /** -y: skip seed and other interactive prompts */
  skipPrompts?: boolean
  interactive: boolean
}): Promise<number> {
  banner()
  const python = await ensurePythonReady()
  p.log.info(`Python · ${python}`)
  const cpuN = cpus().length
  const requestedWorkers = opts.workers && opts.workers > 0 ? opts.workers : cpuN
  const workersLabel = String(requestedWorkers)
  const portfolioK = opts.portfolio === undefined ? 0 : Math.max(0, Math.floor(opts.portfolio))
  if (portfolioK > 0) {
    const memberW = Math.max(2, Math.floor(requestedWorkers / portfolioK))
    p.log.info(
      `CPUs   · ${cpuN} logical · race ${portfolioK} seeds × ${memberW} workers (${portfolioK * memberW}w) → prove ${workersLabel}w`,
    )
    p.log.warn(
      'Portfolio race uses a wall-clock budget — schedule will not reproduce from seed alone. Use --portfolio 0 (default) for reproducible runs.',
    )
  } else {
    p.log.info(`CPUs   · ${cpuN} logical · prove ${workersLabel}w (portfolio off)`)
  }

  let allowSaturdayForMath = opts.saturday
  if (allowSaturdayForMath === undefined) {
    if (opts.interactive) {
      const answer = await p.confirm({
        message: 'Use Saturday slot for maths courses? (temporarily blocked by default)',
        initialValue: false,
      })
      if (p.isCancel(answer)) {
        p.cancel('Cancelled')
        return 1
      }
      allowSaturdayForMath = Boolean(answer)
    } else {
      allowSaturdayForMath = false
    }
  }
  p.log.info(
    allowSaturdayForMath
      ? 'Saturday · enabled for maths courses'
      : 'Saturday · blocked (Mon–Fri only)',
  )

  const seedResult = await resolveRunSeed({
    interactive: !opts.skipPrompts && opts.seed === undefined,
    seed: opts.seed,
  })
  if ('cancelled' in seedResult) {
    p.cancel('Cancelled')
    return 1
  }
  const { seed, reused } = seedResult
  p.log.info(
    reused
      ? `Seed   · ${seed} (reused from previous run)`
      : `Seed   · ${seed} (new run — save this to reproduce with --seed ${seed})`,
  )

  let programNomenclatureXlsx: ArrayBuffer | undefined
  if (opts.nomenclature) {
    try {
      await assertReadableFile(opts.nomenclature)
      const nomBuffer = await readFile(opts.nomenclature)
      programNomenclatureXlsx = nomBuffer.buffer.slice(
        nomBuffer.byteOffset,
        nomBuffer.byteOffset + nomBuffer.byteLength,
      )
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err))
      return 1
    }
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
        cpsatPortfolio: portfolioK,
        cpsatAbsoluteGap: opts.absoluteGap,
        cpsatProvePlateauSeconds: opts.provePlateau,
        cpsatFullProve: opts.prove,
        allowSaturdayForMath,
        programNomenclatureXlsx,
        seed,
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
    const files = await writeExports(outDir, result, {
      seed,
      workers: workersUsed,
      portfolio: portfolioK,
    })
    writeSpin.stop(`Wrote ${files.length} file(s)`)

    const reproduceHint =
      portfolioK > 0 || opts.timeLimit != null || opts.provePlateau != null || opts.absoluteGap != null
        ? chalk.dim(
            `Seed ${seed} recorded — reproducible only with --portfolio 0, same --workers ${workersUsed}, and no time/plateau/gap escapes.`,
          )
        : chalk.dim(
            `Seed ${seed} — reuse with --seed ${seed} --workers ${workersUsed} (same machine settings) to reproduce this schedule.`,
          )

    outroSuccess([
      chalk.green('Done.'),
      reproduceHint,
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
  const args = process.argv.slice(2)
  const hasExplicitSubcommand =
    args[0] === 'doctor' || args[0] === 'rectify' || args[0] === 'solve'
  const nonInteractive = args.includes('-y') || args.includes('--yes')
  const bareInteractive =
    !hasExplicitSubcommand && !nonInteractive && args.every((a) => !a.startsWith('-') || a === '-')

  if (bareInteractive && args.length === 0) {
    banner()
    const mode = await promptRunMode()
    if (!mode) {
      p.cancel('Cancelled')
      process.exit(1)
    }
    if (mode === 'rectify') {
      process.exitCode = await runRectify({ interactive: true })
      return
    }
  }

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
    .option('--nomenclature <file>', 'Optional Nomenclature.xlsx for program/branch abbreviations')
    .option('--time-limit <seconds>', 'Optional wall-clock limit (escape hatch only)', (v) =>
      Number(v),
    )
    .option('--workers <n>', 'CP-SAT workers for the prove phase (default: all CPUs)', (v) =>
      Number(v),
    )
    .option(
      '--portfolio <k>',
      'Multi-seed clash race before prove (default: 0; k>0 enables, breaks seed reproducibility)',
      (v) => Number(v),
    )
    .option('--seed <n>', 'Reuse a prior run seed (skips seed prompt; works with -y)', (v) => {
      const n = parseSeedInput(String(v))
      if (n === undefined) throw new Error('--seed must be a non-negative integer')
      return n
    })
    .option(
      '--absolute-gap <n>',
      'Ship when clash incumbent−bound ≤ n (skips full OPTIMAL certificate)',
      (v) => Number(v),
    )
    .option(
      '--prove-plateau <seconds>',
      'Ship when clash incumbent and bound are both flat for N seconds',
      (v) => Number(v),
    )
    .option('--prove', 'Disable gap/plateau escapes; chase full clash OPTIMAL', false)
    .option(
      '--saturday',
      'Allow Saturday slot for maths courses (use --no-saturday to block; default: ask / blocked)',
    )
    .option('-y, --yes', 'Non-interactive when paths are provided', false)
    .action(async (flags: {
      input?: string
      output?: string
      nomenclature?: string
      timeLimit?: number
      workers?: number
      portfolio?: number
      seed?: number
      absoluteGap?: number
      provePlateau?: number
      prove?: boolean
      saturday?: boolean
      yes?: boolean
    }) => {
      const interactive = !flags.yes && (!flags.input || !flags.output)
      // Commander --saturday / --no-saturday → true / false; omitted → undefined.
      const saturdayFlag =
        typeof flags.saturday === 'boolean' ? flags.saturday : undefined
      const code = await runSolve({
        input: flags.input,
        output: flags.output,
        nomenclature: flags.nomenclature,
        timeLimit: flags.timeLimit,
        workers: flags.workers,
        portfolio: flags.portfolio,
        seed: flags.seed,
        absoluteGap: flags.absoluteGap,
        provePlateau: flags.provePlateau,
        prove: flags.prove,
        saturday: saturdayFlag,
        skipPrompts: Boolean(flags.yes),
        interactive: interactive || !flags.input,
      })
      process.exitCode = code
    })

  program
    .command('rectify')
    .description(
      'Rectify a schedule after registration changes — pins existing course weekdays, places new courses only',
    )
    .option('--baseline <file>', 'Original registration .xlsx (before changes)')
    .option('--rectified <file>', 'Updated full registration .xlsx')
    .option('--previous <dir>', 'Previous output folder containing snapshot.json')
    .option('-o, --output <dir>', 'New output directory for rectified exports')
    .option('--nomenclature <file>', 'Optional Nomenclature.xlsx')
    .option('--time-limit <seconds>', 'Optional wall-clock limit', (v) => Number(v))
    .option('--workers <n>', 'CP-SAT workers (default: all CPUs)', (v) => Number(v))
    .option('--portfolio <k>', 'Portfolio race size (default: 0)', (v) => Number(v))
    .option('--seed <n>', 'Solver seed', (v) => {
      const n = parseSeedInput(String(v))
      if (n === undefined) throw new Error('--seed must be a non-negative integer')
      return n
    })
    .option('--absolute-gap <n>', 'Stop when clash gap ≤ n', (v) => Number(v))
    .option('--prove-plateau <seconds>', 'Plateau escape (seconds)', (v) => Number(v))
    .option('--prove', 'Full optimality proof', false)
    .option('--saturday', 'Allow Saturday for maths')
    .option('-y, --yes', 'Non-interactive when paths are provided', false)
    .action(
      async (flags: {
        baseline?: string
        rectified?: string
        previous?: string
        output?: string
        nomenclature?: string
        timeLimit?: number
        workers?: number
        portfolio?: number
        seed?: number
        absoluteGap?: number
        provePlateau?: number
        prove?: boolean
        saturday?: boolean
        yes?: boolean
      }) => {
        const interactive =
          !flags.yes && (!flags.baseline || !flags.rectified || !flags.previous)
        const saturdayFlag =
          typeof flags.saturday === 'boolean' ? flags.saturday : undefined
        process.exitCode = await runRectify({
          baseline: flags.baseline,
          rectified: flags.rectified,
          previous: flags.previous,
          output: flags.output,
          nomenclature: flags.nomenclature,
          timeLimit: flags.timeLimit,
          workers: flags.workers,
          portfolio: flags.portfolio,
          seed: flags.seed,
          absoluteGap: flags.absoluteGap,
          provePlateau: flags.provePlateau,
          prove: flags.prove,
          saturday: saturdayFlag,
          skipPrompts: Boolean(flags.yes),
          interactive,
        })
      },
    )

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

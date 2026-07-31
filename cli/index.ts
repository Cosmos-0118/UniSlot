#!/usr/bin/env node
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { Command } from 'commander'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus } from 'node:os'
import { assertReadableFile, pickEnrollmentFile, pickOutputFolder, pickPreviousOutputFolder, assertSnapshotFolder } from './fileDialog.ts'
import { formatReproToken, parseSeedInput, resolveRunSeed } from './seedPrompt.ts'
import {
  bannerAnimated,
  createSolveSpinner,
  formatMetrics,
  outroSuccess,
  playWriteSweep,
  showPanel,
} from './ui.ts'
import { palette, spinOk, spinWarn } from './theme.ts'
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
  type RectificationReport,
  type RectifyPipelineResult,
} from '../src/modules/scheduling/pipeline/rectifyRun.ts'
import {
  runLatePipeline,
  type ClashDecision,
  type LateEnrollmentReport,
  type LatePipelineResult,
} from '../src/modules/scheduling/pipeline/lateRun.ts'
import {
  loadSchedulingSnapshot,
  type SchedulingSnapshot,
} from '../src/modules/scheduling/merge/snapshot.ts'
import {
  buildFixedDays,
  computeEnrollmentDelta,
  extractCourseSlotsFromSnapshot,
  formatEnrollmentDeltaSummary,
  freeCourseCodes,
  inferAllowSaturdayFromSnapshot,
  inferSaturdayExtrasFromSnapshot,
} from '../src/modules/scheduling/merge/enrollmentDelta.ts'
import {
  formatProjectedLoads,
  type CapacityPanel,
  type ClashPanel,
} from '../src/modules/scheduling/merge/lateResolution.ts'
import type { CapacityDecision, OnFullStrategy } from '../src/modules/scheduling/merge/lateEnrollment.ts'
import {
  normalizeSaturdayExtraCodes,
  slotIndexToDay,
} from '../src/modules/scheduling/solver/timeModel.ts'
import {
  filterScheduleEntries,
  normalizeCourseCodeList,
  readScheduleEntriesFromFile,
  scheduleFromFilteredEntries,
} from '../src/modules/scheduling/io/excelScheduleReader.ts'
import { scheduleToWorkbookBuffer } from '../src/modules/scheduling/io/excelScheduleWorkbook.ts'
import { readFirstSheetAsAoA } from '../src/modules/scheduling/io/excelIo.ts'
import {
  ISSUE_CATEGORY_LABELS,
  ISSUE_CATEGORY_ORDER,
  findEnrollmentIssues,
  type IssueCategory,
} from '../src/modules/scheduling/parse/issueFinder.ts'

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

async function promptSaturdayExtraCodes(
  initial: string[] = [],
): Promise<string[] | 'cancelled'> {
  const answer = await p.text({
    message: 'Extra course codes allowed on Saturday (comma-separated, optional)',
    placeholder: 'e.g. 21CSE101T, 21ECE202T',
    initialValue: initial.length ? initial.join(', ') : '',
  })
  if (p.isCancel(answer)) return 'cancelled'
  return normalizeSaturdayExtraCodes(String(answer ?? ''))
}

function logSaturdayPolicy(allowSaturdayForMath: boolean, extras: string[]): void {
  p.log.info(
    allowSaturdayForMath
      ? 'Saturday · enabled for maths courses'
      : 'Saturday · maths blocked',
  )
  p.log.info(
    extras.length
      ? `Saturday · extras: ${extras.join(', ')}`
      : 'Saturday · extras: none',
  )
}

async function writeExports(
  outDir: string,
  result: Awaited<ReturnType<typeof runPipeline>>,
  meta: {
    seed: number
    workers: number
    portfolio: number
    allowSaturdayForMath: boolean
    saturdayExtraCourseCodes?: string[]
    ortools_version?: string
    python_version?: string
  },
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
  const saturdayExtras = normalizeSaturdayExtraCodes(meta.saturdayExtraCourseCodes)
  if (result.schedulingSnapshot) {
    const fp = path.join(outDir, 'snapshot.json')
    const snapshot = {
      ...result.schedulingSnapshot,
      seed: meta.seed,
      workers: meta.workers,
      portfolio: meta.portfolio,
      allowSaturdayForMath: meta.allowSaturdayForMath,
      ...(saturdayExtras.length ? { saturdayExtraCourseCodes: saturdayExtras } : {}),
      ...(meta.ortools_version ? { ortools_version: meta.ortools_version } : {}),
      ...(meta.python_version ? { python_version: meta.python_version } : {}),
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
    allow_saturday_for_math: meta.allowSaturdayForMath,
    saturday_extra_course_codes: saturdayExtras,
    repro_token: formatReproToken({
      seed: meta.seed,
      workers: meta.workers,
      portfolio: meta.portfolio,
      allowSaturdayForMath: meta.allowSaturdayForMath,
    }),
    ...(meta.ortools_version ? { ortools_version: meta.ortools_version } : {}),
    ...(meta.python_version ? { python_version: meta.python_version } : {}),
  }
  const summaryPath = path.join(outDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  written.push(summaryPath)
  return written
}

async function writeRectifyExports(
  outDir: string,
  result: RectifyPipelineResult,
  meta: { workers: number; seed?: number },
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
      ...(result.ortools_version ? { ortools_version: result.ortools_version } : {}),
      ...(result.python_version ? { python_version: result.python_version } : {}),
    }
    await writeFile(fp, JSON.stringify(snapshot, null, 2), 'utf8')
    written.push(fp)
  }
  if (result.rectificationReport) {
    const fp = path.join(outDir, 'rectification-report.json')
    await writeFile(fp, JSON.stringify(result.rectificationReport, null, 2), 'utf8')
    written.push(fp)
  }
  if (result.runLog.length) {
    const fp = path.join(outDir, 'run-log.json')
    await writeFile(fp, JSON.stringify(result.runLog, null, 2), 'utf8')
    written.push(fp)
  }
  const report = result.rectificationReport
  const summary = {
    mode: 'rectify',
    status: result.solver_status,
    proven_optimal: result.proven_optimal,
    proven_levels: result.proven_levels,
    message: result.solver_message,
    placement_method: report?.placement_method,
    clash_weight: result.stats?.scheduling?.total_clash_weight,
    red_students: result.clashReport?.students_with_clashes,
    new_clashes: report?.new_clashes.length ?? 0,
    carried_over_clashes: report?.carried_over_clashes.length ?? 0,
    resolved_clashes: report?.resolved_clashes.length ?? 0,
    lower_bounds: result.stats?.scheduling?.lower_bounds,
    changed_students: result.enrollmentDelta?.changed_students.length ?? 0,
    new_courses: result.enrollmentDelta?.new_course_codes ?? [],
    pinned_courses: report?.pinned_course_count ?? 0,
    infeasible: result.infeasible ?? false,
    allow_saturday_for_math: result.allowSaturdayForMath,
    saturday_extra_course_codes: result.saturdayExtraCourseCodes ?? [],
    seed: meta.seed,
    workers: meta.workers,
    ...(result.ortools_version ? { ortools_version: result.ortools_version } : {}),
    ...(result.python_version ? { python_version: result.python_version } : {}),
  }
  const summaryPath = path.join(outDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  written.push(summaryPath)
  return written
}

/**
 * Result panel for a rectify run. Deliberately reports only what this rectification changed —
 * clashes that already existed in the previous run are summarised as a single count, never listed.
 */
function formatRectifyResult(
  report: RectificationReport,
  snapshot: SchedulingSnapshot,
): string {
  const previousDays = extractCourseSlotsFromSnapshot(snapshot)
  const dayOf = (code: string): string => {
    const placed = report.new_course_slots[code]
    if (placed !== undefined) return slotIndexToDay(placed)
    const prev = previousDays[code]
    return prev === undefined ? '?' : slotIndexToDay(prev)
  }

  const lines: string[] = []

  if (report.new_course_placements.length > 0) {
    lines.push(chalk.bold('New course' + (report.new_course_placements.length > 1 ? 's' : '')))
    for (const pl of report.new_course_placements) {
      lines.push(
        `  ${chalk.cyan(pl.course_code)} · ${pl.course_title}`,
        `    ${chalk.green(pl.day)} · ${pl.section_count} section(s) · ${pl.enrollment} student(s)`,
      )
    }
    lines.push('')
  }

  if (report.removed_course_codes.length > 0) {
    lines.push(
      chalk.bold('Removed courses'),
      `  ${report.removed_course_codes.join(', ')}`,
      '',
    )
  }

  if (report.changed_students.length > 0) {
    lines.push(chalk.bold('Student changes'))
    const shown = report.changed_students.slice(0, 12)
    for (const s of shown) {
      lines.push(`  ${chalk.cyan(s.register_number)} · ${s.student_name}`)
      if (s.dropped.length > 0) {
        lines.push(`    dropped  ${s.dropped.map((c) => `${c} (${dayOf(c)})`).join(', ')}`)
      }
      if (s.added.length > 0) {
        lines.push(`    added    ${s.added.map((c) => `${c} (${dayOf(c)})`).join(', ')}`)
      }
      const clash = report.new_clashes.find((c) => c.register_number === s.register_number)
      lines.push(
        clash
          ? `    status   ${chalk.red(`Red — clash on ${clash.day}: ${clash.courses.join(', ')}`)}`
          : `    status   ${chalk.green('Green — no clash')}`,
      )
    }
    if (report.changed_students.length > shown.length) {
      lines.push(chalk.dim(`  … ${report.changed_students.length - shown.length} more`))
    }
    lines.push('')
  }

  lines.push(chalk.bold('Impact'))
  lines.push(`  ${report.pinned_course_count} course weekday(s) frozen from the previous run`)
  lines.push(
    `  Section splits changed: ${
      report.section_count_changes.length === 0
        ? 'none'
        : report.section_count_changes
            .map((c) => `${c.course_code} ${c.before}→${c.after}`)
            .join(', ')
    }`,
  )
  const newClashLine = `  New clashes introduced: ${report.new_clashes.length}`
  lines.push(report.new_clashes.length > 0 ? chalk.red(newClashLine) : chalk.green(newClashLine))
  for (const c of report.new_clashes.slice(0, 8)) {
    lines.push(`    ${c.register_number} · ${c.student_name} · ${c.day} · ${c.courses.join(', ')}`)
  }
  if (report.new_clashes.length > 8) {
    lines.push(chalk.dim(`    … ${report.new_clashes.length - 8} more`))
  }
  if (report.resolved_clashes.length > 0) {
    lines.push(chalk.green(`  Clashes resolved: ${report.resolved_clashes.length}`))
  }
  if (report.carried_over_clashes.length > 0) {
    lines.push(
      chalk.dim(
        `  Pre-existing clashes carried over: ${report.carried_over_clashes.length} (unchanged by this rectification)`,
      ),
    )
  }

  return lines.join('\n')
}

async function promptRunMode(): Promise<
  'solve' | 'rectify' | 'late' | 'filter' | 'issues' | null
> {
  const mode = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'solve', label: 'Create schedule' },
      { value: 'rectify', label: 'Rectify schedule (after registration changes)' },
      { value: 'late', label: 'Add late enrollments (existing schedule stays frozen)' },
      { value: 'filter', label: 'Filter schedule by course codes' },
      { value: 'issues', label: 'Find issues in enrollment file' },
    ],
  })
  if (p.isCancel(mode)) return null
  return mode as 'solve' | 'rectify' | 'late' | 'filter' | 'issues'
}

const ISSUE_PANEL_LINE_CAP = 200

function formatIssueLine(issue: {
  row_number?: number
  severity: string
  message: string
}): string {
  const row = issue.row_number != null ? `Row ${issue.row_number} · ` : ''
  const sev = issue.severity === 'error' ? chalk.red('error') : chalk.yellow('warn')
  return `${sev}  ${row}${issue.message}`
}

function formatCategoryPanelBody(
  issues: { row_number?: number; severity: string; message: string }[],
): string {
  const shown = issues.slice(0, ISSUE_PANEL_LINE_CAP)
  const lines = shown.map(formatIssueLine)
  if (issues.length > ISSUE_PANEL_LINE_CAP) {
    lines.push(chalk.dim(`…and ${issues.length - ISSUE_PANEL_LINE_CAP} more`))
  }
  return lines.join('\n')
}

async function runIssues(opts: {
  input?: string
  interactive: boolean
}): Promise<number> {
  await bannerAnimated()

  let inputPath = opts.input
  if (!inputPath && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick enrollment workbook…')
    inputPath = (await pickEnrollmentFile()) ?? undefined
    pick.stop(inputPath ? spinOk(path.basename(inputPath)) : spinWarn('Cancelled'))
  }
  if (!inputPath) {
    p.log.error('No enrollment file provided. Use -i or pick a file.')
    return 1
  }
  try {
    await assertReadableFile(inputPath)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  const buf = await readFile(inputPath)
  const aoa = await readFirstSheetAsAoA(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  )
  if (!aoa) {
    p.log.error('No sheets in workbook.')
    return 1
  }

  const report = findEnrollmentIssues(aoa)

  const countParts = ISSUE_CATEGORY_ORDER.filter((c) => report.counts[c] > 0).map(
    (c) => `${ISSUE_CATEGORY_LABELS[c]} ${report.counts[c]}`,
  )
  p.log.info(
    `${path.basename(inputPath)} · ${report.total_rows} data rows · ${report.valid_rows} after dedupe · ${report.total_issues} issue${report.total_issues === 1 ? '' : 's'}` +
      (countParts.length ? ` (${countParts.join(', ')})` : ''),
  )

  if (report.total_issues === 0) {
    p.log.success('No data-quality issues found.')
    p.outro('Ready for Create schedule.')
    return 0
  }

  for (const category of ISSUE_CATEGORY_ORDER) {
    const list = report.by_category[category as IssueCategory]
    if (!list.length) continue
    const title = `${ISSUE_CATEGORY_LABELS[category]} (${list.length})`
    showPanel(title, formatCategoryPanelBody(list))
  }

  if (report.blocking) {
    p.log.error(
      `${report.error_count} blocking error${report.error_count === 1 ? '' : 's'} — fix before Create schedule` +
        (report.warning_count
          ? ` (${report.warning_count} warning${report.warning_count === 1 ? '' : 's'} also listed)`
          : ''),
    )
    p.outro('Issue Finder finished with blocking errors.')
    return 1
  }

  p.log.warn(
    `${report.warning_count} warning${report.warning_count === 1 ? '' : 's'} — file is usable for Create schedule (duplicates are dropped automatically)`,
  )
  p.outro('Issue Finder finished.')
  return 0
}

async function promptFilterCourseCodes(initial = ''): Promise<string[] | 'cancelled'> {
  const answer = await p.text({
    message: 'Course codes to keep (comma- or newline-separated)',
    placeholder: 'e.g. 21CSC203P, 21CSE251T, 21CSE254T',
    initialValue: initial,
    validate: (v) => {
      if (!normalizeCourseCodeList(String(v ?? '')).length) {
        return 'Enter at least one course code'
      }
    },
  })
  if (p.isCancel(answer)) return 'cancelled'
  return normalizeCourseCodeList(String(answer ?? ''))
}

async function runFilter(opts: {
  input?: string
  codes?: string
  output?: string
  skipPrompts?: boolean
  interactive: boolean
}): Promise<number> {
  await bannerAnimated()

  let inputPath = opts.input
  let outDir = opts.output
  let codes = normalizeCourseCodeList(opts.codes)

  if (!inputPath && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick final schedule workbook…')
    inputPath = (await pickEnrollmentFile('Select final schedule.xlsx')) ?? undefined
    pick.stop(inputPath ? spinOk(path.basename(inputPath)) : spinWarn('Cancelled'))
  }
  if (!inputPath) {
    p.log.error('No schedule.xlsx provided. Use -i or pick a file.')
    return 1
  }
  try {
    await assertReadableFile(inputPath)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  if (!codes.length && opts.interactive && !opts.skipPrompts) {
    const prompted = await promptFilterCourseCodes()
    if (prompted === 'cancelled') {
      p.cancel('Cancelled')
      return 1
    }
    codes = prompted
  }
  if (!codes.length) {
    p.log.error('No course codes provided. Use -c or enter codes when prompted.')
    return 1
  }

  if (!outDir && opts.interactive) {
    const pick = p.spinner()
    pick.start('Choose output folder…')
    outDir = (await pickOutputFolder('Choose folder for filtered schedule')) ?? undefined
    pick.stop(outDir ? spinOk(outDir) : spinWarn('Using default'))
  }
  outDir = outDir || path.join(process.cwd(), 'unislot-filtered')

  try {
    const parseSpin = p.spinner()
    parseSpin.start('Reading schedule…')
    const entries = await readScheduleEntriesFromFile(inputPath)
    parseSpin.stop(spinOk(`${entries.length} section(s) in source`))

    const filtered = filterScheduleEntries(entries, codes)
    if (filtered.kept === 0) {
      p.log.error(
        `None of the ${codes.length} requested code(s) appear in the schedule. Check codes and try again.`,
      )
      if (filtered.missingCodes.length) {
        p.log.info(`Missing: ${filtered.missingCodes.join(', ')}`)
      }
      return 1
    }

    p.log.info(
      `Kept ${filtered.kept} section(s) · dropped ${filtered.dropped} · ` +
        `${new Set(filtered.entries.map((e) => e.course_code)).size} course(s)`,
    )
    if (filtered.missingCodes.length) {
      p.log.warn(`Not in schedule: ${filtered.missingCodes.join(', ')}`)
    }

    await playWriteSweep()
    const writeSpin = p.spinner()
    writeSpin.start(`Writing filtered schedule to ${outDir}…`)
    await mkdir(outDir, { recursive: true })
    const schedule = scheduleFromFilteredEntries(filtered.entries)
    const buf = await scheduleToWorkbookBuffer(schedule)
    const fp = path.join(outDir, 'schedule.xlsx')
    await writeFile(fp, Buffer.from(buf))
    writeSpin.stop(spinOk('Wrote schedule.xlsx'))

    await outroSuccess([
      palette.ok('Filtered schedule ready.'),
      palette.dim('  · ') + fp,
    ])
    return 0
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }
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
  saturdayCodes?: string
  seed?: number
  skipPrompts?: boolean
  interactive: boolean
}): Promise<number> {
  await bannerAnimated()
  const python = await ensurePythonReady()
  p.log.info(`Python · ${python}`)
  const cpuN = cpus().length
  const requestedWorkers = opts.workers && opts.workers > 0 ? opts.workers : cpuN
  if (opts.portfolio !== undefined && opts.portfolio > 0) {
    // With every continuing course pinned the model presolves to almost nothing.
    p.log.warn('--portfolio is ignored during rectify; the pinned model solves in a single pass.')
  }

  let baselinePath = opts.baseline
  let rectifiedPath = opts.rectified
  let previousDir = opts.previous
  let outDir = opts.output

  if (!baselinePath && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick original registration workbook…')
    baselinePath = (await pickEnrollmentFile('Select original registration Excel')) ?? undefined
    pick.stop(
      baselinePath ? spinOk(path.basename(baselinePath)) : spinWarn('Cancelled'),
    )
  }
  if (!rectifiedPath && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick rectified registration workbook…')
    rectifiedPath =
      (await pickEnrollmentFile('Select rectified (updated) registration Excel')) ?? undefined
    pick.stop(
      rectifiedPath ? spinOk(path.basename(rectifiedPath)) : spinWarn('Cancelled'),
    )
  }
  if (!previousDir && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick previous output folder…')
    previousDir = (await pickPreviousOutputFolder()) ?? undefined
    pick.stop(
      previousDir ? spinOk(path.basename(previousDir)) : spinWarn('Cancelled'),
    )
  }
  if (!outDir && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick new output folder…')
    outDir = (await pickOutputFolder('Choose folder for rectified exports')) ?? undefined
    pick.stop(
      outDir
        ? spinOk(path.basename(outDir))
        : spinWarn('Cancelled — using ./unislot-out-rectified'),
    )
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
  const inferredExtras = inferSaturdayExtrasFromSnapshot(snapshot)
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

  let saturdayExtraCourseCodes: string[]
  if (opts.saturdayCodes !== undefined) {
    saturdayExtraCourseCodes = normalizeSaturdayExtraCodes(opts.saturdayCodes)
  } else if (opts.interactive && !opts.skipPrompts) {
    const extras = await promptSaturdayExtraCodes(inferredExtras)
    if (extras === 'cancelled') {
      p.cancel('Cancelled')
      return 1
    }
    saturdayExtraCourseCodes = extras
  } else {
    saturdayExtraCourseCodes = inferredExtras
  }
  logSaturdayPolicy(allowSaturdayForMath, saturdayExtraCourseCodes)

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

  showPanel(
    'Rectify preview',
    formatEnrollmentDeltaSummary(enrollmentDelta, free, Object.keys(fixedDays).length),
  )

  if (enrollmentDelta.changed_students.length === 0 && free.length === 0) {
    p.log.warn('Nothing changed between the two workbooks — the previous schedule already applies.')
    if (opts.interactive && !opts.skipPrompts) {
      const proceed = await p.confirm({
        message: 'Re-export the schedule anyway?',
        initialValue: false,
      })
      if (p.isCancel(proceed) || !proceed) {
        p.cancel('Cancelled')
        return 1
      }
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
        rectifiedRows: rectifiedParsed.rows,
        previousSnapshot: snapshot,
        previousSummary,
        cpsatTimeLimitSeconds: opts.timeLimit,
        cpsatWorkers: opts.workers,
        cpsatAbsoluteGap: opts.absoluteGap,
        cpsatProvePlateauSeconds: opts.provePlateau,
        cpsatFullProve: opts.prove,
        allowSaturdayForMath,
        saturdayExtraCourseCodes,
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
      spin.stop(spinWarn('Rectify blocked'))
      p.log.error(result.infeasible_reason ?? 'Structural constraints violated')
      const violations = result.rectificationReport?.hard_constraint_violations ?? []
      if (violations.length > 1) {
        showPanel('Structural violations', violations.slice(0, 12).join('\n'))
      }
      const files = await writeRectifyExports(outDir, result, {
        workers: requestedWorkers,
        seed: opts.seed,
      })
      p.log.warn(`Partial report written to ${outDir} (${files.length} file(s))`)
      return 1
    }

    if (!result.schedule) {
      spin.stop(spinWarn('Rectify failed'))
      return 1
    }

    spin.stop(spinOk('Rectify complete'))

    const report = result.rectificationReport
    if (report) {
      showPanel('Rectified', formatRectifyResult(report, snapshot))
      if (report.placement_method === 'greedy-fallback') {
        p.log.warn(
          'CP-SAT was unavailable, so new courses were placed by the greedy fallback. Weekday balance is not guaranteed — re-run once the solver is available.',
        )
      }
      if (report.baseline_warnings.length) {
        p.log.warn(report.baseline_warnings.map((w) => w.message).join('\n'))
      }
      if (report.new_clashes.length > 0 && opts.interactive && !opts.skipPrompts) {
        const proceed = await p.confirm({
          message: `Write exports despite ${report.new_clashes.length} newly introduced clash(es)?`,
          initialValue: true,
        })
        if (p.isCancel(proceed) || !proceed) {
          p.cancel('Cancelled — nothing written.')
          return 1
        }
      }
    }

    await playWriteSweep()
    const writeSpin = p.spinner()
    writeSpin.start(`Writing rectified exports to ${outDir}…`)
    const files = await writeRectifyExports(outDir, result, {
      workers: requestedWorkers,
      seed: opts.seed,
    })
    writeSpin.stop(spinOk(`Wrote ${files.length} file(s)`))

    await outroSuccess([
      palette.ok('Rectified schedule written.'),
      palette.dim(`Previous folder unchanged: ${previousDir}`),
      ...files.map((f) => palette.dim('  · ') + f),
    ])
    return 0
  } catch (err) {
    await killAllCpsatChildren().catch(() => undefined)
    if (ac.signal.aborted || err instanceof PipelineCancelledError) {
      spin.cancel()
      p.cancel('Rectify cancelled.')
      return 130
    }
    spin.stop(spinWarn('Failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}

const ON_FULL_STRATEGIES: OnFullStrategy[] = [
  'new-section',
  'equalize',
  'fit',
  'buffer',
  'park',
]
const ON_CLASH_STRATEGIES: ClashDecision['choice'][] = ['accept', 'drop-course', 'park-student']

async function writeLateExports(
  outDir: string,
  result: LatePipelineResult,
  meta: { workers: number; seed?: number },
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
      ...(result.ortools_version ? { ortools_version: result.ortools_version } : {}),
      ...(result.python_version ? { python_version: result.python_version } : {}),
    }
    await writeFile(fp, JSON.stringify(snapshot, null, 2), 'utf8')
    written.push(fp)
  }
  if (result.lateReport) {
    const fp = path.join(outDir, 'late-enrollment-report.json')
    await writeFile(fp, JSON.stringify(result.lateReport, null, 2), 'utf8')
    written.push(fp)
  }
  if (result.runLog.length) {
    const fp = path.join(outDir, 'run-log.json')
    await writeFile(fp, JSON.stringify(result.runLog, null, 2), 'utf8')
    written.push(fp)
  }
  const report = result.lateReport
  const summary = {
    mode: 'late',
    status: result.solver_status,
    proven_optimal: result.proven_optimal,
    proven_levels: result.proven_levels,
    message: result.solver_message,
    batch: report?.batch,
    run_seq: report?.run_seq,
    clash_weight: result.stats?.scheduling?.total_clash_weight,
    red_students: result.clashReport?.students_with_clashes,
    red_before: report?.red_before,
    red_after: report?.red_after,
    new_clashes: report?.clash_diff.introduced.length ?? 0,
    registrations_added: report?.assignments.length ?? 0,
    sections_created: report?.new_section_ids ?? [],
    parked: report?.parked.length ?? 0,
    capacity_waivers: report?.capacity_waivers.length ?? 0,
    new_course_codes: report?.new_course_codes ?? [],
    placement_method: report?.placement_method,
    infeasible: result.infeasible ?? false,
    allow_saturday_for_math: result.allowSaturdayForMath,
    saturday_extra_course_codes: result.saturdayExtraCourseCodes ?? [],
    seed: meta.seed,
    workers: meta.workers,
    ...(result.ortools_version ? { ortools_version: result.ortools_version } : {}),
    ...(result.python_version ? { python_version: result.python_version } : {}),
    introduced_clash_causes:
      report?.clash_diff.introduced.map((c) => ({
        register_number: c.register_number,
        day: c.day,
        courses: c.courses,
      })) ?? [],
  }
  const summaryPath = path.join(outDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  written.push(summaryPath)
  return written
}

function formatLateResult(report: LateEnrollmentReport): string {
  const lines: string[] = []
  lines.push(chalk.bold(`Late batch ${report.batch} (run #${report.run_seq})`))
  lines.push(`  Placed: ${report.assignments.length} registration(s)`)
  if (report.new_section_ids.length) {
    lines.push(`  New sections: ${report.new_section_ids.join(', ')}`)
  }
  if (report.moved_students.length) {
    lines.push(`  Students moved between sections (equalize): ${report.moved_students.length}`)
  }
  if (report.capacity_waivers.length) {
    lines.push(chalk.yellow(`  Capacity waivers: ${report.capacity_waivers.length}`))
  }
  if (report.parked.length) {
    lines.push(chalk.yellow(`  Parked: ${report.parked.length}`))
  }
  lines.push(`  RED ${report.red_before} → ${report.red_after}`)
  const newClashLine = `  New clashes: ${report.clash_diff.introduced.length}`
  lines.push(
    report.clash_diff.introduced.length > 0 ? chalk.red(newClashLine) : chalk.green(newClashLine),
  )
  for (const c of report.clash_diff.introduced.slice(0, 8)) {
    lines.push(`    ${c.register_number} · ${c.student_name} · ${c.day} · ${c.courses.join(', ')}`)
  }
  if (report.clash_diff.introduced.length > 8) {
    lines.push(chalk.dim(`    … ${report.clash_diff.introduced.length - 8} more`))
  }
  return lines.join('\n')
}

async function promptCapacityPanels(panels: CapacityPanel[]): Promise<CapacityDecision[]> {
  const decisions: CapacityDecision[] = []
  let applyAll: CapacityDecision | null = null

  for (const panel of panels) {
    if (applyAll) {
      decisions.push({ ...applyAll, course_code: panel.conflict.course_code })
      continue
    }
    const c = panel.conflict
    const lines = [
      chalk.bold(`${c.course_code} · ${c.course_title}`),
      `  Frozen weekday   ${panel.frozen_day} — cannot change (${c.sections.reduce((n, s) => n + s.enrollment, 0)} students already scheduled)`,
      `  Sections now     ${c.sections.length} section(s) — ${c.sections.map((s) => `${s.enrollment}/${s.capacity}`).join(' · ')} (${c.seats_free} free)`,
      `  Late demand      ${c.late_demand} student(s)`,
      `  The problem      ${c.shortfall} of them have no seat`,
      '',
      '  How do you want to fit them?',
    ]
    for (let i = 0; i < panel.options.length; i++) {
      const opt = panel.options[i]!
      lines.push(`  ${i + 1}  ${opt.label}`)
      lines.push(`     ${formatProjectedLoads(opt.projected)}`)
      lines.push(`     ${opt.summary}`)
    }
    showPanel('Capacity conflict', lines.join('\n'))

    const choice = await p.select({
      message: `Strategy for ${c.course_code}`,
      options: panel.options.map((o) => ({
        value: o.strategy,
        label: o.label,
        hint: o.summary.slice(0, 80),
      })),
    })
    if (p.isCancel(choice)) throw new Error('Cancelled')

    const decided: CapacityDecision = {
      course_code: c.course_code,
      strategy: choice as OnFullStrategy,
      buffer_per_section: panel.options.find((o) => o.strategy === choice)?.buffer_per_section,
    }

    if (panels.indexOf(panel) < panels.length - 1) {
      const all = await p.confirm({
        message: 'Apply this choice to all remaining over-capacity courses?',
        initialValue: false,
      })
      if (p.isCancel(all)) throw new Error('Cancelled')
      if (all) applyAll = decided
    }
    decisions.push(decided)
  }
  return decisions
}

async function promptClashPanels(panels: ClashPanel[]): Promise<ClashDecision[]> {
  const decisions: ClashDecision[] = []
  let applyAll: ClashDecision | null = null

  for (const panel of panels) {
    if (applyAll) {
      decisions.push({
        ...applyAll,
        register_number: panel.clash.register_number,
        drop_course_code:
          applyAll.choice === 'drop-course'
            ? panel.clash.late_courses[0]
            : applyAll.drop_course_code,
      })
      continue
    }
    const cl = panel.clash
    const whyLines = cl.clashing_courses.map((code) => {
      const n = cl.course_enrollments[code] ?? 0
      return `    ${code} is frozen to ${cl.day} — ${n} student(s) already scheduled`
    })
    const lines = [
      chalk.bold(`${cl.register_number} · ${cl.student_name} · ${cl.program}`),
      `  Late registrations   ${cl.late_courses.join(', ')}`,
      `  The problem          ${cl.clashing_courses.join(' + ')} sit on ${cl.day}`,
      '',
      '  Why it cannot be avoided',
      ...whyLines,
      '    Neither course can move without breaking the published timetable.',
      '',
      '  What do you want to do?',
    ]
    for (let i = 0; i < panel.options.length; i++) {
      const opt = panel.options[i]!
      lines.push(`  ${i + 1}  ${opt.label}`)
      lines.push(`     ${opt.summary}`)
    }
    showPanel('Unavoidable clash', lines.join('\n'))

    const choice = await p.select({
      message: `Clash decision for ${cl.register_number}`,
      options: panel.options.map((o, i) => ({
        value: String(i),
        label: o.label,
        hint: o.summary.slice(0, 80),
      })),
    })
    if (p.isCancel(choice)) throw new Error('Cancelled')
    const opt = panel.options[Number(choice)]!
    const decided: ClashDecision = {
      register_number: cl.register_number,
      choice: opt.choice,
      drop_course_code: opt.drop_course_code,
    }

    if (panels.indexOf(panel) < panels.length - 1) {
      const all = await p.confirm({
        message: 'Apply the same choice to all remaining clashing students?',
        initialValue: false,
      })
      if (p.isCancel(all)) throw new Error('Cancelled')
      if (all) applyAll = decided
    }
    decisions.push(decided)
  }
  return decisions
}

async function runLate(opts: {
  previous?: string
  late?: string
  output?: string
  nomenclature?: string
  timeLimit?: number
  workers?: number
  absoluteGap?: number
  provePlateau?: number
  prove?: boolean
  saturday?: boolean
  saturdayCodes?: string
  seed?: number
  onFull?: OnFullStrategy
  overflowBuffer?: number
  onClash?: 'accept' | 'drop-course' | 'park-student'
  skipPrompts?: boolean
  interactive: boolean
}): Promise<number> {
  await bannerAnimated()
  const python = await ensurePythonReady()
  p.log.info(`Python · ${python}`)
  const cpuN = cpus().length
  const requestedWorkers = opts.workers && opts.workers > 0 ? opts.workers : cpuN

  let previousDir = opts.previous
  let latePath = opts.late
  let outDir = opts.output

  if (!previousDir && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick previous output folder…')
    previousDir = (await pickPreviousOutputFolder()) ?? undefined
    pick.stop(
      previousDir ? spinOk(path.basename(previousDir)) : spinWarn('Cancelled'),
    )
  }
  if (!latePath && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick late enrollments workbook…')
    latePath = (await pickEnrollmentFile('Select late enrollments Excel')) ?? undefined
    pick.stop(latePath ? spinOk(path.basename(latePath)) : spinWarn('Cancelled'))
  }
  if (!outDir && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick new output folder…')
    outDir = (await pickOutputFolder('Choose folder for late-enrollment exports')) ?? undefined
    pick.stop(
      outDir
        ? spinOk(path.basename(outDir))
        : spinWarn('Cancelled — using ./unislot-out-late'),
    )
    outDir = outDir || path.join(process.cwd(), 'unislot-out-late')
  }

  if (!previousDir || !latePath) {
    p.log.error('Late mode requires --previous and --late (or interactive pickers).')
    return 1
  }
  outDir = outDir || path.join(process.cwd(), 'unislot-out-late')

  try {
    await assertReadableFile(latePath)
    await assertSnapshotFolder(previousDir)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  let snapshot: SchedulingSnapshot
  try {
    snapshot = await loadSchedulingSnapshot(previousDir)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  const inferredSaturday = inferAllowSaturdayFromSnapshot(snapshot)
  const inferredExtras = inferSaturdayExtrasFromSnapshot(snapshot)
  let allowSaturdayForMath = opts.saturday
  if (allowSaturdayForMath === undefined) {
    allowSaturdayForMath = inferredSaturday
  }
  const saturdayExtraCourseCodes =
    opts.saturdayCodes !== undefined
      ? normalizeSaturdayExtraCodes(opts.saturdayCodes)
      : inferredExtras
  logSaturdayPolicy(allowSaturdayForMath, saturdayExtraCourseCodes)

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

  const lateBuffer = await readFile(latePath)
  const lateArrayBuffer = lateBuffer.buffer.slice(
    lateBuffer.byteOffset,
    lateBuffer.byteOffset + lateBuffer.byteLength,
  )
  const lateParsed = await parseEnrollmentWorkbook(lateArrayBuffer)
  if (!lateParsed.validation.is_valid) {
    p.log.error('Late workbook failed validation:')
    for (const e of lateParsed.validation.errors.slice(0, 12)) {
      p.log.error(`${e.field}: ${e.message}`)
    }
    return 1
  }

  if (lateParsed.validation.errors.length > 0 && opts.interactive && !opts.skipPrompts) {
    showPanel(
      'Skipped / warning rows',
      lateParsed.validation.errors
        .slice(0, 12)
        .map((e) => `row ${e.row_number ?? '?'}: ${e.field} — ${e.message}`)
        .join('\n'),
    )
    const proceed = await p.confirm({
      message: 'Continue despite skipped/warning rows?',
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

  spin.start('Merging late enrollments…')

  try {
    const result = await runLatePipeline(
      (evt) => {
        if (ac.signal.aborted) return
        if (evt.cpsat) spin.applyCpsat(evt.cpsat)
        else spin.updateFromPipeline(evt.message)
      },
      {
        previousSnapshot: snapshot,
        lateRows: lateParsed.rows,
        previousSummary,
        cpsatTimeLimitSeconds: opts.timeLimit,
        cpsatWorkers: opts.workers,
        cpsatAbsoluteGap: opts.absoluteGap,
        cpsatProvePlateauSeconds: opts.provePlateau,
        cpsatFullProve: opts.prove,
        allowSaturdayForMath,
        saturdayExtraCourseCodes,
        programNomenclatureXlsx,
        seed: opts.seed,
        eagerExports: true,
        eagerExportKinds: { schedule: true, clash: true, courseEmails: true },
        signal: ac.signal,
        inputFileName: path.basename(latePath),
        previousDir,
        outputDir: outDir,
        defaultOnFull: opts.onFull ?? 'new-section',
        defaultBuffer: opts.overflowBuffer ?? 2,
        defaultOnClash: opts.onClash ?? 'accept',
        onCapacityConflicts:
          opts.interactive && !opts.skipPrompts && !opts.onFull
            ? async (panels) => {
                spin.stop('Capacity decision needed')
                const d = await promptCapacityPanels(panels)
                spin.start('Continuing late merge…')
                return d
              }
            : undefined,
        onPredictedClashes:
          opts.interactive && !opts.skipPrompts && !opts.onClash
            ? async (panels) => {
                spin.stop('Clash decision needed')
                const d = await promptClashPanels(panels)
                spin.start('Continuing late merge…')
                return d
              }
            : undefined,
      },
    )

    if (result.infeasible) {
      spin.stop(spinWarn('Late merge blocked'))
      p.log.error(result.infeasible_reason ?? 'Frozen invariants or structural constraints violated')
      const files = await writeLateExports(outDir, result, {
        workers: requestedWorkers,
        seed: opts.seed,
      })
      p.log.warn(`Partial report written to ${outDir} (${files.length} file(s))`)
      return 1
    }

    if (!result.schedule) {
      spin.stop(spinWarn('Nothing to merge (or failed)'))
      if (result.lateReport == null) {
        p.log.warn('No late registrations to add.')
        return 0
      }
      return 1
    }

    spin.stop(spinOk('Late merge complete'))

    const report = result.lateReport
    if (report) {
      showPanel('Late enrollment', formatLateResult(report))
      if (report.clash_diff.introduced.length > 0 && opts.interactive && !opts.skipPrompts) {
        const proceed = await p.confirm({
          message: `Write exports despite ${report.clash_diff.introduced.length} newly introduced clash(es)?`,
          initialValue: true,
        })
        if (p.isCancel(proceed) || !proceed) {
          p.cancel('Cancelled — nothing written.')
          return 1
        }
      }
    }

    await playWriteSweep()
    const writeSpin = p.spinner()
    writeSpin.start(`Writing late exports to ${outDir}…`)
    const files = await writeLateExports(outDir, result, {
      workers: requestedWorkers,
      seed: opts.seed,
    })
    writeSpin.stop(spinOk(`Wrote ${files.length} file(s)`))

    await outroSuccess([
      palette.ok('Late enrollments integrated.'),
      palette.dim(`Previous folder unchanged: ${previousDir}`),
      ...files.map((f) => palette.dim('  · ') + f),
    ])
    return 0
  } catch (err) {
    await killAllCpsatChildren().catch(() => undefined)
    if (ac.signal.aborted || err instanceof PipelineCancelledError) {
      spin.cancel()
      p.cancel('Late merge cancelled.')
      return 130
    }
    spin.stop(spinWarn('Failed'))
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
  /** Comma-separated extra course codes allowed on Saturday. */
  saturdayCodes?: string
  /** Explicit --seed; skips the seed prompt when set. */
  seed?: number
  /** -y: skip seed and other interactive prompts */
  skipPrompts?: boolean
  interactive: boolean
}): Promise<number> {
  await bannerAnimated()
  const python = await ensurePythonReady()
  p.log.info(`Python · ${python}`)
  const cpuN = cpus().length

  const seedResult = await resolveRunSeed({
    interactive: !opts.skipPrompts && opts.seed === undefined,
    seed: opts.seed,
  })
  if ('cancelled' in seedResult) {
    p.cancel('Cancelled')
    return 1
  }
  const { seed, reused, plainSeedOnly } = seedResult

  // Flag > token > machine CPU count. Token workers override cpus().length on reuse.
  const requestedWorkers =
    opts.workers && opts.workers > 0
      ? opts.workers
      : seedResult.workers && seedResult.workers > 0
        ? seedResult.workers
        : cpuN
  const workersLabel = String(requestedWorkers)
  const portfolioK =
    opts.portfolio !== undefined
      ? Math.max(0, Math.floor(opts.portfolio))
      : seedResult.portfolio !== undefined
        ? Math.max(0, Math.floor(seedResult.portfolio))
        : 0

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

  if (plainSeedOnly && reused && !(opts.workers && opts.workers > 0)) {
    p.log.warn(
      `Reusing seed ${seed} alone — workers will default to this machine's CPU count (${requestedWorkers}). ` +
        `If the original run used a different worker count, the schedule will NOT reproduce. ` +
        `Use the full token seed/workers/portfolio/sat, or pass --workers.`,
    )
  }

  let allowSaturdayForMath = opts.saturday
  if (allowSaturdayForMath === undefined && seedResult.allowSaturdayForMath !== undefined) {
    allowSaturdayForMath = seedResult.allowSaturdayForMath
  }
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

  let saturdayExtraCourseCodes: string[]
  if (opts.saturdayCodes !== undefined) {
    saturdayExtraCourseCodes = normalizeSaturdayExtraCodes(opts.saturdayCodes)
  } else if (opts.interactive && !opts.skipPrompts) {
    const extras = await promptSaturdayExtraCodes([])
    if (extras === 'cancelled') {
      p.cancel('Cancelled')
      return 1
    }
    saturdayExtraCourseCodes = extras
  } else {
    saturdayExtraCourseCodes = []
  }
  logSaturdayPolicy(allowSaturdayForMath, saturdayExtraCourseCodes)

  const reproToken = formatReproToken({
    seed,
    workers: requestedWorkers,
    portfolio: portfolioK,
    allowSaturdayForMath,
  })
  p.log.info(
    reused
      ? `Seed   · ${reproToken} (reused from previous run)`
      : `Seed   · ${reproToken} (new run — save this token to reproduce)`,
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
    pick.stop(
      inputPath
        ? spinOk(`Selected ${path.basename(inputPath)}`)
        : spinWarn('Cancelled'),
    )
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
  const spin = createSolveSpinner(requestedWorkers)

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
        cpsatWorkers: requestedWorkers,
        cpsatPortfolio: portfolioK,
        cpsatAbsoluteGap: opts.absoluteGap,
        cpsatProvePlateauSeconds: opts.provePlateau,
        cpsatFullProve: opts.prove,
        allowSaturdayForMath,
        saturdayExtraCourseCodes,
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
      Number(/(\d+)w$/.exec(result.schedule.solver_used)?.[1]) || requestedWorkers
    spin.stop(
      fullLex
        ? spinOk('CP-SAT finished — full lex optimal (clash · RED · balance)')
        : proven
          ? spinOk('CP-SAT finished — clash weight proven optimal')
          : spinWarn('CP-SAT finished — best feasible solution'),
    )

    const statusLabel = result.solver_status ?? result.schedule.solver_used
    await spin.playStamp(statusLabel)
    process.stdout.write(
      '\n' +
        formatMetrics({
          clashWeight,
          red,
          proven,
          provenLevels,
          status: statusLabel,
          seconds: result.schedule.solver_time_seconds,
          workers: workersUsed,
          structuralImpossible: result.schedule.zero_clash_structurally_impossible,
        }) +
        '\n',
    )

    if (result.schedule.lower_bound_notes?.length) {
      showPanel('Lower bounds', result.schedule.lower_bound_notes.join('\n'))
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
          folderSpin.stop(
            outDir ? spinOk(outDir) : spinWarn('Cancelled — using ./unislot-out'),
          )
        }
      }
      outDir = outDir || path.join(process.cwd(), 'unislot-out')
    }

    const finalToken = formatReproToken({
      seed,
      workers: workersUsed,
      portfolio: portfolioK,
      allowSaturdayForMath,
    })

    await playWriteSweep()
    const writeSpin = p.spinner()
    writeSpin.start(`Writing exports to ${outDir}…`)
    const files = await writeExports(outDir, result, {
      seed,
      workers: workersUsed,
      portfolio: portfolioK,
      allowSaturdayForMath,
      saturdayExtraCourseCodes,
      ortools_version: result.ortools_version,
      python_version: result.python_version,
    })
    writeSpin.stop(spinOk(`Wrote ${files.length} file(s)`))

    const reproduceHint =
      portfolioK > 0 || opts.timeLimit != null || opts.provePlateau != null || opts.absoluteGap != null
        ? palette.dim(
            `Repro token · ${finalToken} — reproducible only with --portfolio 0 and no time/plateau/gap escapes (same ortools/python versions).`,
          )
        : palette.dim(
            `Repro token · ${finalToken}\nSave this and enter it when prompted on any machine to reproduce this schedule.`,
          )

    await outroSuccess([
      palette.ok('Done.'),
      reproduceHint,
      ...files.map((f) => palette.dim('  · ') + f),
      fullLex
        ? palette.ok(
            'Full lex optimal — clash, RED, and weekday balance are all proven best under this model.',
          )
        : proven
          ? palette.ok(
              'Clash weight is proven minimal — it is not possible to reduce clashes further under this model.',
            )
          : palette.warn('Run again without --time-limit to chase a full optimality proof.'),
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

    spin.stop(spinWarn('Failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const hasExplicitSubcommand =
    args[0] === 'doctor' ||
    args[0] === 'rectify' ||
    args[0] === 'solve' ||
    args[0] === 'late' ||
    args[0] === 'filter' ||
    args[0] === 'issues'
  const nonInteractive = args.includes('-y') || args.includes('--yes')
  const wantsHelpOrVersion = args.some((a) =>
    ['-h', '--help', '-V', '--version'].includes(a),
  )
  // Offer the mode menu for any bare invocation on a TTY, including one with only flags.
  const showModeMenu =
    !hasExplicitSubcommand &&
    !nonInteractive &&
    !wantsHelpOrVersion &&
    Boolean(process.stdin.isTTY)

  let argv = process.argv
  if (showModeMenu) {
    await bannerAnimated()
    const mode = await promptRunMode()
    if (!mode) {
      p.cancel('Cancelled')
      process.exit(1)
    }
    // Re-dispatch through commander so any flags the user passed still apply.
    argv = [process.argv[0]!, process.argv[1]!, mode, ...args]
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
    .option(
      '--saturday-codes <list>',
      'Extra course codes allowed on Saturday (comma-separated), independent of maths flag',
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
      saturdayCodes?: string
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
        saturdayCodes: flags.saturdayCodes,
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
    .option(
      '--saturday-codes <list>',
      'Extra course codes allowed on Saturday (comma-separated)',
    )
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
        saturdayCodes?: string
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
          saturdayCodes: flags.saturdayCodes,
          skipPrompts: Boolean(flags.yes),
          interactive,
        })
      },
    )

  program
    .command('late')
    .description(
      'Add late enrollments into a frozen prior schedule — existing course weekdays never move',
    )
    .option('--previous <dir>', 'Previous output folder containing snapshot.json')
    .option('--late <file>', 'Late enrollments .xlsx (delta or full updated workbook)')
    .option('-o, --output <dir>', 'New output directory for late-enrollment exports')
    .option('--nomenclature <file>', 'Optional Nomenclature.xlsx')
    .option('--time-limit <seconds>', 'Optional wall-clock limit', (v) => Number(v))
    .option('--workers <n>', 'CP-SAT workers (default: all CPUs)', (v) => Number(v))
    .option('--seed <n>', 'Solver seed', (v) => {
      const n = parseSeedInput(String(v))
      if (n === undefined) throw new Error('--seed must be a non-negative integer')
      return n
    })
    .option('--absolute-gap <n>', 'Stop when clash gap ≤ n', (v) => Number(v))
    .option('--prove-plateau <seconds>', 'Plateau escape (seconds)', (v) => Number(v))
    .option('--prove', 'Full optimality proof', false)
    .option('--saturday', 'Allow Saturday for maths')
    .option(
      '--saturday-codes <list>',
      'Extra course codes allowed on Saturday (comma-separated)',
    )
    .option(
      '--on-full <strategy>',
      'When a course is full: new-section | equalize | fit | buffer | park (default: ask / new-section)',
    )
    .option('--overflow-buffer <n>', 'Soft seats past capacity for buffer strategy (default: 2)', (v) =>
      Number(v),
    )
    .option(
      '--on-clash <strategy>',
      'When a late student clashes: accept | drop-course | park-student (default: ask / accept)',
    )
    .option('-y, --yes', 'Non-interactive when paths are provided', false)
    .action(
      async (flags: {
        previous?: string
        late?: string
        output?: string
        nomenclature?: string
        timeLimit?: number
        workers?: number
        seed?: number
        absoluteGap?: number
        provePlateau?: number
        prove?: boolean
        saturday?: boolean
        saturdayCodes?: string
        onFull?: string
        overflowBuffer?: number
        onClash?: string
        yes?: boolean
      }) => {
        const interactive = !flags.yes && (!flags.previous || !flags.late)
        const saturdayFlag =
          typeof flags.saturday === 'boolean' ? flags.saturday : undefined
        const onFull = flags.onFull as OnFullStrategy | undefined
        const onClash = flags.onClash as 'accept' | 'drop-course' | 'park-student' | undefined
        if (onFull && !ON_FULL_STRATEGIES.includes(onFull)) {
          p.log.error(`--on-full must be one of: ${ON_FULL_STRATEGIES.join(' | ')}`)
          process.exitCode = 1
          return
        }
        if (onClash && !ON_CLASH_STRATEGIES.includes(onClash)) {
          p.log.error(`--on-clash must be one of: ${ON_CLASH_STRATEGIES.join(' | ')}`)
          process.exitCode = 1
          return
        }
        process.exitCode = await runLate({
          previous: flags.previous,
          late: flags.late,
          output: flags.output,
          nomenclature: flags.nomenclature,
          timeLimit: flags.timeLimit,
          workers: flags.workers,
          seed: flags.seed,
          absoluteGap: flags.absoluteGap,
          provePlateau: flags.provePlateau,
          prove: flags.prove,
          saturday: saturdayFlag,
          saturdayCodes: flags.saturdayCodes,
          onFull,
          overflowBuffer: flags.overflowBuffer,
          onClash,
          skipPrompts: Boolean(flags.yes),
          interactive,
        })
      },
    )

  program
    .command('filter')
    .description(
      'Filter a final schedule.xlsx to only the listed course codes (same layout, subset of courses)',
    )
    .option('-i, --input <file>', 'Final schedule.xlsx path')
    .option('-c, --codes <list>', 'Course codes to keep (comma- or newline-separated)')
    .option('-o, --output <dir>', 'Output directory for filtered schedule.xlsx')
    .option('-y, --yes', 'Non-interactive when paths and codes are provided', false)
    .action(async (flags: { input?: string; codes?: string; output?: string; yes?: boolean }) => {
      const interactive = !flags.yes && (!flags.input || !flags.codes)
      process.exitCode = await runFilter({
        input: flags.input,
        codes: flags.codes,
        output: flags.output,
        skipPrompts: Boolean(flags.yes),
        interactive: interactive || !flags.input,
      })
    })

  program
    .command('issues')
    .description('Audit enrollment .xlsx for data-quality issues (no solver)')
    .option('-i, --input <file>', 'Enrollment .xlsx path')
    .option('-y, --yes', 'Non-interactive when -i is provided', false)
    .action(async (flags: { input?: string; yes?: boolean }) => {
      const interactive = !flags.yes && !flags.input
      process.exitCode = await runIssues({
        input: flags.input,
        interactive: interactive || !flags.input,
      })
    })

  program
    .command('doctor')
    .description('Check Python / OR-Tools / CP-SAT readiness')
    .action(async () => {
      await bannerAnimated()
      const python = await ensurePythonReady()
      p.log.success(`Python: ${python}`)
      p.log.info(`Solver: ${path.join(CPSAT_DIR, 'solve.py')}`)
      p.log.info(`Repo:   ${REPO_ROOT}`)
      p.outro('Ready to schedule.')
    })

  await program.parseAsync(argv)
}

void main()

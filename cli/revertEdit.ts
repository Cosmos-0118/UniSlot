import * as p from '@clack/prompts'
import chalk from 'chalk'
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertReadableFile,
  pickOutputFolder,
} from './fileDialog.ts'
import {
  bannerAnimated,
  canPrompt,
  noteSkippedPrompts,
  outroSuccess,
  restoreCliTerminal,
  showPanel,
} from './ui.ts'
import { glyphs, joinCapped, spinOk, spinWarn, truncateMiddle, wrapAnsi } from './theme.ts'
import { checklistPrompt, type ChecklistItem } from './checklistPrompt.ts'
import { writeSnapshotExports } from './surgicalEdit.ts'
import { loadSchedulingSnapshot, type SchedulingSnapshot } from '../src/modules/scheduling/merge/snapshot.ts'
import {
  diffSnapshots,
  filterChanges,
  type RevertChange,
} from '../src/modules/scheduling/merge/revertEdit.ts'
import {
  runRevertPipeline,
  type RevertPipelineResult,
} from '../src/modules/scheduling/pipeline/revertRun.ts'

/** Above this many changes we ask which students / courses are affected instead of listing all. */
export const FULL_LIST_MAX = 30


async function requireSnapshot(dir: string, role: string): Promise<SchedulingSnapshot> {
  try {
    await access(path.join(dir, 'snapshot.json'))
  } catch {
    throw new Error(`The ${role} folder must contain snapshot.json (pick a UniSlot output folder): ${dir}`)
  }
  return loadSchedulingSnapshot(dir)
}

async function folderExists(dir: string | undefined): Promise<boolean> {
  if (!dir) return false
  try {
    await access(path.join(dir, 'snapshot.json'))
    return true
  } catch {
    return false
  }
}

function describeChange(c: RevertChange): string {
  const who = c.studentName ? `${c.register} (${c.studentName})` : c.register
  const title = (code: string | undefined, name: string | undefined) =>
    name ? `${code} ${name}` : String(code)
  switch (c.kind) {
    case 'moved':
      return `${who} · moved ${title(c.droppedCourse, c.droppedTitle)} → ${title(c.addedCourse, c.addedTitle)}`
    case 'dropped':
      return `${who} · removed from ${title(c.droppedCourse, c.droppedTitle)}`
    default:
      return `${who} · added to ${title(c.addedCourse, c.addedTitle)}` +
        (c.lateBatch !== undefined ? ` (late batch ${c.lateBatch})` : '')
  }
}

function countsLine(changes: RevertChange[]): string {
  const n = (kind: RevertChange['kind']) => changes.filter((c) => c.kind === kind).length
  const late = changes.filter((c) => c.kind === 'added' && c.lateBatch !== undefined).length
  const parts = [
    chalk.hex('#F87171')(`${n('dropped')} removed`),
    chalk.hex('#FBBF24')(`${n('moved')} moved`),
    chalk.hex('#4ADE80')(`${n('added')} added`) + (late ? chalk.hex('#A78BFA')(` (${late} late)`) : ''),
  ]
  return parts.join(chalk.dim('  ·  '))
}

function studentCount(changes: RevertChange[]): number {
  return new Set(changes.map((c) => c.register)).size
}

function summarize(changes: RevertChange[]): string {
  return `${changes.length} change(s) across ${studentCount(changes)} student(s): ` +
    `${changes.filter((c) => c.kind === 'dropped').length} removed · ` +
    `${changes.filter((c) => c.kind === 'moved').length} moved · ` +
    `${changes.filter((c) => c.kind === 'added').length} added`
}

function toChecklistItem(c: RevertChange): ChecklistItem {
  const course = (code?: string, title?: string) => (title ? `${code}  ${title}` : String(code))
  const base = {
    value: c.id,
    group: c.register,
    groupLabel: c.studentName ? `${c.register}  ${chalk.dim(c.studentName)}` : c.register,
    search: [c.register, c.studentName, c.droppedCourse, c.addedCourse, c.droppedTitle, c.addedTitle]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }
  if (c.kind === 'dropped') {
    return {
      ...base,
      badge: { text: 'removed', tone: 'bad' },
      label: course(c.droppedCourse, c.droppedTitle),
      detail:
        `Puts ${c.register} back into ${c.droppedCourse}, in the same section as before. ` +
        'If the course was deleted when it emptied, it returns on its original weekday.',
    }
  }
  if (c.kind === 'moved') {
    return {
      ...base,
      badge: { text: 'moved', tone: 'warn' },
      label: `${c.droppedCourse} → ${c.addedCourse}  ${c.addedTitle ?? ''}`.trim(),
      detail: `Undoes the fix: ${c.register} goes back to ${c.droppedCourse} and is taken off ${c.addedCourse}.`,
    }
  }
  const late = c.lateBatch !== undefined
  return {
    ...base,
    badge: { text: 'added', tone: 'ok' },
    label: course(c.addedCourse, c.addedTitle),
    tag: late ? `late · batch ${c.lateBatch}` : undefined,
    detail: late
      ? `Came in with late batch ${c.lateBatch}. Ticking this takes ${c.register} off ${c.addedCourse} again — only do that if the late add was a mistake.`
      : `Takes ${c.register} off ${c.addedCourse} again.`,
  }
}

async function chooseChangesInteractively(all: RevertChange[]): Promise<RevertChange[] | null> {
  const big = all.length > FULL_LIST_MAX
  restoreCliTerminal({ prepareForPrompt: true })
  const picked = await checklistPrompt({
    title: 'Choose the changes to undo',
    subtitle: big
      ? `${all.length} changes — type a register number or course code to narrow them down.`
      : 'Space ticks a change. Anything you leave unticked stays exactly as it is.',
    placeholder: big ? 'e.g. RA2111003010001, 21CSE101T' : 'type to filter by student or course…',
    items: all.map(toChecklistItem),
  })
  if (typeof picked === 'symbol') return null
  if (picked.length === 0) {
    p.log.warn('Nothing was ticked — nothing to restore.')
    return null
  }
  const chosen = new Set(picked)
  return all.filter((c) => chosen.has(c.id))
}

function folderLabel(dir: string): string {
  const name = path.basename(dir)
  const parent = path.dirname(dir)
  return `${chalk.bold(name)}  ${chalk.dim(truncateMiddle(parent, 48))}`
}

/** Wrap prose to the terminal so Clack's left gutter never gets overrun. */
function wrapDim(text: string): string {
  const width = Math.max(30, (process.stdout.columns || 80) - 6)
  return wrapAnsi(text, width).map((line) => chalk.dim(line)).join('\n')
}

function step(n: number, title: string, hint: string): void {
  p.log.step(`${chalk.bold(`Step ${n} of 3`)} ${chalk.dim('·')} ${chalk.bold(title)}\n${wrapDim(hint)}`)
}

function reportPanel(result: RevertPipelineResult, outDir: string): void {
  const r = result.revertReport
  if (!r) return
  const ok = chalk.hex('#4ADE80')
  const lines = [
    ...r.applied.slice(0, 12).map((c) => `${ok(glyphs.check)} ${describeChange(c)}`),
  ]
  if (r.applied.length > 12) lines.push(chalk.dim(`  … +${r.applied.length - 12} more (see revert-report.json)`))
  for (const s of r.skipped) lines.push(chalk.yellow(`! skipped ${s.change.label} — ${s.reason}`))
  lines.push('')
  if (r.recreated_courses.length) {
    lines.push(`${chalk.dim('Courses brought back'.padEnd(20))}${joinCapped(r.recreated_courses, 8)} ${chalk.dim('(original weekday)')}`)
  }
  if (r.pruned_courses.length) {
    lines.push(`${chalk.dim('Courses now empty'.padEnd(20))}${joinCapped(r.pruned_courses, 8)} ${chalk.dim('(removed)')}`)
  }
  const delta = r.red_after - r.red_before
  const redText = `${r.red_before} → ${r.red_after}`
  lines.push(
    `${chalk.dim('Clashing students'.padEnd(20))}${delta > 0 ? chalk.yellow(redText) : delta < 0 ? ok(redText) : redText}`,
    `${chalk.dim('Saved to'.padEnd(20))}${truncateMiddle(outDir, 56)}`,
    '',
    chalk.dim("Other students' sections and weekdays were not touched."),
  )
  showPanel(`Restored ${r.applied.length} change${r.applied.length === 1 ? '' : 's'}`, lines.join('\n'))
}

export async function runRevertEdit(opts: {
  edited?: string
  previous?: string
  output?: string
  register?: string[]
  course?: string[]
  all?: boolean
  nomenclature?: string
  skipPrompts?: boolean
  interactive: boolean
}): Promise<number> {
  await bannerAnimated()
  const session = opts.interactive && !opts.skipPrompts && canPrompt()
  if (opts.interactive && !opts.skipPrompts && !canPrompt()) noteSkippedPrompts()

  let editedDir = opts.edited
  let previousDir = opts.previous
  let outDir = opts.output

  if (session) {
    p.log.message(
      wrapDim(
        'Compare the output with the mistake against an older one, then choose what to take back. ' +
          'Nothing is overwritten — the fixed schedule goes into a new folder.',
      ),
    )
  }

  if (!editedDir && session) {
    step(1, 'The folder with the mistake', 'The output missing the course (made by the wrong delete/fix).')
    editedDir = (await pickOutputFolder('Step 1: choose the folder WITH the mistake (the output after the wrong delete/fix)')) ?? undefined
    restoreCliTerminal()
    if (editedDir) p.log.success(folderLabel(editedDir))
    else p.log.warn('Cancelled')
  }
  if (!editedDir) {
    p.log.error('--edited <dir> is required: the output folder with the mistake (after the wrong delete or fix).')
    return 1
  }

  let edited: SchedulingSnapshot
  try {
    edited = await requireSnapshot(editedDir, 'mistake')
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  if (!previousDir && session) {
    step(2, 'The folder from before the mistake', 'An older output that still has the course — UniSlot restores from it.')
    // The edited run log remembers which folder it was built from.
    const lastEntry = [...(edited.run_log ?? [])].sort((a, b) => b.seq - a.seq)[0]
    const suggested = lastEntry?.inputs.previous_dir
    if (
      suggested &&
      path.resolve(suggested) !== path.resolve(editedDir) &&
      (await folderExists(suggested))
    ) {
      p.log.info(`${chalk.dim('The folder with the mistake was built from')}  ${folderLabel(suggested)}`)
      restoreCliTerminal({ prepareForPrompt: true })
      const use = await p.confirm({ message: 'Is that the folder from before the mistake?', initialValue: true })
      if (p.isCancel(use)) {
        p.cancel('Cancelled')
        return 1
      }
      if (use) previousDir = suggested
    }
    if (!previousDir) {
      previousDir = (await pickOutputFolder('Step 2: choose the folder from BEFORE the mistake (still has the course)')) ?? undefined
      restoreCliTerminal()
    }
    if (previousDir) p.log.success(folderLabel(previousDir))
    else p.log.warn('Cancelled')
  }
  if (!previousDir) {
    p.log.error('--previous <dir> is required: the output folder from before the mistake.')
    return 1
  }

  if (!outDir && session) {
    step(3, 'Where to save the fixed schedule', 'A new or empty folder. Your other two folders are never changed.')
    outDir = (await pickOutputFolder('Step 3: choose a NEW folder to save the fixed schedule into')) ?? undefined
    restoreCliTerminal()
    if (outDir) p.log.success(folderLabel(outDir))
    else p.log.warn(`Cancelled — using ${chalk.bold('./unislot-out-revert')}`)
  }
  outDir = outDir || path.join(process.cwd(), 'unislot-out-revert')

  const resolved = {
    edited: path.resolve(editedDir),
    previous: path.resolve(previousDir),
    out: path.resolve(outDir),
  }
  if (resolved.edited === resolved.previous) {
    p.log.error('You picked the same folder twice. Pick the folder with the mistake and the folder from before it.')
    return 1
  }
  if (resolved.out === resolved.edited || resolved.out === resolved.previous) {
    p.log.error('The save folder must be a new one — not either of the two you compared (they stay untouched).')
    return 1
  }

  let previous: SchedulingSnapshot
  try {
    previous = await requireSnapshot(previousDir, 'before-the-mistake')
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  const diff = diffSnapshots(previous, edited)
  if (diff.errors.length > 0) {
    for (const e of diff.errors) p.log.error(e)
    return 1
  }

  if (session) {
    const label = (name: string) => chalk.dim(name.padEnd(15))
    showPanel(
      'Comparing',
      [
        `${label('With mistake')}${folderLabel(editedDir)}`,
        `${label('Before it')}${folderLabel(previousDir)}`,
        `${label('Save to')}${folderLabel(outDir)}`,
        '',
        `${chalk.bold(String(diff.changes.length))} change${diff.changes.length === 1 ? '' : 's'} across ` +
          `${chalk.bold(String(studentCount(diff.changes)))} student${studentCount(diff.changes) === 1 ? '' : 's'}`,
        countsLine(diff.changes),
      ].join('\n'),
    )
  }
  for (const w of diff.warnings) p.log.warn(w)

  let programNomenclatureXlsx: ArrayBuffer | undefined
  if (opts.nomenclature) {
    try {
      await assertReadableFile(opts.nomenclature)
      const buf = await readFile(opts.nomenclature)
      programNomenclatureXlsx = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err))
      return 1
    }
  }

  // Which changes to revert.
  let selected: RevertChange[]
  const terms = [...(opts.register ?? []), ...(opts.course ?? [])]
  if (terms.length > 0 || opts.all) {
    selected = terms.length > 0 ? filterChanges(diff.changes, terms) : diff.changes
    if (selected.length === 0) {
      p.log.error(`No changes match ${joinCapped(terms, 8)}.`)
      return 1
    }
    p.log.info(`${summarize(selected)} selected`)
  } else if (session) {
    const chosen = await chooseChangesInteractively(diff.changes)
    if (!chosen) {
      p.cancel('Cancelled — nothing was changed.')
      return 1
    }
    selected = chosen
  } else {
    p.log.error('Choose what to revert with --register, --course, or --all.')
    return 1
  }

  if (session) {
    showPanel(
      `About to restore ${selected.length} change${selected.length === 1 ? '' : 's'}`,
      selected.map((c) => describeChange(c)).join('\n'),
      { maxLines: 20 },
    )
    restoreCliTerminal({ prepareForPrompt: true })
    const ok = await p.confirm({
      message: `Restore into ${truncateMiddle(outDir, 48)}? Other edits stay as they are.`,
      initialValue: true,
    })
    if (p.isCancel(ok) || !ok) {
      p.cancel('Cancelled — nothing was changed.')
      return 1
    }
  }

  const spin = p.spinner()
  spin.start('Restoring…')
  let result: RevertPipelineResult
  try {
    result = await runRevertPipeline(
      (ev) => {
        if (ev.message) spin.message(ev.message)
      },
      {
        baselineSnapshot: previous,
        editedSnapshot: edited,
        changes: selected,
        seed: edited.seed,
        baselineDir: previousDir,
        editedDir,
        outputDir: outDir,
        programNomenclatureXlsx,
      },
    )
  } catch (err) {
    spin.stop(spinWarn('Failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }
  if (result.infeasible) {
    spin.stop(spinWarn('Aborted'))
    p.log.error(result.infeasible_reason || 'Revert aborted.')
    return 1
  }
  spin.stop(spinOk('Rebuilt the schedule'))

  const writeSpin = p.spinner()
  writeSpin.start(`Writing exports to ${truncateMiddle(outDir, 60)}…`)
  let files: string[]
  try {
    files = await writeSnapshotExports(outDir, result)
    const report = result.revertReport
    const reportPath = path.join(outDir, 'revert-report.json')
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          edited_dir: editedDir,
          previous_dir: previousDir,
          applied: report?.applied ?? [],
          skipped: report?.skipped ?? [],
          restored: report?.restored ?? [],
          removed: report?.removed ?? [],
          recreated_courses: report?.recreated_courses ?? [],
          pruned_courses: report?.pruned_courses ?? [],
          students_restored: report?.students_restored ?? [],
          red_before: report?.red_before,
          red_after: report?.red_after,
        },
        null,
        2,
      ),
      'utf8',
    )
    files.push(reportPath)
    writeSpin.stop(spinOk(`${files.length} files written`))
  } catch (err) {
    writeSpin.stop(spinWarn('Failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  reportPanel(result, outDir)
  await outroSuccess([
    chalk.green('Done.') + chalk.dim('  Open schedule.xlsx in the new folder to check the result.'),
    chalk.dim(`Your other folders were not changed (${truncateMiddle(editedDir, 36)} · ${truncateMiddle(previousDir, 36)})`),
  ])
  return 0
}

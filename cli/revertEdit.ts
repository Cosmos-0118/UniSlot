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
  selectPrompt,
  showPanel,
  textPrompt,
} from './ui.ts'
import { joinCapped, spinOk, spinWarn, truncateMiddle } from './theme.ts'
import { writeSnapshotExports } from './surgicalEdit.ts'
import { loadSchedulingSnapshot, type SchedulingSnapshot } from '../src/modules/scheduling/merge/snapshot.ts'
import {
  diffSnapshots,
  filterChanges,
  parseSearchTerms,
  type RevertChange,
} from '../src/modules/scheduling/merge/revertEdit.ts'
import {
  runRevertPipeline,
  type RevertPipelineResult,
} from '../src/modules/scheduling/pipeline/revertRun.ts'

/** Above this many changes we ask which students / courses are affected instead of listing all. */
export const FULL_LIST_MAX = 30

const ACTION_RESTORE = '__restore__'
const ACTION_SEARCH = '__search__'
const ACTION_CANCEL = '__cancel__'
const TOGGLE = 'toggle:'

async function requireSnapshot(dir: string, role: string): Promise<SchedulingSnapshot> {
  try {
    await access(path.join(dir, 'snapshot.json'))
  } catch {
    throw new Error(`The ${role} folder must contain snapshot.json: ${dir}`)
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
      return `${who} · added to ${title(c.addedCourse, c.addedTitle)}`
  }
}

function summarize(changes: RevertChange[]): string {
  const n = (kind: RevertChange['kind']) => changes.filter((c) => c.kind === kind).length
  const students = new Set(changes.map((c) => c.register)).size
  return (
    `${changes.length} change(s) across ${students} student(s): ` +
    `${n('dropped')} removed · ${n('moved')} moved · ${n('added')} added`
  )
}

async function askSearchTerms(total: number): Promise<string[] | 'cancelled'> {
  restoreCliTerminal({ prepareForPrompt: true })
  const answer = await textPrompt({
    message:
      `${total} changes found. Which students or courses were affected? ` +
      '(register numbers or course codes, comma-separated)',
    placeholder: 'e.g. RA2111003010001, 21CSE101T',
    validate: (value) =>
      parseSearchTerms(String(value ?? '')).length === 0
        ? 'Enter at least one register number or course code.'
        : undefined,
  })
  if (p.isCancel(answer)) return 'cancelled'
  return parseSearchTerms(String(answer ?? ''))
}

/**
 * Checklist built on the house select picker: pick a row to tick/untick it, then choose
 * "Restore". Returns the ticked changes, or null if the user backs out.
 */
async function checklist(
  pool: RevertChange[],
  checked: Set<string>,
  onSearch: () => Promise<RevertChange[] | 'cancelled'>,
): Promise<RevertChange[] | null> {
  let cursor: string = ACTION_RESTORE
  while (true) {
    const options = [
      {
        value: ACTION_RESTORE,
        label: `Restore ${checked.size} selected change(s)`,
        hint: checked.size === 0 ? 'tick at least one below first' : 'Enter to continue',
      },
      { value: ACTION_SEARCH, label: 'Search another student / course…' },
      { value: ACTION_CANCEL, label: 'Cancel' },
      ...pool.map((c) => ({
        value: `${TOGGLE}${c.id}`,
        label: `${checked.has(c.id) ? '[x]' : '[ ]'} ${describeChange(c)}`,
      })),
    ]
    restoreCliTerminal({ prepareForPrompt: true })
    const picked = await selectPrompt({
      message: `Enter ticks / unticks a change — ${pool.length} listed`,
      options,
      initialValue: cursor,
      withGuide: true,
    })
    if (p.isCancel(picked)) return null
    const value = String(picked)
    cursor = value
    if (value === ACTION_CANCEL) return null
    if (value === ACTION_SEARCH) {
      const more = await onSearch()
      if (more === 'cancelled') continue
      const known = new Set(pool.map((c) => c.id))
      for (const c of more) {
        if (!known.has(c.id)) pool.push(c)
        checked.add(c.id)
      }
      continue
    }
    if (value === ACTION_RESTORE) {
      if (checked.size === 0) {
        p.log.warn('Tick at least one change first.')
        continue
      }
      return pool.filter((c) => checked.has(c.id))
    }
    const id = value.slice(TOGGLE.length)
    if (checked.has(id)) checked.delete(id)
    else checked.add(id)
  }
}

async function chooseChangesInteractively(all: RevertChange[]): Promise<RevertChange[] | null> {
  p.log.info(summarize(all))

  // Small diff: list everything, nothing pre-ticked.
  if (all.length <= FULL_LIST_MAX) {
    const search = async (): Promise<RevertChange[] | 'cancelled'> => {
      const terms = await askSearchTerms(all.length)
      return terms === 'cancelled' ? 'cancelled' : filterChanges(all, terms)
    }
    return checklist([...all], new Set(), search)
  }

  // Large diff: the user names the affected students / courses first.
  const pool: RevertChange[] = []
  const checked = new Set<string>()
  const search = async (): Promise<RevertChange[] | 'cancelled'> => {
    while (true) {
      const terms = await askSearchTerms(all.length)
      if (terms === 'cancelled') return 'cancelled'
      const matches = filterChanges(all, terms)
      if (matches.length === 0) {
        p.log.warn(`No changes match ${joinCapped(terms, 6)}. Try a register number or course code.`)
        continue
      }
      if (matches.length > FULL_LIST_MAX) {
        p.log.warn(`${matches.length} changes match — narrow it down (at most ${FULL_LIST_MAX}).`)
        continue
      }
      p.log.success(`${matches.length} matching change(s) found.`)
      return matches
    }
  }
  const first = await search()
  if (first === 'cancelled') return null
  for (const c of first) {
    pool.push(c)
    checked.add(c.id)
  }
  return checklist(pool, checked, search)
}

function reportPanel(result: RevertPipelineResult): void {
  const r = result.revertReport
  if (!r) return
  const lines = [
    chalk.bold(`Restored ${r.applied.length} change(s)`),
    ...r.applied.slice(0, 15).map((c) => `  ${chalk.cyan('✓')} ${describeChange(c)}`),
  ]
  if (r.applied.length > 15) lines.push(chalk.dim(`  … +${r.applied.length - 15} more`))
  if (r.recreated_courses.length) {
    lines.push(`  courses brought back on their original weekday: ${joinCapped(r.recreated_courses, 12)}`)
  }
  if (r.pruned_courses.length) {
    lines.push(`  courses removed (now empty): ${joinCapped(r.pruned_courses, 12)}`)
  }
  for (const s of r.skipped) lines.push(chalk.yellow(`  ! skipped ${s.change.label} — ${s.reason}`))
  lines.push(`  RED ${r.red_before} → ${r.red_after}`, '', chalk.dim("Other students' days and sections were not changed."))
  showPanel('Undo changes', lines.join('\n'))
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

  if (!editedDir && session) {
    p.log.info('1/3  Pick the EDITED output folder (the one where the wrong change happened)…')
    editedDir = (await pickOutputFolder('Choose the EDITED UniSlot output folder (contains snapshot.json)')) ?? undefined
    restoreCliTerminal()
    if (editedDir) p.log.success(path.basename(editedDir))
    else p.log.warn('Cancelled')
  }
  if (!editedDir) {
    p.log.error('--edited <dir> is required (the output folder that contains the wrong change).')
    return 1
  }

  let edited: SchedulingSnapshot
  try {
    edited = await requireSnapshot(editedDir, 'edited')
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  if (!previousDir && session) {
    // The edited run log remembers which folder it was built from.
    const lastEntry = [...(edited.run_log ?? [])].sort((a, b) => b.seq - a.seq)[0]
    const suggested = lastEntry?.inputs.previous_dir
    if (
      suggested &&
      path.resolve(suggested) !== path.resolve(editedDir) &&
      (await folderExists(suggested))
    ) {
      restoreCliTerminal({ prepareForPrompt: true })
      const use = await p.confirm({
        message: `Use ${truncateMiddle(suggested, 60)} as the PREVIOUS folder (before the change)?`,
        initialValue: true,
      })
      if (p.isCancel(use)) {
        p.cancel('Cancelled')
        return 1
      }
      if (use) previousDir = suggested
    }
  }
  if (!previousDir && session) {
    p.log.info('2/3  Pick the PREVIOUS output folder (before the wrong change)…')
    previousDir = (await pickOutputFolder('Choose the PREVIOUS UniSlot output folder (contains snapshot.json)')) ?? undefined
    restoreCliTerminal()
    if (previousDir) p.log.success(path.basename(previousDir))
    else p.log.warn('Cancelled')
  }
  if (!previousDir) {
    p.log.error('--previous <dir> is required (the output folder from before the wrong change).')
    return 1
  }

  if (!outDir && session) {
    p.log.info('3/3  Pick a NEW output folder for the restored files…')
    outDir = (await pickOutputFolder('Choose a NEW folder for the restored exports')) ?? undefined
    restoreCliTerminal()
    if (outDir) p.log.success(path.basename(outDir))
    else p.log.warn('Cancelled — using ./unislot-out-revert')
  }
  outDir = outDir || path.join(process.cwd(), 'unislot-out-revert')

  const resolved = {
    edited: path.resolve(editedDir),
    previous: path.resolve(previousDir),
    out: path.resolve(outDir),
  }
  if (resolved.edited === resolved.previous) {
    p.log.error('Previous and edited are the same folder — pick two different output folders.')
    return 1
  }
  if (resolved.out === resolved.edited || resolved.out === resolved.previous) {
    p.log.error('The output folder must be new — never the previous or edited folder (they stay untouched).')
    return 1
  }

  let previous: SchedulingSnapshot
  try {
    previous = await requireSnapshot(previousDir, 'previous')
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  const diff = diffSnapshots(previous, edited)
  if (diff.errors.length > 0) {
    for (const e of diff.errors) p.log.error(e)
    return 1
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
      p.cancel('Cancelled')
      return 1
    }
    selected = chosen
  } else {
    p.log.error('Choose what to revert with --register, --course, or --all.')
    return 1
  }

  if (session) {
    showPanel('Will restore', selected.map((c) => `  ${describeChange(c)}`).join('\n'), { maxLines: 25 })
    restoreCliTerminal({ prepareForPrompt: true })
    const ok = await p.confirm({
      message: `Restore ${selected.length} change(s) into ${truncateMiddle(outDir, 50)}? (other edits are kept)`,
      initialValue: true,
    })
    if (p.isCancel(ok) || !ok) {
      p.cancel('Cancelled')
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
  spin.stop(spinOk('Done'))
  reportPanel(result)

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
    writeSpin.stop(spinOk(`${files.length} file(s)`))
  } catch (err) {
    writeSpin.stop(spinWarn('Failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  await outroSuccess([
    chalk.green(`Restored ${result.revertReport?.applied.length ?? 0} change(s).`),
    chalk.dim(`Previous and edited folders unchanged: ${previousDir} · ${editedDir}`),
    ...files.map((f) => chalk.dim('  · ') + f),
  ])
  return 0
}

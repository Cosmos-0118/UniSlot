import * as p from '@clack/prompts'
import chalk from 'chalk'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pickOutputFolder } from './fileDialog.ts'
import { bannerAnimated, canPrompt, noteSkippedPrompts, outroSuccess, restoreCliTerminal } from './ui.ts'
import { spinOk, spinWarn, truncateMiddle } from './theme.ts'
import { loadSchedulingSnapshot } from '../src/modules/scheduling/merge/snapshot.ts'
import { nameListToWorkbookBuffer } from '../src/modules/scheduling/io/excelInputSheet.ts'

export const NAME_LIST_FILE = 'name-list.xlsx'

/** Rebuild the input-format name list from any saved output folder, without changing the schedule. */
export async function runNameList(opts: {
  folder?: string
  output?: string
  skipPrompts?: boolean
  interactive: boolean
}): Promise<number> {
  await bannerAnimated()
  const session = opts.interactive && !opts.skipPrompts && canPrompt()
  if (opts.interactive && !opts.skipPrompts && !canPrompt()) noteSkippedPrompts()

  let folder = opts.folder
  if (!folder && session) {
    folder = (await pickOutputFolder('Choose the UniSlot output folder (must contain snapshot.json)')) ?? undefined
    restoreCliTerminal()
    if (!folder) p.log.warn('Cancelled')
  }
  if (!folder) {
    p.log.error('--folder <dir> is required: the UniSlot output folder to read.')
    return 1
  }

  const spin = p.spinner()
  spin.start('Reading snapshot…')
  try {
    const snapshot = await loadSchedulingSnapshot(folder)
    const rows = snapshot.enrollmentRows ?? []
    if (rows.length === 0) {
      spin.stop(spinWarn('No enrollment data'))
      p.log.error(`snapshot.json in ${folder} has no enrollment rows.`)
      return 1
    }
    const outDir = path.resolve(opts.output ?? folder)
    await mkdir(outDir, { recursive: true })
    const filePath = path.join(outDir, NAME_LIST_FILE)
    await writeFile(filePath, Buffer.from(await nameListToWorkbookBuffer(rows, { seed: snapshot.seed })))
    spin.stop(spinOk(`${rows.length} rows written`))
    await outroSuccess([
      chalk.green('Done.') + chalk.dim(`  ${truncateMiddle(filePath, 64)}`),
      chalk.dim(
        snapshot.source
          ? `Schedule created from ${snapshot.source.file_name}. Same columns as that input; the schedule was not changed.`
          : 'Same columns as the enrollment input. The schedule was not changed.',
      ),
    ])
    return 0
  } catch (err) {
    spin.stop(spinWarn('Failed'))
    const missing = (err as NodeJS.ErrnoException)?.code === 'ENOENT'
    p.log.error(
      missing
        ? `Pick a UniSlot output folder that contains snapshot.json: ${folder}`
        : err instanceof Error ? err.message : String(err),
    )
    return 1
  }
}

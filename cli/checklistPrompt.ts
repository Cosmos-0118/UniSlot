import { AutocompletePrompt, type State } from '@clack/core'
import chalk from 'chalk'
import type { Writable } from 'node:stream'
import { glyphs, pad, strWidth, truncateVisible, wrapAnsi } from './theme.ts'

/**
 * Searchable checklist: type to filter, ↑↓ to move, space/tab to tick, Enter to confirm.
 * Items are grouped (e.g. by student) and the list scrolls inside a fixed frame so a long
 * diff never floods the terminal.
 */

export type ChecklistTone = 'bad' | 'ok' | 'warn' | 'info' | 'muted'

export type ChecklistItem = {
  value: string
  /** Rows sharing a group key sit under one heading (items must already be sorted by group). */
  group: string
  groupLabel: string
  badge: { text: string; tone: ChecklistTone }
  label: string
  /** Small trailing note, e.g. "late · batch 2". */
  tag?: string
  /** One or two sentences shown under the list for the focused row. */
  detail?: string
  /** Lower-case haystack the filter matches against. */
  search: string
}

const ink = chalk.hex('#E2E8F0')
const muted = chalk.hex('#94A3B8')
const faint = chalk.hex('#64748B')
const border = chalk.hex('#475569')
const accent = chalk.hex('#22D3EE')
const highlight = chalk.bgHex('#164E63').hex('#ECFEFF')
const field = chalk.bgHex('#0F2A3A').hex('#ECFEFF')
const tones: Record<ChecklistTone, (s: string) => string> = {
  bad: chalk.hex('#F87171'),
  ok: chalk.hex('#4ADE80'),
  warn: chalk.hex('#FBBF24'),
  info: chalk.hex('#A78BFA'),
  muted: muted,
}

export type ChecklistFrameOptions = {
  title: string
  /** Shown under the title (e.g. a nudge to narrow a big list). */
  subtitle?: string
  /** Items that survive the current filter. */
  items: ChecklistItem[]
  totalCount: number
  cursor: number
  selected: ReadonlySet<string>
  query: string
  /** Query with a caret rendered in (from the prompt); falls back to `query`. */
  queryWithCaret?: string
  placeholder?: string
  state: State
  columns?: number
  rows?: number
}

type Row = { kind: 'group'; text: string } | { kind: 'spacer' } | { kind: 'item'; index: number }

function buildRows(items: ChecklistItem[]): Row[] {
  const rows: Row[] = []
  let last: string | undefined
  items.forEach((item, index) => {
    if (item.group !== last) {
      if (last !== undefined) rows.push({ kind: 'spacer' })
      rows.push({ kind: 'group', text: item.groupLabel })
      last = item.group
    }
    rows.push({ kind: 'item', index })
  })
  return rows
}

/** Window of `max` physical rows that keeps the cursor row (and its group heading) in view. */
function viewport(rows: Row[], cursorRow: number, max: number): [number, number] {
  if (rows.length <= max) return [0, rows.length]
  let start = Math.max(0, Math.min(cursorRow - Math.floor(max / 2), rows.length - max))
  // Never strand an item without its heading when the heading would be the row just above.
  if (rows[start]?.kind === 'item' && start > 0 && rows[start - 1]?.kind === 'group' && cursorRow >= start) {
    start -= 1
  }
  if (rows[start]?.kind === 'spacer') start += 1
  return [start, Math.min(rows.length, start + max)]
}

/** Pure renderer — exported so layout stays regression-tested. */
export function renderChecklistFrame(opts: ChecklistFrameOptions): string {
  const ticked = opts.selected.size

  if (opts.state === 'submit') {
    return `${chalk.green(glyphs.check)} ${ink(opts.title)}  ${muted(`${ticked} selected`)}`
  }
  if (opts.state === 'cancel') {
    return `${muted('×')} ${muted(opts.title)}  ${faint('cancelled')}`
  }

  const width = Math.max(40, Math.min(100, (opts.columns || 80) - 3))
  const inner = width - 2
  const textWidth = inner - 4
  const row = (text = '') => ` ${border('│')}${pad(text, inner)}${border('│')}`
  const content = (text: string) => row(`  ${text}`)
  const rule = (l: string, r: string) => ` ${border(l + '─'.repeat(inner) + r)}`

  const rows = buildRows(opts.items)
  const cursor = Math.min(Math.max(0, opts.cursor), Math.max(0, opts.items.length - 1))
  const cursorRow = rows.findIndex((r) => r.kind === 'item' && r.index === cursor)
  const focused = opts.items[cursor]
  const wrappedDetail = focused?.detail ? wrapAnsi(focused.detail, textWidth) : []
  const detailLines =
    wrappedDetail.length > 2
      ? [wrappedDetail[0]!, truncateVisible(`${wrappedDetail[1]!} ${wrappedDetail[2]!}`, textWidth)]
      : wrappedDetail

  const termRows = opts.rows || 24
  // frame chrome: top, title, subtitle, blank, filter, blank, [list], blank, ├, detail×2, └, footer
  const chrome = 11 + (opts.subtitle ? 1 : 0)
  const maxRows = Math.max(4, Math.min(20, termRows - chrome - 1))
  const [start, end] = viewport(rows, cursorRow < 0 ? 0 : cursorRow, maxRows)

  const shown = opts.items.length
  const counter = `${ticked} ticked · ${shown === opts.totalCount ? `${shown} change${shown === 1 ? '' : 's'}` : `${shown} of ${opts.totalCount} shown`}`
  const titleRoom = Math.max(8, textWidth - strWidth(counter) - 2)
  const titleText = truncateVisible(opts.title, titleRoom)
  const gap = Math.max(2, textWidth - strWidth(titleText) - strWidth(counter))

  const lines: string[] = [
    rule('┌', '┐'),
    content(`${chalk.bold(ink(titleText))}${' '.repeat(gap)}${muted(counter)}`),
  ]
  if (opts.subtitle) lines.push(content(muted(truncateVisible(opts.subtitle, textWidth))))
  lines.push(row())

  const entry = opts.query
    ? truncateVisible(opts.queryWithCaret || opts.query, Math.max(1, textWidth - 12))
    : `${chalk.bgHex('#67E8F9').hex('#083344')(' ')}${muted(truncateVisible(opts.placeholder ?? 'type to filter…', Math.max(1, textWidth - 14)))}`
  lines.push(content(`${accent('Filter')}  ${field(` ${pad(entry, Math.max(1, textWidth - 12))} `)}`))
  lines.push(row())

  if (rows.length === 0) {
    lines.push(content(muted(`No changes match "${truncateVisible(opts.query, 40)}".`)))
  }
  const labelWidth = Math.max(8, textWidth - 20)
  for (let i = start; i < end; i++) {
    const r = rows[i]!
    if (r.kind === 'spacer') {
      lines.push(row())
      continue
    }
    if (r.kind === 'group') {
      lines.push(content(`${chalk.bold(ink(truncateVisible(r.text, textWidth - 2)))}`))
      continue
    }
    const item = opts.items[r.index]!
    const active = r.index === cursor
    const on = opts.selected.has(item.value)
    const box = on ? accent('[x]') : faint('[ ]')
    const badge = tones[item.badge.tone](pad(item.badge.text, 8))
    const tag = item.tag ? `  ${tones.info(item.tag)}` : ''
    const body = truncateVisible(item.label, Math.max(6, labelWidth - strWidth(item.tag ?? '') - 2))
    const text = `${active ? '›' : ' '} ${box} ${badge} ${on ? ink(body) : muted(body)}${tag}`
    // Keep the highlight to plain text so nested colours cannot bleed past the row.
    lines.push(row(` ${active ? highlight(pad(stripForHighlight(text), inner - 2)) : pad(text, inner - 2)} `))
  }

  const above = start
  const below = rows.length - end
  lines.push(row(above || below ? `  ${faint(`${above ? `↑ ${above} more above` : ''}${above && below ? '   ' : ''}${below ? `↓ ${below} more below` : ''}`)}` : ''))
  lines.push(rule('├', '┤'))
  lines.push(...(detailLines.length ? detailLines : ['']).map((line) => content(muted(line))))
  lines.push(rule('└', '┘'))

  const enter =
    ticked > 0
      ? `enter restore ${ticked}`
      : opts.query && shown > 0
        ? `enter restore ${shown} shown`
        : 'enter —'
  const help =
    width >= 78
      ? `type filter · ↑↓ move · space tick · ctrl+a all shown · ${enter} · esc cancel`
      : `type · ↑↓ · space · ${enter} · esc`
  lines.push(`   ${faint(truncateVisible(help, width - 3))}`)
  return lines.join('\n')
}

// Strip colour so a highlighted row has one uniform background.
function stripForHighlight(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

export type ChecklistOptions = {
  title: string
  subtitle?: string
  placeholder?: string
  items: ChecklistItem[]
  /** Values ticked when the prompt opens. */
  initialValues?: string[]
  input?: NodeJS.ReadableStream
  output?: Writable & { columns?: number; rows?: number }
}

/**
 * Resolves with the ticked values (Enter with nothing ticked but an active filter takes every
 * shown match), or a symbol when cancelled — same contract as the other prompts.
 */
export async function checklistPrompt(opts: ChecklistOptions): Promise<string[] | symbol> {
  const output = (opts.output ?? process.stdout) as Writable & { columns?: number; rows?: number }
  const prompt = new AutocompletePrompt<ChecklistItem>({
    options: opts.items,
    multiple: true,
    initialValue: opts.initialValues,
    input: opts.input as never,
    output,
    filter: (search, option) => {
      const terms = search.toLowerCase().split(/[\s,;]+/).filter(Boolean)
      return terms.length === 0 || terms.some((t) => option.search.includes(t))
    },
    render() {
      return renderChecklistFrame({
        title: opts.title,
        subtitle: opts.subtitle,
        items: this.filteredOptions,
        totalCount: opts.items.length,
        cursor: this.cursor,
        selected: new Set(this.selectedValues as string[]),
        query: this.userInput,
        queryWithCaret: this.userInputWithCursor,
        placeholder: opts.placeholder,
        state: this.state,
        columns: output.columns,
        rows: output.rows,
      })
    },
  })

  // Ctrl+A: tick every row that survives the filter, or clear them if they are all ticked.
  prompt.on('key', (_char, key) => {
    if (!key?.ctrl || key.name !== 'a') return
    const shown = prompt.filteredOptions.map((o) => o.value)
    const current = new Set(prompt.selectedValues as string[])
    const all = shown.length > 0 && shown.every((v) => current.has(v))
    for (const v of shown) {
      if (all) current.delete(v)
      else current.add(v)
    }
    prompt.selectedValues = [...current]
  })

  const result = (await prompt.prompt()) as string[] | symbol | undefined
  if (typeof result === 'symbol') return result
  const ticked = Array.isArray(result) ? result : []
  if (ticked.length === 0 && prompt.userInput.trim() && prompt.filteredOptions.length > 0) {
    return prompt.filteredOptions.map((o) => o.value)
  }
  return ticked
}

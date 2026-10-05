import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { strWidth } from '../../cli/theme'
import {
  checklistPrompt,
  renderChecklistFrame,
  type ChecklistItem,
} from '../../cli/checklistPrompt'

function item(reg: string, name: string, course: string, tag?: string): ChecklistItem {
  return {
    value: `${reg}|${course}`,
    group: reg,
    groupLabel: `${reg}  ${name}`,
    badge: { text: 'removed', tone: 'bad' },
    label: `${course}  Title of ${course}`,
    tag,
    detail: `Puts ${reg} back into ${course}.`,
    search: `${reg} ${name} ${course}`.toLowerCase(),
  }
}

const items = [
  item('RA001', 'Asha', '21CSE101T'),
  item('RA001', 'Asha', '21MAB310T', 'late · batch 2'),
  item('RA002', 'Bala', '21CSE204T'),
  item('RA003', 'Chitra', '21PHY101T'),
]

const base = {
  title: 'Choose the changes to undo',
  items,
  totalCount: items.length,
  cursor: 0,
  selected: new Set<string>(),
  query: '',
  state: 'active' as const,
  columns: 80,
  rows: 24,
}

describe('renderChecklistFrame', () => {
  it('groups rows under one heading per student with a blank row between groups', () => {
    const out = renderChecklistFrame(base).split('\n')
    const text = out.join('\n')
    expect(text).toContain('RA001  Asha')
    expect(text).toContain('RA002  Bala')
    expect(text.match(/RA001 {2}Asha/g)).toHaveLength(1)
    const heading = out.findIndex((l) => l.includes('RA002  Bala'))
    expect(out[heading - 1]!.replace(/[│\s]/g, '')).toBe('')
  })

  it('shows ticks, tags, counters and the focused detail', () => {
    const out = renderChecklistFrame({ ...base, cursor: 1, selected: new Set([items[0]!.value]) })
    expect(out).toContain('[x]')
    expect(out).toContain('late · batch 2')
    expect(out).toContain('1 ticked · 4 changes')
    expect(out).toContain('Puts RA001 back into 21MAB310T.')
    expect(out).toContain('enter restore 1')
  })

  it('offers to restore every shown match when only a filter is active', () => {
    const out = renderChecklistFrame({ ...base, items: items.slice(0, 2), query: 'ra001' })
    expect(out).toContain('2 of 4 shown')
    expect(out).toContain('enter restore 2 shown')
  })

  it('says so when nothing matches', () => {
    expect(renderChecklistFrame({ ...base, items: [], query: 'zzz' })).toContain('No changes match "zzz"')
  })

  it('stays inside the terminal width and scrolls long lists', () => {
    const many = Array.from({ length: 40 }, (_, i) => item(`RA${100 + i}`, 'Student', `21CSE${100 + i}T`))
    const out = renderChecklistFrame({ ...base, items: many, totalCount: 40, cursor: 20, columns: 60, rows: 18 })
    const lines = out.split('\n')
    expect(lines.every((l) => strWidth(l) <= 60)).toBe(true)
    expect(lines.length).toBeLessThanOrEqual(18)
    expect(out).toContain('more above')
    expect(out).toContain('more below')
  })

  it('collapses to short receipts after submit / cancel', () => {
    const done = renderChecklistFrame({ ...base, selected: new Set(['a', 'b']), state: 'submit' })
    expect(done.split('\n')).toHaveLength(1)
    expect(done).toContain('2 selected')
    expect(renderChecklistFrame({ ...base, state: 'cancel' })).toContain('cancelled')
  })
})

function fakeTty() {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => input }) as unknown as NodeJS.ReadStream
  const output = Object.assign(new PassThrough(), { columns: 90, rows: 30, isTTY: true }) as unknown as NodeJS.WriteStream
  return { input, output }
}
const tick = () => new Promise((r) => setTimeout(r, 15))

describe('checklistPrompt', () => {
  // The fake TTY advertises cursor/keyboard support. TERM=dumb makes Node's
  // readline deliberately insert control bytes instead of interpreting them.
  beforeEach(() => { vi.stubEnv('TERM', 'xterm') })
  afterEach(() => { vi.unstubAllEnvs() })
  it('ctrl+a can clear an unfiltered selection on the second press', async () => {
    const { input, output } = fakeTty()
    const done = checklistPrompt({ title: 'Pick', items, input, output })
    await tick()
    input.write('\u0001')
    await tick()
    input.write('\u0001')
    await tick()
    input.write('\r')
    expect(await done).toEqual([])
  })

  it('ctrl+a preserves selected rows outside the active filter', async () => {
    const { input, output } = fakeTty()
    const done = checklistPrompt({ title: 'Pick', items, input, output,
      initialValues: ['RA003|21PHY101T'] })
    await tick()
    input.write('ra001')
    await tick()
    input.write('\u0001')
    await tick()
    input.write('\r')
    expect(await done).toEqual(['RA003|21PHY101T', 'RA001|21CSE101T', 'RA001|21MAB310T'])
  })

  it('ticks with space after navigating and returns the ticked values on Enter', async () => {
    const { input, output } = fakeTty()
    const done = checklistPrompt({ title: 'Pick', items, input, output })
    await tick()
    input.write('\u001b[B') // down → RA001|21MAB310T
    await tick()
    input.write(' ')
    await tick()
    input.write('\u001b[B\u001b[B') // down, down → RA003
    await tick()
    input.write('\t') // tab also ticks
    await tick()
    input.write('\r')
    expect(await done).toEqual(['RA001|21MAB310T', 'RA003|21PHY101T'])
  })

  it('takes every shown match when Enter is pressed with a filter and nothing ticked', async () => {
    const { input, output } = fakeTty()
    const done = checklistPrompt({ title: 'Pick', items, input, output })
    await tick()
    input.write('ra001')
    await tick()
    input.write('\r')
    expect(await done).toEqual(['RA001|21CSE101T', 'RA001|21MAB310T'])
  })

  it('treats a comma-separated filter as "any of these"', async () => {
    const { input, output } = fakeTty()
    const done = checklistPrompt({ title: 'Pick', items, input, output })
    await tick()
    input.write('ra002, 21phy101t')
    await tick()
    input.write('\r')
    expect(await done).toEqual(['RA002|21CSE204T', 'RA003|21PHY101T'])
  })

  it('ctrl+a ticks everything shown, and Esc cancels', async () => {
    const a = fakeTty()
    const first = checklistPrompt({ title: 'Pick', items, input: a.input, output: a.output })
    await tick()
    a.input.write('ra001')
    await tick()
    a.input.write('\u0001')
    await tick()
    a.input.write('\r')
    expect(await first).toEqual(['RA001|21CSE101T', 'RA001|21MAB310T'])

    const b = fakeTty()
    const second = checklistPrompt({ title: 'Pick', items, input: b.input, output: b.output })
    await tick()
    b.input.write('\u001b')
    await tick()
    expect(typeof (await second)).toBe('symbol')
  })
})

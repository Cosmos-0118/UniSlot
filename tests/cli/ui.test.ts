import { describe, expect, it, vi } from 'vitest'
import * as p from '@clack/prompts'
import {
  box,
  col,
  divider,
  glyphs,
  joinCapped,
  strWidth,
  truncateMiddle,
  truncateVisible,
  visibleLen,
  wrapAnsi,
} from '../../cli/theme'
import {
  canPrompt,
  cleanFlagNumber,
  createSolveSpinner,
  formatMetrics,
  formatMetricsLines,
  installTerminalSafetyNet,
  playTransition,
  renderSelectFrame,
  renderTextFrame,
  restoreCliTerminal,
  showPanel,
  TRANSITION_TICKS,
  transitionFrame,
  type TransitionName,
} from '../../cli/ui'
import { parseReproToken, parseSeedInput } from '../../cli/seedPrompt'

describe('theme helpers', () => {
  it('visibleLen ignores ANSI sequences', () => {
    // chalk may or may not wrap depending on FORCE_COLOR; test the helper itself.
    expect(visibleLen('hello')).toBe(5)
    expect(visibleLen(`\x1b[32mhello\x1b[39m`)).toBe(5)
  })

  it('box wraps title and lines with corners', () => {
    const out = box('Result', ['Status  OPTIMAL', 'Clash   0'])
    expect(out).toContain(glyphs.box.tl)
    expect(out).toContain(glyphs.box.tr)
    expect(out).toContain(glyphs.box.bl)
    expect(out).toContain(glyphs.box.br)
    expect(out).toContain('Result')
    expect(out).toContain('Status  OPTIMAL')
    expect(out).toContain('Clash   0')
    const lines = out.split('\n')
    expect(lines.length).toBe(4) // top + 2 body + bottom
  })

  it('divider returns a horizontal rule', () => {
    const d = divider(20)
    expect(visibleLen(d)).toBe(20)
  })

  it('col aligns label and value', () => {
    const a = col('clash', '12', { labelWidth: 8, valueWidth: 4 })
    expect(visibleLen(a)).toBeGreaterThanOrEqual(13)
    expect(a).toContain('clash')
    expect(a).toContain('12')
  })
})

describe('custom text input', () => {
  const base = { message: 'Student register number', value: '', cursor: 0, state: 'active' as const, columns: 72 }

  it('shows a bordered field, example and keyboard help', () => {
    const out = renderTextFrame({ ...base, placeholder: 'e.g. RA211003010001' })
    expect(out).toContain('e.g. RA211003010001')
    expect(out).toContain('Enter Continue')
    expect(out).toContain('Esc Cancel')
    expect(out).toContain('┌')
  })

  it('replaces the placeholder when typing and wraps validation feedback', () => {
    const out = renderTextFrame({ ...base, columns: 36, value: 'RA123', cursor: 5, placeholder: 'Example', state: 'error', error: 'Enter a register number from the enrollment file.' })
    expect(out).toContain('RA123')
    expect(out).not.toContain('Example')
    expect(out).toContain('! Enter a register number')
    expect(out.split('\n').every((line) => strWidth(line) < 36)).toBe(true)
  })

  it('scrolls long input to keep the caret visible at the start, middle and end', () => {
    const value = 'a'.repeat(80) + 'END'
    for (const cursor of [0, 40, value.length]) {
      const out = renderTextFrame({ ...base, value, cursor, columns: 36 })
      expect(out.split('\n').every((line) => strWidth(line) < 36)).toBe(true)
      expect(out).toContain(cursor === 0 ? '›' : '‹')
      if (cursor === value.length) expect(out).toContain('END')
    }
  })

  it('keeps wide Unicode input within the field', () => {
    const value = '学生😀'.repeat(25)
    const out = renderTextFrame({ ...base, value, cursor: value.length, columns: 36 })
    expect(out.split('\n').every((line) => strWidth(line) < 36)).toBe(true)
    expect(out).not.toContain('�')
  })

  it('shows default values and compact completion receipts', () => {
    expect(renderTextFrame({ ...base, defaultValue: '42' })).toContain('Default: 42')
    const submitted = renderTextFrame({ ...base, value: 'RA123', state: 'submit' })
    expect(submitted).toContain('✓')
    expect(submitted).toContain('RA123')
    expect(submitted).not.toContain('┌')
    const cancelled = renderTextFrame({ ...base, value: 'unfinished', state: 'cancel' })
    expect(cancelled).toContain('Input cancelled')
    expect(cancelled).not.toContain('unfinished')
  })
})

describe('custom select picker', () => {
  const options = [
    { value: 'solve', label: 'Create schedule', hint: 'Build a new timetable' },
    { value: 'rectify', label: 'Rectify schedule', hint: 'Adapt an existing timetable' },
    { value: 'issues', label: 'Find enrollment issues', hint: 'Validate the source file' },
  ]

  it('preserves long course titles and keeps wrapped rows within the panel', () => {
    const label = '19ARH209T - HISTORY OF ARCHITECTURE - III (ROMANESQUE ARCHITECTURE AND GOTHIC ARCHITECTURE)'
    const out = renderSelectFrame({
      message: 'Which course code is wrong?',
      options: [{ value: 'course', label }],
      cursor: 0,
      state: 'active',
      columns: 48,
      rows: 24,
    })
    expect(out).not.toContain('…')
    expect(out).toContain('GOTHIC ARCHITECTURE)')
    expect(out).not.toContain('Press Enter to continue.')
    expect(out.split('\n').every((line) => strWidth(line) < 48)).toBe(true)
  })

  it('renders one emphasized option and its supporting description', () => {
    const out = renderSelectFrame({
      message: 'What would you like to do?',
      options,
      cursor: 1,
      state: 'active',
      columns: 80,
      rows: 24,
    })
    expect(out).toContain('┌')
    expect(out).toContain('›')
    expect(out).toContain('Rectify schedule')
    expect(out).toContain('Adapt an existing timetable')
    expect(out).toContain('2 / 3')
    expect(out).toContain('Enter Select')
  })

  it('uses a compact completion receipt after submit', () => {
    const out = renderSelectFrame({
      message: 'What would you like to do?',
      options,
      cursor: 0,
      state: 'submit',
      columns: 80,
    })
    expect(out).toContain('✓ Create schedule')
    expect(out).not.toContain('Rectify schedule')
    expect(out).not.toContain('┌')
  })

  it('shows the abandoned choice once when cancelled', () => {
    const out = renderSelectFrame({
      message: 'Choose an action',
      options,
      cursor: 2,
      state: 'cancel',
      columns: 80,
    })
    expect(out).toContain('Find enrollment issues')
    expect(out.match(/Find enrollment issues/g)).toHaveLength(1)
    expect(out).not.toContain('Cancelled')
  })

  it('limits long menus by terminal rows and advertises scrolling', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ value: index, label: `Option ${index + 1}` }))
    const out = renderSelectFrame({
      message: 'Choose an action',
      options: many,
      cursor: 10,
      state: 'active',
      columns: 60,
      rows: 12,
    })
    expect(out.split('\n').length).toBeLessThan(12)
    expect(out).toContain('↑')
    expect(out).toContain('↓')
    expect(out).toContain('Option 11')
  })
})

describe('formatMetrics', () => {
  it('returns a boxed Result panel with aligned rows', () => {
    const out = formatMetrics({
      clashWeight: 18,
      red: 12,
      proven: true,
      provenLevels: ['clash_weight', 'red_students', 'balance_and_parallel'],
      status: 'OPTIMAL',
      seconds: 42.5,
      workers: 8,
    })
    expect(out).toContain('Result')
    expect(out).toContain('OPTIMAL')
    expect(out).toContain('18')
    expect(out).toContain('12')
    expect(out).toContain(glyphs.box.tl)
  })

  it('formatMetricsLines includes structural note when requested', () => {
    const lines = formatMetricsLines({
      clashWeight: 3,
      red: 2,
      proven: true,
      status: 'OPTIMAL',
      seconds: 1,
      workers: 4,
      structuralImpossible: true,
    })
    expect(lines.some((l) => /zero-clash is impossible/i.test(l))).toBe(true)
  })
})

describe('transitionFrame / playTransition', () => {
  const names = Object.keys(TRANSITION_TICKS) as TransitionName[]

  it('every transition returns the expected frame count shape', () => {
    for (const name of names) {
      const total = TRANSITION_TICKS[name]
      expect(total).toBeGreaterThan(0)
      for (let t = 0; t < total; t++) {
        const frame = transitionFrame(name, t, total)
        expect(Array.isArray(frame)).toBe(true)
        expect(frame.length).toBeGreaterThan(0)
      }
    }
  })

  it('playTransition is a no-op when isTty is false', async () => {
    const painted: string[][] = []
    const frames = await playTransition('burst', {
      isTty: false,
      paint: (lines) => painted.push(lines),
    })
    expect(frames).toBe(0)
    expect(painted).toHaveLength(0)
  })

  it('playTransition paints all frames when isTty is forced true', async () => {
    const painted: string[][] = []
    const frames = await playTransition('stamp', {
      isTty: true,
      paint: (lines) => painted.push(lines),
    })
    expect(frames).toBe(TRANSITION_TICKS.stamp)
    expect(painted).toHaveLength(TRANSITION_TICKS.stamp)
  })
})

describe('restoreCliTerminal', () => {
  function mockStdin(opts: { paused?: boolean } = {}) {
    const stdin = process.stdin as unknown as {
      isTTY?: boolean
      read: () => Buffer | null
      pause: () => unknown
      resume: () => unknown
      setRawMode: (mode: boolean) => unknown
      isPaused: () => boolean
    }
    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    const read = vi.spyOn(stdin, 'read').mockReturnValueOnce(Buffer.from('\n')).mockReturnValue(null)
    const pause = vi.spyOn(stdin, 'pause')
    const resume = vi.spyOn(stdin, 'resume').mockReturnValue(process.stdin)
    if (!(process.stdin as { setRawMode?: unknown }).setRawMode) {
      ;(process.stdin as unknown as { setRawMode: (mode: boolean) => unknown }).setRawMode = () =>
        process.stdin
    }
    const setRawMode = vi.spyOn(stdin, 'setRawMode').mockReturnValue(process.stdin)
    const isPaused = vi.spyOn(stdin, 'isPaused').mockReturnValue(opts.paused ?? true)

    return {
      read,
      pause,
      resume,
      setRawMode,
      isPaused,
      restore: () => {
        read.mockRestore()
        pause.mockRestore()
        resume.mockRestore()
        setRawMode.mockRestore()
        isPaused.mockRestore()
        if (originalDescriptor) Object.defineProperty(process.stdin, 'isTTY', originalDescriptor)
        else delete (process.stdin as { isTTY?: boolean }).isTTY
      },
    }
  }

  function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    try {
      return fn()
    } finally {
      Object.defineProperty(process, 'platform', originalDescriptor)
    }
  }

  it('drains stale input and resumes stdin when preparing a prompt, if stdin was left paused', () => {
    const stdin = mockStdin({ paused: true })

    try {
      restoreCliTerminal({ prepareForPrompt: true })

      expect(stdin.read).toHaveBeenCalledTimes(2)
      expect(stdin.pause).toHaveBeenCalledOnce()
      expect(stdin.resume).toHaveBeenCalledOnce()
    } finally {
      stdin.restore()
    }
  })

  it('leaves stdin paused when no prompt follows', () => {
    const stdin = mockStdin({ paused: true })

    try {
      restoreCliTerminal()

      expect(stdin.read).toHaveBeenCalledTimes(2)
      expect(stdin.pause).toHaveBeenCalledOnce()
      expect(stdin.resume).not.toHaveBeenCalled()
    } finally {
      stdin.restore()
    }
  })

  it('skips the pause/drain/resume dance entirely when stdin is already flowing (the normal state Clack leaves it in between its own prompts and spinners) — avoids stdin churn around transitions Clack already owns correctly', () => {
    const stdin = mockStdin({ paused: false })

    try {
      restoreCliTerminal({ prepareForPrompt: true })

      expect(stdin.pause).not.toHaveBeenCalled()
      expect(stdin.read).not.toHaveBeenCalled()
      expect(stdin.resume).not.toHaveBeenCalled()
    } finally {
      stdin.restore()
    }
  })

  it('bounds the drain loop so a stream that never returns null cannot hang the CLI forever', () => {
    const stdin = mockStdin({ paused: true })
    // Every read returns data — a pathological/misbehaving stream.
    stdin.read.mockReset().mockReturnValue(Buffer.from('x'))

    try {
      const start = Date.now()
      restoreCliTerminal({ prepareForPrompt: true })
      expect(Date.now() - start).toBeLessThan(2000)
      expect(stdin.read.mock.calls.length).toBeLessThanOrEqual(10_001)
    } finally {
      stdin.restore()
    }
  })

  it('turns raw mode off on non-Windows platforms', () => {
    const stdin = mockStdin()

    try {
      withPlatform('darwin', () => restoreCliTerminal({ prepareForPrompt: true }))

      expect(stdin.setRawMode).toHaveBeenCalledWith(false)
    } finally {
      stdin.restore()
    }
  })

  it('never touches raw mode on Windows (clack leaves it on after a spinner there; forcing it off wedges the console read and freezes stdin, even Ctrl+C)', () => {
    const stdin = mockStdin()

    try {
      withPlatform('win32', () => restoreCliTerminal({ prepareForPrompt: true }))

      expect(stdin.setRawMode).not.toHaveBeenCalled()
    } finally {
      stdin.restore()
    }
  })
})

describe('installTerminalSafetyNet', () => {
  it('registers exactly one exit listener that restores the cursor and, off Windows, raw mode', () => {
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    if (!(process.stdin as { setRawMode?: unknown }).setRawMode) {
      ;(process.stdin as unknown as { setRawMode: (mode: boolean) => unknown }).setRawMode = () =>
        process.stdin
    }
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const setRawMode = vi
      .spyOn(process.stdin as unknown as { setRawMode: (mode: boolean) => unknown }, 'setRawMode')
      .mockReturnValue(process.stdin)
    const listenersBefore = process.listeners('exit')

    try {
      installTerminalSafetyNet()
      const listenersAfter = process.listeners('exit')
      expect(listenersAfter.length).toBe(listenersBefore.length + 1)
      const added = listenersAfter.find((l) => !listenersBefore.includes(l))!

      process.emit('exit', 0)
      expect(write).toHaveBeenCalledWith(expect.stringContaining('\x1b[?25h'))
      expect(setRawMode).toHaveBeenCalledWith(false)

      // Idempotent — a second 'exit' (or any listener re-firing) must not throw or double-write.
      write.mockClear()
      setRawMode.mockClear()
      process.emit('exit', 0)
      expect(write).not.toHaveBeenCalled()
      expect(setRawMode).not.toHaveBeenCalled()

      process.off('exit', added as never)
    } finally {
      write.mockRestore()
      setRawMode.mockRestore()
      if (stdoutDescriptor) Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
      if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }
  })
})

describe('createSolveSpinner live panel', () => {
  it('never emits raw cursor-up/clear ANSI (clack owns the spinner line)', async () => {
    const stdout = process.stdout as unknown as { write: (chunk: unknown) => boolean; isTTY?: boolean }
    const originalWrite = stdout.write
    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    const writes: string[] = []
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    stdout.write = (chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }

    try {
      const spin = createSolveSpinner(4)
      spin.start('Reading enrollment workbook…')
      spin.applyCpsat({ type: 'start', workers: 4, courses: 373, edges: 584, students: 1102 } as never)
      spin.applyCpsat({ type: 'model_ready', elapsed: 0.4 } as never)
      spin.applyCpsat({
        type: 'progress',
        phase: 'minimize_clash',
        phase_label: '1/3 Minimizing clashes',
        elapsed: 1.2,
        workers: 4,
        solutions: 1,
        best_clash: 9,
        best_red: 9,
        bound: 4,
        activity: 'proving',
        seconds_since_improve: 1,
      } as never)
      spin.applyCpsat({
        type: 'progress',
        phase: 'minimize_red',
        phase_label: '2/3 Minimizing RED',
        elapsed: 2.4,
        workers: 4,
        solutions: 2,
        best_clash: 9,
        best_red: 7,
        bound: null,
        activity: 'improving',
        seconds_since_improve: 0,
      } as never)
      await spin.stop('done')

      const blob = writes.join('')
      const cursorUp = new RegExp(`${String.fromCharCode(27)}\\[[0-9]+A`)
      expect(blob).not.toMatch(cursorUp)
      expect(spin.state.bestClash).toBe(9)
      expect(spin.state.bestRed).toBe(7)
    } finally {
      stdout.write = originalWrite
      if (originalDescriptor) Object.defineProperty(process.stdout, 'isTTY', originalDescriptor)
    }
  })

  it('pause/resume keeps progress flowing (late-mode mid-run prompts)', async () => {
    const stdout = process.stdout as unknown as { write: (chunk: unknown) => boolean }
    const originalWrite = stdout.write
    const writes: string[] = []
    stdout.write = (chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }
    try {
      const spin = createSolveSpinner(4)
      spin.start('Merging late enrollments…')
      spin.pause('Capacity decision needed')
      spin.updateFromPipeline('waiting on user…')
      spin.resume('Continuing late merge…')
      spin.applyCpsat({
        type: 'progress',
        phase: 'minimize_clash',
        phase_label: '1/3 Minimizing clashes',
        elapsed: 3,
        workers: 4,
        solutions: 1,
        best_clash: 5,
        best_red: 4,
        bound: null,
        activity: 'searching',
        seconds_since_improve: 0,
      } as never)
      await spin.stop('finished')
      expect(spin.state.bestClash).toBe(5)
      expect(writes.join('')).toContain('finished')
    } finally {
      stdout.write = originalWrite
    }
  })

  it('cancel during pause still stamps Cancelled, and later stop cannot override it', async () => {
    const stdout = process.stdout as unknown as { write: (chunk: unknown) => boolean }
    const originalWrite = stdout.write
    const writes: string[] = []
    stdout.write = (chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }
    try {
      const spin = createSolveSpinner(2)
      spin.start('Merging late enrollments…')
      spin.pause('Capacity decision needed')
      spin.cancel()
      await spin.stop('override')
      const blob = writes.join('')
      expect(blob).toContain('Cancelled')
      expect(blob).not.toContain('override')
    } finally {
      stdout.write = originalWrite
    }
  })

  it('stop after cancel keeps the Cancelled message (no override)', async () => {
    const stdout = process.stdout as unknown as { write: (chunk: unknown) => boolean }
    const originalWrite = stdout.write
    const writes: string[] = []
    stdout.write = (chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }
    try {
      const spin = createSolveSpinner(2)
      spin.start('Working…')
      spin.cancel()
      await spin.stop('override')
      const blob = writes.join('')
      expect(blob).toContain('Cancelled')
      expect(blob).not.toContain('override')
    } finally {
      stdout.write = originalWrite
    }
  })
})

describe('huge text boxes', () => {
  it('wrapAnsi hard-splits a single word longer than the width', () => {
    const rows = wrapAnsi('x'.repeat(100), 20)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(strWidth(row)).toBeLessThanOrEqual(20)
    expect(rows.join('')).toBe('x'.repeat(100))
  })

  it('wrapAnsi preserves mid-line color state on every row', () => {
    const esc = String.fromCharCode(27)
    const line = `${esc}[31mred ${esc}[1mbold-word-that-is-long ${esc}[0mplain tail here`
    const rows = wrapAnsi(line, 16)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(strWidth(row)).toBeLessThanOrEqual(16)
    // No border-bleed: the last SGR on a styled row must be a reset.
    for (const row of rows) {
      const codes = [...row.matchAll(new RegExp(`${esc}\\[[0-9;]*m`, 'g'))].map((m) => m[0])
      if (codes.length) expect(codes[codes.length - 1]).toBe(`${esc}[0m`)
    }
  })

  it('wrapAnsi does not let a color run bleed into a later uncolored token', () => {
    const esc = String.fromCharCode(27)
    const rows = wrapAnsi(`${esc}[31mred-word ${esc}[0mplain-word-here`, 12)
    const plain = rows.find((row) => row.includes('plain'))
    expect(plain).toBeDefined()
    expect(plain).not.toContain(`${esc}[31m`)
  })

  it('wrapAnsi tracks 256-color SGR across a wrap', () => {
    const esc = String.fromCharCode(27)
    const rows = wrapAnsi(`${esc}[38;5;196m${'x'.repeat(30)}${esc}[0m`, 10)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      expect(strWidth(row)).toBeLessThanOrEqual(10)
      expect(row).toContain(`${esc}[38;5;196m`)
      expect(row.endsWith(`${esc}[0m`)).toBe(true)
    }
  })

  it('strWidth counts CJK/emoji as 2 columns', () => {
    expect(strWidth('abc')).toBe(3)
    expect(strWidth('中文')).toBe(4)
    expect(strWidth('✓')).toBe(1)
    expect(strWidth('😀')).toBe(2)
    expect(strWidth('👩‍💻')).toBe(2)
    expect(strWidth('a\tb')).toBe(9) // tab advances to the next 8-column stop
  })

  it('wrapAnsi preserves indentation and nested SGR state', () => {
    const esc = String.fromCharCode(27)
    const rows = wrapAnsi(`  ${esc}[1m${esc}[31mred words that wrap${esc}[39m still bold${esc}[0m`, 12)
    expect(rows[0]).toMatch(/^ {2}/)
    const still = rows.find((row) => row.includes('still'))
    expect(still).toBeDefined()
    expect(still).toContain(`${esc}[1m`)
    // 39m dropped the red; bold must survive without a hanging 31m after the last reset.
    const afterReset = still!.split(`${esc}[0m`).pop() ?? ''
    expect(afterReset).not.toContain(`${esc}[31m`)
    for (const row of rows) expect(strWidth(row)).toBeLessThanOrEqual(12)
  })

  it('box never overflows on narrow terminals, even with unspaced words', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 20, configurable: true })
    try {
      const out = box('T', [`C:\\${'very'.repeat(30)}.xlsx`, 'short line'])
      for (const row of out.split('\n')) expect(strWidth(row)).toBeLessThanOrEqual(20)
    } finally {
      if (originalDescriptor) Object.defineProperty(process.stdout, 'columns', originalDescriptor)
    }
  })

  it('box remains contained even below the usual minimum terminal width', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 5, configurable: true })
    try {
      const out = box('a\nb', ['😀'])
      for (const row of out.split('\n')) expect(strWidth(row)).toBeLessThanOrEqual(5)
    } finally {
      if (originalDescriptor) Object.defineProperty(process.stdout, 'columns', originalDescriptor)
    }
  })

  it('showPanel caps huge bodies with an explicit more-tail (piped)', () => {
    const stdout = process.stdout as unknown as {
      write: (chunk: unknown) => boolean
      isTTY?: boolean
    }
    const originalWrite = stdout.write
    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    const writes: string[] = []
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    stdout.write = (chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }
    try {
      const body = Array.from({ length: 150 }, (_, i) => `row ${i} · detail`).join('\n')
      showPanel('Huge', body)
      const blob = writes.join('')
      expect(blob).toContain('+50 more')
    } finally {
      stdout.write = originalWrite
      if (originalDescriptor) Object.defineProperty(process.stdout, 'isTTY', originalDescriptor)
    }
  })

  it('showPanel logs a friendly empty-body note instead of a blank box', () => {
    const info = vi.spyOn(p.log, 'info').mockImplementation(() => undefined)
    try {
      expect(() => showPanel('Empty', '\n\n')).not.toThrow()
      expect(info).toHaveBeenCalledOnce()
    } finally {
      info.mockRestore()
    }
  })

  it('joinCapped / truncateMiddle / truncateVisible degrade gracefully', () => {
    expect(joinCapped(['a', 'b', 'c'], 5)).toBe('a, b, c')
    expect(joinCapped(['a', 'b', 'c', 'd'], 2)).toContain('+2 more')
    expect(truncateMiddle('short', 60)).toBe('short')
    expect(truncateMiddle('x'.repeat(100), 60).length).toBeLessThanOrEqual(60)
    expect(truncateVisible('hello world', 5)).toBe('hell…')
    expect(truncateVisible('hi', 5)).toBe('hi')
  })
})

describe('input edge cases', () => {
  it('parseSeedInput tolerates pasted quotes', () => {
    expect(parseSeedInput('"77"')).toBe(77)
    expect(parseSeedInput("'77/8/0/0'".slice(1, -1))).toBeUndefined() // slashes are not a seed
    expect(parseReproToken('"77/8/0/0"')).toEqual({
      seed: 77,
      workers: 8,
      portfolio: 0,
      allowSaturdayForMath: false,
    })
    expect(parseReproToken('“77/8/0/0”')).toEqual({
      seed: 77,
      workers: 8,
      portfolio: 0,
      allowSaturdayForMath: false,
    })
    expect(parseSeedInput('  42  ')).toBe(42)
    expect(parseSeedInput('999999999999999999999')).toBeUndefined()
    expect(parseSeedInput('-5')).toBeUndefined()
    expect(parseSeedInput('')).toBeUndefined()
  })

  it('cleanFlagNumber rejects NaN/Infinity/below-min', () => {
    expect(cleanFlagNumber(undefined)).toBeUndefined()
    expect(cleanFlagNumber(Number.NaN, { min: 0, integer: true })).toBeUndefined()
    expect(cleanFlagNumber(Number.POSITIVE_INFINITY, { min: 0 })).toBeUndefined()
    expect(cleanFlagNumber(-3, { min: 0, integer: true })).toBeUndefined()
    expect(cleanFlagNumber(0, { min: 1, integer: true })).toBeUndefined()
    expect(cleanFlagNumber(8.9, { min: 1, integer: true })).toBe(8)
    expect(cleanFlagNumber(8, { min: 1, integer: true })).toBe(8)
  })

  it('canPrompt is a boolean reflecting stdin TTY state', () => {
    expect(typeof canPrompt()).toBe('boolean')
  })
})

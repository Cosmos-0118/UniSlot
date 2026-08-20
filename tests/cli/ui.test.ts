import { describe, expect, it, vi } from 'vitest'
import { box, col, divider, glyphs, visibleLen } from '../../cli/theme'
import {
  createSolveSpinner,
  formatMetrics,
  formatMetricsLines,
  playTransition,
  TRANSITION_TICKS,
  transitionFrame,
  type TransitionName,
} from '../../cli/ui'

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

describe('createSolveSpinner live panel', () => {
  it('every cursor-up jump matches the row count actually painted just before it (no drift)', async () => {
    vi.useFakeTimers()
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
      // Let the initial 'scan' transition (8 ticks) finish and the real, tall
      // clash-stage frame (5 lines) paint a few times, as happens for real while
      // the Python subprocess is still starting up.
      await vi.advanceTimersByTimeAsync(80 * 12)
      // Triggers the shorter 'assemble' transition overlay — tall(5) -> short(3),
      // the exact shrink that used to strand old rows as scrollback.
      spin.applyCpsat({ type: 'model_ready', elapsed: 0.4 } as never)
      // Run past assemble (9 ticks) + the checkpoint + clash_enter (7 ticks) with margin,
      // landing back on the real (tall) clash frame.
      await vi.advanceTimersByTimeAsync(80 * 20)
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
      await vi.advanceTimersByTimeAsync(80 * 3)
      await spin.stop('done')

      // Replay the captured ANSI stream: each cursor-up jump must equal the
      // number of rows the previous paint/clear burst actually wrote, or the
      // block drifts and leaves stale content behind (the screenshot bug).
      const ups: number[] = []
      const segments: number[] = []
      let rows = 0
      for (const w of writes) {
        const up = /^\x1b\[(\d+)A$/.exec(w)
        if (up) {
          segments.push(rows)
          ups.push(Number(up[1]))
          rows = 0
        } else if (w === '\x1b[1B' || w.startsWith('\x1b[2K')) {
          rows++
        }
      }
      expect(ups.length).toBeGreaterThan(0)
      for (let i = 0; i < ups.length; i++) {
        expect(ups[i]).toBe(segments[i])
      }
    } finally {
      stdout.write = originalWrite
      if (originalDescriptor) Object.defineProperty(process.stdout, 'isTTY', originalDescriptor)
      vi.useRealTimers()
    }
  })
})

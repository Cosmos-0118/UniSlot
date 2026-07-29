import { describe, expect, it } from 'vitest'
import { box, col, divider, glyphs, visibleLen } from '../../cli/theme'
import {
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

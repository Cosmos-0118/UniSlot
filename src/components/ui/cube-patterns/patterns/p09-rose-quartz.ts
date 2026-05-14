import type { CubePattern, PatternContext } from '../types'

/** Dust rose / mauve — minimal lift, breathing light. */
export const patternRoseQuartz: CubePattern = {
  id: 'rose-quartz',
  title: 'Rose Quartz',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const breath = Math.sin(t * (reduced ? 0.35 : 0.65) + nx * 3 + ny * 2)
    const ripple = Math.sin((nx - 0.5) ** 2 * 40 + (ny - 0.5) ** 2 * 40 - t * (reduced ? 0.25 : 0.5)) * 0.35
    const lift = (breath * 2.2 + ripple) * (reduced ? 0.55 : 1)
    const hue = 330 + breath * 12 + ripple * 8
    const sat = 18 + Math.abs(breath) * 16
    const light = 42 + breath * 8 + ripple * 5
    return { lift, hue, sat, light }
  },
}

import type { CubePattern, PatternContext } from '../types'

/** Dark forest with lime crests on slow diagonal pulses. */
export const patternForestPulse: CubePattern = {
  id: 'forest-pulse',
  title: 'Forest Pulse',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const u = col / cols
    const v = row / rows
    const pulse = Math.sin((u * 1.2 + v) * 9 - t * (reduced ? 0.35 : 0.62))
    const crest = Math.max(0, pulse) ** 1.8
    const lift = pulse * 3.8 * (reduced ? 0.5 : 1)
    const hue = 118 + crest * 38 + pulse * 6
    const sat = 20 + crest * 32 + Math.abs(pulse) * 12
    const light = 30 + crest * 14 + pulse * 5
    return { lift, hue, sat, light }
  },
}

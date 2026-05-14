import type { CubePattern, PatternContext } from '../types'

/** Near-monochrome ice — cyan-white breathing horizontal mist. */
export const patternArcticBreath: CubePattern = {
  id: 'arctic-breath',
  title: 'Arctic Breath',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const mist = Math.sin(nx * 6 + t * (reduced ? 0.2 : 0.38)) * Math.cos(ny * 5 - t * 0.22)
    const lift = mist * 3.5 * (reduced ? 0.55 : 1)
    const hue = 188 + mist * 12
    const sat = 14 + Math.abs(mist) * 22
    const light = 40 + mist * 12 + Math.sin(t * 0.5 + ny * 3) * 4
    return { lift, hue, sat, light }
  },
}

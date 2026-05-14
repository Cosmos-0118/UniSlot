import type { CubePattern, PatternContext } from '../types'

/** Deep greens with soft gold-tinted radial halos. */
export const patternMossCathedral: CubePattern = {
  id: 'moss-cathedral',
  title: 'Moss Cathedral',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const u = col / cols - 0.5
    const v = row / rows - 0.5
    const r = Math.hypot(u, v) + 1e-5
    const rings = Math.sin(r * 24 - t * (reduced ? 0.4 : 0.85)) * Math.exp(-r * 1.2)
    const lift = rings * 5.2 * (reduced ? 0.48 : 1)
    const gold = Math.max(0, rings) * 8
    const hue = 128 + rings * 18 + gold * 0.35
    const sat = 22 + Math.abs(rings) * 26 + gold * 0.15
    const light = 32 + rings * 9 + gold * 0.2
    return { lift, hue, sat, light }
  },
}

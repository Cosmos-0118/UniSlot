import type { CubePattern, PatternContext } from '../types'

/** Terracotta / cream diagonal tide — desert calm. */
export const patternSandstoneTide: CubePattern = {
  id: 'sandstone-tide',
  title: 'Sandstone Tide',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const u = col / cols
    const v = row / rows
    const tide = Math.sin((u + v) * 11 - t * (reduced ? 0.3 : 0.58))
    const grain = Math.sin(u * 33 + v * 17) * 0.15
    const lift = (tide * 4.2 + grain) * (reduced ? 0.5 : 1)
    const hue = 32 + tide * 14 + grain * 6
    const sat = 24 + Math.abs(tide) * 20
    const light = 40 + tide * 9 + grain * 4
    return { lift, hue, sat, light }
  },
}

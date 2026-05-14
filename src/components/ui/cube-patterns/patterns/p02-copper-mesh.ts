import type { CubePattern, PatternContext } from '../types'

/** Warm art-deco diamond mesh — amber / rust. */
export const patternCopperMesh: CubePattern = {
  id: 'copper-mesh',
  title: 'Copper Mesh',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const u = col / cols - 0.5
    const v = row / rows - 0.5
    const d1 = Math.sin((u + v) * 22 + t * (reduced ? 0.35 : 0.7))
    const d2 = Math.cos((u - v) * 19 - t * (reduced ? 0.28 : 0.55))
    const m = d1 * d2
    const lift = m * 4.8 * (reduced ? 0.5 : 1)
    const hue = 22 + m * 16 + Math.sin(t * 0.15) * 4
    const sat = 36 + Math.abs(m) * 28
    const light = 36 + m * 10
    return { lift, hue, sat, light }
  },
}

import type { CubePattern, PatternContext } from '../types'

/** Blue-only hex-ish lattice from three interfering cosines. */
export const patternSapphireLattice: CubePattern = {
  id: 'sapphire-lattice',
  title: 'Sapphire Lattice',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = (col / cols) * Math.PI * 2
    const ny = (row / rows) * Math.PI * 2
    const k = reduced ? 5.5 : 9
    const h =
      Math.cos(nx * k + t * 0.5) + Math.cos((nx * 0.5 + ny * 0.866) * k - t * 0.42) + Math.cos((-nx * 0.5 + ny * 0.866) * k + t * 0.38)
    const lift = h * 2.4 * (reduced ? 0.55 : 1)
    const hue = 225 + h * 18
    const sat = 30 + Math.abs(h) * 22
    const light = 36 + h * 8
    return { lift, hue, sat, light }
  },
}

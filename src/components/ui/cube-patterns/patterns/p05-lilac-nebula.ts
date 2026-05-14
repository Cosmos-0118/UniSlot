import type { CubePattern, PatternContext } from '../types'

/** Soft violet clouds — low frequency, restrained magenta. */
export const patternLilacNebula: CubePattern = {
  id: 'lilac-nebula',
  title: 'Lilac Nebula',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const n = Math.sin(nx * 4 + ny * 3 + t * (reduced ? 0.18 : 0.32)) * Math.cos(ny * 5 - nx * 2 - t * 0.24)
    const lift = n * 4 * (reduced ? 0.52 : 1)
    const hue = 278 + n * 22
    const sat = 26 + Math.abs(n) * 24
    const light = 38 + n * 11
    return { lift, hue, sat, light }
  },
}

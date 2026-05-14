import type { CubePattern, PatternContext } from '../types'

/** Cool vertical meridians — indigo / cyan, no full-spectrum sweep. */
export const patternTwilightMeridian: CubePattern = {
  id: 'twilight-meridian',
  title: 'Twilight Meridian',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols
    const ny = row / rows
    const bands = Math.sin(nx * Math.PI * 10 + t * (reduced ? 0.25 : 0.55))
    const veil = Math.sin((nx + ny * 0.4) * 14 - t * (reduced ? 0.2 : 0.45)) * 0.5
    const lift = (bands * 3.2 + veil * 2.1) * (reduced ? 0.45 : 1)
    const hue = 218 + bands * 14 + veil * 10
    const sat = 28 + Math.abs(bands) * 18
    const light = 34 + bands * 8 + veil * 5
    return { lift, hue, sat, light }
  },
}

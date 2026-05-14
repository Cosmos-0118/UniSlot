import type { CubePattern, PatternContext } from '../types'

/** Charcoal base + thin electric violet fault lines. */
export const patternObsidianFault: CubePattern = {
  id: 'obsidian-fault',
  title: 'Obsidian Fault',
  sample({ col, row, t, reduced }: PatternContext) {
    const stripe = Math.sin(col * 0.85 + row * 0.12 + t * (reduced ? 0.5 : 1.05))
    const fault = Math.pow(Math.abs(stripe), 6) * Math.sign(stripe)
    const lift = stripe * 2.8 + fault * 3.2 * (reduced ? 0.4 : 1)
    const hue = fault > 0.02 ? 265 + fault * 25 : 235 + stripe * 8
    const sat = 12 + Math.abs(fault) * 55 + Math.abs(stripe) * 10
    const light = 28 + fault * 18 + Math.abs(stripe) * 6
    return { lift, hue, sat, light }
  },
}

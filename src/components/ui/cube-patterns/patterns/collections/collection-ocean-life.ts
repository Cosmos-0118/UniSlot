import type { CubePattern, PatternContext } from '../../types'
import {
  clamp01, fbm, warpedFbm, voronoi,
  smoothstep, lerp, speed, wrapHue, fract01
} from '../_shared'

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION: Ocean Life (curated keepers)
// ═══════════════════════════════════════════════════════════════════════════

/** Deep ocean with a slow-moving pressure wave and distant whale song pulses. */
export const patternWhaleSongDepth: CubePattern = {
  id: 'whale-song-depth',
  title: 'Whale Song Depth',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.35, 0.1)

    // Deep pressure waves
    const pressure = warpedFbm(nx * 2.5, ny * 2 + T * 0.1, T * 0.4, 1.8)
    // Sound wave ripples — concentric expanding rings
    const cx = 0.5 + Math.sin(T * 0.3) * 0.2, cy = 0.5
    const dist = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2)
    const songPulse = smoothstep(0.02, 0.0, Math.abs(fract01(dist * 8 - T * 0.6) - 0.5) - 0.4)

    // Depth gradient
    const depth = smoothstep(0.0, 1.0, ny)
    const intensity = clamp01(pressure * 0.4 + songPulse * 0.6 + 0.1)

    return {
      lift: (intensity * 3.5 + songPulse * 2) * (reduced ? 0.45 : 1),
      hue: wrapHue(lerp(220, 195, depth) - pressure * 15),
      sat: lerp(45, 75, intensity),
      light: lerp(6, 40, intensity),
    }
  },
}

/** Translucent jellyfish bells pulsing with Voronoi-based body structure. */
export const patternJellyfishBloom: CubePattern = {
  id: 'jellyfish-bloom',
  title: 'Jellyfish Bloom',
  sample({ col, row, cols, rows, t, reduced }: PatternContext) {
    const nx = col / cols, ny = row / rows
    const T = t * speed(reduced, 0.35, 0.1)

    // Multiple jellyfish as Voronoi cells
    const v = voronoi(nx * 4 + Math.sin(T * 0.3) * 0.3, ny * 3 - T * 0.15)
    const bell = smoothstep(0.35, 0.08, v.dist1)
    // Inner bell translucency
    const inner = smoothstep(0.2, 0.05, v.dist1)

    // Pulsing motion
    const pulse = Math.sin(T * 2.5 + v.dist1 * 10) * 0.5 + 0.5
    // Tentacle trails below each bell
    const tentacle = clamp01(fbm(nx * 8 + T * 0.4, ny * 8 - T * 0.6, 3)) * (1 - bell) * smoothstep(0.2, 0.5, ny)

    const glow = clamp01(bell * pulse + inner * 0.3 + tentacle * 0.5)

    return {
      lift: (glow * 4 + tentacle * 2) * (reduced ? 0.5 : 1),
      hue: wrapHue(lerp(270, 310, bell) + pulse * 15),
      sat: lerp(50, 85, glow),
      light: lerp(15, 65, glow),
    }
  },
}

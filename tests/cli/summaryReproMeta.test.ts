import { describe, expect, it } from 'vitest'
import { formatReproToken } from '../../cli/seedPrompt'

/**
 * summary.json / snapshot.json shape for cross-device reproduction metadata.
 * Mirrors the fields written by writeExports in cli/index.ts.
 */
function buildSummaryMeta(meta: {
  seed: number
  workers: number
  portfolio: number
  allowSaturdayForMath: boolean
  ortools_version?: string
  python_version?: string
}) {
  return {
    seed: meta.seed,
    workers: meta.workers,
    portfolio: meta.portfolio,
    allow_saturday_for_math: meta.allowSaturdayForMath,
    repro_token: formatReproToken({
      seed: meta.seed,
      workers: meta.workers,
      portfolio: meta.portfolio,
      allowSaturdayForMath: meta.allowSaturdayForMath,
    }),
    ...(meta.ortools_version ? { ortools_version: meta.ortools_version } : {}),
    ...(meta.python_version ? { python_version: meta.python_version } : {}),
  }
}

describe('summary.json reproduction metadata', () => {
  it('includes repro_token, ortools_version, and python_version', () => {
    const summary = buildSummaryMeta({
      seed: 77,
      workers: 8,
      portfolio: 0,
      allowSaturdayForMath: false,
      ortools_version: '9.15.6755',
      python_version: '3.12.8',
    })
    expect(summary.repro_token).toBe('77/8/0/0')
    expect(summary.ortools_version).toBe('9.15.6755')
    expect(summary.python_version).toBe('3.12.8')
    expect(summary.seed).toBe(77)
    expect(summary.workers).toBe(8)
    expect(summary.portfolio).toBe(0)
    expect(summary.allow_saturday_for_math).toBe(false)
  })
})

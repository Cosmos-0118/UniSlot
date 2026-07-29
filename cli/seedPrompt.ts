import * as p from '@clack/prompts'
import { randomInt } from 'node:crypto'

/** New-run seed in [1, 2^31 − 1] (safe for CP-SAT and JSON). */
export function generateRunSeed(): number {
  return randomInt(1, 2 ** 31)
}

export function parseSeedInput(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 0) return undefined
  return n
}

/** Compact reproduction token: seed/workers/portfolio/allowSaturdayForMath. */
export type ReproToken = {
  seed: number
  workers: number
  portfolio: number
  allowSaturdayForMath: boolean
}

export function formatReproToken(t: ReproToken): string {
  return `${t.seed}/${t.workers}/${t.portfolio}/${t.allowSaturdayForMath ? 1 : 0}`
}

/**
 * Parse a reproduction token or a plain seed number.
 * - Full token: `77/8/0/0` → ReproToken
 * - Plain number: `77` → `{ plainSeed: 77 }`
 * - Invalid → undefined
 */
export function parseReproToken(raw: string): ReproToken | { plainSeed: number } | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const parts = trimmed.split('/').map((s) => s.trim())
  if (parts.length === 1) {
    const n = parseSeedInput(parts[0]!)
    return n === undefined ? undefined : { plainSeed: n }
  }
  if (parts.length !== 4) return undefined
  const [seedS, workersS, portfolioS, satS] = parts
  const seed = parseSeedInput(seedS!)
  const workers = parseSeedInput(workersS!)
  const portfolio = parseSeedInput(portfolioS!)
  const sat = parseSeedInput(satS!)
  if (seed === undefined || workers === undefined || portfolio === undefined || sat === undefined) {
    return undefined
  }
  if (workers < 1 || portfolio < 0 || sat < 0 || sat > 1) return undefined
  return { seed, workers, portfolio, allowSaturdayForMath: sat === 1 }
}

export type ResolveRunSeedOptions = {
  /** When set, skip prompts and reuse this seed. */
  seed?: number
  /** Interactive confirm/text prompts (ignored when `seed` is set). */
  interactive: boolean
}

export type ResolvedRunSeed = {
  seed: number
  reused: boolean
  /** Present when a full repro token was entered. */
  workers?: number
  portfolio?: number
  allowSaturdayForMath?: boolean
  /** True when user reused a plain seed number without workers/portfolio/sat. */
  plainSeedOnly?: boolean
}

/**
 * Resolve the run seed: explicit `--seed`, interactive reuse prompt (token or plain),
 * or a fresh value. Non-interactive mode without `--seed` always generates a fresh seed.
 */
export async function resolveRunSeed(
  options: ResolveRunSeedOptions | boolean,
): Promise<ResolvedRunSeed | { cancelled: true }> {
  // Back-compat: older call sites passed `interactive: boolean` only.
  const opts: ResolveRunSeedOptions =
    typeof options === 'boolean' ? { interactive: options } : options

  if (opts.seed !== undefined) {
    return { seed: opts.seed, reused: true, plainSeedOnly: true }
  }

  if (!opts.interactive) {
    return { seed: generateRunSeed(), reused: false }
  }

  const hasSeed = await p.confirm({
    message: 'Do you have a seed from a previous run?',
    initialValue: false,
  })
  if (p.isCancel(hasSeed)) {
    return { cancelled: true }
  }

  if (hasSeed) {
    const entered = await p.text({
      message: 'Enter reproduction token (seed/workers/portfolio/sat)',
      placeholder: '77/8/0/0',
      validate: (value) => {
        if (parseReproToken(String(value ?? '')) === undefined) {
          return 'Enter a token like 77/8/0/0, or a plain non-negative integer seed'
        }
      },
    })
    if (p.isCancel(entered)) {
      return { cancelled: true }
    }
    const parsed = parseReproToken(String(entered))!
    if ('plainSeed' in parsed) {
      return { seed: parsed.plainSeed, reused: true, plainSeedOnly: true }
    }
    return {
      seed: parsed.seed,
      reused: true,
      workers: parsed.workers,
      portfolio: parsed.portfolio,
      allowSaturdayForMath: parsed.allowSaturdayForMath,
    }
  }

  return { seed: generateRunSeed(), reused: false }
}

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

export type ResolveRunSeedOptions = {
  /** When set, skip prompts and reuse this seed. */
  seed?: number
  /** Interactive confirm/text prompts (ignored when `seed` is set). */
  interactive: boolean
}

/**
 * Resolve the run seed: explicit `--seed`, interactive reuse prompt, or a fresh value.
 * Non-interactive mode without `--seed` always generates a fresh seed.
 */
export async function resolveRunSeed(
  options: ResolveRunSeedOptions | boolean,
): Promise<{ seed: number; reused: boolean } | { cancelled: true }> {
  // Back-compat: older call sites passed `interactive: boolean` only.
  const opts: ResolveRunSeedOptions =
    typeof options === 'boolean' ? { interactive: options } : options

  if (opts.seed !== undefined) {
    return { seed: opts.seed, reused: true }
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
      message: 'Enter seed',
      validate: (value) => {
        if (parseSeedInput(String(value ?? '')) === undefined) {
          return 'Enter a non-negative integer'
        }
      },
    })
    if (p.isCancel(entered)) {
      return { cancelled: true }
    }
    const seed = parseSeedInput(String(entered))!
    return { seed, reused: true }
  }

  return { seed: generateRunSeed(), reused: false }
}

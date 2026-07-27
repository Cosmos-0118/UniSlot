import * as p from '@clack/prompts'
import { randomInt } from 'node:crypto'

/** New-run seed in [1, 2^31 − 1] (safe for CP-SAT and JSON). */
export function generateRunSeed(): number {
  return randomInt(1, 2 ** 31)
}

function parseSeedInput(raw: string): number | undefined {
  const n = Number(raw.trim())
  if (!Number.isInteger(n) || n < 0) return undefined
  return n
}

/**
 * Ask whether the user is reusing a prior seed; otherwise generate one for a new run.
 * Non-interactive mode always generates a fresh seed.
 */
export async function resolveRunSeed(
  interactive: boolean,
): Promise<{ seed: number; reused: boolean } | { cancelled: true }> {
  if (!interactive) {
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

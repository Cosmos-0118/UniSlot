import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Section } from '../../src/modules/scheduling/types'
import type { CpsatInstance, CpsatSolution } from '../../src/modules/scheduling/solver/cpsatInstance'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: spawnMock,
}))
import { runCpsatScheduler, spawnCpsatSolve } from '../../src/modules/scheduling/solver/cpsatBridge'

// Exercise the real bridge, filesystem exchange and portfolio orchestration,
// substituting only the child search outcomes to force otherwise rare failures.
const sections: Record<string, Section[]> = { X: [{
  section_id: 'X', course_code: 'X', course_title: 'X', section_number: 1,
  faculty: null, capacity: 64, programs: [], enrolled_students: [],
}] }
function result(red: number, pairs: number): CpsatSolution {
  return { status: 'FEASIBLE', proven_optimal: false, red_students: red,
    clash_weight: pairs, slot_by_course: { X: 0 }, num_workers: 1, solver_time_seconds: 0 }
}
let outcomes: Array<CpsatSolution | Error>
let checkpoints: Array<CpsatSolution | undefined>
let advanceClock: (() => void) | undefined
beforeEach(() => {
  outcomes = []
  checkpoints = []
  advanceClock = undefined
  spawnMock.mockReset().mockImplementation((_command: string, args: string[]) => {
    const outcome = outcomes.shift()!
    const checkpoint = checkpoints.shift()
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
      exitCode: null as number | null,
    })
    void Promise.resolve().then(async () => {
      advanceClock?.()
      if (outcome instanceof Error) child.stderr.write(outcome.message + '\n')
      else await writeFile(args[args.indexOf('--output') + 1]!, JSON.stringify(outcome))
      if (checkpoint) await writeFile(args[args.indexOf('--output') + 1]! + '.incumbent.json', JSON.stringify(checkpoint))
      child.exitCode = outcome instanceof Error ? 1 : 0
      child.stderr.end()
      child.emit('close', child.exitCode)
    })
    return child
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const solve = (options = {}) => runCpsatScheduler(sections, { sections: ['X'], edges: [] }, {}, {}, {
  workers: 2, seed: 7, portfolio: 2, timeLimitSeconds: 10, ...options,
})

describe('portfolio incumbent retention', () => {
  it.each([-1, NaN, Infinity])('rejects invalid time limit %s before starting search', async (timeLimitSeconds) => {
    await expect(solve({ portfolio: 0, timeLimitSeconds })).rejects.toThrow('finite non-negative')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('treats a zero-second budget as expired instead of unlimited', async () => {
    await expect(solve({ portfolio: 0, timeLimitSeconds: 0 })).rejects.toThrow('budget expired')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('does not start a child when startup consumes the remaining budget', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0)
      .mockReturnValue(2000)
    const instance: CpsatInstance = { num_weekdays: 5, saturday_index: 5,
      allow_saturday: false, preferred_parallel: 10, courses: [],
      conflict_edges: [], faculty_groups: [], students: [] }
    await expect(spawnCpsatSolve(instance, { timeLimitSeconds: 1 })).rejects.toThrow('budget expired')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('discards an illegal final assignment and returns the valid checkpoint', async () => {
    outcomes = [{ ...result(0, 0), slot_by_course: { X: 5 } }]
    checkpoints = [result(1, 6)]
    const answer = await solve({ portfolio: 0, allowSaturdayForMath: false })
    expect(answer.slot_by_course).toEqual({ X: 0 })
    expect(answer.red_students).toBe(1)
  })

  it('rejects incomplete checkpoints instead of accepting their better score', async () => {
    outcomes = [new Error('interrupted before a feasible assignment')]
    checkpoints = [{ ...result(0, 0), slot_by_course: {} }]
    await expect(solve({ portfolio: 0 })).rejects.toThrow(/no solution file/)
  })

  it('returns the RED-first race winner when the final search fails', async () => {
    outcomes = [result(1, 6), result(3, 5), new Error('forced final search failure')]
    const answer = await solve()
    expect(answer.red_students).toBe(1)
    expect(answer.total_clash_weight).toBe(6)
    expect(spawnMock.mock.calls.slice(0, 2).every(([, args]) => args.includes('--primary-only'))).toBe(true)
    expect(spawnMock.mock.calls[2]![1]).not.toContain('--primary-only')
  })

  it('keeps the winner when the final search returns a worse student count', async () => {
    outcomes = [result(1, 6), result(3, 5), result(2, 4)]
    expect((await solve()).red_students).toBe(1)
  })

  it('returns the incumbent without starting another search after the total budget expires', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    advanceClock = () => { now = 12_000 }
    outcomes = [result(1, 6), result(3, 5)]
    const answer = await solve()
    expect(answer.red_students).toBe(1)
    expect(spawnMock.mock.calls.length).toBeGreaterThan(0)
    expect(spawnMock.mock.calls.length).toBeLessThanOrEqual(2)
    for (const [, args] of spawnMock.mock.calls) {
      expect(Number(args[args.indexOf('--time-limit') + 1])).toBeLessThanOrEqual(5)
    }
  })

  it('fails promptly when the budget expires and no race member found a solution', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    advanceClock = () => { now = 12_000 }
    outcomes = [new Error('no incumbent'), new Error('no incumbent')]
    await expect(solve()).rejects.toThrow('budget expired without a portfolio incumbent')
    expect(spawnMock.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('honors cancellation even when a race winner is available', async () => {
    const controller = new AbortController()
    outcomes = [result(1, 6), result(3, 5)]
    await expect(solve({ signal: controller.signal, onProgress: (event: { phase?: string }) => {
      if (event.phase === 'portfolio_best') controller.abort()
    } })).rejects.toThrow(/cancel/i)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('kills a stuck bounded child and recovers its complete checkpoint', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    let ready!: () => void
    const checkpointReady = new Promise<void>((resolve) => { ready = resolve })
    let killed = false
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(),
        stderr: new PassThrough(), exitCode: null as number | null, kill: () => {
          killed = true
          child.exitCode = 1
          child.stderr.end()
          child.emit('close', 1)
          return true
        } })
      void writeFile(args[args.indexOf('--output') + 1]! + '.incumbent.json',
        JSON.stringify(result(0, 0))).then(ready)
      return child
    })
    const solving = solve({ portfolio: 0, timeLimitSeconds: 1 })
    await checkpointReady
    now = 1001
    await vi.advanceTimersByTimeAsync(1001)
    const answer = await solving
    expect(killed).toBe(true)
    expect(answer.slot_by_course).toEqual({ X: 0 })
    expect(answer.red_students).toBe(0)
    expect(answer.total_clash_weight).toBe(0)
    expect(answer.proven_optimal).toBe(false)
  })
})

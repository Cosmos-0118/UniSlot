import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import {
  PipelineCancelledError,
  throwIfAborted,
} from '../../src/modules/scheduling/pipeline/cancellation'
import {
  installCpsatExitGuard,
  killAllCpsatChildrenSync,
  killChildTreeSync,
  terminateChild,
  trackCpsatChild,
} from '../../src/modules/scheduling/solver/cpsatBridge'

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 40))
  }
  return predicate()
}

describe('pipeline cancellation helpers', () => {
  it('throws PipelineCancelledError when signal is aborted', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => throwIfAborted(controller.signal)).toThrow(PipelineCancelledError)
  })

  it('does not throw for an active signal', () => {
    const controller = new AbortController()
    expect(() => throwIfAborted(controller.signal)).not.toThrow()
  })
})

describe('terminateChild', () => {
  it(
    'stops a long-running child process',
    async () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
        detached: process.platform !== 'win32',
      })
      expect(child.pid).toBeTruthy()
      await terminateChild(child, 300)
      await new Promise((r) => setTimeout(r, 100))
      expect(child.exitCode != null || child.signalCode != null || child.killed).toBe(true)
    },
    10_000,
  )
})

describe('killChildTreeSync', () => {
  it(
    'SIGKILLs a detached child that swallowed SIGTERM after child.kill() set killed',
    async () => {
      if (process.platform === 'win32') return
      const child = spawn('sh', ['-c', "trap '' TERM; printf ready\\n; while true; do sleep 1; done"], {
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: true,
      })
      expect(child.pid).toBeTruthy()
      try {
        const ready = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), 3000)
          child.stdout?.once('data', () => {
            clearTimeout(t)
            resolve(true)
          })
        })
        expect(ready).toBe(true)
        child.kill('SIGTERM')
        expect(child.killed).toBe(true)
        await new Promise((r) => setTimeout(r, 120))
        expect(child.exitCode).toBeNull()
        expect(child.signalCode).toBeNull()
        killChildTreeSync(child)
        const died = await waitFor(
          () => child.exitCode != null || child.signalCode != null || !pidAlive(child.pid!),
          3000,
        )
        expect(died).toBe(true)
        expect(pidAlive(child.pid!)).toBe(false)
      } finally {
        if (child.pid && pidAlive(child.pid)) killChildTreeSync(child)
      }
    },
    10_000,
  )
})

describe('cpsat exit guard', () => {
  it('installs idempotently', () => {
    installCpsatExitGuard()
    installCpsatExitGuard()
  })

  it(
    'killAllCpsatChildrenSync reaps a tracked detached child (Clack process.exit path)',
    async () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
        detached: process.platform !== 'win32',
      })
      expect(child.pid).toBeTruthy()
      try {
        trackCpsatChild(child)
        await new Promise((r) => setTimeout(r, 50))
        expect(pidAlive(child.pid!)).toBe(true)
        killAllCpsatChildrenSync()
        const gone = await waitFor(
          () => child.exitCode != null || child.signalCode != null || !pidAlive(child.pid!),
          3000,
        )
        expect(gone).toBe(true)
        expect(pidAlive(child.pid!)).toBe(false)
      } finally {
        if (child.pid && pidAlive(child.pid)) killChildTreeSync(child)
      }
    },
    10_000,
  )
})

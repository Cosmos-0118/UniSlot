import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import {
  PipelineCancelledError,
  throwIfAborted,
} from '../../src/modules/scheduling/pipeline/cancellation'
import { terminateChild } from '../../src/modules/scheduling/solver/cpsatBridge'

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

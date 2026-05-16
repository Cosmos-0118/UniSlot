import { describe, expect, it } from 'vitest'
import { PipelineCancelledError, throwIfAborted } from '../../src/modules/scheduling/cancellation'

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

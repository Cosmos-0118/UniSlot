import { describe, expect, it, vi } from 'vitest'
import { createProgressThrottle } from '../../src/modules/scheduling/worker/progressThrottle'

describe('createProgressThrottle', () => {
  it('coalesces rapid schedule-stage updates', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const throttled = createProgressThrottle(emit, 100)

    throttled({ stage: 'schedule', message: 'a', fraction: 0.2 })
    throttled({ stage: 'schedule', message: 'b', fraction: 0.21 })
    throttled({ stage: 'schedule', message: 'c', fraction: 0.22 })

    expect(emit).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    expect(emit.mock.calls.length).toBeGreaterThanOrEqual(2)

    throttled({ stage: 'done', message: 'complete', fraction: 1 })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'done', fraction: 1 }),
    )

    vi.useRealTimers()
  })
})

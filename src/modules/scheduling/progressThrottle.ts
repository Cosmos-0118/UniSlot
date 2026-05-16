import type { PipelineProgressEvent } from './pipeline'

/** Limits worker→main progress posts (solver can emit hundreds per second). */
export function createProgressThrottle(
  emit: (event: PipelineProgressEvent) => void,
  minIntervalMs = 120,
): (event: PipelineProgressEvent) => void {
  let lastAt = 0
  let lastFraction: number | undefined
  let pending: PipelineProgressEvent | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (!pending) return
    const evt = pending
    pending = null
    lastAt = Date.now()
    lastFraction = evt.fraction
    emit(evt)
  }

  return (event: PipelineProgressEvent) => {
    const force =
      event.stage === 'done' ||
      event.stage === 'queued' ||
      event.stage === 'read' ||
      event.stage === 'parse' ||
      event.stage === 'preprocess' ||
      event.fraction === 1 ||
      event.fraction === 0

    if (force) {
      if (timer) clearTimeout(timer)
      pending = null
      lastAt = Date.now()
      lastFraction = event.fraction
      emit(event)
      return
    }

    const now = Date.now()
    const fractionMoved =
      event.fraction !== undefined &&
      lastFraction !== undefined &&
      Math.abs(event.fraction - lastFraction) >= 0.02

    if (now - lastAt >= minIntervalMs || fractionMoved) {
      if (timer) clearTimeout(timer)
      pending = null
      lastAt = now
      lastFraction = event.fraction
      emit(event)
      return
    }

    pending = event
    if (!timer) {
      timer = setTimeout(flush, minIntervalMs - (now - lastAt))
    }
  }
}

/** Thrown when a pipeline run is cancelled via {@link AbortSignal}. */
export class PipelineCancelledError extends Error {
  constructor(message = 'Scheduling run was cancelled') {
    super(message)
    this.name = 'PipelineCancelledError'
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PipelineCancelledError()
}

export function createAbortChecker(signal?: AbortSignal): () => void {
  return () => throwIfAborted(signal)
}

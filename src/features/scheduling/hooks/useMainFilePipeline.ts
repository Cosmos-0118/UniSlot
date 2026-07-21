import { useCallback } from 'react'
import type { SchedulingSnapshot } from '@/modules/scheduling/merge/snapshot'
import type { RunPipelineOptions } from '@/modules/scheduling/pipeline/run'
import { useUnislotWorker } from '@/features/scheduling/hooks/useUnislotWorker'

export function useMainFilePipeline() {
  const { run, fetchSchedulingSnapshot, progress, running } = useUnislotWorker()

  const processMainFile = useCallback(
    async (file: File, options?: RunPipelineOptions): Promise<SchedulingSnapshot> => {
      const result = await run(file, options)
      if (!result.validation.is_valid) {
        const first = result.validation.errors[0]?.message ?? 'Validation failed on the main workbook.'
        throw new Error(first)
      }
      if (result.schedulingSnapshot) return result.schedulingSnapshot
      if (result.hasDeferredSnapshot) return fetchSchedulingSnapshot()
      throw new Error('Could not build a schedule snapshot from this workbook.')
    },
    [run, fetchSchedulingSnapshot],
  )

  return { processMainFile, progress, running }
}

import type { ClashReport, EnrollmentRow, Schedule } from './types'
import type { SchedulingSnapshot } from './schedulingSnapshot'

export type WorkerRunArtifacts = {
  schedule: Schedule | null
  clashReport: ClashReport | null
  enrollmentRows: EnrollmentRow[] | null
  allowScheduleXlsx: boolean
}

let activeRunId: number | null = null
let activeAbort: AbortController | null = null
let cachedArtifacts: WorkerRunArtifacts | null = null
let cachedSnapshot: SchedulingSnapshot | null = null

export function beginWorkerRun(id: number): AbortSignal {
  activeAbort?.abort()
  activeRunId = id
  activeAbort = new AbortController()
  cachedArtifacts = null
  cachedSnapshot = null
  return activeAbort.signal
}

export function endWorkerRun(id: number): void {
  if (activeRunId !== id) return
  activeRunId = null
  activeAbort = null
}

export function cancelWorkerRun(id: number): boolean {
  if (activeRunId !== id) return false
  activeAbort?.abort()
  return true
}

export function isWorkerRunActive(id: number): boolean {
  return activeRunId === id
}

export function setWorkerRunArtifacts(artifacts: WorkerRunArtifacts): void {
  cachedArtifacts = artifacts
}

export function getWorkerRunArtifacts(): WorkerRunArtifacts | null {
  return cachedArtifacts
}

export function setWorkerRunSnapshot(snapshot: SchedulingSnapshot): void {
  cachedSnapshot = snapshot
}

export function getWorkerRunSnapshot(): SchedulingSnapshot | null {
  return cachedSnapshot
}

export function patchWorkerRunArtifacts(patch: Partial<WorkerRunArtifacts>): void {
  if (!cachedArtifacts) return
  cachedArtifacts = { ...cachedArtifacts, ...patch }
}

export function patchWorkerRunSnapshot(patch: Partial<SchedulingSnapshot>): void {
  if (!cachedSnapshot) return
  cachedSnapshot = { ...cachedSnapshot, ...patch }
}

import {
  cloneSchedulingSnapshot,
  type SchedulingSnapshot,
} from '@/modules/scheduling/merge/snapshot'

const STORAGE_KEY = 'unislot.savedRuns.v1'

export const SAVED_RUNS_CHANGED_EVENT = 'unislot-saved-runs-changed'

export type SavedScheduleRun = {
  id: string
  createdAt: string
  title: string
  sourceFileName: string | null
  snapshot: SchedulingSnapshot
}

export function loadSavedRuns(): SavedScheduleRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as SavedScheduleRun[]
    return Array.isArray(arr)
      ? arr.map((run) => ({ ...run, snapshot: cloneSchedulingSnapshot(run.snapshot) }))
      : []
  } catch {
    return []
  }
}

export function getSavedRun(id: string): SavedScheduleRun | null {
  return loadSavedRuns().find((r) => r.id === id) ?? null
}

export function createSavedRun(input: {
  title: string
  sourceFileName: string | null
  snapshot: SchedulingSnapshot
}): SavedScheduleRun {
  const run: SavedScheduleRun = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title: input.title,
    sourceFileName: input.sourceFileName,
    snapshot: cloneSchedulingSnapshot(input.snapshot),
  }
  const next = [run, ...loadSavedRuns()]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(SAVED_RUNS_CHANGED_EVENT))
  return run
}

export function updateSavedRunSnapshot(
  id: string,
  snapshot: SchedulingSnapshot,
  patch?: Partial<Pick<SavedScheduleRun, 'title' | 'sourceFileName'>>,
): SavedScheduleRun | null {
  const runs = loadSavedRuns()
  const i = runs.findIndex((r) => r.id === id)
  if (i < 0) return null
  const prev = runs[i]!
  runs[i] = { ...prev, ...patch, snapshot: cloneSchedulingSnapshot(snapshot) }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs))
  window.dispatchEvent(new Event(SAVED_RUNS_CHANGED_EVENT))
  return runs[i]!
}

export function deleteSavedRun(id: string): void {
  const next = loadSavedRuns().filter((r) => r.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(SAVED_RUNS_CHANGED_EVENT))
}

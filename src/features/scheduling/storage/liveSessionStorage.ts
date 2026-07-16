import type { PipelineOutput } from '@/features/scheduling/hooks/useUnislotWorker'

const DB_NAME = 'unislot.liveSession'
const DB_VERSION = 1
const STORE = 'session'
const RECORD_KEY = 'last'

export type LiveSessionRecord = {
  savedAt: string
  viewMode: 'actions' | 'details'
  fileName: string | null
  result: PipelineOutput
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('Failed to open live session DB'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
  })
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export async function loadLiveSession(): Promise<LiveSessionRecord | null> {
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const raw = await idbRequest(store.get(RECORD_KEY))
      if (!raw || typeof raw !== 'object') return null
      const rec = raw as LiveSessionRecord
      if (rec.viewMode !== 'actions' && rec.viewMode !== 'details') return null
      if (!rec.result) return null
      return rec
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

export async function saveLiveSession(record: LiveSessionRecord): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    await idbRequest(store.put(record, RECORD_KEY))
  } finally {
    db.close()
  }
}

export async function clearLiveSession(): Promise<void> {
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      await idbRequest(store.delete(RECORD_KEY))
    } finally {
      db.close()
    }
  } catch {
    // ignore — draft clear is best-effort
  }
}

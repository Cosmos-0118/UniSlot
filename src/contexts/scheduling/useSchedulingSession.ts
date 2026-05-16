import { useContext } from 'react'
import { SchedulingSessionContext } from './context'

export function useSchedulingSession() {
  const ctx = useContext(SchedulingSessionContext)
  if (!ctx) {
    throw new Error('useSchedulingSession must be used within SchedulingSessionProvider')
  }
  return ctx
}

import { useContext } from 'react'
import { BootGateContext } from '@/contexts/boot/BootGateContext'

export function useBootGate() {
  const ctx = useContext(BootGateContext)
  if (!ctx) {
    return {
      isBooting: false,
      signalLandingReady: () => {},
    }
  }
  return ctx
}

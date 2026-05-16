import { createContext } from 'react'

export type BootGateContextValue = {
  /** True while the landing boot overlay should block the page. */
  isBooting: boolean
  /** Called when the lazy landing route has mounted (still hidden under overlay). */
  signalLandingReady: () => void
}

export const BootGateContext = createContext<BootGateContextValue | null>(null)

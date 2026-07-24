import { RetroBootOverlay } from '@/components/ui/RetroBootOverlay'
import { BootGateContext } from '@/contexts/boot/BootGateContext'
import { isLandingPath, removeBootVeil } from '@/shared/boot/bootVeil'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

export function BootGateProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const onLanding = isLandingPath(pathname)

  const [isBooting, setIsBooting] = useState(onLanding)
  const [landingReady, setLandingReady] = useState(false)
  const [prevOnLanding, setPrevOnLanding] = useState(onLanding)

  // Adjust boot state when route enters/leaves landing (React "adjust state when prop changes").
  if (onLanding !== prevOnLanding) {
    setPrevOnLanding(onLanding)
    if (onLanding) {
      setIsBooting(true)
      setLandingReady(false)
    } else {
      setIsBooting(false)
    }
  }

  useEffect(() => {
    if (!onLanding) removeBootVeil()
  }, [onLanding])

  const signalLandingReady = useCallback(() => {
    setLandingReady((prev) => (prev ? prev : true))
  }, [])

  const completeBoot = useCallback(() => {
    setIsBooting(false)
  }, [])

  const value = useMemo(
    () => ({ isBooting: onLanding && isBooting, signalLandingReady }),
    [isBooting, onLanding, signalLandingReady],
  )

  return (
    <BootGateContext.Provider value={value}>
      {onLanding && isBooting ? (
        <RetroBootOverlay landingReady={landingReady} onComplete={completeBoot} />
      ) : null}
      {children}
    </BootGateContext.Provider>
  )
}

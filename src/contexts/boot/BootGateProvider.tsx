import { RetroBootOverlay } from '@/components/ui/RetroBootOverlay'
import { BootGateContext } from '@/contexts/boot/BootGateContext'
import { isLandingPath, removeBootVeil } from '@/shared/boot/bootVeil'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

export function BootGateProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const onLanding = isLandingPath(pathname)

  const [isBooting, setIsBooting] = useState(onLanding)
  const [landingReady, setLandingReady] = useState(false)
  const landingReadyRef = useRef(false)

  useEffect(() => {
    if (onLanding) {
      setIsBooting(true)
      setLandingReady(false)
      landingReadyRef.current = false
    } else {
      setIsBooting(false)
      removeBootVeil()
    }
  }, [onLanding])

  const signalLandingReady = useCallback(() => {
    if (landingReadyRef.current) return
    landingReadyRef.current = true
    setLandingReady(true)
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

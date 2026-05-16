import { LoadingOverlay, LOADING_OVERLAY_EXIT_MS } from '@/components/ui/LoadingOverlay'
import { removeBootVeil } from '@/shared/boot/bootVeil'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

function doubleRaf(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

function waitForLandingReady(
  isReady: () => boolean,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    if (isReady()) {
      resolve()
      return
    }
    const started = performance.now()
    const tick = () => {
      if (isReady() || performance.now() - started >= timeoutMs) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

type Props = {
  landingReady: boolean
  onComplete: () => void
}

export function RetroBootOverlay({ landingReady, onComplete }: Props) {
  const [visible, setVisible] = useState(true)
  const [mounted, setMounted] = useState(true)
  const landingReadyRef = useRef(landingReady)
  const finishedRef = useRef(false)
  landingReadyRef.current = landingReady

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    removeBootVeil()
    setMounted(false)
    onComplete()
  }, [onComplete])

  useLayoutEffect(() => {
    removeBootVeil()
  }, [])

  useEffect(() => {
    if (visible) return
    const fallback = window.setTimeout(finish, LOADING_OVERLAY_EXIT_MS + 120)
    return () => window.clearTimeout(fallback)
  }, [visible, finish])

  useEffect(() => {
    let cancelled = false
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const minMs = reduceMotion ? 120 : 720
    const capMs = 3600
    const t0 = performance.now()

    const waitMin = async () => {
      const elapsed = performance.now() - t0
      const rest = Math.max(0, minMs - elapsed)
      if (rest > 0) await new Promise<void>((r) => setTimeout(r, rest))
    }

    const run = async () => {
      const loadPromise = new Promise<void>((resolve) => {
        if (document.readyState === 'complete') {
          queueMicrotask(resolve)
          return
        }
        window.addEventListener('load', () => resolve(), { once: true })
      })

      const fontsPromise =
        document.fonts && typeof document.fonts.ready?.then === 'function'
          ? document.fonts.ready.catch(() => {})
          : Promise.resolve()

      const landingPromise = waitForLandingReady(() => landingReadyRef.current, capMs)

      try {
        await Promise.race([
          Promise.all([loadPromise, fontsPromise, landingPromise]),
          new Promise<void>((resolve) => setTimeout(resolve, capMs)),
        ])
      } catch {
        // Continue to fade phase even if readiness checks fail
      }

      if (cancelled) return
      await doubleRaf()
      await waitMin()
      if (cancelled) return
      setVisible(false)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  if (!mounted) return null

  return (
    <LoadingOverlay
      visible={visible}
      enterMode="instant"
      message="Preparing your workspace"
      onExitComplete={finish}
    />
  )
}

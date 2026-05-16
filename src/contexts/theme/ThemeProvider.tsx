import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ThemeContext, type Theme } from './theme-context'

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => {
    finished: Promise<void>
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('unislot-theme') as Theme
    return saved || 'dark'
  })
  const transitionTimerRef = useRef<number | null>(null)

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
  }, [])

  const setTheme = useCallback(
    (nextTheme: Theme) => {
      if (nextTheme === theme) return

      const root = window.document.documentElement
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const applyTheme = () => setThemeState(nextTheme)

      clearTransitionTimer()
      root.classList.add('theme-changing')

      const finishTransition = () => {
        clearTransitionTimer()
        transitionTimerRef.current = window.setTimeout(() => {
          root.classList.remove('theme-changing')
          transitionTimerRef.current = null
        }, reduceMotion ? 0 : 360)
      }

      if (!reduceMotion) {
        const viewTransition = (window.document as ViewTransitionDocument).startViewTransition?.(applyTheme)
        if (viewTransition) {
          viewTransition.finished.finally(finishTransition)
          return
        }
      }

      applyTheme()
      finishTransition()
    },
    [clearTransitionTimer, theme],
  )

  useEffect(() => {
    const root = window.document.documentElement
    root.setAttribute('data-theme', theme)
    localStorage.setItem('unislot-theme', theme)
  }, [theme])

  useEffect(() => {
    return () => {
      clearTransitionTimer()
      window.document.documentElement.classList.remove('theme-changing')
    }
  }, [clearTransitionTimer])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

import { useTheme as useNextTheme } from 'next-themes'
import { useCallback, useSyncExternalStore } from 'react'
import { applyThemeTransition, type ThemeTransitionSource } from './applyThemeTransition'
import type { Theme } from './context'

export type { ThemeTransitionSource }

const emptySubscribe = () => () => {}

export function useTheme() {
  const { theme, setTheme: setNextTheme, resolvedTheme } = useNextTheme()
  // Client-only mount gate without setState-in-effect (avoids hydration flash).
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  const setTheme = useCallback(
    (next: Theme, source: ThemeTransitionSource = 'center') => {
      if (!setNextTheme) return
      const current = (resolvedTheme ?? theme ?? 'dark') as Theme
      if (next === current) return
      applyThemeTransition(current, next, () => setNextTheme(next), source)
    },
    [setNextTheme, resolvedTheme, theme],
  )

  const active = (mounted ? (resolvedTheme ?? theme) : 'dark') as Theme

  return { theme: active, setTheme, mounted }
}

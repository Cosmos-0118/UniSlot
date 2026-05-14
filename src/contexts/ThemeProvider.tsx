import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ThemeContext, type Theme } from './theme-context'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('unislot-theme') as Theme
    return saved || 'dark'
  })

  useEffect(() => {
    const root = window.document.documentElement
    root.setAttribute('data-theme', theme)
    localStorage.setItem('unislot-theme', theme)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

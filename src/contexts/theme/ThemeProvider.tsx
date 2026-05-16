import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ReactNode } from 'react'
import type { Theme } from './context'

const THEMES: Theme[] = ['light', 'dark', 'crimson']

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      themes={THEMES}
      storageKey="unislot-theme"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}

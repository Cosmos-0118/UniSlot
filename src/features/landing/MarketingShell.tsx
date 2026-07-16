import { AppLogo } from '@/components/brand/AppLogo'
import { CubesBackground } from '@/components/ui/CubesBackground'
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher'
import { useTheme } from '@/contexts/theme/useTheme'
import { cn } from '@/shared/utils/cn'
import { motion } from 'framer-motion'
import { useLayoutEffect, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

/** Shared glass surface used on marketing pages. */
export const glassPanelSurface =
  'relative rounded-[1.75rem] border border-white/[0.14] bg-[color-mix(in_srgb,var(--bg)_14%,transparent)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_8px_32px_-12px_rgba(0,0,0,0.38)] backdrop-blur-2xl ring-1 ring-white/[0.06] md:rounded-[2rem]'

type MarketingShellProps = {
  children: ReactNode
  /** Optional class on the scrollable main region. */
  mainClassName?: string
}

/**
 * Marketing chrome matching the landing page: cubes backdrop, blurred nav,
 * theme switcher (no light), and Get Started CTA.
 */
export function MarketingShell({ children, mainClassName }: MarketingShellProps) {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()

  useLayoutEffect(() => {
    if (theme === 'light') {
      setTheme('dark')
    }
  }, [theme, setTheme])

  return (
    <div className="app-shell relative flex min-h-[100dvh] flex-col overflow-x-hidden overflow-y-auto text-text">
      <CubesBackground />

      <nav className="fixed left-0 top-0 z-50 flex w-full justify-center border-b border-white/[0.05] bg-[color-mix(in_srgb,var(--bg)_8%,transparent)] backdrop-blur-md px-6 py-3">
        <div className="flex w-full items-center justify-between gap-4">
          <Link
            to="/"
            className="theme-focusable flex min-w-0 items-center gap-2.5 rounded-lg text-lg font-bold tracking-wide outline-offset-4"
          >
            <AppLogo size="nav" />
            <span className="text-text mt-0.5">UniSlot</span>
          </Link>
          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            <ThemeSwitcher
              layout="toolbar"
              variant="popover"
              hideLight
              className="[&>button]:border-white/10 [&>button]:bg-white/[0.06] [&>button]:shadow-none [&>button]:backdrop-blur-sm [&>button]:hover:bg-white/[0.12]"
            />
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate('/app')}
              className="theme-btn-primary theme-focusable rounded-xl px-4 py-2.5 text-sm font-semibold sm:px-5"
            >
              Get Started
            </motion.button>
          </div>
        </div>
      </nav>

      <main
        className={cn(
          'relative z-10 flex w-full flex-1 flex-col px-6 pb-16 pt-24 md:px-8 md:pb-20 md:pt-28',
          mainClassName,
        )}
      >
        {children}
      </main>
    </div>
  )
}

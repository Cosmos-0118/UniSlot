import { AppLogo } from '@/components/brand/AppLogo'
import { ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Variants } from 'framer-motion'
import { useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CubesBackground } from '@/components/ui/CubesBackground'
import { RetroBootOverlay } from '@/components/ui/RetroBootOverlay'
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher'
import { useTheme } from '@/contexts/useTheme'
import { cn } from '@/shared/utils/cn'

/**
 * Glass surface — no overflow clip here (text must not be cropped).
 * Opacity must stay off parent entrance animations: animating opacity on a Framer
 * ancestor breaks backdrop-filter compositing (brief “glass” then flat grey).
 */
const glassPanelSurface =
  'relative rounded-[1.75rem] border border-white/[0.14] bg-[color-mix(in_srgb,var(--bg)_14%,transparent)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_8px_32px_-12px_rgba(0,0,0,0.38)] backdrop-blur-2xl ring-1 ring-white/[0.06] md:rounded-[2rem]'

const glassHoverClass =
  'transition-[box-shadow,border-color] duration-500 hover:border-brand-400/30 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_24px_64px_-16px_color-mix(in_srgb,var(--brand-500)_28%,transparent),0_12px_40px_-18px_rgba(0,0,0,0.55)]'

const hoverSpring = { type: 'spring' as const, stiffness: 420, damping: 26, mass: 0.85 }

/** Fluid size: stays readable, fits typical card widths; vmin helps short viewports. */
const heroTitleSize =
  'text-[clamp(1.05rem,calc(0.72rem+3.2vmin),2.35rem)] sm:text-[clamp(1.1rem,calc(0.7rem+2.8vw),2.5rem)] md:text-[clamp(1.2rem,calc(0.65rem+2.4vw),2.75rem)]'

export function LandingPage() {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const reduceMotion = useReducedMotion()

  const cardHover = reduceMotion
    ? undefined
    : {
        y: -10,
        rotateX: 4,
        translateZ: 28,
        transition: hoverSpring,
      }

  const cardHoverSubtle = reduceMotion
    ? undefined
    : {
        y: -10,
        rotateX: 3.5,
        translateZ: 22,
        transition: hoverSpring,
      }

  /** Light is hidden on marketing; normalize if user chose it in the app then returned here. */
  useLayoutEffect(() => {
    if (theme === 'light') {
      setTheme('dark')
    }
  }, [theme, setTheme])
  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.1, delayChildren: 0.12 },
    },
  }

  const itemVariants: Variants = {
    hidden: { y: 22 },
    visible: {
      y: 0,
      transition: { type: 'spring', stiffness: 95, damping: 20, mass: 0.85 },
    },
  }

  return (
    <div
      className="app-shell relative flex min-h-[100dvh] flex-col overflow-x-hidden overflow-y-auto text-text select-none touch-callout-none"
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
    >
      <RetroBootOverlay />
      <CubesBackground />

      <nav className="relative z-30 flex w-full justify-center px-6 py-6">
        <div className="flex w-full max-w-5xl items-center justify-between gap-4">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="flex min-w-0 items-center gap-3 text-2xl font-bold tracking-wide"
          >
            <AppLogo size="hero" />
            <span className="text-text">UniSlot</span>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="flex shrink-0 items-center gap-3 sm:gap-4"
          >
            <ThemeSwitcher layout="toolbar" variant="popover" hideLight />
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate('/app')}
              className="theme-btn-primary theme-focusable rounded-xl px-4 py-2.5 text-sm font-semibold sm:px-5"
            >
              Get Started
            </motion.button>
          </motion.div>
        </div>
      </nav>

      <main className="pointer-events-none relative z-10 flex w-full flex-1 flex-col items-center justify-center px-6 pb-20 pt-4 md:px-8 md:pb-28 md:pt-8">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="pointer-events-auto flex w-full min-w-0 max-w-5xl flex-col items-center justify-center text-center"
        >
          <motion.div variants={itemVariants} className="w-full min-w-0 max-w-full [perspective:1200px]">
            <motion.div
              whileHover={cardHover}
              style={{ transformStyle: 'preserve-3d' }}
              className={cn('group', glassPanelSurface, glassHoverClass)}
            >
              <div
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
                aria-hidden
              >
                <div className="absolute -left-[40%] top-0 h-full w-[45%] skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/18 to-transparent opacity-0 transition duration-700 ease-out group-hover:translate-x-[280%] group-hover:opacity-100" />
              </div>
              <div className="relative z-10 w-full min-w-0 px-5 py-7 md:px-9 md:py-9">
                <h1
                  className={cn(
                    'mx-auto flex w-full min-w-0 max-w-full flex-wrap items-baseline justify-center gap-x-2 gap-y-2 text-center font-extrabold leading-snug tracking-tight',
                    heroTitleSize
                  )}
                >
                  <span className="max-w-full whitespace-nowrap text-text [text-shadow:0_1px_2px_rgba(0,0,0,0.88),0_4px_28px_rgba(0,0,0,0.42)]">
                    Schedule with
                  </span>
                  <span className="max-w-full whitespace-nowrap bg-gradient-to-r from-brand-200 via-brand-400 to-brand-500 bg-clip-text pb-0.5 text-transparent [filter:drop-shadow(0_2px_14px_rgba(0,0,0,0.65))_drop-shadow(0_0_1px_rgba(0,0,0,0.55))]">
                    Absolute Confidence.
                  </span>
                </h1>
              </div>
            </motion.div>
          </motion.div>

          <motion.div variants={itemVariants} className="w-full min-w-0 max-w-2xl [perspective:1200px]">
            <motion.div
              whileHover={cardHoverSubtle}
              whileTap={{ scale: 0.992 }}
              style={{ transformStyle: 'preserve-3d' }}
              className={cn(
                'group mx-auto mt-8 md:mt-10',
                glassPanelSurface,
                glassHoverClass,
                'rounded-2xl border-white/[0.1] md:rounded-2xl'
              )}
            >
              <div
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
                aria-hidden
              >
                <div className="absolute -left-[40%] top-0 h-full w-[45%] skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/14 to-transparent opacity-0 transition duration-700 ease-out group-hover:translate-x-[280%] group-hover:opacity-100" />
              </div>
              <p className="relative z-10 px-5 py-5 text-balance text-lg leading-relaxed text-text md:px-7 md:py-6 md:text-xl">
                Process large enrollment workbooks, surface clashes quickly, and build high-quality evening timetables
                locally in your browser with transparent exports.
              </p>
            </motion.div>
          </motion.div>

          <motion.div variants={itemVariants} className="mx-auto mt-10 flex w-full max-w-md justify-center sm:mt-12">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/app')}
              className="theme-btn-primary theme-focusable flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-4 text-lg font-semibold sm:w-auto sm:min-w-[220px]"
            >
              Get Started <ArrowRight className="size-5" />
            </motion.button>
          </motion.div>
        </motion.div>
      </main>
    </div>
  )
}

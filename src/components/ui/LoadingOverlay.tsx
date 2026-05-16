import { AppLogo } from '@/components/brand/AppLogo'
import { removeBootVeil } from '@/shared/boot/bootVeil'
import { cn } from '@/shared/utils/cn'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useLayoutEffect } from 'react'

const EASE_OUT = [0.22, 1, 0.36, 1] as const
const EXIT_MS = 480

export type LoadingOverlayProps = {
  /** When false, plays exit animation then calls `onExitComplete`. */
  visible: boolean
  onExitComplete?: () => void
  message?: string
  className?: string
  /**
   * `instant` — opaque on first paint (boot). `fade` — gentle fade-in for in-app use.
   * @default 'fade'
   */
  enterMode?: 'fade' | 'instant'
}

function OrbitalRings({ reduced }: { reduced: boolean }) {
  if (reduced) {
    return (
      <span
        className="absolute inset-0 rounded-full border border-brand-500/35"
        aria-hidden
      />
    )
  }

  return (
    <>
      <motion.span
        className="absolute inset-0 rounded-full border border-brand-500/20"
        aria-hidden
        animate={{ rotate: 360 }}
        transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
      />
      <motion.span
        className="absolute -inset-2 rounded-full border border-transparent border-t-brand-400/55 border-r-brand-400/20"
        aria-hidden
        animate={{ rotate: -360 }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }}
      />
      <motion.span
        className="absolute -inset-4 rounded-full border border-transparent border-b-brand-300/40 border-l-brand-500/25"
        aria-hidden
        animate={{ rotate: 360 }}
        transition={{ duration: 7.25, repeat: Infinity, ease: 'linear' }}
      />
    </>
  )
}

function LoadingDots({ reduced }: { reduced: boolean }) {
  if (reduced) {
    return <span className="size-1.5 rounded-full bg-brand-400" aria-hidden />
  }

  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-brand-400 shadow-[0_0_10px_color-mix(in_srgb,var(--brand-400)_70%,transparent)]"
          animate={{ opacity: [0.35, 1, 0.35], scale: [0.85, 1.1, 0.85] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.16,
          }}
        />
      ))}
    </span>
  )
}

export function LoadingOverlay({
  visible,
  onExitComplete,
  message = 'Preparing your workspace',
  className,
  enterMode = 'fade',
}: LoadingOverlayProps) {
  const reduced = useReducedMotion() ?? false
  const fadeDuration = reduced ? 0.12 : 0.42
  const instantEnter = enterMode === 'instant'

  useLayoutEffect(() => {
    if (visible && instantEnter) removeBootVeil()
  }, [visible, instantEnter])

  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {visible ? (
        <motion.div
          key="loading-overlay"
          role="status"
          aria-live="polite"
          aria-busy="true"
          className={cn(
            'fixed inset-0 z-[200] flex items-center justify-center bg-[var(--bg)] px-6',
            className,
          )}
          initial={instantEnter ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: fadeDuration, ease: EASE_OUT }}
        >
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.12 }}
            exit={{ opacity: 0 }}
            transition={{ duration: fadeDuration * 1.2, ease: EASE_OUT }}
            style={{
              backgroundImage: `
                linear-gradient(color-mix(in srgb, var(--brand-500) 40%, transparent) 1px, transparent 1px),
                linear-gradient(90deg, color-mix(in srgb, var(--brand-500) 40%, transparent) 1px, transparent 1px)
              `,
              backgroundSize: '18px 18px',
            }}
            aria-hidden
          />

          <motion.div
            className="pointer-events-none absolute left-1/2 top-1/2 size-[min(72vw,22rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--brand-500)_22%,transparent)_0%,transparent_68%)]"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={
              reduced
                ? { opacity: 0.5, scale: 1 }
                : { opacity: [0.35, 0.55, 0.35], scale: [0.95, 1.08, 0.95] }
            }
            exit={{ opacity: 0, scale: 0.9 }}
            transition={
              reduced
                ? { duration: fadeDuration, ease: EASE_OUT }
                : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }
            }
            aria-hidden
          />

          <motion.div
            className="relative z-10 flex flex-col items-center gap-6 text-center"
            initial={instantEnter ? false : { opacity: 0, y: reduced ? 0 : 10, scale: reduced ? 1 : 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -6, scale: 0.98 }}
            transition={{
              duration: reduced ? fadeDuration : instantEnter ? 0.35 : 0.55,
              ease: EASE_OUT,
              delay: reduced || instantEnter ? 0 : 0.06,
            }}
          >
            <motion.div
              className="relative flex size-24 items-center justify-center sm:size-28"
              initial={instantEnter ? false : { opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{
                duration: instantEnter ? 0.35 : 0.5,
                ease: EASE_OUT,
                delay: reduced || instantEnter ? 0 : 0.1,
              }}
            >
              <OrbitalRings reduced={reduced} />
              <motion.div
                className="relative z-10 rounded-[1.35rem] border border-white/[0.1] bg-[color-mix(in_srgb,var(--bg)_40%,transparent)] p-3 shadow-[0_0_40px_-8px_color-mix(in_srgb,var(--brand-500)_50%,transparent),inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-sm"
                animate={reduced ? undefined : { y: [0, -2, 0] }}
                transition={
                  reduced ? undefined : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
                }
              >
                <AppLogo
                  size="md"
                  className="ring-1 ring-[color-mix(in_srgb,var(--brand-400)_35%,transparent)]"
                />
              </motion.div>
            </motion.div>

            <motion.div
              className="flex flex-col items-center gap-3"
              initial={instantEnter ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.4,
                ease: EASE_OUT,
                delay: reduced || instantEnter ? 0 : 0.18,
              }}
            >
              <p className="bg-gradient-to-r from-brand-200 via-brand-400 to-brand-500 bg-clip-text text-lg font-semibold tracking-tight text-transparent sm:text-xl">
                UniSlot
              </p>
              <motion.div className="flex items-center gap-2.5">
                <LoadingDots reduced={reduced} />
                <p className="text-sm text-[var(--text-muted)]">{message}</p>
              </motion.div>
            </motion.div>

            <motion.div
              className="h-0.5 w-36 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] sm:w-44"
              aria-hidden
              initial={instantEnter ? false : { opacity: 0, scaleX: 0.6 }}
              animate={{ opacity: 1, scaleX: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.45,
                ease: EASE_OUT,
                delay: reduced || instantEnter ? 0 : 0.22,
              }}
            >
              <motion.div
                className="h-full w-1/3 rounded-full bg-gradient-to-r from-[var(--term-bar-from)] via-[var(--term-bar-via)] to-[var(--term-bar-from)] shadow-[0_0_14px_var(--term-bar-glow)]"
                animate={
                  reduced
                    ? { x: '120%' }
                    : { x: ['-30%', '220%'] }
                }
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 1.35, repeat: Infinity, ease: 'easeInOut' }
                }
              />
            </motion.div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** Exit animation length in ms — keep in sync with fade duration + buffer. */
export const LOADING_OVERLAY_EXIT_MS = EXIT_MS

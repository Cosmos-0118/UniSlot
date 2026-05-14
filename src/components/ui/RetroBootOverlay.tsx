import { AppLogo } from '@/components/brand/AppLogo'
import { cn } from '@/shared/utils/cn'
import { useEffect, useState } from 'react'

function doubleRaf(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

export function RetroBootOverlay() {
  const [phase, setPhase] = useState<'show' | 'fade' | 'done'>('show')

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

      try {
        await Promise.race([
          Promise.all([loadPromise, fontsPromise]),
          new Promise<void>((resolve) => setTimeout(resolve, capMs)),
        ])
      } finally {
        if (cancelled) return
        await doubleRaf()
        await waitMin()
        if (cancelled) return
        setPhase('fade')
        window.setTimeout(() => {
          if (!cancelled) setPhase('done')
        }, 480)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  if (phase === 'done') return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-[var(--bg)] px-6 transition-opacity duration-[480ms] ease-out',
        phase === 'fade' ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
      aria-busy={phase === 'show'}
      aria-hidden={phase === 'fade'}
    >
      {/* subtle cube-ish grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: `
            linear-gradient(color-mix(in srgb, var(--brand-500) 35%, transparent) 1px, transparent 1px),
            linear-gradient(90deg, color-mix(in srgb, var(--brand-500) 35%, transparent) 1px, transparent 1px)
          `,
          backgroundSize: '14px 14px',
        }}
        aria-hidden
      />
      {/* CRT scanlines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.22]"
        style={{
          background:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 3px)',
        }}
        aria-hidden
      />

      <div className="relative z-10 flex flex-col items-center gap-5 text-center">
        <div
          className="rounded-[1.35rem] border border-white/[0.12] bg-[color-mix(in_srgb,var(--bg)_32%,transparent)] px-6 py-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_12px_48px_-20px_rgba(0,0,0,0.55)] backdrop-blur-md ring-1 ring-white/[0.05]"
          style={{ transform: 'translateZ(0)' }}
        >
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
            <AppLogo size="md" className="ring-1 ring-[color-mix(in_srgb,var(--brand-400)_40%,transparent)] shadow-[0_0_24px_-4px_color-mix(in_srgb,var(--brand-500)_45%,transparent)]" />
            <div className="text-left">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.35em] text-[var(--text-muted)]">
                System
              </p>
              <p className="mt-1 bg-gradient-to-r from-brand-200 via-brand-400 to-brand-500 bg-clip-text font-semibold tracking-wide text-transparent">
                UniSlot
              </p>
              <p className="mt-2 font-mono text-xs text-[var(--text-muted)]">Initializing interface…</p>
            </div>
          </div>

          <div
            className="mt-5 h-1.5 overflow-hidden rounded-full border border-[var(--term-progress-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_55%,transparent)]"
            aria-hidden
          >
            <div className="retro-boot-shimmer h-full w-full origin-left bg-gradient-to-r from-[var(--term-bar-from)] via-[var(--term-bar-via)] to-[var(--term-bar-from)]" />
          </div>
        </div>

        <p className="font-mono text-[11px] tracking-[0.2em] text-[var(--text-muted)] [text-shadow:0_0_12px_color-mix(in_srgb,var(--brand-400)_25%,transparent)]">
          <span className="inline-block animate-pulse">█</span>
          {' LOADING '}
          <span className="inline-block animate-pulse">█</span>
        </p>
      </div>

      <style>{`
        @keyframes retro-boot-shimmer {
          0% { transform: scaleX(0.18) translateX(-12%); opacity: 0.85; }
          50% { transform: scaleX(0.72) translateX(18%); opacity: 1; }
          100% { transform: scaleX(0.22) translateX(120%); opacity: 0.75; }
        }
        .retro-boot-shimmer {
          animation: retro-boot-shimmer 1.35s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .retro-boot-shimmer {
            animation: none;
            transform: scaleX(0.55);
            opacity: 0.9;
          }
        }
      `}</style>
    </div>
  )
}

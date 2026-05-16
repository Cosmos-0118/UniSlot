import { Droplet, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '@/contexts/theme/useTheme'
import { cn } from '@/shared/utils/cn'

type ThemeSwitcherProps = {
  /** `toolbar` — compact horizontal row for marketing nav. `sidebar` — grid like app sidebar. */
  layout?: 'toolbar' | 'sidebar'
  /** Landing: one icon button; panel opens on press until dismissed. */
  variant?: 'open' | 'popover'
  /** Omit Light (e.g. marketing page where light theme is unsupported visually). */
  hideLight?: boolean
  className?: string
}

export function ThemeSwitcher({
  layout = 'sidebar',
  variant = 'open',
  hideLight = false,
  className,
}: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setPopoverOpen(false), [])

  useEffect(() => {
    if (!popoverOpen || variant !== 'popover') return
    /** Use `click` so theme buttons receive full mousedown→click before we evaluate outside. */
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('click', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [popoverOpen, variant, close])

  const panel = (
    <div
      className={cn(
        layout === 'toolbar'
          ? 'theme-theme-toggle flex flex-row gap-1 rounded-2xl p-1.5'
          : cn(
              'theme-theme-toggle grid gap-1.5 rounded-2xl p-1.5',
              hideLight ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'
            )
      )}
    >
      {!hideLight ? (
        <ThemeButton
          icon={Sun}
          label="Light"
          isActive={theme === 'light'}
          onClick={() => {
            setTheme('light')
            if (variant === 'popover') close()
          }}
          compact={layout === 'toolbar'}
        />
      ) : null}
      <ThemeButton
        icon={Moon}
        label="Dark"
        isActive={theme === 'dark'}
        onClick={() => {
          setTheme('dark')
          if (variant === 'popover') close()
        }}
        compact={layout === 'toolbar'}
      />
      <ThemeButton
        icon={Droplet}
        label="Crimson"
        isActive={theme === 'crimson'}
        onClick={() => {
          setTheme('crimson')
          if (variant === 'popover') close()
        }}
        compact={layout === 'toolbar'}
      />
    </div>
  )

  if (variant === 'popover') {
    const TriggerIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Droplet
    return (
      <div ref={rootRef} className={cn('relative', className)}>
        <button
          type="button"
          onClick={() => setPopoverOpen((o) => !o)}
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
          aria-label="Choose theme"
          className="theme-theme-button theme-focusable flex size-10 items-center justify-center rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)] shadow-sm backdrop-blur-md transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_88%,var(--brand-500)_8%)]"
        >
          <TriggerIcon className="size-[18px]" />
        </button>
        {popoverOpen ? (
          <div
            role="dialog"
            aria-label="Theme"
            className="theme-muted-surface absolute right-0 top-[calc(100%+10px)] z-[120] min-w-[220px] rounded-2xl p-2 shadow-xl ring-1 ring-border/50"
          >
            <div className="mb-2 px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-text-muted">Theme</div>
            {panel}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('theme-muted-surface rounded-2xl p-2', className)}>
      <div
        className={cn(
          'mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-text-muted',
          layout === 'toolbar' ? 'hidden sm:block px-0.5' : 'mb-2 hidden px-2 md:block'
        )}
      >
        Theme
      </div>
      {panel}
    </div>
  )
}

function ThemeButton({
  icon: Icon,
  label,
  isActive,
  onClick,
  compact,
}: {
  icon: LucideIcon
  label: string
  isActive: boolean
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'theme-theme-button theme-focusable flex items-center justify-center gap-2 rounded-xl px-2 py-2.5',
        compact
          ? 'min-h-9 flex-1 flex-col gap-0.5 py-2 sm:min-h-[40px] sm:flex-row sm:gap-2 sm:py-2.5'
          : 'md:flex-col md:gap-1',
        isActive && 'theme-theme-button-active'
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span
        className={cn(
          'text-[11px] font-semibold tracking-wide',
          compact ? 'hidden sm:inline' : 'hidden md:block'
        )}
      >
        {label}
      </span>
    </button>
  )
}

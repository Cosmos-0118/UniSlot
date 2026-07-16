import { Droplet, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '@/contexts/theme/useTheme'
import { cn } from '@/shared/utils/cn'

type ThemeSwitcherProps = {
  layout?: 'toolbar' | 'sidebar'
  variant?: 'open' | 'popover'
  hideLight?: boolean
  className?: string
}

const themeOptions = [
  { id: 'light' as const, icon: Sun, label: 'Light' },
  { id: 'dark' as const, icon: Moon, label: 'Dark' },
  { id: 'crimson' as const, icon: Droplet, label: 'Crimson' },
]

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

  const visibleOptions = hideLight ? themeOptions.filter((o) => o.id !== 'light') : themeOptions
  const activeOption = themeOptions.find((o) => o.id === theme) ?? themeOptions[1]
  const TriggerIcon = activeOption.icon

  useEffect(() => {
    if (!popoverOpen || variant !== 'popover') return
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

  const pickTheme = (id: (typeof themeOptions)[number]['id'], e: React.MouseEvent) => {
    setTheme(id, { clientX: e.clientX, clientY: e.clientY })
    if (variant === 'popover') close()
  }

  const panel = (
    <div
      className={cn(
        'theme-theme-toggle relative',
        layout === 'toolbar'
          ? 'grid grid-cols-2 gap-2 rounded-2xl p-1.5'
          : cn(
              'grid gap-2 rounded-2xl p-1.5',
              hideLight ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'
            )
      )}
    >
      {visibleOptions.map((option) => (
        <ThemeButton
          key={option.id}
          icon={option.icon}
          label={option.label}
          isActive={theme === option.id}
          onClick={(e) => pickTheme(option.id, e)}
          compact={layout === 'toolbar'}
        />
      ))}
    </div>
  )

  if (variant === 'popover') {
    return (
      <div ref={rootRef} className={cn('relative', className)}>
        <button
          type="button"
          onClick={() => setPopoverOpen((o) => !o)}
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
          aria-label="Choose theme"
          className="theme-theme-button theme-focusable flex size-10 items-center justify-center rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)] shadow-sm backdrop-blur-md transition-[background-color,color] duration-200 hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_88%,transparent)]"
        >
          <TriggerIcon key={theme} className="size-[18px]" />
        </button>
        {popoverOpen ? (
          <div
            role="dialog"
            aria-label="Theme"
            className="theme-theme-popover theme-popover-in absolute right-0 top-[calc(100%+10px)] z-[120] min-w-[280px] rounded-3xl p-3 shadow-2xl"
          >
            <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-text">
              Theme
            </div>
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
          layout === 'toolbar' ? 'hidden px-0.5 sm:block' : 'mb-2 hidden px-2 md:block'
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
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'theme-theme-button theme-focusable relative flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 transition-[color,transform] duration-200 active:scale-[0.97]',
        compact
          ? 'min-h-[44px] min-w-[7rem] flex-row'
          : 'md:flex-col md:gap-1',
        isActive && 'theme-theme-button-active'
      )}
    >
      <Icon className="size-4.5 shrink-0" />
      <span
        className={cn(
          'text-xs font-bold tracking-wide',
          compact ? 'inline' : 'hidden md:block'
        )}
      >
        {label}
      </span>
    </button>
  )
}

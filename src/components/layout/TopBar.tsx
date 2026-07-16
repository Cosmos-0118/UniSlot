import { AppLogo } from '@/components/brand/AppLogo'
import { cn } from '@/shared/utils/cn'
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher'
import { useSchedulingSession } from '@/contexts/scheduling/useSchedulingSession'
import { Calendar, CheckCircle2, Library, Settings, Zap, Mail } from 'lucide-react'

interface TopBarProps {
  activeFeature: string
  setActiveFeature: (feature: string) => void
  onLogoClick: () => void
}

export function TopBar({ activeFeature, setActiveFeature, onLogoClick }: TopBarProps) {
  const { viewMode, running, progress, displayEtaSeconds, backgroundThrottled, result } =
    useSchedulingSession()

  const features = [
    { id: 'scheduler', label: 'Scheduler', icon: Calendar },
    { id: 'runs', label: 'Saved runs', icon: Library },
    { id: 'emails', label: 'Emails', icon: Mail },
    { id: 'insights', label: 'Insights', icon: Zap },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  const showRunning = running || viewMode === 'processing'
  const showReady =
    !showRunning &&
    (viewMode === 'actions' || viewMode === 'details') &&
    result != null &&
    activeFeature !== 'scheduler'

  const frac = progress?.fraction
  const pct =
    frac != null && Number.isFinite(frac)
      ? Math.round(Math.max(0, Math.min(1, frac)) * 100)
      : null

  const etaLabel =
    !backgroundThrottled &&
    displayEtaSeconds != null &&
    Number.isFinite(displayEtaSeconds) &&
    displayEtaSeconds > 0
      ? displayEtaSeconds >= 120
        ? `~${Math.round(displayEtaSeconds / 60)}m`
        : `~${Math.max(1, Math.round(displayEtaSeconds))}s`
      : null

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_80%,transparent)] px-4 md:px-6 backdrop-blur-xl shadow-sm">
      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={onLogoClick}
          title="Back to UniSlot home"
          className="theme-focusable group flex cursor-pointer items-center justify-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_40%,transparent)]"
        >
          <AppLogo size="nav" className="transition-transform duration-200 group-active:scale-95" />
          <div className="hidden sm:block">
            <div className="text-base font-semibold tracking-wide text-text leading-none">UniSlot</div>
          </div>
        </button>

        <div className="h-5 w-[1px] bg-border/60 hidden md:block" />

        <nav className="hidden md:flex items-center gap-1">
          {features.map((feature) => {
            const Icon = feature.icon
            const isActive = activeFeature === feature.id
            return (
              <button
                key={feature.id}
                onClick={() => setActiveFeature(feature.id)}
                title={feature.label}
                className={cn(
                  'theme-focusable group flex items-center gap-2 rounded-xl px-3 py-2 text-[14px] font-medium transition-colors',
                  isActive
                    ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
                    : 'text-text-muted hover:bg-border/40 hover:text-text',
                )}
              >
                <Icon
                  className={cn(
                    'size-4 transition-all duration-200',
                    isActive ? 'text-brand-500' : 'text-text-muted group-hover:text-text',
                  )}
                />
                <span>{feature.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {showRunning && (
          <button
            type="button"
            onClick={() => setActiveFeature('scheduler')}
            title="Open Scheduler"
            className="theme-focusable inline-flex max-w-[14rem] items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-600 dark:text-brand-400"
          >
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-brand-500" />
            </span>
            <span className="truncate">
              {backgroundThrottled
                ? 'Running (background)'
                : pct != null
                  ? `Running ${pct}%`
                  : 'Running…'}
              {etaLabel ? ` · ${etaLabel}` : ''}
            </span>
          </button>
        )}
        {showReady && (
          <button
            type="button"
            onClick={() => setActiveFeature('scheduler')}
            title="Return to completed run"
            className="theme-focusable inline-flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-text"
          >
            <CheckCircle2 className="size-3.5 text-brand-500" aria-hidden />
            Run ready
          </button>
        )}
        <ThemeSwitcher layout="toolbar" variant="popover" />
      </div>
    </header>
  )
}

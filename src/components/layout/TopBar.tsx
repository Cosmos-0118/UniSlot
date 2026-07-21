import { AppLogo } from '@/components/brand/AppLogo'
import { cn } from '@/shared/utils/cn'
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher'
import { useSchedulingSession } from '@/contexts/scheduling/useSchedulingSession'
import { Calendar, CheckCircle2, Clock, Library, UserCheck } from 'lucide-react'

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
    { id: 'teachers', label: 'Teachers', icon: UserCheck },
    { id: 'late-submissions', label: 'Late submissions', icon: Clock },
    { id: 'runs', label: 'Saved runs', icon: Library },
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
    <header className="relative z-20 flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-[color-mix(in_srgb,var(--bg-secondary)_75%,transparent)] px-4 md:h-16 md:px-6 backdrop-blur-xl">
      <div className="flex items-center gap-4 md:gap-6">
        <button
          type="button"
          onClick={onLogoClick}
          title="Back to UniSlot home"
          className="theme-focusable group flex cursor-pointer items-center justify-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_40%,transparent)]"
        >
          <AppLogo size="nav" className="transition-transform duration-200 group-active:scale-95" />
          <div className="hidden sm:block">
            <div className="text-sm font-semibold tracking-wide text-text leading-none">UniSlot</div>
          </div>
        </button>

        <div className="h-5 w-px bg-border/60 hidden md:block" />

        <nav className="hidden lg:flex items-center gap-0.5">
          {features.map((feature) => {
            const Icon = feature.icon
            const isActive = activeFeature === feature.id
            return (
              <button
                key={feature.id}
                onClick={() => setActiveFeature(feature.id)}
                title={feature.label}
                className={cn(
                  'theme-focusable group flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-brand-500/12 text-brand-600 dark:text-brand-400'
                    : 'text-text-muted hover:bg-border/30 hover:text-text',
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

      <div className="flex items-center gap-2 md:gap-3">
        {showRunning && (
          <button
            type="button"
            onClick={() => setActiveFeature('scheduler')}
            title="Open Scheduler"
            className="theme-focusable inline-flex max-w-[12rem] items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 md:max-w-[14rem] md:px-3"
          >
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-brand-500" />
            </span>
            <span className="truncate">
              {backgroundThrottled
                ? 'Running (bg)'
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
            className="theme-focusable hidden items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-text sm:inline-flex"
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

export function MobileNav({ activeFeature, setActiveFeature }: Pick<TopBarProps, 'activeFeature' | 'setActiveFeature'>) {
  const features = [
    { id: 'scheduler', label: 'Scheduler', icon: Calendar },
    { id: 'teachers', label: 'Teachers', icon: UserCheck },
    { id: 'late-submissions', label: 'Late', icon: Clock },
    { id: 'runs', label: 'Runs', icon: Library },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_92%,transparent)] backdrop-blur-xl lg:hidden">
      <div className="flex overflow-x-auto px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {features.map((feature) => {
          const Icon = feature.icon
          const isActive = activeFeature === feature.id
          return (
            <button
              key={feature.id}
              type="button"
              onClick={() => setActiveFeature(feature.id)}
              className={cn(
                'theme-focusable flex min-w-[4.25rem] shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium transition-colors',
                isActive ? 'text-brand-500' : 'text-text-muted',
              )}
            >
              <Icon className={cn('size-5', isActive && 'text-brand-500')} aria-hidden />
              {feature.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

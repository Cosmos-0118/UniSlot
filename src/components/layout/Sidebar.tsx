import { AppLogo } from '@/components/brand/AppLogo'
import { cn } from '@/shared/utils/cn'
import { Calendar, Library, Settings, Zap, Mail } from 'lucide-react'


interface SidebarProps {
  activeFeature: string;
  setActiveFeature: (feature: string) => void;
  onLogoClick: () => void;
}

export function Sidebar({ activeFeature, setActiveFeature, onLogoClick }: SidebarProps) {

  const features = [
    { id: 'scheduler', label: 'Scheduler', icon: Calendar },
    { id: 'runs', label: 'Saved runs', icon: Library },
    { id: 'emails', label: 'Emails', icon: Mail },
    { id: 'insights', label: 'Insights', icon: Zap },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="theme-sidebar flex w-20 flex-shrink-0 flex-col transition-colors duration-500 md:w-80">
      <div className="flex h-16 shrink-0 items-center border-b border-border/60 px-3 md:px-5">
        <button
          type="button"
          onClick={onLogoClick}
          title="Back to UniSlot home"
          className="theme-focusable group flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_40%,transparent)] md:justify-start"
        >
          <AppLogo size="nav" className="transition-transform duration-200 group-active:scale-95" />
          <div className="hidden md:block">
            <div className="text-lg font-semibold tracking-wide text-text">UniSlot</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
              Scheduling Studio
            </div>
          </div>
        </button>
      </div>

      <div className="hidden px-5 pb-1 pt-4 md:block">
        <p className="theme-sidebar-section-label">Workspace</p>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-2.5 py-3 md:px-4 md:py-4">
        {features.map((feature) => {
          const Icon = feature.icon;
          const isActive = activeFeature === feature.id;
          return (
            <button
              key={feature.id}
              onClick={() => setActiveFeature(feature.id)}
              title={feature.label}
              className={cn(
                'theme-sidebar-nav-button theme-focusable group flex w-full items-center justify-center gap-3 rounded-2xl px-2.5 py-2.5 text-[15px] font-medium md:justify-start md:px-3.5',
                isActive && 'theme-sidebar-nav-button-active'
              )}
            >
              <span className={cn('theme-sidebar-nav-icon', isActive && 'theme-sidebar-nav-icon-active')}>
                <Icon
                  className={cn(
                    'size-4 transition-all duration-200',
                    isActive
                      ? 'text-brand-500'
                      : 'text-text-muted group-hover:text-brand-500'
                  )}
                />
              </span>
              <span className="hidden md:inline">{feature.label}</span>
            </button>
          );
        })}
      </nav>

    </aside>
  );
}

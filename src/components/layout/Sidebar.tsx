import { useTheme } from '../../contexts/useTheme';
import { cn } from '@/shared/utils/cn'
import {
  Calendar,
  Home,
  Moon,
  Settings,
  Sun,
  Droplet,
  Sparkles,
  Zap,
  Mail,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface SidebarProps {
  activeFeature: string;
  setActiveFeature: (feature: string) => void;
}

export function Sidebar({ activeFeature, setActiveFeature }: SidebarProps) {
  const { theme, setTheme } = useTheme();

  const features = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'scheduler', label: 'Scheduler', icon: Calendar },
    { id: 'emails', label: 'Emails', icon: Mail },
    { id: 'insights', label: 'Insights', icon: Zap },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="theme-sidebar flex w-20 flex-shrink-0 flex-col transition-colors duration-500 md:w-80">
      <div className="px-3 pb-4 pt-5 md:px-5 md:pt-6">
        <div className="theme-sidebar-brand flex items-center justify-center gap-3 rounded-2xl px-2.5 py-3 md:justify-start md:px-3.5">
          <div
            className="flex size-9 items-center justify-center rounded-xl"
            style={{
              background: 'color-mix(in srgb, var(--brand-500) 75%, transparent)',
            }}
          >
            <Sparkles className="size-4 text-white" />
          </div>
          <div className="hidden md:block">
            <div className="text-lg font-semibold tracking-wide text-text">UniSlot</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
              Scheduling Studio
            </div>
          </div>
        </div>
      </div>

      <div className="hidden px-5 pb-1 md:block">
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
                      ? 'text-brand-200'
                      : 'text-text-muted/90 group-hover:text-brand-300'
                  )}
                />
              </span>
              <span className="hidden md:inline">{feature.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border/60 px-3 pb-4 pt-4 md:px-4 md:pt-5">
        <div className="theme-muted-surface rounded-2xl p-2">
          <div className="mb-2 hidden px-2 text-xs font-medium uppercase tracking-[0.16em] text-text-muted md:block">
            Theme
          </div>
          <div className="theme-theme-toggle grid grid-cols-1 gap-1.5 rounded-2xl p-1.5 md:grid-cols-3">
            <ThemeButton
              icon={Sun}
              label="Light"
              isActive={theme === 'light'}
              onClick={() => setTheme('light')}
            />
            <ThemeButton
              icon={Moon}
              label="Dark"
              isActive={theme === 'dark'}
              onClick={() => setTheme('dark')}
            />
            <ThemeButton
              icon={Droplet}
              label="Crimson"
              isActive={theme === 'crimson'}
              onClick={() => setTheme('crimson')}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

function ThemeButton({
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  icon: LucideIcon
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'theme-theme-button theme-focusable flex items-center justify-center gap-2 rounded-xl px-2 py-2.5 md:flex-col md:gap-1',
        isActive && 'theme-theme-button-active'
      )}
    >
      <Icon className="size-4" />
      <span className="hidden text-[11px] font-semibold tracking-wide md:block">{label}</span>
    </button>
  );
}

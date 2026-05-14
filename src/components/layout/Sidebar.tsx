import { useTheme } from '../../contexts/useTheme';
import { cn } from '../../lib/cn';
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
    <aside className="w-64 flex-shrink-0 border-r border-border bg-bg-secondary/50 backdrop-blur-xl flex flex-col transition-colors duration-500">
      <div className="h-16 flex items-center px-6 border-b border-border">
        <div className="flex items-center gap-2 text-brand-500 font-semibold text-lg tracking-wide">
          <Sparkles className="size-5" />
          <span>UniSlot</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
        {features.map((feature) => {
          const Icon = feature.icon;
          const isActive = activeFeature === feature.id;
          return (
            <button
              key={feature.id}
              onClick={() => setActiveFeature(feature.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-brand-500/10 text-brand-500 border border-brand-500/20'
                  : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
              )}
            >
              <Icon className={cn('size-4', isActive ? 'text-brand-500' : 'opacity-70')} />
              {feature.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="text-xs font-medium text-text-muted mb-3 px-2 uppercase tracking-wider">
          Theme
        </div>
        <div className="flex bg-bg-tertiary/30 p-1 rounded-2xl border border-border">
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
    </aside>
  );
}

function ThemeButton({
  icon: Icon,
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
        'flex-1 flex justify-center items-center py-2 rounded-xl transition-all duration-300',
        isActive
          ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/25 scale-100'
          : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50 scale-95 hover:scale-100'
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

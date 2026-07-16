import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher'
import { Bell, Search } from 'lucide-react'

export function TopBar() {
  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_80%,transparent)] px-6 backdrop-blur-xl shadow-sm">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-text">Workspace</h2>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="theme-focusable flex size-9 items-center justify-center rounded-xl text-text-muted hover:bg-border/40 hover:text-text transition-colors"
          title="Search"
        >
          <Search className="size-4.5" />
        </button>
        <button
          type="button"
          className="theme-focusable flex size-9 items-center justify-center rounded-xl text-text-muted hover:bg-border/40 hover:text-text transition-colors"
          title="Notifications"
        >
          <Bell className="size-4.5" />
        </button>
        <div className="h-5 w-[1px] bg-border/60 mx-1" />
        <ThemeSwitcher layout="toolbar" variant="popover" />
      </div>
    </header>
  )
}

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface LayoutProps {
  children: ReactNode;
  activeFeature: string;
  setActiveFeature: (feature: string) => void;
  onLogoClick: () => void;
}

export function Layout({ children, activeFeature, setActiveFeature, onLogoClick }: LayoutProps) {
  return (
    <div className="app-shell flex h-screen overflow-hidden text-text">
      <Sidebar activeFeature={activeFeature} setActiveFeature={setActiveFeature} onLogoClick={onLogoClick} />
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-700"
          style={{
            background: 'color-mix(in srgb, var(--brand-500) 5%, transparent)',
            opacity: 0.36,
          }}
        />
        <TopBar />
        <div className="relative z-10 flex-1 overflow-y-auto w-full">{children}</div>
      </main>
    </div>
  );
}

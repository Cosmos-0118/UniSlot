import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  children: ReactNode;
  activeFeature: string;
  setActiveFeature: (feature: string) => void;
}

export function Layout({ children, activeFeature, setActiveFeature }: LayoutProps) {
  return (
    <div className="app-shell flex h-screen overflow-hidden text-text">
      <Sidebar activeFeature={activeFeature} setActiveFeature={setActiveFeature} />
      <main className="relative flex-1 overflow-y-auto">
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-700"
          style={{
            background: 'color-mix(in srgb, var(--brand-500) 5%, transparent)',
            opacity: 0.36,
          }}
        />
        <div className="relative z-10 h-full w-full">{children}</div>
      </main>
    </div>
  );
}

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  children: ReactNode;
  activeFeature: string;
  setActiveFeature: (feature: string) => void;
}

export function Layout({ children, activeFeature, setActiveFeature }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text selection:bg-brand-500/30">
      <Sidebar activeFeature={activeFeature} setActiveFeature={setActiveFeature} />
      <main className="flex-1 overflow-y-auto relative">
        <div 
          className="absolute inset-0 pointer-events-none transition-opacity duration-700" 
          style={{ backgroundImage: 'radial-gradient(ellipse 80% 80% at 50% -20%, var(--color-brand-500), transparent 50%)', opacity: 0.15 }}
        />
        <div className="relative z-10 w-full h-full">
          {children}
        </div>
      </main>
    </div>
  );
}

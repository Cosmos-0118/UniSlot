import type { ReactNode } from 'react';
import { MobileNav, TopBar } from './TopBar';

interface LayoutProps {
  children: ReactNode;
  activeFeature: string;
  setActiveFeature: (feature: string) => void;
  onLogoClick: () => void;
}

export function Layout({ children, activeFeature, setActiveFeature, onLogoClick }: LayoutProps) {
  return (
    <div className="app-shell flex flex-col h-screen overflow-hidden text-text">
      <TopBar activeFeature={activeFeature} setActiveFeature={setActiveFeature} onLogoClick={onLogoClick} />
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <div className="relative z-10 flex-1 overflow-y-auto w-full pb-[4.5rem] lg:pb-0">{children}</div>
      </main>
      <MobileNav activeFeature={activeFeature} setActiveFeature={setActiveFeature} />
    </div>
  );
}

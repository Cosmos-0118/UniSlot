import { useState } from 'react';
import { ThemeProvider } from './contexts/ThemeProvider';
import { LandingPage } from './features/LandingPage';
import { Dashboard } from './features/Dashboard';

export default function App() {
  // Simple custom router state
  // 'landing' -> The public facing landing page
  // 'app' -> The main logged-in dashboard area
  const [currentRoute, setCurrentRoute] = useState<'landing' | 'app'>('landing');

  return (
    <ThemeProvider>
      {currentRoute === 'landing' ? (
        <LandingPage onEnterApp={() => setCurrentRoute('app')} />
      ) : (
        <Dashboard onLogout={() => setCurrentRoute('landing')} />
      )}
    </ThemeProvider>
  );
}

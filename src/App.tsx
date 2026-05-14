import { useState } from 'react';
import { ThemeProvider } from './contexts/ThemeProvider'
import { Layout } from './components/layout/Layout';
import { LandingPage } from './features/LandingPage';
import { Scheduler } from './features/Scheduler';

function AppContent() {
  const [activeFeature, setActiveFeature] = useState('home');

  return (
    <Layout activeFeature={activeFeature} setActiveFeature={setActiveFeature}>
      {activeFeature === 'home' && <LandingPage onGetStarted={() => setActiveFeature('scheduler')} />}
      {activeFeature === 'scheduler' && <Scheduler />}
      {activeFeature === 'insights' && (
        <div className="p-8 flex items-center justify-center h-full text-text-muted">
          Insights feature coming soon...
        </div>
      )}
      {activeFeature === 'settings' && (
        <div className="p-8 flex items-center justify-center h-full text-text-muted">
          Settings feature coming soon...
        </div>
      )}
    </Layout>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

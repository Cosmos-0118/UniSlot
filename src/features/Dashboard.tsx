import { useState } from 'react';
import { Layout } from '../components/layout/Layout';
import { Scheduler } from './Scheduler';
import { EmailsView } from './EmailsView';
import type { PipelineOutput } from '../hooks/useUnislotWorker';

interface DashboardProps {
  onLogout: () => void;
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [activeFeature, setActiveFeature] = useState('scheduler');
  const [result, setResult] = useState<PipelineOutput | null>(null);

  // We can add a simple wrapper function to catch 'home' or handle logout
  const handleFeatureChange = (feature: string) => {
    if (feature === 'home') {
      onLogout();
    } else {
      setActiveFeature(feature);
    }
  };

  return (
    <Layout activeFeature={activeFeature} setActiveFeature={handleFeatureChange}>
      {activeFeature === 'scheduler' && <Scheduler result={result} onResult={setResult} />}
      {activeFeature === 'emails' && <EmailsView result={result} />}
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

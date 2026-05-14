import { useState } from 'react';
import { Layout } from '../components/layout/Layout';
import { Scheduler } from './Scheduler';
import { EmailsView } from './EmailsView';
import type { PipelineOutput } from '@/hooks/useUnislotWorker'
import { BarChart3, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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
        <ComingSoonPanel
          icon={BarChart3}
          title="Insights in Progress"
          description="Course-level analytics, slot heatmaps, and scheduling quality trends are being designed for this dashboard."
          accent="var(--accent-info)"
        />
      )}
      {activeFeature === 'settings' && (
        <ComingSoonPanel
          icon={SlidersHorizontal}
          title="Settings in Progress"
          description="Theme presets, export preferences, and advanced scheduling controls will be available here soon."
          accent="var(--accent-warning)"
        />
      )}
    </Layout>
  );
}

function ComingSoonPanel({
  icon: Icon,
  title,
  description,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  accent: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-4 sm:p-8">
      <div className="theme-card w-full max-w-xl rounded-3xl p-8 text-center">
        <div
          className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: `color-mix(in srgb, ${accent} 18%, transparent)` }}
        >
          <Icon className="size-7" style={{ color: accent }} />
        </div>
        <h2 className="text-2xl font-semibold text-text">{title}</h2>
        <p className="mt-3 text-text-muted">{description}</p>
      </div>
    </div>
  );
}

import { ArrowRight, CalendarDays, Lock, Sparkles, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export function LandingPage({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="min-h-full flex flex-col pt-20 pb-32 px-8 max-w-6xl mx-auto">
      {/* Hero Section */}
      <section className="flex flex-col items-center text-center mt-12 mb-32">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-500 text-sm font-medium mb-8">
          <Sparkles className="size-4" />
          <span>Next-generation scheduling</span>
        </div>
        
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-text mb-6">
          Schedule with <span className="text-brand-500">Confidence.</span>
        </h1>
        
        <p className="text-xl text-text-muted max-w-2xl mb-10 leading-relaxed">
          The most advanced, client-side scheduling engine. Process massive Excel files, detect clashes, and generate optimal schedules entirely within your browser.
        </p>

        <div className="flex gap-4">
          <button
            onClick={onGetStarted}
            className="px-8 py-4 bg-brand-500 text-white rounded-2xl font-semibold flex items-center gap-2 hover:bg-brand-600 transition-all duration-300 shadow-[0_0_40px_-10px_rgba(var(--brand-500-rgb),0.5)] hover:shadow-[0_0_60px_-10px_rgba(var(--brand-500-rgb),0.6)] hover:-translate-y-0.5"
          >
            Start Scheduling <ArrowRight className="size-5" />
          </button>
          <button className="px-8 py-4 bg-bg-secondary text-text rounded-2xl font-semibold border border-border hover:bg-bg-tertiary transition-all duration-300">
            View Documentation
          </button>
        </div>
      </section>

      {/* Features Section */}
      <section className="grid md:grid-cols-3 gap-8 mt-12">
        <FeatureCard
          icon={Zap}
          title="Lightning Fast"
          description="Powered by a dedicated Web Worker, UniSlot processes thousands of entries in seconds without freezing your UI."
        />
        <FeatureCard
          icon={Lock}
          title="100% Private"
          description="Your sensitive student data never leaves your machine. All computation happens locally in your browser."
        />
        <FeatureCard
          icon={CalendarDays}
          title="Smart Clash Detection"
          description="Advanced greedy multi-start algorithms with local search ensure optimal scheduling with zero undetected clashes."
        />
      </section>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="p-8 rounded-3xl bg-bg-secondary/40 border border-border backdrop-blur-sm hover:bg-bg-secondary/80 transition-all duration-500 hover:-translate-y-1 group">
      <div className="w-14 h-14 rounded-2xl bg-brand-500/10 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-brand-500/20 transition-all duration-500">
        <Icon className="size-7 text-brand-500" />
      </div>
      <h3 className="text-xl font-semibold text-text mb-3">{title}</h3>
      <p className="text-text-muted leading-relaxed">{description}</p>
    </div>
  );
}

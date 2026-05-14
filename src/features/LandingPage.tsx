import { ArrowRight, CalendarDays, Sparkles, Zap, Shield, Rocket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion'
import type { Variants } from 'framer-motion'

export function LandingPage({ onEnterApp }: { onEnterApp: () => void }) {
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.2 },
    },
  }

  const itemVariants: Variants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 100 } },
  }

  return (
    <div className="app-shell relative flex min-h-screen flex-col items-center overflow-hidden text-text">

      <nav className="w-full max-w-7xl mx-auto px-6 py-6 flex justify-between items-center z-10">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center gap-2 text-2xl font-bold tracking-wide"
        >
          <Sparkles className="size-6 text-brand-400" />
          <span className="text-brand-400">UniSlot</span>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            onClick={onEnterApp}
            className="theme-btn-primary theme-focusable rounded-xl px-5 py-2.5 text-sm font-semibold"
          >
            Get Started
          </motion.button>
        </motion.div>
      </nav>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 flex flex-col items-center justify-center pt-20 pb-32 z-10">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center text-center max-w-4xl"
        >
          <motion.div variants={itemVariants} className="theme-chip-brand mb-8 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium shadow-lg shadow-brand-500/20">
            <Rocket className="size-4" />
            <span>The next generation of timetable scheduling</span>
          </motion.div>

          <motion.h1 variants={itemVariants} className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight text-text mb-8 leading-[1.1]">
            Schedule with <br />
            <span className="text-brand-400">
              Absolute Confidence.
            </span>
          </motion.h1>

          <motion.p variants={itemVariants} className="text-xl md:text-2xl text-text-muted max-w-2xl mb-12 leading-relaxed">
            Process massive enrollment files, detect clashes instantly, and generate optimal conflict-free schedules securely inside your browser.
          </motion.p>

          <motion.div variants={itemVariants} className="w-full sm:w-auto">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onEnterApp}
              className="theme-btn-primary theme-focusable flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-4 text-lg font-semibold sm:w-auto"
            >
              Get Started <ArrowRight className="size-5" />
            </motion.button>
          </motion.div>
        </motion.div>

        {/* Features Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid md:grid-cols-3 gap-8 mt-40 w-full"
        >
          <FeatureCard
            icon={Zap}
            title="Lightning Fast Execution"
            description="Powered by a dedicated Web Worker, UniSlot processes thousands of entries in milliseconds without freezing your UI."
            accent="var(--accent-info)"
          />
          <FeatureCard
            icon={Shield}
            title="100% Private & Secure"
            description="Your sensitive student data never leaves your machine. All computation happens entirely locally in your browser."
            accent="var(--accent-success)"
          />
          <FeatureCard
            icon={CalendarDays}
            title="Smart Clash Detection"
            description="Advanced greedy multi-start algorithms with local search ensure optimal scheduling with zero undetected clashes."
            accent="var(--accent-warning)"
          />
        </motion.div>
      </main>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  accent,
}: {
  icon: LucideIcon,
  title: string,
  description: string,
  accent: string,
}) {
  return (
    <motion.div
      variants={{
        hidden: { y: 20, opacity: 0 },
        visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 50 } },
      } satisfies Variants}
      whileHover={{ y: -5 }}
      className="theme-card theme-card-hover group rounded-3xl p-8"
    >
      <div
        className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl transition-all duration-500 group-hover:scale-110"
        style={{ background: `color-mix(in srgb, ${accent} 18%, transparent)` }}
      >
        <Icon className="size-7" style={{ color: accent }} />
      </div>
      <h3 className="text-xl font-semibold text-text mb-3">{title}</h3>
      <p className="text-text-muted leading-relaxed">{description}</p>
    </motion.div>
  );
}

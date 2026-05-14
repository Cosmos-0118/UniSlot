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
    <div className="min-h-screen relative flex flex-col items-center overflow-hidden bg-bg text-text selection:bg-brand-500/30">
      
      {/* Animated Background Gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.15, 0.3, 0.15] 
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-brand-500 blur-[120px]" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.1, 0.2, 0.1] 
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute top-[40%] -right-[10%] w-[60%] h-[60%] rounded-full bg-brand-600 blur-[120px]" 
        />
      </div>

      <nav className="w-full max-w-7xl mx-auto px-6 py-6 flex justify-between items-center z-10">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center gap-2 text-brand-500 font-bold text-2xl tracking-wide"
        >
          <Sparkles className="size-6" />
          <span>UniSlot</span>
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
            className="px-5 py-2.5 bg-brand-500 text-white rounded-xl font-semibold hover:bg-brand-600 transition-colors shadow-lg shadow-brand-500/20"
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
          <motion.div variants={itemVariants} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-500 text-sm font-medium mb-8 shadow-lg shadow-brand-500/20">
            <Rocket className="size-4" />
            <span>The next generation of timetable scheduling</span>
          </motion.div>
          
          <motion.h1 variants={itemVariants} className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight text-text mb-8 leading-[1.1]">
            Schedule with <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 via-brand-500 to-brand-600">
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
              className="px-8 py-4 bg-brand-500 text-white rounded-2xl font-semibold flex items-center justify-center gap-2 hover:bg-brand-600 transition-colors shadow-lg shadow-brand-500/25 text-lg w-full sm:w-auto"
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
          />
          <FeatureCard
            icon={Shield}
            title="100% Private & Secure"
            description="Your sensitive student data never leaves your machine. All computation happens entirely locally in your browser."
          />
          <FeatureCard
            icon={CalendarDays}
            title="Smart Clash Detection"
            description="Advanced greedy multi-start algorithms with local search ensure optimal scheduling with zero undetected clashes."
          />
        </motion.div>
      </main>
    </div>
  );
}

function FeatureCard({ 
  icon: Icon, 
  title, 
  description 
}: { 
  icon: LucideIcon, 
  title: string, 
  description: string 
}) {
  return (
    <motion.div
      variants={{
        hidden: { y: 20, opacity: 0 },
        visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 50 } },
      } satisfies Variants}
      whileHover={{ y: -5 }}
      className="p-8 rounded-3xl bg-bg-secondary/40 border border-border backdrop-blur-md hover:bg-bg-secondary/80 transition-colors group"
    >
      <div className="w-14 h-14 rounded-2xl bg-brand-500/10 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-brand-500/20 transition-all duration-500">
        <Icon className="size-7 text-brand-500" />
      </div>
      <h3 className="text-xl font-semibold text-text mb-3">{title}</h3>
      <p className="text-text-muted leading-relaxed">{description}</p>
    </motion.div>
  );
}

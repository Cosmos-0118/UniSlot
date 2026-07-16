import { glassPanelSurface, MarketingShell } from '@/features/landing/MarketingShell'
import { cn } from '@/shared/utils/cn'
import { ArrowLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export type LegalSection = {
  heading: string
  body: ReactNode
}

type LegalDocumentPageProps = {
  title: string
  eyebrow: string
  lastUpdated: string
  intro: string
  sections: LegalSection[]
  /** Link to the sibling legal document (privacy ↔ terms). */
  related?: { to: string; label: string }
}

export function LegalDocumentPage({
  title,
  eyebrow,
  lastUpdated,
  intro,
  sections,
  related,
}: LegalDocumentPageProps) {
  return (
    <MarketingShell mainClassName="items-center">
      <motion.article
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 90, damping: 20, mass: 0.9 }}
        className={cn('w-full max-w-3xl overflow-hidden', glassPanelSurface)}
      >
        {/* Hero band */}
        <div className="relative border-b border-white/[0.08] px-5 pb-7 pt-6 md:px-10 md:pb-9 md:pt-8">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_srgb,var(--brand-500)_22%,transparent),transparent_55%)]"
            aria-hidden
          />
          <div className="relative z-10">
            <Link
              to="/"
              className="theme-focusable mb-6 inline-flex items-center gap-2 rounded-lg text-sm font-medium text-text-muted transition-colors hover:text-text"
            >
              <ArrowLeft className="size-4" />
              Back to home
            </Link>

            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300/90">{eyebrow}</p>
            <h1 className="mt-2 bg-gradient-to-r from-text via-text to-brand-200 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent md:text-4xl">
              {title}
            </h1>
            <p className="mt-2 text-sm text-text-muted">Last updated {lastUpdated}</p>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-text/90 md:text-lg">{intro}</p>
          </div>
        </div>

        {/* Sections */}
        <div className="relative z-10 space-y-0 px-5 py-2 md:px-10 md:py-3">
          {sections.map((section, index) => (
            <section
              key={section.heading}
              className="border-b border-white/[0.06] py-7 last:border-b-0 md:py-8"
            >
              <div className="flex gap-4 md:gap-5">
                <span
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] font-mono text-xs font-semibold text-brand-300 tabular-nums"
                  aria-hidden
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold tracking-tight text-text md:text-xl">
                    {section.heading}
                  </h2>
                  <div className="mt-2.5 space-y-3 text-[0.95rem] leading-relaxed text-text-muted md:text-base [&_a]:font-medium [&_a]:text-brand-300 [&_a]:underline [&_a]:decoration-brand-400/40 [&_a]:underline-offset-2 [&_a]:transition-colors hover:[&_a]:text-brand-200 [&_ul]:mt-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                    {section.body}
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* Footer strip */}
        {related ? (
          <div className="relative z-10 flex flex-col gap-3 border-t border-white/[0.08] bg-white/[0.03] px-5 py-5 sm:flex-row sm:items-center sm:justify-between md:px-10">
            <p className="text-sm text-text-muted">Also see</p>
            <Link
              to={related.to}
              className="theme-focusable inline-flex items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-text transition-[border-color,background-color] hover:border-brand-400/35 hover:bg-white/[0.1]"
            >
              {related.label}
            </Link>
          </div>
        ) : null}
      </motion.article>
    </MarketingShell>
  )
}

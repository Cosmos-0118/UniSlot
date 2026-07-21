import type { ReactNode } from 'react'
import { cn } from '@/shared/utils/cn'

type PageShellProps = {
  eyebrow?: string
  title: string
  description: string
  children: ReactNode
  className?: string
  maxWidth?: '3xl' | '4xl' | '5xl' | '6xl'
}

export function PageShell({
  eyebrow,
  title,
  description,
  children,
  className,
  maxWidth = '5xl',
}: PageShellProps) {
  const maxW = {
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
  }[maxWidth]

  return (
    <div className={cn('mx-auto flex w-full flex-col px-4 py-8 sm:px-8 sm:py-10', maxW, className)}>
      <header className="mb-8 sm:mb-10">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-500">{eyebrow}</p>
        )}
        <h1 className={cn('font-bold tracking-tight text-text', eyebrow ? 'mt-2 text-3xl sm:text-4xl' : 'text-3xl sm:text-4xl')}>
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-muted">{description}</p>
      </header>
      {children}
    </div>
  )
}

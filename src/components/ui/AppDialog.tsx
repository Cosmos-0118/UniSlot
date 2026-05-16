import { AlertTriangle, Check, Copy, Info, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  dialogBodyPlainText,
  dialogLayoutMode,
  normalizeDialogBody,
  type NormalizedDialogBody,
} from '@/contexts/appDialog/normalizeDialogBody'
import type { AppDialogRequest, AppDialogTone } from '@/contexts/appDialog/types'
import { cn } from '@/shared/utils/cn'

const PANEL_LAYOUT_CLASS = {
  fit: 'app-dialog-panel--fit',
  standard: 'app-dialog-panel--standard',
  wide: 'app-dialog-panel--wide',
} as const

function toneStyles(tone: AppDialogTone) {
  switch (tone) {
    case 'danger':
      return {
        iconWrap: 'theme-soft-danger',
        icon: Trash2,
        iconColor: 'var(--accent-danger)',
      }
    case 'warning':
      return {
        iconWrap: 'theme-soft-warning',
        icon: AlertTriangle,
        iconColor: 'var(--accent-warning)',
      }
    default:
      return {
        iconWrap: 'border border-border/80 bg-bg-secondary/60',
        icon: Info,
        iconColor: 'var(--brand-400)',
      }
  }
}

type Props = {
  request: AppDialogRequest
  onClose: (result: boolean) => void
}

export function AppDialog({ request, onClose }: Props) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [copied, setCopied] = useState(false)

  const { options, kind } = request
  const tone = options.tone ?? 'default'
  const size = options.size ?? 'md'
  const { icon: Icon, iconWrap, iconColor } = toneStyles(tone)
  const body = normalizeDialogBody(options)
  const layout = dialogLayoutMode(body, size)

  const title =
    options.title ??
    (kind === 'confirm' && tone === 'danger' ? 'Confirm action' : kind === 'alert' ? 'Notice' : 'Confirm')

  const confirmLabel =
    options.confirmLabel ?? (kind === 'confirm' && tone === 'danger' ? 'Delete' : 'OK')
  const cancelLabel = kind === 'confirm' ? (options.cancelLabel ?? 'Cancel') : undefined

  const dismissAlert = useCallback(() => onClose(true), [onClose])
  const dismissCancel = useCallback(() => onClose(false), [onClose])

  const copyText = dialogBodyPlainText(body)

  async function handleCopy() {
    if (!copyText) return
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
      copyResetRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
    }
  }, [])

  useEffect(() => {
    confirmRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose(kind === 'alert')
        return
      }
      if (e.key === 'Enter' && kind === 'alert' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'TEXTAREA') return
        e.preventDefault()
        dismissAlert()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kind, onClose, dismissAlert])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || focusables.length === 0) return
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else if (document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    panel.addEventListener('keydown', onTab)
    return () => panel.removeEventListener('keydown', onTab)
  }, [])

  const showCopy = copyText.length > 0 && (body.kind === 'list' || copyText.length > 80)

  return createPortal(
    <div
      className="app-dialog-root fixed inset-0 z-[180] flex items-end justify-center p-3 sm:items-center sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="app-dialog-backdrop absolute inset-0 bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] backdrop-blur-[6px]"
        onClick={() => onClose(kind === 'alert')}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body.kind === 'empty' ? undefined : descId}
        className={cn(
          'app-dialog-panel theme-card relative z-10 flex max-h-[min(90dvh,calc(100dvh-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border/80 shadow-2xl',
          PANEL_LAYOUT_CLASS[layout],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="relative shrink-0 border-b border-border/50 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-start gap-3 pr-16">
            <div
              className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl sm:size-12', iconWrap)}
              aria-hidden
            >
              <Icon className="size-5 sm:size-6" style={{ color: iconColor }} />
            </div>
            <div className={cn('flex-1 pt-0.5', layout !== 'fit' && 'min-w-0')}>
              <h2 id={titleId} className="text-base font-semibold leading-snug tracking-tight text-text sm:text-lg">
                {title}
              </h2>
              {body.kind === 'list' && body.items.length > 1 ? (
                <p className="mt-1 text-xs text-text-muted">
                  {body.items.length} items
                  {body.intro ? ' · see details below' : null}
                </p>
              ) : null}
            </div>
          </div>
          <div className="absolute right-3 top-3 flex items-center gap-1 sm:right-4 sm:top-4">
            {showCopy ? (
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="theme-focusable rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-tertiary/80 hover:text-text"
                aria-label={copied ? 'Copied' : 'Copy message'}
                title={copied ? 'Copied' : 'Copy'}
              >
                {copied ? (
                  <Check className="size-4 text-[var(--accent-success)]" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onClose(kind === 'alert')}
              className="theme-focusable rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-tertiary/80 hover:text-text"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>

        <div className="app-dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
          <DialogBodyContent body={body} descId={descId} />
        </div>

        <footer
          className={cn(
            'shrink-0 border-t border-border/60 bg-bg-secondary/30 px-4 py-3.5 sm:px-5 sm:py-4',
            'pb-[max(0.875rem,env(safe-area-inset-bottom))]',
            kind === 'confirm' ? 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end' : '',
          )}
        >
          {kind === 'confirm' ? (
            <button
              type="button"
              onClick={dismissCancel}
              className="theme-btn-secondary theme-focusable w-full rounded-xl px-4 py-2.5 text-sm font-medium sm:w-auto"
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            ref={confirmRef}
            type="button"
            onClick={dismissAlert}
            className={cn(
              'theme-focusable rounded-xl px-4 py-2.5 text-sm font-medium',
              kind === 'alert' ? 'theme-btn-primary w-full' : 'theme-btn-primary sm:w-auto',
              tone === 'danger' &&
                'border-red-500/40 bg-[var(--accent-danger)] hover:brightness-110',
            )}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function proseClass(text: string, extra?: string) {
  return cn('app-dialog-prose text-left text-sm leading-relaxed', /\n/.test(text) && 'app-dialog-prose--pre', extra)
}

function DialogBodyContent({ body, descId }: { body: NormalizedDialogBody; descId: string }) {
  if (body.kind === 'empty') {
    return (
      <p id={descId} className="app-dialog-prose text-sm text-text-muted">
        No details provided.
      </p>
    )
  }

  if (body.kind === 'paragraph') {
    return (
      <p id={descId} className={proseClass(body.text, 'text-text')}>
        {body.text}
      </p>
    )
  }

  return (
    <div id={descId} className="w-full space-y-3">
      {body.intro ? (
        <p className={proseClass(body.intro, 'text-text-muted')}>{body.intro}</p>
      ) : null}
      <ul
        className={cn(
          'app-dialog-list w-full space-y-2.5 rounded-xl border border-border/60 bg-bg/50',
          body.items.length > 4 ? 'app-dialog-list--scroll' : 'px-3.5 py-3.5',
        )}
      >
        {body.items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-bg-tertiary/90 text-[11px] font-semibold leading-none tabular-nums text-text-muted"
              aria-hidden
            >
              {i + 1}
            </span>
            <span className={proseClass(item, 'min-w-0 flex-1 pt-px text-text')}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { AppDialogContext } from './AppDialogContext'
import type { AppContentDialogRender } from './AppDialogContext'
import type { AppAlertOptions, AppConfirmOptions, AppDialogRequest } from './types'

function normalizeAlert(options: string | AppAlertOptions): AppAlertOptions {
  return typeof options === 'string' ? { message: options } : options
}

function normalizeConfirm(options: string | AppConfirmOptions): AppConfirmOptions {
  return typeof options === 'string' ? { message: options } : options
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<AppDialogRequest | null>(null)

  const alert = useCallback((options: string | AppAlertOptions) => {
    const opts = normalizeAlert(options)
    return new Promise<void>((resolve) => {
      setRequest({ kind: 'alert', options: opts, resolve })
    })
  }, [])

  const confirm = useCallback((options: string | AppConfirmOptions) => {
    const opts = normalizeConfirm(options)
    return new Promise<boolean>((resolve) => {
      setRequest({ kind: 'confirm', options: opts, resolve })
    })
  }, [])

  const openContent = useCallback((render: AppContentDialogRender) => {
    return new Promise<void>((resolve) => {
      const close = () => {
        setRequest(null)
        resolve()
      }
      setRequest({ kind: 'content', options: render({ close }), resolve: close })
    })
  }, [])

  const handleClose = useCallback(
    (confirmed: boolean) => {
      if (!request) return
      const current = request
      setRequest(null)
      if (current.kind === 'alert' || current.kind === 'content') {
        current.resolve()
      } else {
        current.resolve(confirmed)
      }
    },
    [request],
  )

  const value = useMemo(() => ({ alert, confirm, openContent }), [alert, confirm, openContent])

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      {request ? <AppDialog request={request} onClose={handleClose} /> : null}
    </AppDialogContext.Provider>
  )
}

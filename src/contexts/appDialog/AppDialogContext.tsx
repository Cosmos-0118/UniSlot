import { createContext } from 'react'
import type { AppAlertOptions, AppConfirmOptions } from './types'

export type AppDialogContextValue = {
  alert: (options: string | AppAlertOptions) => Promise<void>
  confirm: (options: string | AppConfirmOptions) => Promise<boolean>
}

export const AppDialogContext = createContext<AppDialogContextValue | null>(null)

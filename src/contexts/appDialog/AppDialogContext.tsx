import { createContext } from 'react'
import type { AppAlertOptions, AppConfirmOptions, AppContentDialogOptions } from './types'

export type AppContentDialogRender = (api: { close: () => void }) => AppContentDialogOptions

export type AppDialogContextValue = {
  alert: (options: string | AppAlertOptions) => Promise<void>
  confirm: (options: string | AppConfirmOptions) => Promise<boolean>
  openContent: (render: AppContentDialogRender) => Promise<void>
}

export const AppDialogContext = createContext<AppDialogContextValue | null>(null)

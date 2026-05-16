export type AppDialogTone = 'default' | 'warning' | 'danger'

export type AppDialogSize = 'sm' | 'md' | 'lg'

export type AppDialogOptionsBase = {
  title?: string
  message?: string
  items?: string[]
  /** Split multiline `message` into a numbered list (default true). */
  splitMessageLines?: boolean
  size?: AppDialogSize
  tone?: AppDialogTone
}

export type AppAlertOptions = AppDialogOptionsBase & {
  confirmLabel?: string
}

export type AppConfirmOptions = AppDialogOptionsBase & {
  confirmLabel?: string
  cancelLabel?: string
}

export type AppDialogRequest =
  | { kind: 'alert'; options: AppAlertOptions; resolve: () => void }
  | { kind: 'confirm'; options: AppConfirmOptions; resolve: (value: boolean) => void }

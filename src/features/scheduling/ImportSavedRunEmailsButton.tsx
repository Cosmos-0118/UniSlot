import { Library } from 'lucide-react'
import { cn } from '@/shared/utils/cn'
import { useOpenSavedRunEmailsImportDialog } from '@/features/scheduling/useOpenSavedRunEmailsImportDialog'

type ImportSavedRunEmailsButtonProps = {
  className?: string
  variant?: 'primary' | 'secondary'
}

export function ImportSavedRunEmailsButton({
  className,
  variant = 'secondary',
}: ImportSavedRunEmailsButtonProps) {
  const openImport = useOpenSavedRunEmailsImportDialog()

  return (
    <button
      type="button"
      onClick={openImport}
      className={cn(
        'theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium',
        variant === 'primary' ? 'theme-btn-primary' : 'theme-btn-secondary',
        className,
      )}
    >
      <Library className="size-4" aria-hidden />
      Import from saved run
    </button>
  )
}

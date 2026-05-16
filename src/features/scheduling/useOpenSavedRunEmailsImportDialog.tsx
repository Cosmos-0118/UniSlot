import { useCallback } from 'react'
import { useAppDialog } from '@/contexts/appDialog/useAppDialog'
import { SavedRunEmailsImport } from '@/features/scheduling/SavedRunEmailsImport'

export function useOpenSavedRunEmailsImportDialog() {
  const { openContent } = useAppDialog()

  return useCallback(() => {
    void openContent(({ close }) => ({
      title: 'Import from saved run',
      message:
        'Choose a saved run. Course email groups are rebuilt from its frozen enrollment rows (including late merges).',
      size: 'lg',
      cancelLabel: 'Cancel',
      content: <SavedRunEmailsImport embedded onImported={close} />,
    }))
  }, [openContent])
}

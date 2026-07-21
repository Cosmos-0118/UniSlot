import { useState } from 'react'
import { CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/utils/cn'

type FileDropzoneProps = {
  label: string
  description: string
  accept?: string
  file: File | null
  onFile: (file: File | null) => void
  disabled?: boolean
  icon?: LucideIcon
  hint?: string
}

export function FileDropzone({
  label,
  description,
  accept = '.xlsx',
  file,
  onFile,
  disabled = false,
  icon: Icon = FileSpreadsheet,
  hint,
}: FileDropzoneProps) {
  const [drag, setDrag] = useState(false)

  const pickFile = () => {
    if (disabled) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const f = input.files?.[0]
      if (f) onFile(f)
    }
    input.click()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    if (disabled) return
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-text">{label}</h3>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">{description}</p>
      </div>

      <button
        type="button"
        disabled={disabled}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={pickFile}
        className={cn(
          'theme-dropzone theme-focusable group relative flex min-h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200',
          drag && 'theme-dropzone-active',
          file && 'border-[color-mix(in_srgb,var(--accent-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-success)_6%,transparent)]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        {file ? (
          <>
            <div className="flex size-12 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent-success)_18%,transparent)]">
              <CheckCircle2 className="size-6 text-[var(--accent-success)]" aria-hidden />
            </div>
            <div className="max-w-full px-2">
              <p className="truncate text-sm font-medium text-text">{file.name}</p>
              <p className="mt-1 text-xs text-text-muted">
                {(file.size / 1024).toFixed(1)} KB · Click or drop to replace
              </p>
            </div>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                if (!disabled) onFile(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!disabled) onFile(null)
                }
              }}
              className="theme-focusable inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-bg/60 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text"
            >
              <X className="size-3.5" aria-hidden />
              Remove
            </span>
          </>
        ) : (
          <>
            <div
              className="flex size-12 items-center justify-center rounded-xl shadow-md"
              style={{ background: 'var(--btn-primary-from)' }}
            >
              <Icon className="size-6 text-white" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-text">Drop file here or click to browse</p>
              {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-bg-secondary/60 px-4 py-2 text-xs font-medium text-text-muted">
              <Upload className="size-3.5" aria-hidden />
              Choose file
            </span>
          </>
        )}
      </button>
    </div>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, FileSpreadsheet, Library, Mail } from 'lucide-react'
import { applySavedRunEmailsToSession } from '@/features/scheduling/courseEmailsFromSnapshot'
import {
  displayRunTitle,
  formatSavedAt,
  snapshotStats,
  sourceFileLabel,
} from '@/features/scheduling/savedRunDisplay'
import {
  loadSavedRuns,
  SAVED_RUNS_CHANGED_EVENT,
  type SavedScheduleRun,
} from '@/features/scheduling/storage/savedRunsStorage'
import { useSchedulingSession } from '@/contexts/scheduling/useSchedulingSession'
import { cn } from '@/shared/utils/cn'

type SavedRunEmailsImportProps = {
  onImported?: () => void
  className?: string
  /** Render inside AppDialog without card chrome or duplicate headings. */
  embedded?: boolean
}

export function SavedRunEmailsImport({ onImported, className, embedded = false }: SavedRunEmailsImportProps) {
  const { setResult, setFileName, result } = useSchedulingSession()
  const [runs, setRuns] = useState<SavedScheduleRun[]>(() => loadSavedRuns())

  useEffect(() => {
    const sync = () => setRuns(loadSavedRuns())
    sync()
    window.addEventListener(SAVED_RUNS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SAVED_RUNS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const importRun = (run: SavedScheduleRun) => {
    if (!applySavedRunEmailsToSession(run, setResult, setFileName, result)) return
    onImported?.()
  }

  const eligible = runs.filter((r) => r.snapshot.enrollmentRows.length > 0)

  if (runs.length === 0) {
    return (
      <ImportShell embedded={embedded} className={className}>
        <p className="text-sm text-text-muted">
          No saved runs yet. Finish a pass in Scheduler and use <span className="font-medium text-text">Save run</span>{' '}
          to freeze a timetable here.
        </p>
        <Link
          to="/app/scheduler"
          onClick={onImported}
          className="theme-btn-secondary theme-focusable mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
        >
          Go to Scheduler
        </Link>
      </ImportShell>
    )
  }

  if (eligible.length === 0) {
    return (
      <ImportShell embedded={embedded} className={className}>
        <p className="text-sm text-text-muted">
          Saved runs exist, but none include enrollment rows needed for course emails. Re-save from a scheduler pass that
          retained enrollment data, or open a run and merge enrollments first.
        </p>
        <Link
          to="/app/runs"
          onClick={onImported}
          className="theme-btn-secondary theme-focusable mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
        >
          <Library className="size-4" aria-hidden />
          Saved runs
        </Link>
      </ImportShell>
    )
  }

  return (
    <ImportShell embedded={embedded} className={className}>
      {!embedded ? (
        <>
          <p className="text-sm font-medium text-text">Import from a saved run</p>
          <p className="mt-1 text-sm text-text-muted">
            Course email groups are rebuilt from the frozen enrollment rows in that run (including late merges).
          </p>
        </>
      ) : null}
      <ul
        className={cn(
          'flex flex-col gap-2 overflow-y-auto pr-1',
          embedded ? 'max-h-[min(50vh,22rem)]' : 'mt-4 max-h-64',
        )}
      >
        {eligible.map((run) => {
          const { studentCount, courseCount } = snapshotStats(run.snapshot)
          const { relative, primary } = formatSavedAt(run.createdAt)
          const fileStem = sourceFileLabel(run.sourceFileName)
          return (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => importRun(run)}
                className={cn(
                  'theme-focusable flex w-full items-center gap-3 rounded-xl border border-border/80 bg-bg/60 px-3 py-3 text-left',
                  'transition-colors hover:border-brand-500/40 hover:bg-[color-mix(in_srgb,var(--brand-500)_10%,transparent)]',
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg theme-soft-info">
                  <Mail className="size-4 text-[var(--accent-info)]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">{displayRunTitle(run.title)}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
                    <CalendarClock className="size-3 shrink-0" aria-hidden />
                    <span title={primary}>{relative || primary}</span>
                    {fileStem ? (
                      <>
                        <span aria-hidden>·</span>
                        <FileSpreadsheet className="size-3 shrink-0" aria-hidden />
                        <span className="truncate font-mono">{fileStem}</span>
                      </>
                    ) : null}
                    <span aria-hidden>·</span>
                    <span>
                      {studentCount.toLocaleString()} students · {courseCount.toLocaleString()} courses
                    </span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </ImportShell>
  )
}

function ImportShell({
  children,
  className,
  embedded,
}: {
  children: ReactNode
  className?: string
  embedded: boolean
}) {
  if (embedded) {
    return <div className={cn('w-full text-left', className)}>{children}</div>
  }
  return (
    <div
      className={cn('theme-card mt-8 w-full max-w-lg rounded-2xl border border-border/80 p-6 text-left', className)}
    >
      {children}
    </div>
  )
}

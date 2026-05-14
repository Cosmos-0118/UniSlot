import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Users,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '../lib/cn'
import type { ScheduleEntry, StudentClashReport, ValidationError } from '../lib/unislot/types'
import { useUnislotWorker, type PipelineOutput } from '../hooks/useUnislotWorker'
import { ProcessingTerminal } from '../components/ui/ProcessingTerminal'

function downloadArrayBuffer(data: ArrayBuffer, filename: string) {
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ValidationList({ items, variant }: { items: ValidationError[]; variant: 'error' | 'warn' }) {
  if (!items.length) return null
  return (
    <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
      {items.slice(0, 80).map((e, i) => (
        <li
          key={i}
          className={cn(
            'rounded-lg border px-3 py-2',
            variant === 'error'
              ? 'border-red-500/30 bg-red-500/10 text-red-100'
              : 'border-amber-500/25 bg-amber-500/10 text-amber-100',
          )}
        >
          {e.row_number != null && <span className="font-mono text-xs opacity-80">Row {e.row_number} · </span>}
          <span className="font-medium">{e.field}</span>: {e.message}
        </li>
      ))}
      {items.length > 80 && (
        <li className="text-text-muted">…and {items.length - 80} more (fix sheet and retry)</li>
      )}
    </ul>
  )
}

function SchedulePreview({ entries }: { entries: ScheduleEntry[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-bg-secondary/50 shadow-xl backdrop-blur">
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-bg/95 backdrop-blur">
            <tr className="border-b border-border text-xs uppercase tracking-wider text-text-muted">
              <th className="px-4 py-3 font-medium">Course</th>
              <th className="px-4 py-3 font-medium">Section</th>
              <th className="px-4 py-3 font-medium">Day</th>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Enrollment</th>
              <th className="px-4 py-3 font-medium">Programs</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.section_id}
                className="border-b border-border/50 transition-colors hover:bg-bg-tertiary/30"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-text">{e.course_code}</div>
                  <div className="text-xs text-text-muted">{e.course_title}</div>
                </td>
                <td className="px-4 py-3 font-mono text-text-muted">{e.section_number}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-tertiary/50 px-2.5 py-1 text-xs font-medium text-brand-500">
                    <CalendarDays className="size-3.5 opacity-70" aria-hidden />
                    {e.day}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted">{e.time}</td>
                <td className="px-4 py-3 text-text-muted">{e.enrollment_count}</td>
                <td className="max-w-[200px] truncate px-4 py-3 text-xs text-text-muted" title={e.programs}>
                  {e.programs || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClashPreview({ reports }: { reports: StudentClashReport[] }) {
  const red = reports.filter((r) => r.status === 'Red').slice(0, 40)
  if (!red.length) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-emerald-500">
        <CheckCircle2 className="size-6 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">No student clashes detected</p>
          <p className="text-sm opacity-80">Every student has at most one evening slot per day.</p>
        </div>
      </div>
    )
  }
  return (
    <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
      {red.map((r) => (
        <li
          key={r.register_number}
          className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-red-500"
        >
          <span className="font-mono text-xs opacity-90">{r.register_number}</span>
          <span className="mx-2 opacity-60">·</span>
          {r.student_name}
          <div className="mt-1 text-xs opacity-80">
            {r.clashing_courses.map(([a, b], i) => (
              <span key={i}>
                {a} ↔ {b}
                {i < r.clashing_courses.length - 1 ? '; ' : ''}
              </span>
            ))}
            {r.clashing_day && <span className="ml-2 opacity-80">({r.clashing_day})</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}

type ViewMode = 'idle' | 'processing' | 'actions' | 'details'

export function Scheduler({ result, onResult }: { result: PipelineOutput | null, onResult: (r: PipelineOutput | null) => void }) {
  const { run, progress } = useUnislotWorker()
  const [drag, setDrag] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('idle')

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      if (!/\.xlsx$/i.test(file.name)) {
        alert('Please upload an Excel workbook (.xlsx)')
        return
      }
      setFileName(file.name)
      onResult(null)
      setViewMode('processing')
      try {
        const out = await run(file)
        onResult(out)
        // If valid, show action buttons; if invalid, go straight to details
        if (out.validation.is_valid) {
          setViewMode('actions')
        } else {
          setViewMode('details')
        }
      } catch (e) {
        console.error(e)
        setViewMode('idle')
        alert(e instanceof Error ? e.message : 'Something went wrong')
      }
    },
    [run, onResult],
  )

  const showUploader = viewMode === 'idle'
  const showTerminal = viewMode === 'processing'
  const showActions = viewMode === 'actions' && result?.validation.is_valid
  const showDetails = viewMode === 'details' && result

  return (
    <div className={cn(
      'mx-auto flex flex-col px-8 max-w-5xl w-full',
      showTerminal ? 'py-6 h-full' : 'py-10',
      showActions && 'h-full justify-center',
    )}>
      <header className={cn(
        'flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between',
        showTerminal ? 'mb-4' : 'mb-12',
      )}>
        <div>
          <h1 className={cn(
            'font-bold tracking-tight text-text',
            showTerminal ? 'text-2xl' : 'text-4xl sm:text-5xl',
          )}>
            Scheduler
          </h1>
          {!showTerminal && (
            <p className="mt-3 max-w-xl text-lg leading-relaxed text-text-muted">
              Drop your enrollment workbook. Parsing, sectioning, conflict detection, and scheduling run
              entirely in a dedicated browser worker.
            </p>
          )}
        </div>
        {/* Show "New run" button when we're in actions/details mode */}
        {(viewMode === 'actions' || viewMode === 'details') && (
          <button
            type="button"
            onClick={() => {
              onResult(null)
              setViewMode('idle')
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-tertiary/50 px-4 py-2.5 text-sm font-medium text-text transition hover:bg-border shrink-0"
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            New run
          </button>
        )}
      </header>

      {/* ── Upload zone ──────────────────────────────────── */}
      {showUploader && (
        <section className="mb-10">
          <button
            type="button"
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              const f = e.dataTransfer.files[0]
              void handleFile(f ?? null)
            }}
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.xlsx'
              input.onchange = () => {
                const f = input.files?.[0]
                void handleFile(f ?? null)
              }
              input.click()
            }}
            className={cn(
              'group relative flex w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed px-6 py-16 transition-all duration-300',
              drag
                ? 'border-brand-500 bg-brand-500/5 shadow-[0_0_60px_-12px_rgba(var(--brand-500-rgb),0.3)]'
                : 'border-border bg-bg-secondary/30 hover:border-brand-500/50 hover:bg-bg-secondary/80',
            )}
          >
            <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-500 shadow-lg shadow-brand-500/30">
              <FileSpreadsheet className="size-7 text-white" aria-hidden />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-text">Click or drop enrollment .xlsx</p>
              {fileName && (
                <p className="mt-2 text-xs text-text-muted">Last file: {fileName}</p>
              )}
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-bg-tertiary px-4 py-2 text-sm font-medium text-text transition group-hover:bg-bg-tertiary/80 border border-border">
              Choose file
              <ArrowRight className="size-4 opacity-70" aria-hidden />
            </span>
          </button>
        </section>
      )}

      {/* ── Terminal (processing view) ───────────────────── */}
      {showTerminal && (
        <section className="flex-1 flex flex-col min-h-0 mb-4">
          <ProcessingTerminal
            stage={progress?.stage ?? null}
            message={progress?.message ?? null}
            done={false}
          />
          {fileName && (
            <p className="mt-3 text-center text-xs text-text-muted">
              Processing <span className="font-mono text-text">{fileName}</span>
            </p>
          )}
        </section>
      )}

      {/* ── Action buttons (after successful run) ────────── */}
      {showActions && result && (
        <section className="mb-10">
          <div className="results-panel">
            {/* Success icon */}
            <div className="results-check">
              <CheckCircle2 className="size-7" />
            </div>

            <div className="text-center">
              <h2 className="text-xl font-bold text-text">Pipeline Complete</h2>
              <p className="mt-1 text-sm text-text-muted">
                {result.stats?.studentCount} students · {result.stats?.courseCount} courses · {result.stats?.sectionCount} sections
              </p>
            </div>

            {/* Three action buttons */}
            <div className="results-actions">
              {result.scheduleXlsx && (
                <button
                  type="button"
                  onClick={() => downloadArrayBuffer(result.scheduleXlsx!, 'unislot-schedule.xlsx')}
                  className="btn-download btn-download-primary"
                >
                  <Download className="size-4" aria-hidden />
                  Download Schedule
                </button>
              )}
              {result.clashXlsx && (
                <button
                  type="button"
                  onClick={() => downloadArrayBuffer(result.clashXlsx!, 'unislot-clash-report.xlsx')}
                  className="btn-download btn-download-secondary"
                >
                  <Download className="size-4" aria-hidden />
                  Download Clash Report
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setViewMode('details')}
              className="btn-view"
            >
              <Eye className="size-4" aria-hidden />
              View Outcome
            </button>
          </div>
        </section>
      )}

      {/* ── Details view (full results) ──────────────────── */}
      {showDetails && result && (
        <section className="space-y-10 pb-20">
          {/* Back to actions button (only if valid) */}
          {result.validation.is_valid && (
            <button
              type="button"
              onClick={() => setViewMode('actions')}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-tertiary/50 px-4 py-2.5 text-sm font-medium text-text transition hover:bg-border"
            >
              ← Back to downloads
            </button>
          )}

          {!result.validation.is_valid && (
            <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-6 shrink-0 text-red-500" aria-hidden />
                <div>
                  <h2 className="text-lg font-semibold text-red-500">Validation did not pass</h2>
                  <p className="mt-1 text-sm text-red-500/80">
                    Fix the sheet and try again. Showing up to 80 issues.
                  </p>
                  <ValidationList items={result.validation.errors} variant="error" />
                  <ValidationList items={result.validation.warnings} variant="warn" />
                </div>
              </div>
            </div>
          )}

          {result.validation.is_valid && result.schedule && result.clashReport && result.stats && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { label: 'Students', value: result.stats.studentCount, icon: Users },
                  { label: 'Courses', value: result.stats.courseCount, icon: FileSpreadsheet },
                  { label: 'Sections', value: result.stats.sectionCount, icon: CalendarDays },
                ].map(({ label, value, icon: Icon }) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-border bg-bg-secondary/50 p-5 shadow-sm backdrop-blur"
                  >
                    <Icon className="size-5 text-brand-500" aria-hidden />
                    <p className="mt-3 text-3xl font-semibold tabular-nums text-text">{value}</p>
                    <p className="text-sm text-text-muted">{label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl border border-border bg-bg-secondary/30">
                <div>
                  <h2 className="text-lg font-semibold text-text">Exports</h2>
                  <p className="text-sm text-text-muted mt-1 max-w-md">
                    Schedule workbook, multi-sheet clash analysis, and course-wise email lists.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {result.scheduleXlsx && (
                    <button
                      type="button"
                      onClick={() => downloadArrayBuffer(result.scheduleXlsx!, 'unislot-schedule.xlsx')}
                      className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-600"
                    >
                      <Download className="size-4" aria-hidden />
                      Schedule
                    </button>
                  )}
                  {result.clashXlsx && (
                    <button
                      type="button"
                      onClick={() => downloadArrayBuffer(result.clashXlsx!, 'unislot-clash-report.xlsx')}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-tertiary/50 px-4 py-2.5 text-sm font-medium text-text transition hover:bg-border"
                    >
                      <Download className="size-4" aria-hidden />
                      Clash report
                    </button>
                  )}
                </div>
              </div>

              <SchedulePreview entries={result.schedule.entries} />

              <div>
                <h2 className="mb-3 text-xl font-semibold text-text">Clash overview</h2>
                <p className="mb-4 text-sm text-text-muted">
                  {result.clashReport.students_with_clashes} students with overlaps (
                  {result.clashReport.clash_percentage}%)
                </p>
                <ClashPreview reports={result.clashReport.reports} />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

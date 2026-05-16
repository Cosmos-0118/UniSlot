import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Library,
  Users,
} from 'lucide-react'
import { useCallback, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/utils/cn'
import type { RunPipelineOptions } from '@/modules/scheduling/pipeline'
import type { ValidationError } from '@/modules/scheduling/types'
import { useSchedulingSession } from '../contexts/useSchedulingSession'
import { ProcessingTerminal } from '../components/ui/ProcessingTerminal'
import { createSavedRun } from '@/lib/savedRunsStorage'
import { downloadArrayBuffer } from '@/lib/downloadArrayBuffer'
import {
  ClashPreview,
  HardConstraintAuditNotice,
  ScheduleExportBlockedNotice,
  SchedulePreview,
} from './schedulerResultUi'

function ValidationList({ items, variant }: { items: ValidationError[]; variant: 'error' | 'warn' }) {
  if (!items.length) return null

  const palette: CSSProperties =
    variant === 'error'
      ? {
        borderColor: 'var(--soft-danger-border)',
        background: 'var(--soft-danger-bg)',
        color: 'var(--accent-danger)',
      }
      : {
        borderColor: 'var(--soft-warning-border)',
        background: 'var(--soft-warning-bg)',
        color: 'var(--accent-warning)',
      }

  return (
    <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
      {items.slice(0, 80).map((e, i) => (
        <li key={i} className="rounded-lg border px-3 py-2" style={palette}>
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

export function Scheduler() {
  const {
    result,
    setResult,
    fileName,
    setFileName,
    viewMode,
    setViewMode,
    run,
    running,
    progress,
    resetTerminalLog,
    terminalLines,
    terminalTypingIdx,
    onTerminalLineTypeDone,
  } = useSchedulingSession()
  const navigate = useNavigate()
  const [drag, setDrag] = useState(false)
  const [runSeedInput, setRunSeedInput] = useState('')
  const [allowProvisionalExport, setAllowProvisionalExport] = useState(false)

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      if (!/\.xlsx$/i.test(file.name)) {
        alert('Please upload an Excel workbook (.xlsx)')
        return
      }
      resetTerminalLog()
      setFileName(file.name)
      setResult(null)
      setViewMode('processing')
      try {
        const pipelineOpts: RunPipelineOptions = {}
        const raw = runSeedInput.trim()
        if (raw !== '') {
          const n = Number(raw)
          if (Number.isFinite(n)) pipelineOpts.randomSeed = Math.floor(n)
        }
        if (allowProvisionalExport) pipelineOpts.allowProvisionalScheduleExport = true
        const keys = Object.keys(pipelineOpts) as (keyof RunPipelineOptions)[]
        const out = await run(file, keys.length > 0 ? pipelineOpts : undefined)
        setResult(out)
        if (out.validation.is_valid) {
          setViewMode('actions')
        } else {
          setViewMode('details')
        }
      } catch (e) {
        console.error(e)
        resetTerminalLog()
        setViewMode('idle')
        alert(e instanceof Error ? e.message : 'Something went wrong')
      }
    },
    [run, setResult, setFileName, setViewMode, resetTerminalLog, runSeedInput, allowProvisionalExport],
  )

  const showUploader = viewMode === 'idle'
  const showTerminal = viewMode === 'processing'
  const showActions = viewMode === 'actions' && result?.validation.is_valid
  const showDetails = viewMode === 'details' && result

  return (
    <div className={cn(
      'mx-auto flex w-full max-w-5xl flex-col px-4 sm:px-8',
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
              resetTerminalLog()
              setResult(null)
              setViewMode('idle')
            }}
            className="theme-btn-secondary theme-focusable inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            New run
          </button>
        )}
      </header>

      {/* ── Upload zone ──────────────────────────────────── */}
      {showUploader && (
        <section className="mb-10">
          <details className="theme-card mb-6 rounded-2xl border border-border px-4 py-3">
            <summary className="cursor-pointer select-none text-sm font-medium text-text">
              Run options (determinism & exports)
            </summary>
            <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
              <label className="block text-sm">
                <span className="text-text-muted">Deterministic RNG seed (optional)</span>
                <input
                  type="number"
                  value={runSeedInput}
                  onChange={(e) => setRunSeedInput(e.target.value)}
                  placeholder="e.g. 42 — same file + seed → same search path"
                  className="theme-focusable mt-1.5 w-full max-w-md rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text"
                />
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm leading-snug text-text-muted">
                <input
                  type="checkbox"
                  checked={allowProvisionalExport}
                  onChange={(e) => setAllowProvisionalExport(e.target.checked)}
                  className="theme-focusable mt-0.5 size-4 shrink-0 rounded border-border"
                />
                <span>
                  Allow provisional <span className="font-mono text-xs text-text">schedule</span> workbook (.xlsx) when
                  the hard-constraint audit fails. Use only when you intentionally accept a non-certified export.
                </span>
              </label>
            </div>
          </details>
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
              'theme-dropzone theme-focusable group relative flex w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed px-6 py-16 transition-all duration-300',
              drag && 'theme-dropzone-active',
            )}
          >
            <div
              className="flex size-14 items-center justify-center rounded-2xl shadow-lg shadow-brand-500/30"
              style={{
                background: 'var(--btn-primary-from)',
              }}
            >
              <FileSpreadsheet className="size-7 text-white" aria-hidden />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-text">Click or drop enrollment .xlsx</p>
              {fileName && (
                <p className="mt-2 text-xs text-text-muted">Last file: {fileName}</p>
              )}
            </div>
            <span className="theme-btn-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium">
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
            lines={terminalLines}
            typingIdx={terminalTypingIdx}
            onLineTypeDone={onTerminalLineTypeDone}
            done={false}
            progressFraction={running ? progress?.fraction : undefined}
            progressMessage={running ? progress?.message : undefined}
            progressEta={running ? progress?.etaSeconds : undefined}
            fileLabel={fileName ?? undefined}
          />
        </section>
      )}

      {/* ── Action buttons (after successful run) ────────── */}
      {showActions && result && (
        <section className="mb-10">
          <div className="results-panel">
            {result.schedule && <HardConstraintAuditNotice schedule={result.schedule} />}
            <ScheduleExportBlockedNotice
              blocked={result.schedule_export_blocked}
              reason={result.schedule_export_block_reason}
            />
            {/* Success icon */}
            <div className="results-check">
              <CheckCircle2 className="size-7" />
            </div>

            <div className="text-center">
              <h2 className="text-xl font-bold text-text">Pipeline Complete</h2>
              <p className="mt-1 text-sm text-text-muted">
                {result.stats?.studentCount} students · {result.stats?.courseCount} courses · {result.stats?.sectionCount} sections
              </p>
              {result.stats?.scheduling && (
                <p className="mt-1 text-xs text-text-muted/90">
                  Load: peak {result.stats.scheduling.max_parallel_sections_in_slot} parallel sections in one slot ·
                  avg {result.stats.scheduling.average_parallel_sections_per_slot} per slot ·{' '}
                  {result.stats.scheduling.slots_with_zero_courses} unused slots (of {result.stats.scheduling.total_weekly_slots})
                  {' · '}
                  weekday balance (L1) {result.stats.scheduling.weekday_balance_l1}
                </p>
              )}
            </div>

            {/* Three action buttons */}
            <div className="results-actions">
              {result.scheduleXlsx ? (
                <button
                  type="button"
                  onClick={() => downloadArrayBuffer(result.scheduleXlsx!, 'unislot-schedule.xlsx')}
                  className="btn-download btn-download-primary"
                >
                  <Download className="size-4" aria-hidden />
                  Download Schedule
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title={
                    result.schedule_export_block_reason ??
                    'Schedule workbook was not generated for this run.'
                  }
                  className="btn-download btn-download-primary cursor-not-allowed opacity-50"
                >
                  <Download className="size-4" aria-hidden />
                  Schedule export blocked
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

            {result.schedulingSnapshot && (
              <button
                type="button"
                onClick={() => {
                  const stem = (fileName ?? 'schedule').replace(/\.xlsx$/i, '')
                  const run = createSavedRun({
                    title: `${stem} (${new Date().toLocaleDateString()})`,
                    sourceFileName: fileName,
                    snapshot: result.schedulingSnapshot!,
                  })
                  navigate(`/app/runs/${run.id}`)
                }}
                className="theme-btn-secondary theme-focusable mx-auto mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
              >
                <Library className="size-4" aria-hidden />
                Save run for late registrations
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Details view (full results) ──────────────────── */}
      {showDetails && result && (
        <section className="space-y-10 pb-20">
          {result.schedule && <HardConstraintAuditNotice schedule={result.schedule} />}
          <ScheduleExportBlockedNotice
            blocked={result.schedule_export_blocked}
            reason={result.schedule_export_block_reason}
          />
          {/* Back to actions button (only if valid) */}
          {result.validation.is_valid && (
            <button
              type="button"
              onClick={() => setViewMode('actions')}
              className="theme-btn-outline theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
            >
              ← Back to downloads
            </button>
          )}

          {!result.validation.is_valid && (
            <div className="theme-soft-danger rounded-3xl p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-6 shrink-0" aria-hidden />
                <div>
                  <h2 className="text-lg font-semibold">Validation did not pass</h2>
                  <p className="mt-1 text-sm opacity-85">
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
                    className="theme-card rounded-2xl p-5"
                  >
                    <Icon className="size-5 text-brand-500" aria-hidden />
                    <p className="mt-3 text-3xl font-semibold tabular-nums text-text">{value}</p>
                    <p className="text-sm text-text-muted">{label}</p>
                  </div>
                ))}
              </div>

              <div className="theme-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
                <div>
                  <h2 className="text-lg font-semibold text-text">Exports</h2>
                  <p className="text-sm text-text-muted mt-1 max-w-md">
                    Schedule workbook, multi-sheet clash analysis, and course-wise email lists.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {result.scheduleXlsx ? (
                    <button
                      type="button"
                      onClick={() => downloadArrayBuffer(result.scheduleXlsx!, 'unislot-schedule.xlsx')}
                      className="theme-btn-primary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                    >
                      <Download className="size-4" aria-hidden />
                      Schedule
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title={
                        result.schedule_export_block_reason ??
                        'Schedule workbook was not generated for this run.'
                      }
                      className="theme-btn-primary inline-flex cursor-not-allowed items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium opacity-50"
                    >
                      <Download className="size-4" aria-hidden />
                      Schedule (blocked)
                    </button>
                  )}
                  {result.clashXlsx && (
                    <button
                      type="button"
                      onClick={() => downloadArrayBuffer(result.clashXlsx!, 'unislot-clash-report.xlsx')}
                      className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                    >
                      <Download className="size-4" aria-hidden />
                      Clash report
                    </button>
                  )}
                </div>
              </div>

              {result.schedulingSnapshot && (
                <div className="theme-card rounded-2xl p-5">
                  <h2 className="text-lg font-semibold text-text">Late registrations</h2>
                  <p className="mt-1 max-w-lg text-sm text-text-muted">
                    Store this run, then open it under Saved runs to merge new enrollment rows. Existing section slots
                    stay fixed.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const stem = (fileName ?? 'schedule').replace(/\.xlsx$/i, '')
                      const run = createSavedRun({
                        title: `${stem} (${new Date().toLocaleDateString()})`,
                        sourceFileName: fileName,
                        snapshot: result.schedulingSnapshot!,
                      })
                      navigate(`/app/runs/${run.id}`)
                    }}
                    className="theme-btn-secondary theme-focusable mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                  >
                    <Library className="size-4" aria-hidden />
                    Save run for late registrations
                  </button>
                </div>
              )}

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

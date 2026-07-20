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
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { scheduleWithEntries } from '@/features/scheduling/hooks/useUnislotWorker'
import type { PipelineExportKind } from '@/modules/scheduling/pipeline/exports'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/utils/cn'
import type { RunPipelineOptions } from '@/modules/scheduling/pipeline/run'
import type { ValidationError } from '@/modules/scheduling/types'
import { useAppDialog } from '@/contexts/appDialog/useAppDialog'
import { useSchedulingSession } from '@/contexts/scheduling/useSchedulingSession'
import { ProcessingTerminal } from '@/components/ui/ProcessingTerminal'
import { createSavedRun } from '@/features/scheduling/storage/savedRunsStorage'
import { downloadArrayBuffer } from '@/shared/lib/downloadArrayBuffer'
import { FacultyMappingPanel } from '@/features/scheduling/FacultyMappingPanel'
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
    viewMode,
    setViewMode,
    startRun,
    cancelRun,
    exportXlsx,
    fetchSchedulingSnapshot,
    fetchScheduleEntries,
    syncWorkerArtifacts,
    warmupWorker,
    running,
    progress,
    displayEtaSeconds,
    backgroundThrottled,
    beginNewRun,
    resetTerminalLog,
    flushTerminalLog,
    terminalLines,
    terminalTypingIdx,
    onTerminalLineTypeDone,
  } = useSchedulingSession()
  const { alert: showAlert } = useAppDialog()
  const navigate = useNavigate()
  const [drag, setDrag] = useState(false)
  const [runSeedInput, setRunSeedInput] = useState('')
  const [allowProvisionalExport, setAllowProvisionalExport] = useState(false)
  const [effortLevel, setEffortLevel] = useState<'fast' | 'balanced' | 'max'>('balanced')
  const [exportBusy, setExportBusy] = useState<PipelineExportKind | null>(null)
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [entriesBusy, setEntriesBusy] = useState(false)

  const ensureSnapshot = useCallback(async () => {
    if (!result) return null
    if (result.schedulingSnapshot) return result.schedulingSnapshot
    if (!result.hasDeferredSnapshot) return null
    setSnapshotBusy(true)
    try {
      const snapshot = await fetchSchedulingSnapshot()
      setResult({ ...result, schedulingSnapshot: snapshot, hasDeferredSnapshot: false })
      return snapshot
    } finally {
      setSnapshotBusy(false)
    }
  }, [result, fetchSchedulingSnapshot, setResult])

  const saveRunForLateRegistrations = useCallback(async () => {
    const snapshot = await ensureSnapshot()
    if (!snapshot) return
    const stem = (fileName ?? 'schedule').replace(/\.xlsx$/i, '')
    const saved = createSavedRun({
      title: `${stem} (${new Date().toLocaleDateString()})`,
      sourceFileName: fileName,
      snapshot,
    })
    navigate(`/app/runs/${saved.id}`)
  }, [ensureSnapshot, fileName, navigate])

  useEffect(() => {
    if (viewMode !== 'idle') return
    let cancelled = false
    const runWarmup = () => {
      if (!cancelled) warmupWorker({ includeSolver: true })
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(runWarmup, { timeout: 2500 })
      return () => {
        cancelled = true
        cancelIdleCallback(id)
      }
    }
    const t = window.setTimeout(runWarmup, 500)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [viewMode, warmupWorker])

  useEffect(() => {
    if (!result?.hasDeferredSnapshot || result.schedulingSnapshot) return
    if (viewMode !== 'actions' && viewMode !== 'details') return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void ensureSnapshot()
    })
    return () => {
      cancelled = true
    }
  }, [viewMode, result?.hasDeferredSnapshot, result?.schedulingSnapshot, ensureSnapshot])

  useEffect(() => {
    if (viewMode !== 'details' || !result?.schedule) return
    if (result.schedule.entries.length > 0 || !result.hasDeferredScheduleEntries) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setEntriesBusy(true)
      void fetchScheduleEntries()
        .then((entries) => {
          if (cancelled || !result.schedule) return
          setResult({
            ...result,
            schedule: scheduleWithEntries(result.schedule, entries),
            hasDeferredScheduleEntries: false,
          })
        })
        .catch((e) => console.error(e))
        .finally(() => {
          if (!cancelled) setEntriesBusy(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [viewMode, result, fetchScheduleEntries, setResult])

  const downloadXlsx = useCallback(
    async (
      kind: PipelineExportKind,
      filename: string,
      bufferKey: 'scheduleXlsx' | 'clashXlsx' | 'courseEmailsXlsx',
    ) => {
      if (!result) return
      const cached = result[bufferKey]
      if (cached) {
        downloadArrayBuffer(cached, filename)
        return
      }
      setExportBusy(kind)
      try {
        const buf = await exportXlsx(kind)
        setResult({ ...result, [bufferKey]: buf })
        downloadArrayBuffer(buf, filename)
      } catch (e) {
        void showAlert({
          title: 'Export failed',
          message: e instanceof Error ? e.message : 'Export failed',
          tone: 'warning',
        })
      } finally {
        setExportBusy(null)
      }
    },
    [result, exportXlsx, setResult, showAlert],
  )

  // Flush typewriter when leaving the Scheduler mid-run so the log queue cannot stall.
  useEffect(() => {
    return () => {
      flushTerminalLog()
    }
  }, [flushTerminalLog])

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      if (!/\.xlsx$/i.test(file.name)) {
        void showAlert({
          title: 'Invalid file',
          message: 'Please upload an Excel workbook (.xlsx).',
          tone: 'warning',
        })
        return
      }
      try {
        const pipelineOpts: RunPipelineOptions = {}
        const raw = runSeedInput.trim()
        if (raw !== '') {
          const n = Number(raw)
          if (Number.isFinite(n)) pipelineOpts.randomSeed = Math.floor(n)
        }
        if (allowProvisionalExport) pipelineOpts.allowProvisionalScheduleExport = true
        pipelineOpts.effort = effortLevel
        const keys = Object.keys(pipelineOpts) as (keyof RunPipelineOptions)[]
        await startRun(file, keys.length > 0 ? pipelineOpts : undefined)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Something went wrong'
        if (msg.toLowerCase().includes('cancelled')) return
        console.error(e)
        void showAlert({
          title: 'Scheduling failed',
          message: msg,
          tone: 'warning',
        })
      }
    },
    [startRun, runSeedInput, allowProvisionalExport, effortLevel, showAlert],
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
            onClick={() => beginNewRun()}
            className="theme-btn-secondary theme-focusable inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            New run
          </button>
        )}
      </header>

      {backgroundThrottled && viewMode === 'processing' && (
        <div
          className="mb-4 rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--soft-warning-border)',
            background: 'var(--soft-warning-bg)',
            color: 'var(--accent-warning)',
          }}
          role="status"
        >
          Tab in background — the browser may slow this run. Keep this tab focused for the fastest ETA.
        </div>
      )}

      {/* ── Upload zone ──────────────────────────────────── */}
      {showUploader && (
        <section className="mb-10">
          <details className="theme-card mb-6 rounded-2xl border border-border px-4 py-3">
            <summary className="cursor-pointer select-none text-sm font-medium text-text">
              Run options (determinism & exports)
            </summary>
            <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
              <div>
                <span className="text-sm text-text-muted">Search effort</span>
                <div className="mt-2 inline-flex rounded-xl border border-border bg-bg p-1">
                  {(
                    [
                      ['fast', 'Fast'],
                      ['balanced', 'Balanced'],
                      ['max', 'Max'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setEffortLevel(value)}
                      className={`theme-focusable rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        effortLevel === value
                          ? 'bg-accent text-white'
                          : 'text-text-muted hover:text-text'
                      }`}
                      aria-pressed={effortLevel === value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-text-muted">
                  {effortLevel === 'fast'
                    ? 'Quick pass — fewer seeds and shorter refine.'
                    : effortLevel === 'max'
                      ? 'Longest search — more seeds, Kempe escapes, and elite restarts.'
                      : 'Default — solid quality vs time (recommended).'}
                </p>
              </div>
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
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                cancelRun()
                resetTerminalLog()
                setViewMode('idle')
              }}
              disabled={!running}
              className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel run
            </button>
          </div>
          <ProcessingTerminal
            lines={terminalLines}
            typingIdx={terminalTypingIdx}
            onLineTypeDone={onTerminalLineTypeDone}
            done={false}
            progressFraction={running ? progress?.fraction : undefined}
            progressMessage={running ? progress?.message : undefined}
            progressEta={running ? displayEtaSeconds : undefined}
            fileLabel={fileName ?? undefined}
            backgroundThrottled={backgroundThrottled}
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
              {result.schedule_export_blocked ? (
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
              ) : (
                <button
                  type="button"
                  disabled={exportBusy === 'schedule'}
                  onClick={() => void downloadXlsx('schedule', 'unislot-schedule.xlsx', 'scheduleXlsx')}
                  className="btn-download btn-download-primary"
                >
                  <Download className="size-4" aria-hidden />
                  {exportBusy === 'schedule' ? 'Preparing schedule…' : 'Download Schedule'}
                </button>
              )}
              <button
                type="button"
                disabled={exportBusy === 'clash' || !result.clashReport}
                onClick={() => void downloadXlsx('clash', 'unislot-clash-report.xlsx', 'clashXlsx')}
                className="btn-download btn-download-secondary"
              >
                <Download className="size-4" aria-hidden />
                {exportBusy === 'clash' ? 'Preparing clash report…' : 'Download Clash Report'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setViewMode('details')}
              className="btn-view"
            >
              <Eye className="size-4" aria-hidden />
              View Outcome
            </button>

            {(result.schedulingSnapshot || result.hasDeferredSnapshot) && (
              <button
                type="button"
                disabled={snapshotBusy}
                onClick={() => void saveRunForLateRegistrations()}
                className="theme-btn-secondary theme-focusable mx-auto mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-60"
              >
                <Library className="size-4" aria-hidden />
                {snapshotBusy ? 'Preparing saved run…' : 'Save run for late registrations'}
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
                  {result.schedule_export_blocked ? (
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
                  ) : (
                    <button
                      type="button"
                      disabled={exportBusy === 'schedule'}
                      onClick={() => void downloadXlsx('schedule', 'unislot-schedule.xlsx', 'scheduleXlsx')}
                      className="theme-btn-primary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                    >
                      <Download className="size-4" aria-hidden />
                      {exportBusy === 'schedule' ? 'Preparing…' : 'Schedule'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={exportBusy === 'clash' || !result.clashReport}
                    onClick={() => void downloadXlsx('clash', 'unislot-clash-report.xlsx', 'clashXlsx')}
                    className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                  >
                    <Download className="size-4" aria-hidden />
                    {exportBusy === 'clash' ? 'Preparing…' : 'Clash report'}
                  </button>
                </div>
              </div>

              {(result.schedulingSnapshot || result.hasDeferredSnapshot) &&
                (result.schedulingSnapshot ? (
                  <FacultyMappingPanel
                    snapshot={result.schedulingSnapshot}
                    schedule={result.schedule}
                    onApplied={({ snapshot, schedule, auditFeasible }) => {
                      syncWorkerArtifacts({ schedule, snapshot })
                      setResult({
                        ...result,
                        schedulingSnapshot: snapshot,
                        schedule,
                        scheduleXlsx: null,
                        schedule_export_blocked: auditFeasible
                          ? result.schedule_export_blocked
                          : true,
                        schedule_export_block_reason: auditFeasible
                          ? result.schedule_export_block_reason
                          : 'Hard-constraint audit failed after faculty mapping. Fix faculty double-booking or re-run with provisional export enabled.',
                      })
                    }}
                  />
                ) : (
                  <p className="text-sm text-text-muted">Loading faculty mapping tools…</p>
                ))}

              {(result.schedulingSnapshot || result.hasDeferredSnapshot) && (
                <div className="theme-card rounded-2xl p-5">
                  <h2 className="text-lg font-semibold text-text">Late registrations</h2>
                  <p className="mt-1 max-w-lg text-sm text-text-muted">
                    Store this run, then open it under Saved runs to merge new enrollment rows. Existing section slots
                    stay fixed.
                  </p>
                  <button
                    type="button"
                    disabled={snapshotBusy}
                    onClick={() => void saveRunForLateRegistrations()}
                    className="theme-btn-secondary theme-focusable mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-60"
                  >
                    <Library className="size-4" aria-hidden />
                    {snapshotBusy ? 'Preparing…' : 'Save run for late registrations'}
                  </button>
                </div>
              )}

              {entriesBusy ? (
                <p className="text-sm text-text-muted">Loading timetable preview…</p>
              ) : (
                <SchedulePreview entries={result.schedule.entries} />
              )}

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

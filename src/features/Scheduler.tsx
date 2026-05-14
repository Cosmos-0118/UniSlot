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
import { useCallback, useState, type CSSProperties } from 'react'
import { cn } from '@/shared/utils/cn'
import type { RunPipelineOptions } from '@/modules/scheduling/pipeline'
import type { Schedule, ScheduleEntry, StudentClashReport, ValidationError } from '@/modules/scheduling/types'
import { useSchedulingSession } from '../contexts/useSchedulingSession'
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

function HardConstraintAuditNotice({ schedule }: { schedule: Schedule }) {
  if (schedule.hard_constraints_feasible !== false) return null
  const items = schedule.hard_constraint_violations ?? []
  return (
    <div
      className="mb-6 rounded-2xl border px-4 py-3 text-left text-sm"
      style={{
        borderColor: 'var(--soft-warning-border)',
        background: 'var(--soft-warning-bg)',
        color: 'var(--text)',
      }}
    >
      <div className="flex gap-3">
        <AlertTriangle className="size-5 shrink-0" style={{ color: 'var(--accent-warning)' }} aria-hidden />
        <div>
          <p className="font-medium">Hard-constraint audit reported issues</p>
          <p className="mt-1 text-xs opacity-90">
            The timetable may still violate Constraints.md rules (faculty overlap, capacity, parallel cap, or split-section
            alignment). Treat exports as provisional until resolved.
          </p>
          {items.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-4 font-mono text-[11px] leading-snug opacity-95">
              {items.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function ScheduleExportBlockedNotice({
  blocked,
  reason,
}: {
  blocked?: boolean
  reason?: string | null
}) {
  if (!blocked) return null
  return (
    <div
      className="mb-6 rounded-2xl border px-4 py-3 text-left text-sm"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--accent-info) 10%, var(--bg-secondary))',
      }}
    >
      <p className="font-medium text-text">Schedule workbook was not exported</p>
      <p className="mt-1 text-xs text-text-muted leading-relaxed">
        {reason ??
          'Hard-constraint audit failed. Enable “Allow provisional schedule export” under Run options and process the file again if you need the .xlsx.'}
      </p>
    </div>
  )
}

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

function SchedulePreview({ entries }: { entries: ScheduleEntry[] }) {
  return (
    <div className="theme-card overflow-hidden rounded-2xl">
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-bg/95 backdrop-blur">
            <tr className="border-b border-border text-xs uppercase tracking-wider text-text-muted">
              <th className="px-4 py-3 font-medium">Course</th>
              <th className="px-4 py-3 font-medium">Section</th>
              <th className="px-4 py-3 font-medium">Slot</th>
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
                <td className="px-4 py-3 font-mono text-xs text-text-muted" title="Global evening slot index (0–54)">
                  {e.slot_index}
                </td>
                <td className="px-4 py-3">
                  <span className="theme-chip-brand px-2.5 py-1 text-xs font-medium">
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
      <div className="theme-soft-success flex items-center gap-3 rounded-2xl px-4 py-4">
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
          className="rounded-xl border px-3 py-2"
          style={{
            borderColor: 'var(--soft-danger-border)',
            background: 'var(--soft-danger-bg)',
            color: 'var(--accent-danger)',
          }}
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
            {(r.clashing_days.length > 0 || r.clashing_day) && (
              <span className="ml-2 opacity-80">
                (
                {r.clashing_days.length > 0 ? r.clashing_days.join(', ') : r.clashing_day}
                )
              </span>
            )}
          </div>
        </li>
      ))}
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
    resetTerminalLog,
    terminalLines,
    terminalTypingIdx,
    onTerminalLineTypeDone,
  } = useSchedulingSession()
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

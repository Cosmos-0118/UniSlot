import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Mail,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { applySavedRunEmailsToSession } from '@/features/scheduling/courseEmailsFromSnapshot'
import { useSchedulingSession } from '@/contexts/scheduling/useSchedulingSession'
import { SavedRunListCard, SavedRunsEmptyState } from '@/features/scheduling/SavedRunListCard'
import { formatSavedAt, snapshotStats, sourceFileLabel } from '@/features/scheduling/savedRunDisplay'
import { cn } from '@/shared/utils/cn'
import { buildScheduleFromSnapshot, countPlanningFacultySections } from '@/modules/scheduling/merge/facultyMapping'
import type { SchedulingSnapshot } from '@/modules/scheduling/merge/snapshot'
import { mergeLateEnrollmentIntoSnapshot } from '@/modules/scheduling/merge/lateEnrollment'
import {
  buildSavedRunClashXlsx,
  buildSavedRunCourseEmailsXlsx,
  buildSavedRunScheduleXlsx,
  computeSavedRunExportState,
} from '@/modules/scheduling/merge/savedRunExports'
import type { RunPipelineOptions } from '@/modules/scheduling/pipeline/run'
import {
  deleteSavedRun,
  getSavedRun,
  loadSavedRuns,
  SAVED_RUNS_CHANGED_EVENT,
  updateSavedRunSnapshot,
  type SavedScheduleRun,
} from '@/features/scheduling/storage/savedRunsStorage'
import { useAppDialog } from '@/contexts/appDialog/useAppDialog'
import { downloadArrayBuffer } from '@/shared/lib/downloadArrayBuffer'
import { FacultyMappingPanel } from '@/features/scheduling/FacultyMappingPanel'
import {
  HardConstraintAuditNotice,
  ScheduleExportBlockedNotice,
  SchedulePreview,
} from '@/features/scheduling/schedulerResultUi'
import type { Schedule } from '@/modules/scheduling/types'

export function SavedRunsPage() {
  const { runId } = useParams<{ runId?: string }>()
  const navigate = useNavigate()
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

  const selected = runId ? getSavedRun(runId) : null

  if (runId && !selected) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-16 sm:px-8">
        <p className="text-text-muted">This saved run no longer exists (or the link is invalid).</p>
        <Link
          to="/app/runs"
          className="theme-btn-secondary theme-focusable inline-flex w-fit items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
        >
          <ArrowLeft className="size-4" aria-hidden />
          All saved runs
        </Link>
      </div>
    )
  }

  if (selected) {
    return <SavedRunDetail key={selected.id} run={selected} onDeleted={() => navigate('/app/runs')} />
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-10 sm:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-400">Workspace</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight text-text sm:text-5xl">Saved runs</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-muted">
            Frozen timetables from successful scheduler passes. Open a run to merge late registrations, map faculty, or
            export workbooks—without moving slots for students already placed.
          </p>
        </div>
        {runs.length > 0 ? (
          <span className="theme-soft-info inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold">
            <CalendarDays className="size-4 text-[var(--accent-info)]" aria-hidden />
            {runs.length} {runs.length === 1 ? 'run' : 'runs'}
          </span>
        ) : null}
      </header>

      {runs.length === 0 ? (
        <SavedRunsEmptyState />
      ) : (
        <ul className="flex w-full flex-col gap-3">
          {runs.map((r) => (
            <SavedRunListCard key={r.id} run={r} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SavedRunDetail({ run, onDeleted }: { run: SavedScheduleRun; onDeleted: () => void }) {
  const navigate = useNavigate()
  const { setResult, setFileName, result } = useSchedulingSession()
  const { alert: showAlert, confirm: showConfirm } = useAppDialog()
  const [title, setTitle] = useState(run.title)
  const [snapshot, setSnapshot] = useState(run.snapshot)
  const [mergeBusy, setMergeBusy] = useState(false)
  const [allowProvisionalExport, setAllowProvisionalExport] = useState(false)
  const [mergeIssues, setMergeIssues] = useState<string[]>([])
  const [mergeSuccessSummary, setMergeSuccessSummary] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState<'schedule' | 'clash' | 'courseEmails' | null>(null)

  const [schedule, setSchedule] = useState<Schedule>(() => buildScheduleFromSnapshot(snapshot).schedule)

  const handleFacultyApplied = useCallback(
    (next: { snapshot: SchedulingSnapshot; schedule: Schedule }) => {
      setSnapshot(next.snapshot)
      setSchedule(next.schedule)
      updateSavedRunSnapshot(run.id, next.snapshot)
    },
    [run.id],
  )

  const exportState = useMemo(
    () =>
      computeSavedRunExportState(snapshot, {
        allowProvisionalScheduleExport: allowProvisionalExport,
      }),
    [snapshot, allowProvisionalExport],
  )

  const persistTitle = useCallback(() => {
    const t = title.trim() || run.title
    updateSavedRunSnapshot(run.id, snapshot, { title: t })
    setTitle(t)
  }, [run.id, run.title, snapshot, title])

  const handleMergeFile = useCallback(
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
      setMergeIssues([])
      setMergeSuccessSummary(null)
      setMergeBusy(true)
      try {
        const buf = await file.arrayBuffer()
        const opts: RunPipelineOptions = {}
        if (allowProvisionalExport) opts.allowProvisionalScheduleExport = true
        const out = await mergeLateEnrollmentIntoSnapshot(snapshot, buf, opts)
        const issueMessages = [
          ...out.validation.errors.map((e) => e.message),
          ...out.validation.warnings.map((w) => w.message),
        ]
        if (!out.validation.is_valid || !out.schedulingSnapshot) {
          setMergeIssues(
            issueMessages.length > 0
              ? issueMessages
              : ['Merge did not complete. Fix the sheet or check that courses match this saved run.'],
          )
          setMergeSuccessSummary(null)
          return
        }
        setSnapshot(out.schedulingSnapshot)
        setSchedule(out.schedule!)
        updateSavedRunSnapshot(run.id, out.schedulingSnapshot)
        const s = out.mergeSummary
        setMergeSuccessSummary(
          s
            ? `Merged ${s.addedEnrollmentRows} new row(s) · ${s.newStudents} new student(s) · ${s.existingStudentsNewCourses} existing student(s) with added course(s).`
            : 'Merge complete.',
        )
        if (issueMessages.length > 0) setMergeIssues(issueMessages)
      } catch (e) {
        console.error(e)
        setMergeIssues([e instanceof Error ? e.message : 'Merge failed'])
        setMergeSuccessSummary(null)
      } finally {
        setMergeBusy(false)
      }
    },
    [allowProvisionalExport, run.id, snapshot, showAlert],
  )

  const handleDelete = () => {
    void (async () => {
      const ok = await showConfirm({
        title: 'Delete saved run?',
        message: 'This cannot be undone. The timetable snapshot will be removed from this browser.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep',
        tone: 'danger',
      })
      if (!ok) return
      deleteSavedRun(run.id)
      onDeleted()
    })()
  }

  const { studentCount, courseCount, sectionCount } = snapshotStats(snapshot)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 pb-24 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/app/runs"
            className="theme-btn-ghost theme-focusable mb-4 inline-flex items-center gap-2 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Saved runs
          </Link>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">Title</span>
            <div className="mt-1 flex flex-wrap gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => persistTitle()}
                className="theme-focusable min-w-[240px] flex-1 rounded-xl border border-border bg-bg px-3 py-2 text-lg font-semibold text-text"
              />
            </div>
          </label>
          <p className="mt-2 text-sm text-text-muted">
            Saved {formatSavedAt(run.createdAt).primary}
            {run.sourceFileName ? (
              <>
                {' · '}Original file{' '}
                <span className="font-mono text-xs">{sourceFileLabel(run.sourceFileName)}</span>
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          className="theme-focusable inline-flex items-center gap-2 self-start rounded-xl border border-border px-3 py-2 text-sm text-text-muted hover:border-red-500/40 hover:text-red-500"
        >
          <Trash2 className="size-4" aria-hidden />
          Delete
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Students', value: studentCount, icon: Users, shell: 'theme-soft-info', iconClass: 'text-[var(--accent-info)]' },
          {
            label: 'Courses',
            value: courseCount,
            icon: FileSpreadsheet,
            shell:
              'border-[color-mix(in_srgb,var(--brand-500)_32%,transparent)] bg-[color-mix(in_srgb,var(--brand-500)_14%,transparent)]',
            iconClass: 'text-brand-400',
          },
          {
            label: 'Sections',
            value: sectionCount,
            icon: CalendarDays,
            shell: 'theme-soft-success',
            iconClass: 'text-[var(--accent-success)]',
          },
        ].map(({ label, value, icon: Icon, shell, iconClass }) => (
          <div key={label} className={cn('rounded-2xl border p-5', shell)}>
            <Icon className={cn('size-5', iconClass)} aria-hidden />
            <p className="mt-3 text-3xl font-bold tabular-nums text-text">{value.toLocaleString()}</p>
            <p className="text-sm font-medium text-text-muted">{label}</p>
          </div>
        ))}
      </div>

      <section className="theme-card rounded-3xl border border-border/80 p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text">Late registrations</h2>
            <p className="mt-1 max-w-xl text-sm text-text-muted leading-relaxed">
              Upload an .xlsx in the same format as the scheduler. Rows that are already in this run are skipped. Only
              courses that existed in this run can accept new enrollments; section times stay fixed.
            </p>
          </div>
          <UserPlus className="size-8 shrink-0 text-brand-500/80" aria-hidden />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={mergeBusy}
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.xlsx'
              input.onchange = () => {
                const f = input.files?.[0]
                void handleMergeFile(f ?? null)
              }
              input.click()
            }}
            className={cn(
              'theme-btn-primary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium',
              mergeBusy && 'pointer-events-none opacity-60',
            )}
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            {mergeBusy ? 'Merging…' : 'Add enrollments from .xlsx'}
          </button>
          {mergeIssues.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                void showAlert({
                  title: 'Merge issues',
                  message:
                    mergeIssues.length > 1
                      ? `${mergeIssues.length} issues from the last enrollment upload.`
                      : undefined,
                  items: mergeIssues,
                  tone: 'warning',
                  size: mergeIssues.length > 5 ? 'lg' : 'md',
                })
              }}
              className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl border-[var(--soft-warning-border)] bg-[var(--soft-warning-bg)] px-4 py-2.5 text-sm font-medium text-text"
            >
              <AlertTriangle className="size-4 shrink-0 text-[var(--accent-warning)]" aria-hidden />
              Issues
              <span className="rounded-md bg-[color-mix(in_srgb,var(--accent-warning)_22%,transparent)] px-1.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--accent-warning)]">
                {mergeIssues.length}
              </span>
            </button>
          ) : null}
        </div>

        {mergeSuccessSummary ? (
          <p className="mt-4 flex items-start gap-2 text-sm text-text-muted">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--accent-success)]" aria-hidden />
            <span>
              <span className="font-medium text-text">Last merge:</span> {mergeSuccessSummary}
            </span>
          </p>
        ) : null}
      </section>

      <FacultyMappingPanel
        key={`faculty-${run.id}-${countPlanningFacultySections(snapshot.courseSections)}`}
        snapshot={snapshot}
        schedule={schedule}
        onApplied={handleFacultyApplied}
        alwaysShow={
          countPlanningFacultySections(snapshot.courseSections) === 0 &&
          Boolean(snapshot.facultyOverrides && Object.keys(snapshot.facultyOverrides).length > 0)
        }
      />

      <section className="theme-card space-y-4 rounded-3xl border border-border/80 p-6">
        <div>
          <h2 className="text-lg font-semibold text-text">Download workbooks</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-muted">
            Schedule, clash report, and course emails reflect the current saved snapshot (including late merges and
            faculty mapping).
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 text-sm leading-snug text-text-muted">
          <input
            type="checkbox"
            checked={allowProvisionalExport}
            onChange={(e) => setAllowProvisionalExport(e.target.checked)}
            className="theme-focusable mt-0.5 size-4 shrink-0 rounded border-border"
          />
          <span>
            Allow provisional schedule workbook if the hard-constraint audit fails (same behaviour as the main
            scheduler).
          </span>
        </label>

        <HardConstraintAuditNotice schedule={exportState.schedule} />
        <ScheduleExportBlockedNotice
          blocked={exportState.schedule_export_blocked}
          reason={exportState.schedule_export_block_reason}
        />

        <div className="flex flex-wrap gap-2">
          {exportState.schedule_export_blocked ? (
            <button
              type="button"
              disabled
              title={exportState.schedule_export_block_reason ?? undefined}
              className="theme-btn-primary inline-flex cursor-not-allowed items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium opacity-50"
            >
              <Download className="size-4" aria-hidden />
              Schedule (blocked)
            </button>
          ) : (
            <button
              type="button"
              disabled={exportBusy === 'schedule'}
              onClick={() => {
                void (async () => {
                  setExportBusy('schedule')
                  try {
                    const buf = await buildSavedRunScheduleXlsx(exportState)
                    if (buf) downloadArrayBuffer(buf, 'unislot-schedule.xlsx')
                  } catch (e) {
                    void showAlert({
                      title: 'Export failed',
                      message: e instanceof Error ? e.message : 'Export failed',
                      tone: 'warning',
                    })
                  } finally {
                    setExportBusy(null)
                  }
                })()
              }}
              className="theme-btn-primary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
            >
              <Download className="size-4" aria-hidden />
              {exportBusy === 'schedule' ? 'Preparing…' : 'Schedule'}
            </button>
          )}
          <button
            type="button"
            disabled={exportBusy === 'clash'}
            onClick={() => {
              void (async () => {
                setExportBusy('clash')
                try {
                  const buf = await buildSavedRunClashXlsx(exportState)
                  downloadArrayBuffer(buf, 'unislot-clash-report.xlsx')
                } catch (e) {
                  void showAlert({
                    title: 'Export failed',
                    message: e instanceof Error ? e.message : 'Export failed',
                    tone: 'warning',
                  })
                } finally {
                  setExportBusy(null)
                }
              })()
            }}
            className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
          >
            <Download className="size-4" aria-hidden />
            {exportBusy === 'clash' ? 'Preparing…' : 'Clash report'}
          </button>
          {snapshot.enrollmentRows.length > 0 ? (
            <>
            <button
              type="button"
              onClick={() => {
                if (!applySavedRunEmailsToSession(run, setResult, setFileName, result)) {
                  void showAlert({
                    title: 'No enrollment data',
                    message: 'This saved run has no enrollment rows to build course emails from.',
                    tone: 'warning',
                  })
                  return
                }
                navigate('/app/emails')
              }}
              className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
            >
              <Mail className="size-4" aria-hidden />
              Open in Emails
            </button>
            <button
              type="button"
              disabled={exportBusy === 'courseEmails'}
              onClick={() => {
                void (async () => {
                  setExportBusy('courseEmails')
                  try {
                    const buf = await buildSavedRunCourseEmailsXlsx(snapshot)
                    if (buf) downloadArrayBuffer(buf, 'unislot-course-emails.xlsx')
                  } catch (e) {
                    void showAlert({
                      title: 'Export failed',
                      message: e instanceof Error ? e.message : 'Export failed',
                      tone: 'warning',
                    })
                  } finally {
                    setExportBusy(null)
                  }
                })()
              }}
              className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
            >
              <Download className="size-4" aria-hidden />
              {exportBusy === 'courseEmails' ? 'Preparing…' : 'Course emails'}
            </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Timetable (frozen slots)</h2>
        {schedule.hard_constraints_feasible === false && <HardConstraintAuditNotice schedule={schedule} />}
        <SchedulePreview entries={schedule.entries} />
      </section>
    </div>
  )
}

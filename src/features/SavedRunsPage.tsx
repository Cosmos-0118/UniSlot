import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Download, FileSpreadsheet, Trash2, UserPlus, Users } from 'lucide-react'
import { cn } from '@/shared/utils/cn'
import { buildScheduleFromSnapshot, countPlanningFacultySections } from '@/modules/scheduling/facultyMapping'
import type { SchedulingSnapshot } from '@/modules/scheduling/schedulingSnapshot'
import { mergeLateEnrollmentIntoSnapshot, type MergeLateEnrollmentResult } from '@/modules/scheduling/lateEnrollmentMerge'
import { buildCourseEmailsXlsxBuffer } from '@/modules/scheduling/pipelineExports'
import type { RunPipelineOptions } from '@/modules/scheduling/pipeline'
import {
  deleteSavedRun,
  getSavedRun,
  loadSavedRuns,
  SAVED_RUNS_CHANGED_EVENT,
  updateSavedRunSnapshot,
  type SavedScheduleRun,
} from '@/lib/savedRunsStorage'
import { downloadArrayBuffer } from '@/lib/downloadArrayBuffer'
import { FacultyMappingPanel } from '@/features/FacultyMappingPanel'
import {
  HardConstraintAuditNotice,
  ScheduleExportBlockedNotice,
  SchedulePreview,
} from '@/features/schedulerResultUi'
import type { Schedule } from '@/modules/scheduling/types'

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function snapshotStats(s: SavedScheduleRun['snapshot']) {
  const sectionCount = Object.values(s.courseSections).reduce((n, arr) => n + arr.length, 0)
  const studentCount = Object.keys(s.students).length
  const courseCount = Object.keys(s.courseSections).length
  return { sectionCount, studentCount, courseCount }
}

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
    <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-10 sm:px-8">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-text sm:text-5xl">Saved runs</h1>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-text-muted">
          Each successful scheduler pass can be stored here with its timetable frozen. Open a run to attach late
          registrations: new rows are merged into existing sections without moving timeslots for students who were
          already placed.
        </p>
      </header>

      {runs.length === 0 ? (
        <div className="theme-card rounded-3xl border border-border/80 p-10 text-center">
          <CalendarDays className="mx-auto size-10 text-text-muted opacity-60" aria-hidden />
          <p className="mt-4 text-text-muted">
            No saved runs yet. After you process a workbook in <Link className="text-brand-500 underline" to="/app/scheduler">Scheduler</Link>, use{' '}
            <span className="font-medium text-text">Save run</span> to store it here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {runs.map((r) => {
            const { studentCount, courseCount, sectionCount } = snapshotStats(r.snapshot)
            return (
              <li key={r.id}>
                <Link
                  to={`/app/runs/${r.id}`}
                  className="theme-card theme-focusable group flex flex-col gap-3 rounded-2xl border border-border/80 p-5 transition-colors hover:border-brand-500/35 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-lg font-semibold text-text group-hover:text-brand-500">{r.title}</p>
                    <p className="mt-1 text-sm text-text-muted">
                      {formatWhen(r.createdAt)}
                      {r.sourceFileName ? (
                        <>
                          {' · '}
                          <span className="font-mono text-xs">{r.sourceFileName}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-text-muted">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-bg-tertiary/60 px-2.5 py-1">
                      <Users className="size-3.5" aria-hidden />
                      {studentCount} students
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-bg-tertiary/60 px-2.5 py-1">
                      <FileSpreadsheet className="size-3.5" aria-hidden />
                      {courseCount} courses · {sectionCount} sections
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SavedRunDetail({ run, onDeleted }: { run: SavedScheduleRun; onDeleted: () => void }) {
  const [title, setTitle] = useState(run.title)
  const [snapshot, setSnapshot] = useState(run.snapshot)
  const [mergeBusy, setMergeBusy] = useState(false)
  const [allowProvisionalExport, setAllowProvisionalExport] = useState(false)
  const [lastMergeMessage, setLastMergeMessage] = useState<string | null>(null)
  const [postMerge, setPostMerge] = useState<MergeLateEnrollmentResult | null>(null)
  const [courseEmailsExportBusy, setCourseEmailsExportBusy] = useState(false)

  const [schedule, setSchedule] = useState<Schedule>(() => buildScheduleFromSnapshot(snapshot).schedule)

  const handleFacultyApplied = useCallback(
    (next: { snapshot: SchedulingSnapshot; schedule: Schedule }) => {
      setSnapshot(next.snapshot)
      setSchedule(next.schedule)
      updateSavedRunSnapshot(run.id, next.snapshot)
      setPostMerge(null)
    },
    [run.id],
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
        alert('Please upload an Excel workbook (.xlsx)')
        return
      }
      setLastMergeMessage(null)
      setMergeBusy(true)
      try {
        const buf = await file.arrayBuffer()
        const opts: RunPipelineOptions = {}
        if (allowProvisionalExport) opts.allowProvisionalScheduleExport = true
        const out = await mergeLateEnrollmentIntoSnapshot(snapshot, buf, opts)
        if (!out.validation.is_valid || !out.schedulingSnapshot) {
          const msg =
            out.validation.errors[0]?.message ??
            'Merge did not complete. Fix the sheet or check that courses match this saved run.'
          setLastMergeMessage(msg)
          alert(msg)
          return
        }
        setSnapshot(out.schedulingSnapshot)
        setSchedule(out.schedule!)
        updateSavedRunSnapshot(run.id, out.schedulingSnapshot)
        setPostMerge(out)
        const s = out.mergeSummary
        setLastMergeMessage(
          s
            ? `Merged ${s.addedEnrollmentRows} new row(s) · ${s.newStudents} new student(s) · ${s.existingStudentsNewCourses} existing student(s) with added course(s).`
            : 'Merge complete.',
        )
      } catch (e) {
        console.error(e)
        alert(e instanceof Error ? e.message : 'Merge failed')
      } finally {
        setMergeBusy(false)
      }
    },
    [allowProvisionalExport, run.id, snapshot],
  )

  const handleDelete = () => {
    if (!confirm('Delete this saved run? This cannot be undone.')) return
    deleteSavedRun(run.id)
    onDeleted()
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
            Saved {formatWhen(run.createdAt)}
            {run.sourceFileName ? (
              <>
                {' · '}Original file <span className="font-mono text-xs">{run.sourceFileName}</span>
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

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Students', value: studentCount, icon: Users },
          { label: 'Courses', value: courseCount, icon: FileSpreadsheet },
          { label: 'Sections', value: sectionCount, icon: CalendarDays },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="theme-card rounded-2xl p-5">
            <Icon className="size-5 text-brand-500" aria-hidden />
            <p className="mt-3 text-3xl font-semibold tabular-nums text-text">{value}</p>
            <p className="text-sm text-text-muted">{label}</p>
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

        <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-snug text-text-muted">
          <input
            type="checkbox"
            checked={allowProvisionalExport}
            onChange={(e) => setAllowProvisionalExport(e.target.checked)}
            className="theme-focusable mt-0.5 size-4 shrink-0 rounded border-border"
          />
          <span>
            Allow provisional schedule workbook if the post-merge hard-constraint audit fails (same behaviour as the
            main scheduler).
          </span>
        </label>

        <div className="mt-5">
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
        </div>

        {lastMergeMessage && (
          <p className="mt-4 text-sm text-text-muted">
            <span className="font-medium text-text">Last merge:</span> {lastMergeMessage}
          </p>
        )}

        {postMerge?.schedule && (
          <div className="mt-6 space-y-4 border-t border-border/60 pt-6">
            <h3 className="text-sm font-semibold text-text">Exports after last merge</h3>
            <HardConstraintAuditNotice schedule={postMerge.schedule} />
            <ScheduleExportBlockedNotice
              blocked={postMerge.schedule_export_blocked}
              reason={postMerge.schedule_export_block_reason}
            />
            <div className="flex flex-wrap gap-2">
              {postMerge.scheduleXlsx ? (
                <button
                  type="button"
                  onClick={() => downloadArrayBuffer(postMerge.scheduleXlsx!, 'unislot-schedule-after-merge.xlsx')}
                  className="theme-btn-primary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                >
                  <Download className="size-4" aria-hidden />
                  Schedule
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title={postMerge.schedule_export_block_reason ?? undefined}
                  className="theme-btn-primary inline-flex cursor-not-allowed items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium opacity-50"
                >
                  <Download className="size-4" aria-hidden />
                  Schedule (blocked)
                </button>
              )}
              {postMerge.clashXlsx && (
                <button
                  type="button"
                  onClick={() => downloadArrayBuffer(postMerge.clashXlsx!, 'unislot-clash-after-merge.xlsx')}
                  className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                >
                  <Download className="size-4" aria-hidden />
                  Clash report
                </button>
              )}
              {postMerge.schedulingSnapshot?.enrollmentRows?.length ? (
                <button
                  type="button"
                  disabled={courseEmailsExportBusy}
                  onClick={() => {
                    void (async () => {
                      setCourseEmailsExportBusy(true)
                      try {
                        const buf = await buildCourseEmailsXlsxBuffer(
                          postMerge.schedulingSnapshot!.enrollmentRows,
                        )
                        downloadArrayBuffer(buf, 'unislot-course-emails-after-merge.xlsx')
                      } catch (e) {
                        alert(e instanceof Error ? e.message : 'Export failed')
                      } finally {
                        setCourseEmailsExportBusy(false)
                      }
                    })()
                  }}
                  className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                >
                  <Download className="size-4" aria-hidden />
                  {courseEmailsExportBusy ? 'Preparing…' : 'Course emails'}
                </button>
              ) : null}
            </div>
          </div>
        )}
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

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Timetable (frozen slots)</h2>
        {schedule.hard_constraints_feasible === false && <HardConstraintAuditNotice schedule={schedule} />}
        <SchedulePreview entries={schedule.entries} />
      </section>
    </div>
  )
}

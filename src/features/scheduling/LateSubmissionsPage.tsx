import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
} from 'lucide-react'
import { FileDropzone } from '@/components/ui/FileDropzone'
import { PageShell } from '@/features/scheduling/PageShell'
import { useMainFilePipeline } from '@/features/scheduling/hooks/useMainFilePipeline'
import { useAppDialog } from '@/contexts/appDialog/useAppDialog'
import { downloadArrayBuffer } from '@/shared/lib/downloadArrayBuffer'
import { mergeLateEnrollmentIntoSnapshot } from '@/modules/scheduling/merge/lateEnrollment'
import {
  buildSavedRunClashXlsx,
  buildSavedRunScheduleXlsx,
  computeSavedRunExportState,
} from '@/modules/scheduling/merge/savedRunExports'
import type { SchedulingSnapshot } from '@/modules/scheduling/merge/snapshot'
import { cn } from '@/shared/utils/cn'
import {
  HardConstraintAuditNotice,
  ScheduleExportBlockedNotice,
} from '@/features/scheduling/schedulerResultUi'

export function LateSubmissionsPage() {
  const { alert: showAlert } = useAppDialog()
  const { processMainFile, progress, running } = useMainFilePipeline()

  const [mainFile, setMainFile] = useState<File | null>(null)
  const [lateFile, setLateFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [snapshot, setSnapshot] = useState<SchedulingSnapshot | null>(null)
  const [mergeSummary, setMergeSummary] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [success, setSuccess] = useState<boolean | null>(null)
  const [exportBusy, setExportBusy] = useState<'schedule' | 'clash' | null>(null)
  const [lastMainName, setLastMainName] = useState<string | null>(null)

  const processing = running || busy
  const canProcess = Boolean(mainFile && lateFile) && !processing

  const progressPct =
    progress?.fraction != null && Number.isFinite(progress.fraction)
      ? Math.round(Math.max(0, Math.min(1, progress.fraction)) * 100)
      : null

  const handleMerge = async () => {
    if (!mainFile || !lateFile) return

    setBusy(true)
    setIssues([])
    setMergeSummary(null)
    setSuccess(null)

    try {
      let activeSnapshot = snapshot
      if (!activeSnapshot || mainFile.name !== lastMainName) {
        activeSnapshot = await processMainFile(mainFile)
        setSnapshot(activeSnapshot)
        setLastMainName(mainFile.name)
      }

      const buf = await lateFile.arrayBuffer()
      const out = await mergeLateEnrollmentIntoSnapshot(activeSnapshot, buf)

      const issueMessages = [
        ...out.validation.errors.map((e) => e.message),
        ...out.validation.warnings.map((w) => w.message),
      ]

      if (!out.validation.is_valid || !out.schedulingSnapshot) {
        setIssues(
          issueMessages.length > 0
            ? issueMessages
            : ['Merge did not complete. Check that courses in the late file match the main schedule.'],
        )
        setSuccess(false)
        return
      }

      setSnapshot(out.schedulingSnapshot)
      const s = out.mergeSummary
      setMergeSummary(
        s
          ? `Merged ${s.addedEnrollmentRows} new row(s) · ${s.newStudents} new student(s) · ${s.existingStudentsNewCourses} existing student(s) with added course(s).`
          : 'Merge complete.',
      )
      setSuccess(true)
      if (issueMessages.length > 0) setIssues(issueMessages)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Merge failed'
      setIssues([msg])
      setSuccess(false)
      void showAlert({ title: 'Merge failed', message: msg, tone: 'warning' })
    } finally {
      setBusy(false)
    }
  }

  const exportState = snapshot ? computeSavedRunExportState(snapshot) : null

  const handleDownload = async (kind: 'schedule' | 'clash') => {
    if (!snapshot || !exportState) return
    setExportBusy(kind)
    try {
      if (kind === 'schedule') {
        const buf = await buildSavedRunScheduleXlsx(exportState, snapshot)
        if (buf) downloadArrayBuffer(buf, 'unislot-schedule-late-merged.xlsx')
      } else {
        const buf = await buildSavedRunClashXlsx(exportState)
        downloadArrayBuffer(buf, 'unislot-clash-report.xlsx')
      }
    } catch (e) {
      void showAlert({
        title: 'Export failed',
        message: e instanceof Error ? e.message : 'Export failed',
        tone: 'warning',
      })
    } finally {
      setExportBusy(null)
    }
  }

  return (
    <PageShell
      eyebrow="Enrollment updates"
      title="Late submissions"
      description="Upload your main scheduler workbook and a late enrollment file. New students are placed into existing section slots without moving anyone already scheduled."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="theme-card rounded-2xl border border-border/70 p-6">
          <FileDropzone
            label="Main scheduler workbook"
            description="The original enrollment .xlsx that produced the current timetable."
            accept=".xlsx"
            file={mainFile}
            onFile={(f) => {
              setMainFile(f)
              if (!f) {
                setSnapshot(null)
                setLastMainName(null)
                setMergeSummary(null)
                setSuccess(null)
              }
            }}
            disabled={processing}
            hint="Accepts .xlsx"
          />
        </div>

        <div className="theme-card rounded-2xl border border-border/70 p-6">
          <FileDropzone
            label="Late submission workbook"
            description="New enrollment rows in the same format as the main scheduler file."
            accept=".xlsx"
            file={lateFile}
            onFile={setLateFile}
            disabled={processing}
            icon={Clock}
            hint="Accepts .xlsx"
          />
        </div>
      </div>

      <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={!canProcess}
          onClick={() => void handleMerge()}
          className="theme-btn-primary theme-focusable inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {processing ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {running ? `Processing main file${progressPct != null ? ` (${progressPct}%)` : '…'}` : 'Merging enrollments…'}
            </>
          ) : (
            <>
              <Clock className="size-4" aria-hidden />
              Merge late submissions
            </>
          )}
        </button>

        {running && progress?.message && (
          <p className="text-sm text-text-muted">{progress.message}</p>
        )}
      </div>

      {mergeSummary && success && (
        <div className="mt-6 flex gap-3 rounded-2xl border border-[var(--soft-success-border)] bg-[var(--soft-success-bg)] px-4 py-3.5 text-sm">
          <CheckCircle2 className="size-5 shrink-0 text-[var(--accent-success)]" aria-hidden />
          <span className="leading-relaxed text-text">{mergeSummary}</span>
        </div>
      )}

      {issues.length > 0 && (
        <div
          className={cn(
            'mt-6 rounded-2xl border px-4 py-3.5 text-sm',
            success === false
              ? 'border-[var(--soft-warning-border)] bg-[var(--soft-warning-bg)]'
              : 'border-border bg-bg-secondary/50',
          )}
        >
          <div className="flex gap-3">
            <AlertTriangle className="size-5 shrink-0 text-[var(--accent-warning)]" aria-hidden />
            <ul className="space-y-1.5 text-text">
              {issues.slice(0, 8).map((issue, i) => (
                <li key={i} className="leading-relaxed">
                  {issue}
                </li>
              ))}
              {issues.length > 8 && (
                <li className="text-text-muted">…and {issues.length - 8} more</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {exportState && success && (
        <section className="theme-card mt-8 space-y-4 rounded-2xl border border-border/70 p-6">
          <div>
            <h2 className="text-lg font-semibold text-text">Export updated timetable</h2>
            <p className="mt-1 text-sm text-text-muted">
              Download the merged schedule and clash report reflecting late enrollments.
            </p>
          </div>

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
                className="theme-btn-primary inline-flex cursor-not-allowed items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium opacity-50"
              >
                <Download className="size-4" aria-hidden />
                Schedule (blocked)
              </button>
            ) : (
              <button
                type="button"
                disabled={exportBusy === 'schedule'}
                onClick={() => void handleDownload('schedule')}
                className="theme-btn-primary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
              >
                <Download className="size-4" aria-hidden />
                {exportBusy === 'schedule' ? 'Preparing…' : 'Download schedule'}
              </button>
            )}
            <button
              type="button"
              disabled={exportBusy === 'clash'}
              onClick={() => void handleDownload('clash')}
              className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
            >
              <Download className="size-4" aria-hidden />
              {exportBusy === 'clash' ? 'Preparing…' : 'Download clash report'}
            </button>
          </div>
        </section>
      )}
    </PageShell>
  )
}

import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  UserCheck,
} from 'lucide-react'
import { FileDropzone } from '@/components/ui/FileDropzone'
import { PageShell } from '@/features/scheduling/PageShell'
import { useMainFilePipeline } from '@/features/scheduling/hooks/useMainFilePipeline'
import { useAppDialog } from '@/contexts/appDialog/useAppDialog'
import { downloadArrayBuffer } from '@/shared/lib/downloadArrayBuffer'
import {
  applyAndValidateFacultyMapping,
  parseFacultyMappingTable,
} from '@/modules/scheduling/merge/facultyMapping'
import {
  buildSavedRunClashXlsx,
  buildSavedRunScheduleXlsx,
  computeSavedRunExportState,
} from '@/modules/scheduling/merge/savedRunExports'
import type { SchedulingSnapshot } from '@/modules/scheduling/merge/snapshot'
import type { Schedule } from '@/modules/scheduling/types'
import { cn } from '@/shared/utils/cn'
import {
  HardConstraintAuditNotice,
  ScheduleExportBlockedNotice,
} from '@/features/scheduling/schedulerResultUi'

export function TeacherAssignmentPage() {
  const { alert: showAlert } = useAppDialog()
  const { processMainFile, progress, running } = useMainFilePipeline()

  const [mainFile, setMainFile] = useState<File | null>(null)
  const [teacherFile, setTeacherFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [snapshot, setSnapshot] = useState<SchedulingSnapshot | null>(null)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [auditOk, setAuditOk] = useState<boolean | null>(null)
  const [exportBusy, setExportBusy] = useState<'schedule' | 'clash' | null>(null)
  const [lastMainName, setLastMainName] = useState<string | null>(null)

  const canProcess = Boolean(mainFile && teacherFile) && !busy && !running

  const handleProcess = async () => {
    if (!mainFile || !teacherFile) return

    setBusy(true)
    setStatus(null)
    setAuditOk(null)

    try {
      let activeSnapshot = snapshot
      if (!activeSnapshot || mainFile.name !== lastMainName) {
        activeSnapshot = await processMainFile(mainFile)
        setSnapshot(activeSnapshot)
        setLastMainName(mainFile.name)
      }

      const text = await teacherFile.text()
      const parsed = parseFacultyMappingTable(text)
      if (parsed.errors.length) {
        setStatus(parsed.errors.join(' '))
        setAuditOk(false)
        return
      }

      const out = applyAndValidateFacultyMapping(activeSnapshot, parsed.overrides)
      const msgs = [...out.warnings]
      if (parsed.warnings.length) msgs.unshift(...parsed.warnings)

      if (out.errors.length) {
        setStatus(out.errors.join(' '))
        setAuditOk(false)
        return
      }

      if (out.audit.feasible && out.planningCount === 0) {
        msgs.unshift('Faculty mapping applied — hard-constraint audit passed.')
        setAuditOk(true)
      } else {
        setAuditOk(out.audit.feasible)
        if (!msgs.length) msgs.push('Mapping applied with warnings.')
      }

      setSnapshot(out.snapshot)
      setSchedule(out.schedule)
      setStatus(msgs.join(' '))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Processing failed'
      setStatus(msg)
      setAuditOk(false)
      void showAlert({ title: 'Mapping failed', message: msg, tone: 'warning' })
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
        if (buf) downloadArrayBuffer(buf, 'unislot-schedule-mapped.xlsx')
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

  const processing = running || busy
  const progressPct =
    progress?.fraction != null && Number.isFinite(progress.fraction)
      ? Math.round(Math.max(0, Math.min(1, progress.fraction)) * 100)
      : null

  return (
    <PageShell
      eyebrow="Faculty mapping"
      title="Teacher assignment"
      description="Upload your main scheduler workbook and a teacher mapping file. Section time slots stay fixed while real faculty names are applied and validated."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="theme-card rounded-2xl border border-border/70 p-6">
          <FileDropzone
            label="Main scheduler workbook"
            description="The enrollment .xlsx file used to generate the timetable."
            accept=".xlsx"
            file={mainFile}
            onFile={(f) => {
              setMainFile(f)
              if (!f) {
                setSnapshot(null)
                setSchedule(null)
                setLastMainName(null)
              }
            }}
            disabled={processing}
            hint="Accepts .xlsx"
          />
        </div>

        <div className="theme-card rounded-2xl border border-border/70 p-6">
          <FileDropzone
            label="Teacher mapping file"
            description="CSV or TSV with section_id and faculty name columns."
            accept=".csv,.txt,.tsv"
            file={teacherFile}
            onFile={setTeacherFile}
            disabled={processing}
            icon={UserCheck}
            hint="Accepts .csv, .tsv, .txt"
          />
        </div>
      </div>

      <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={!canProcess}
          onClick={() => void handleProcess()}
          className="theme-btn-primary theme-focusable inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {processing ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {running ? `Processing main file${progressPct != null ? ` (${progressPct}%)` : '…'}` : 'Applying mapping…'}
            </>
          ) : (
            <>
              <UserCheck className="size-4" aria-hidden />
              Apply faculty mapping
            </>
          )}
        </button>

        {running && progress?.message && (
          <p className="text-sm text-text-muted">{progress.message}</p>
        )}
      </div>

      {status && (
        <div
          className={cn(
            'mt-6 flex gap-3 rounded-2xl border px-4 py-3.5 text-sm',
            auditOk === true && 'border-[var(--soft-success-border)] bg-[var(--soft-success-bg)]',
            auditOk === false && 'border-[var(--soft-warning-border)] bg-[var(--soft-warning-bg)]',
            auditOk == null && 'border-border bg-bg-secondary/50',
          )}
        >
          {auditOk === true ? (
            <CheckCircle2 className="size-5 shrink-0 text-[var(--accent-success)]" aria-hidden />
          ) : (
            <AlertTriangle className="size-5 shrink-0 text-[var(--accent-warning)]" aria-hidden />
          )}
          <span className="leading-relaxed text-text">{status}</span>
        </div>
      )}

      {schedule && exportState && (
        <section className="theme-card mt-8 space-y-4 rounded-2xl border border-border/70 p-6">
          <div>
            <h2 className="text-lg font-semibold text-text">Export mapped timetable</h2>
            <p className="mt-1 text-sm text-text-muted">
              Download the updated schedule and clash report with faculty names applied.
            </p>
          </div>

          <HardConstraintAuditNotice schedule={schedule} />
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

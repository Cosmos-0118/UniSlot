import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { cn } from '@/shared/utils/cn'
import {
  applyAndValidateFacultyMapping,
  facultyMappingTemplateCsv,
  listFacultyMappingRows,
  parseFacultyMappingTable,
} from '@/modules/scheduling/merge/facultyMapping'
import type { SchedulingSnapshot } from '@/modules/scheduling/merge/snapshot'
import type { Schedule } from '@/modules/scheduling/types'

type Props = {
  snapshot: SchedulingSnapshot
  schedule: Schedule | null
  onApplied: (next: {
    snapshot: SchedulingSnapshot
    schedule: Schedule
    auditFeasible: boolean
  }) => void
  alwaysShow?: boolean
}

export function FacultyMappingPanel({ snapshot, schedule, onApplied, alwaysShow }: Props) {
  const rows = useMemo(() => listFacultyMappingRows(snapshot), [snapshot])
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.section_id, snapshot.facultyOverrides?.[r.section_id] ?? ''])),
  )
  const [status, setStatus] = useState<string | null>(null)
  const [lastAuditOk, setLastAuditOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const applyOverrides = useCallback(
    (overrides: Record<string, string>) => {
      setBusy(true)
      try {
        const merged = { ...draft, ...overrides }
        const out = applyAndValidateFacultyMapping(snapshot, merged)
        setDraft((prev) => {
          const next = { ...prev }
          for (const [id, name] of Object.entries(overrides)) {
            if (name.trim()) next[id] = name.trim()
          }
          return next
        })
        if (out.errors.length) {
          setStatus(out.errors.join(' '))
          setLastAuditOk(false)
          return
        }
        const msgs = [...out.warnings]
        if (out.audit.feasible && out.planningCount === 0) {
          msgs.unshift('Faculty mapping validated — hard-constraint audit passed.')
          setLastAuditOk(true)
        } else {
          setLastAuditOk(out.audit.feasible)
        }
        setStatus(msgs.join(' '))
        onApplied({
          snapshot: out.snapshot,
          schedule: out.schedule,
          auditFeasible: out.audit.feasible,
        })
      } finally {
        setBusy(false)
      }
    },
    [draft, onApplied, snapshot],
  )

  const handleApplyDraft = () => {
    const overrides: Record<string, string> = {}
    for (const r of rows) {
      const v = draft[r.section_id]?.trim()
      if (v) overrides[r.section_id] = v
    }
    applyOverrides(overrides)
  }

  const handleUploadCsv = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,.txt,.tsv'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return
      void f.text().then((text) => {
        const parsed = parseFacultyMappingTable(text)
        if (parsed.errors.length) {
          setStatus(parsed.errors.join(' '))
          setLastAuditOk(false)
          return
        }
        const hint = parsed.warnings.length > 0 ? ` ${parsed.warnings.join(' ')}` : ''
        setStatus(`Parsed ${Object.keys(parsed.overrides).length} row(s).${hint}`)
        applyOverrides(parsed.overrides)
      })
    }
    input.click()
  }

  const downloadTemplate = () => {
    const csv = facultyMappingTemplateCsv(snapshot)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'faculty-mapping-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const planningRemaining = rows.filter((r) => !draft[r.section_id]?.trim()).length

  const show = alwaysShow || rows.length > 0
  if (!show) return null

  return (
    <section className="theme-card rounded-3xl border border-border/80 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-text">Assign real faculty</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted leading-relaxed">
            Sections with planning placeholders need real names before the timetable is faculty-certified. Slots stay
            fixed; we re-run the hard-constraint audit (including faculty double-booking).
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-text-muted">
          {rows.length > 0 && (
            <span className="rounded-lg bg-bg-tertiary/80 px-2 py-1 font-medium">
              {rows.length} planning placeholder{rows.length === 1 ? '' : 's'}
            </span>
          )}
          {schedule?.hard_constraints_feasible === false && (
            <span className="text-[var(--accent-warning)]">Solve-time audit had issues</span>
          )}
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadTemplate}
              className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium"
            >
              <Download className="size-4" aria-hidden />
              Template CSV
            </button>
            <button
              type="button"
              onClick={handleUploadCsv}
              disabled={busy}
              className="theme-btn-secondary theme-focusable inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium"
            >
              <Upload className="size-4" aria-hidden />
              Upload mapping
            </button>
            <button
              type="button"
              onClick={handleApplyDraft}
              disabled={busy}
              className="theme-btn-primary theme-focusable inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium"
            >
              <FileSpreadsheet className="size-4" aria-hidden />
              {busy ? 'Validating…' : 'Apply & validate'}
            </button>
          </div>

          <FacultyMappingTable rows={rows} draft={draft} setDraft={setDraft} />

          {planningRemaining > 0 && (
            <p className="mt-3 text-xs text-text-muted">
              {planningRemaining} section(s) still need a faculty name.
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-text-muted">
          All sections have assigned faculty labels. Upload a CSV to update names and re-validate.
        </p>
      )}

      {status && (
        <div
          className={cn(
            'mt-4 flex gap-2 rounded-xl border px-3 py-2.5 text-sm',
            lastAuditOk === true && 'border-[var(--soft-success-border)] bg-[var(--soft-success-bg)]',
            lastAuditOk === false && 'border-[var(--soft-warning-border)] bg-[var(--soft-warning-bg)]',
            lastAuditOk == null && 'border-border bg-bg-secondary/50',
          )}
        >
          {lastAuditOk === true ? (
            <CheckCircle2 className="size-5 shrink-0 text-[var(--accent-success)]" aria-hidden />
          ) : (
            <AlertTriangle className="size-5 shrink-0 text-[var(--accent-warning)]" aria-hidden />
          )}
          <span className="text-text leading-snug">{status}</span>
        </div>
      )}
    </section>
  )
}

function FacultyMappingTable({
  rows,
  draft,
  setDraft,
}: {
  rows: ReturnType<typeof listFacultyMappingRows>
  draft: Record<string, string>
  setDraft: Dispatch<SetStateAction<Record<string, string>>>
}) {
  return (
    <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-border/70">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="sticky top-0 bg-bg/95 text-xs uppercase tracking-wider text-text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Section ID</th>
            <th className="px-3 py-2 font-medium">Course</th>
            <th className="px-3 py-2 font-medium">Slot</th>
            <th className="px-3 py-2 font-medium">Faculty name</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.section_id} className="border-t border-border/50">
              <td className="px-3 py-2 font-mono text-xs text-text-muted">{r.section_id}</td>
              <td className="px-3 py-2 text-text">
                {r.course_code}
                <span className="text-text-muted"> · §{r.section_number}</span>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-text-muted">{r.daySlotLabel}</td>
              <td className="px-3 py-2">
                <input
                  value={draft[r.section_id] ?? ''}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [r.section_id]: e.target.value }))
                  }
                  placeholder="Real faculty name"
                  className="theme-focusable w-full min-w-[160px] rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-text"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

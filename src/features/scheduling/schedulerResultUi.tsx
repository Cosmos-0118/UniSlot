import { AlertTriangle, CalendarDays, CheckCircle2 } from 'lucide-react'
import type { Schedule, ScheduleEntry, StudentClashReport } from '@/modules/scheduling/types'

export function HardConstraintAuditNotice({ schedule }: { schedule: Schedule }) {
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
            The timetable may still violate Constraints.md rules (student daily attendance, faculty overlap, capacity,
            parallel cap, or split-section alignment). Treat exports as provisional until resolved.
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

export function ScheduleExportBlockedNotice({
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

export function SchedulePreview({ entries }: { entries: ScheduleEntry[] }) {
  return (
    <div className="theme-card overflow-hidden rounded-2xl">
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-bg/95 backdrop-blur">
            <tr className="border-b border-border text-xs uppercase tracking-wider text-text-muted">
              <th className="px-4 py-3 font-medium">Course</th>
              <th className="px-4 py-3 font-medium">Section</th>
              <th className="px-4 py-3 font-medium">Day</th>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Parallel lane</th>
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
                  <span className="theme-chip-brand px-2.5 py-1 text-xs font-medium">
                    <CalendarDays className="size-3.5 opacity-70" aria-hidden />
                    {e.day}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted">{e.time}</td>
                <td className="px-4 py-3 font-mono text-xs text-text-muted">
                  {e.slot_band}/{e.parallel_lane_count}
                </td>
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

export function ClashPreview({ reports }: { reports: StudentClashReport[] }) {
  const red = reports.filter((r) => r.status === 'Red').slice(0, 40)
  if (!red.length) {
    return (
      <div className="theme-soft-success flex items-center gap-3 rounded-2xl px-4 py-4">
        <CheckCircle2 className="size-6 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">No student clashes detected</p>
          <p className="text-sm opacity-80">Every student has at most one course per weekday (5–7 PM).</p>
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

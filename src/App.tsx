import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Mail,
  Sparkles,
  Users,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from './lib/cn'
import type { ScheduleEntry, StudentClashReport, ValidationError } from './lib/unislot/types'
import { useUnislotWorker } from './hooks/useUnislotWorker'

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
        <li className="text-zinc-400">…and {items.length - 80} more (fix sheet and retry)</li>
      )}
    </ul>
  )
}

function SchedulePreview({ entries }: { entries: ScheduleEntry[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-xl backdrop-blur">
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur">
            <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-zinc-400">
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
                className="border-b border-white/5 transition-colors hover:bg-white/[0.04]"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{e.course_code}</div>
                  <div className="text-xs text-zinc-500">{e.course_title}</div>
                </td>
                <td className="px-4 py-3 font-mono text-zinc-300">{e.section_number}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-brand-100">
                    <CalendarDays className="size-3.5 opacity-70" aria-hidden />
                    {e.day}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400">{e.time}</td>
                <td className="px-4 py-3 text-zinc-300">{e.enrollment_count}</td>
                <td className="max-w-[200px] truncate px-4 py-3 text-xs text-zinc-500" title={e.programs}>
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
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-emerald-100">
        <CheckCircle2 className="size-6 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">No student clashes detected</p>
          <p className="text-sm text-emerald-200/80">Every student has at most one evening slot per day.</p>
        </div>
      </div>
    )
  }
  return (
    <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
      {red.map((r) => (
        <li
          key={r.register_number}
          className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-red-50"
        >
          <span className="font-mono text-xs text-red-200/90">{r.register_number}</span>
          <span className="mx-2 text-red-300/60">·</span>
          {r.student_name}
          <div className="mt-1 text-xs text-red-200/80">
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

export default function App() {
  const { run, running, progress } = useUnislotWorker()
  const [drag, setDrag] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof run>> | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      if (!/\.xlsx$/i.test(file.name)) {
        alert('Please upload an Excel workbook (.xlsx)')
        return
      }
      setFileName(file.name)
      setResult(null)
      try {
        const out = await run(file)
        setResult(out)
      } catch (e) {
        console.error(e)
        alert(e instanceof Error ? e.message : 'Something went wrong')
      }
    },
    [run],
  )

  return (
    <div className="relative mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-20 pt-10 sm:px-6 lg:px-8">
      <header className="mb-12 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-brand-200">
            <Sparkles className="size-3.5" aria-hidden />
            Client-side · private · no upload server
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            UniSlot
          </h1>
          <p className="mt-3 max-w-xl text-lg leading-relaxed text-zinc-400">
            Drop your enrollment workbook. Parsing, sectioning, conflict detection, and scheduling run
            entirely in a dedicated browser worker—your data never leaves your machine.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-zinc-500">
          <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <Users className="size-4 text-brand-300" aria-hidden />
            Greedy + local search
          </span>
          <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <FileSpreadsheet className="size-4 text-brand-300" aria-hidden />
            Excel in / out
          </span>
        </div>
      </header>

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
            'group relative flex w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed px-6 py-16 transition-all',
            drag
              ? 'border-brand-400 bg-brand-500/15 shadow-[0_0_60px_-12px_oklch(0.58_0.22_280/0.5)]'
              : 'border-white/15 bg-white/[0.03] hover:border-brand-500/40 hover:bg-white/[0.05]',
            running && 'pointer-events-none opacity-60',
          )}
        >
          {running ? (
            <Loader2 className="size-12 animate-spin text-brand-300" aria-hidden />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-600 shadow-lg">
              <FileSpreadsheet className="size-7 text-white" aria-hidden />
            </div>
          )}
          <div className="text-center">
            <p className="text-lg font-medium text-white">
              {running ? 'Working in background thread…' : 'Click or drop enrollment .xlsx'}
            </p>
            {progress && (
              <p className="mt-2 text-sm text-brand-200/90">
                {progress.message}
              </p>
            )}
            {fileName && !running && (
              <p className="mt-2 text-xs text-zinc-500">Last file: {fileName}</p>
            )}
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition group-hover:bg-white/15">
            Choose file
            <ArrowRight className="size-4 opacity-70" aria-hidden />
          </span>
        </button>
      </section>

      {result && (
        <section className="space-y-10">
          {!result.validation.is_valid && (
            <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-6 shrink-0 text-red-300" aria-hidden />
                <div>
                  <h2 className="text-lg font-semibold text-red-50">Validation did not pass</h2>
                  <p className="mt-1 text-sm text-red-200/80">
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
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-inner backdrop-blur"
                  >
                    <Icon className="size-5 text-brand-300" aria-hidden />
                    <p className="mt-3 text-3xl font-semibold tabular-nums text-white">{value}</p>
                    <p className="text-sm text-zinc-500">{label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">Exports</h2>
                  <p className="text-sm text-zinc-500">
                    Schedule workbook, multi-sheet clash analysis (Summary, Clashes Only, By Program, By Day, By Course,
                    Full Report), and course-wise email lists.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {result.scheduleXlsx && (
                    <button
                      type="button"
                      onClick={() => downloadArrayBuffer(result.scheduleXlsx!, 'unislot-schedule.xlsx')}
                      className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-500"
                    >
                      <Download className="size-4" aria-hidden />
                      Schedule
                    </button>
                  )}
                  {result.clashXlsx && (
                    <button
                      type="button"
                      onClick={() => downloadArrayBuffer(result.clashXlsx!, 'unislot-clash-report.xlsx')}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
                    >
                      <Download className="size-4" aria-hidden />
                      Clash report
                    </button>
                  )}
                  {result.courseEmailsXlsx && (
                    <button
                      type="button"
                      onClick={() => downloadArrayBuffer(result.courseEmailsXlsx!, 'unislot-course-emails.xlsx')}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
                    >
                      <Mail className="size-4" aria-hidden />
                      Course emails
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">Schedule</h2>
                  <p className="text-sm text-zinc-500">
                    Solver: {result.schedule.solver_used} · {result.schedule.solver_time_seconds.toFixed(2)}s ·{' '}
                    {result.schedule.total_sections} sections
                  </p>
                </div>
              </div>

              <SchedulePreview entries={result.schedule.entries} />

              <div>
                <h2 className="mb-3 text-xl font-semibold text-white">Clash overview</h2>
                <p className="mb-4 text-sm text-zinc-500">
                  {result.clashReport.students_with_clashes} students with overlaps (
                  {result.clashReport.clash_percentage}%)
                </p>
                <ClashPreview reports={result.clashReport.reports} />
              </div>
            </>
          )}
        </section>
      )}

      <footer className="mt-auto pt-16 text-center text-xs text-zinc-600">
        Scheduling uses greedy multi-start with local search in a Web Worker. See{' '}
        <code className="rounded bg-white/5 px-1.5 py-0.5">docs/excel_schema.md</code> for the workbook format.
      </footer>
    </div>
  )
}

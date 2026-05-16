import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  ChevronRight,
  FileSpreadsheet,
  GraduationCap,
  Layers,
  Users,
} from 'lucide-react'
import { cn } from '@/shared/utils/cn'
import type { SavedScheduleRun } from '@/features/scheduling/storage/savedRunsStorage'
import {
  displayRunTitle,
  formatSavedAt,
  isTitleSameAsSourceFile,
  snapshotStats,
  sourceFileLabel,
} from '@/features/scheduling/savedRunDisplay'

type StatTone = 'brand' | 'info' | 'success'

const statToneClass: Record<StatTone, { shell: string; icon: string }> = {
  brand: {
    shell:
      'border-[color-mix(in_srgb,var(--brand-500)_32%,transparent)] bg-[color-mix(in_srgb,var(--brand-500)_14%,transparent)]',
    icon: 'text-brand-400',
  },
  info: {
    shell: 'theme-soft-info',
    icon: 'text-[var(--accent-info)]',
  },
  success: {
    shell: 'theme-soft-success',
    icon: 'text-[var(--accent-success)]',
  },
}

function StatPill({
  tone,
  icon: Icon,
  label,
  value,
}: {
  tone: StatTone
  icon: typeof Users
  label: string
  value: number
}) {
  const t = statToneClass[tone]
  return (
    <div
      className={cn(
        'flex min-w-[4.25rem] flex-col items-center gap-1 rounded-xl border px-3 py-2.5 text-center sm:min-w-[5rem]',
        t.shell,
      )}
      title={`${value.toLocaleString()} ${label}`}
    >
      <div className="flex items-center justify-center gap-1.5">
        <Icon className={cn('size-3 shrink-0 opacity-90', t.icon)} aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      </div>
      <p className="w-full text-lg font-bold tabular-nums leading-none text-text sm:text-xl">
        {value.toLocaleString()}
      </p>
    </div>
  )
}

export function SavedRunListCard({ run }: { run: SavedScheduleRun }) {
  const { studentCount, courseCount, sectionCount, facultyMapped } = snapshotStats(run.snapshot)
  const { primary: savedAt, relative } = formatSavedAt(run.createdAt)
  const title = displayRunTitle(run.title)
  const fileStem = sourceFileLabel(run.sourceFileName)
  const fileOnlyName = fileStem != null && isTitleSameAsSourceFile(run.title, run.sourceFileName)

  return (
    <li className="w-full">
      <Link
        to={`/app/runs/${run.id}`}
        className={cn(
          'theme-card theme-card-hover theme-focusable group relative flex w-full flex-col gap-4 overflow-hidden rounded-2xl',
          'border border-border/80 p-4 pl-5 sm:flex-row sm:items-center sm:gap-6 sm:p-4 sm:pl-6',
        )}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-brand-400 via-brand-500 to-[var(--accent-info)]"
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="theme-soft-info inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold">
              <CalendarClock className="size-3.5 text-[var(--accent-info)]" aria-hidden />
              <span className="text-text">{relative || savedAt}</span>
            </span>
            <span className="theme-chip-brand px-2.5 py-1 text-[11px] font-semibold">Frozen slots</span>
            {facultyMapped > 0 ? (
              <span className="theme-soft-success inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                <GraduationCap className="size-3" aria-hidden />
                Faculty mapped
              </span>
            ) : null}
          </div>

          <div className="mt-2.5 min-w-0">
            {fileOnlyName ? (
              <p className="flex items-center gap-2 text-text group-hover:text-brand-400">
                <FileSpreadsheet className="size-4 shrink-0 text-brand-400" aria-hidden />
                <span className="truncate font-mono text-sm font-medium">{fileStem}</span>
              </p>
            ) : (
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-text group-hover:text-brand-400 sm:text-lg">
                  {title}
                </h2>
                {fileStem ? (
                  <p className="mt-1 flex items-center gap-2 text-text-muted">
                    <FileSpreadsheet className="size-3.5 shrink-0 text-brand-500/80" aria-hidden />
                    <span className="truncate font-mono text-xs">{fileStem}</span>
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end sm:gap-4">
          <div className="flex flex-1 gap-2 sm:flex-initial">
            <StatPill tone="info" icon={Users} label="Students" value={studentCount} />
            <StatPill tone="brand" icon={BookOpen} label="Courses" value={courseCount} />
            <StatPill tone="success" icon={Layers} label="Sections" value={sectionCount} />
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold',
              'bg-[color-mix(in_srgb,var(--brand-500)_18%,transparent)] text-brand-300',
              'border border-[color-mix(in_srgb,var(--brand-500)_28%,transparent)]',
              'transition-[gap,background] group-hover:gap-2 group-hover:bg-[color-mix(in_srgb,var(--brand-500)_26%,transparent)]',
            )}
          >
            <span className="hidden sm:inline">Open</span>
            <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  )
}

export function SavedRunsEmptyState() {
  return (
    <div className="theme-card relative w-full overflow-hidden rounded-3xl border border-border/80 p-10 text-center sm:p-14">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, color-mix(in srgb, var(--brand-500) 22%, transparent), transparent 70%)',
        }}
        aria-hidden
      />
      <div className="relative">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl theme-soft-info">
          <CalendarClock className="size-7 text-[var(--accent-info)]" aria-hidden />
        </div>
        <h2 className="mt-5 text-xl font-semibold text-text">No saved runs yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
          After a successful pass in Scheduler, use <span className="font-medium text-text">Save run</span> to freeze
          the timetable here for late registrations and faculty mapping.
        </p>
        <Link
          to="/app/scheduler"
          className="theme-btn-primary theme-focusable mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
        >
          Go to Scheduler
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

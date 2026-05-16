import { Mail, Users, Copy, CheckCircle2, FileWarning, Library } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/shared/utils/cn'
import { useSchedulingSession } from '@/contexts/scheduling/useSchedulingSession'
import { ImportSavedRunEmailsButton } from '@/features/scheduling/ImportSavedRunEmailsButton'

export function EmailsView() {
  const { result, fileName } = useSchedulingSession()
  const [copied, setCopied] = useState<string | null>(null)

  if (!result || !result.courseEmailsData) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <div
          className="mb-6 flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: 'color-mix(in srgb, var(--brand-500) 16%, transparent)' }}
        >
          <Mail className="size-10 text-brand-500" />
        </div>
        <h2 className="mb-2 text-2xl font-semibold text-text">No course emails loaded</h2>
        <p className="max-w-md text-text-muted">
          Upload an enrollment workbook in Scheduler, or import email groups from a saved run.
        </p>
        <ImportSavedRunEmailsButton className="mt-8" variant="primary" />
        <p className="mt-6 text-sm text-text-muted">
          Or{' '}
          <Link to="/app/scheduler" className="font-medium text-brand-400 hover:underline">
            go to Scheduler
          </Link>{' '}
          to process a new workbook.
        </p>
      </div>
    )
  }

  const { courseEmailsData } = result

  const handleCopy = (code: string, emails: string[]) => {
    navigator.clipboard.writeText(emails.join(', '))
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="mb-10">
        <h1 className="mb-3 text-4xl font-bold tracking-tight text-text">Course Emails</h1>
        <p className="text-lg text-text-muted">
          Extracted email lists grouped by course. Easily send bulk emails or copy addresses.
        </p>
        {fileName ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <Library className="size-4 shrink-0 text-brand-400" aria-hidden />
            <span>
              Source: <span className="font-medium text-text">{fileName}</span>
            </span>
          </p>
        ) : null}
        <div className="mt-4">
          <ImportSavedRunEmailsButton />
        </div>
      </header>

      {courseEmailsData.length === 0 ? (
        <div className="theme-card rounded-2xl p-8 text-center">
          <FileWarning className="mx-auto mb-4 size-8 text-text-muted" />
          <h3 className="text-lg font-medium text-text">No Emails Found</h3>
          <p className="text-text-muted">No valid email addresses were found in the enrollment data.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {courseEmailsData.map((group) => {
            const hasEmails = group.emails.length > 0
            const mailtoLink = `mailto:?bcc=${group.emails.join(',')}&subject=${encodeURIComponent(`Update regarding ${group.course_code}: ${group.course_title}`)}`

            return (
              <div key={group.course_code} className="theme-card theme-card-hover rounded-2xl p-6">
                <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
                  <div>
                    <div className="mb-1 flex items-center gap-3">
                      <h3 className="text-xl font-semibold text-text">{group.course_code}</h3>
                      <span className="theme-chip-brand px-2.5 py-0.5 text-xs font-medium">
                        {group.student_count} Students
                      </span>
                    </div>
                    <p className="text-text-muted">{group.course_title}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleCopy(group.course_code, group.emails)}
                      disabled={!hasEmails}
                      className={cn(
                        'theme-focusable inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200',
                        !hasEmails && 'theme-btn-secondary cursor-not-allowed opacity-50',
                        hasEmails && copied === group.course_code && 'theme-soft-success',
                        hasEmails && copied !== group.course_code && 'theme-btn-secondary',
                      )}
                    >
                      {copied === group.course_code ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copied === group.course_code ? 'Copied!' : 'Copy'}
                    </button>

                    <a
                      href={hasEmails ? mailtoLink : '#'}
                      onClick={(e) => !hasEmails && e.preventDefault()}
                      className={cn(
                        'theme-focusable inline-flex items-center gap-2 rounded-xl px-6 py-2 text-sm font-medium transition-all duration-200',
                        !hasEmails ? 'theme-btn-secondary cursor-not-allowed opacity-50' : 'theme-btn-primary',
                      )}
                    >
                      <Mail className="size-4" />
                      Send Email
                    </a>
                  </div>
                </div>

                <div className="theme-muted-surface rounded-xl p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Users className="size-4 text-brand-500" />
                    <span className="text-sm font-medium text-text">Recipients ({group.emails.length})</span>
                  </div>
                  {hasEmails ? (
                    <div className="max-h-24 overflow-y-auto break-all pr-2 text-sm leading-relaxed text-text-muted">
                      {group.emails.join(', ')}
                    </div>
                  ) : (
                    <div className="text-sm italic text-text-muted">No emails available for this course.</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

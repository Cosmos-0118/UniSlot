import { Mail, Users, Copy, CheckCircle2, FileWarning } from 'lucide-react';
import { useState } from 'react'
import { cn } from '@/shared/utils/cn'
import { useSchedulingSession } from '@/contexts/scheduling/useSchedulingSession'

export function EmailsView() {
  const { result } = useSchedulingSession()
  const [copied, setCopied] = useState<string | null>(null)

  if (!result || !result.courseEmailsData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div
          className="mb-6 flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: 'color-mix(in srgb, var(--brand-500) 16%, transparent)' }}
        >
          <Mail className="size-10 text-brand-500" />
        </div>
        <h2 className="text-2xl font-semibold text-text mb-2">No Data Available</h2>
        <p className="text-text-muted max-w-md">
          Please go to the Scheduler and upload an enrollment workbook first. Once processed, the course email groups will appear here.
        </p>
      </div>
    );
  }

  const { courseEmailsData } = result;

  const handleCopy = (code: string, emails: string[]) => {
    navigator.clipboard.writeText(emails.join(', '));
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-text mb-3">
          Course Emails
        </h1>
        <p className="text-lg text-text-muted">
          Extracted email lists grouped by course. Easily send bulk emails or copy addresses.
        </p>
      </header>

      {courseEmailsData.length === 0 ? (
        <div className="theme-card rounded-2xl p-8 text-center">
          <FileWarning className="size-8 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text">No Emails Found</h3>
          <p className="text-text-muted">No valid email addresses were found in the uploaded workbook.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {courseEmailsData.map((group) => {
            const hasEmails = group.emails.length > 0;
            const mailtoLink = `mailto:?bcc=${group.emails.join(',')}&subject=${encodeURIComponent(`Update regarding ${group.course_code}: ${group.course_title}`)}`;

            return (
              <div key={group.course_code} className="theme-card theme-card-hover rounded-2xl p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
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
                      {copied === group.course_code ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
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
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="size-4 text-brand-500" />
                    <span className="text-sm font-medium text-text">Recipients ({group.emails.length})</span>
                  </div>
                  {hasEmails ? (
                    <div className="max-h-24 overflow-y-auto break-all pr-2 text-sm leading-relaxed text-text-muted">
                      {group.emails.join(', ')}
                    </div>
                  ) : (
                    <div className="text-sm text-text-muted italic">
                      No emails available for this course.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

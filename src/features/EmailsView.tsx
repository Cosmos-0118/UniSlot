import { Mail, Users, Copy, CheckCircle2, FileWarning } from 'lucide-react';
import type { PipelineOutput } from '../hooks/useUnislotWorker';
import { useState } from 'react';
import { cn } from '../lib/cn';

export function EmailsView({ result }: { result: PipelineOutput | null }) {
  const [copied, setCopied] = useState<string | null>(null);

  if (!result || !result.courseEmailsData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-20 h-20 bg-brand-500/10 rounded-full flex items-center justify-center mb-6">
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
    <div className="px-8 py-10 max-w-5xl mx-auto">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-text mb-3">
          Course Emails
        </h1>
        <p className="text-lg text-text-muted">
          Extracted email lists grouped by course. Easily send bulk emails or copy addresses.
        </p>
      </header>

      {courseEmailsData.length === 0 ? (
        <div className="p-8 rounded-2xl bg-bg-secondary/50 border border-border text-center">
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
              <div key={group.course_code} className="p-6 rounded-2xl bg-bg-secondary/30 border border-border hover:border-brand-500/30 transition-colors duration-300">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-xl font-semibold text-text">{group.course_code}</h3>
                      <span className="px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-500 text-xs font-medium border border-brand-500/20">
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
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all duration-200",
                        !hasEmails ? "opacity-50 cursor-not-allowed border-border text-text-muted bg-bg-tertiary/20" :
                        copied === group.course_code 
                          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
                          : "bg-bg-tertiary/50 text-text hover:bg-bg-tertiary border-border hover:border-text-muted/50"
                      )}
                    >
                      {copied === group.course_code ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
                      {copied === group.course_code ? 'Copied!' : 'Copy'}
                    </button>
                    
                    <a
                      href={hasEmails ? mailtoLink : '#'}
                      onClick={(e) => !hasEmails && e.preventDefault()}
                      className={cn(
                        "flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-medium transition-all duration-200",
                        !hasEmails ? "opacity-50 cursor-not-allowed bg-bg-tertiary text-text-muted" : "bg-brand-500 text-white shadow-lg shadow-brand-500/20 hover:bg-brand-600 hover:-translate-y-0.5"
                      )}
                    >
                      <Mail className="size-4" />
                      Send Email
                    </a>
                  </div>
                </div>

                <div className="bg-bg/50 rounded-xl p-4 border border-border/50">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="size-4 text-brand-500" />
                    <span className="text-sm font-medium text-text">Recipients ({group.emails.length})</span>
                  </div>
                  {hasEmails ? (
                    <div className="max-h-24 overflow-y-auto text-sm text-text-muted break-all leading-relaxed custom-scrollbar pr-2">
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

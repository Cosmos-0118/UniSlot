/** Minimal placeholder while a lazy route chunk loads. */
export function RouteChunkFallback() {
  return (
    <div className="flex min-h-[min(420px,55vh)] flex-1 flex-col items-center justify-center gap-3 px-6 text-sm text-text-muted">
      <span className="flex size-9 items-center justify-center rounded-full border border-border/70 bg-bg-secondary/80 shadow-inner">
        <span className="size-2 animate-pulse rounded-full bg-brand-500 shadow-[0_0_12px_color-mix(in_srgb,var(--brand-500)_55%,transparent)]" />
      </span>
      <span className="font-medium tracking-wide text-text/80">Loading…</span>
    </div>
  )
}

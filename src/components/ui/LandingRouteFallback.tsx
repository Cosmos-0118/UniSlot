/** Opaque shell while the landing chunk loads — avoids flashing route fallback UI. */
export function LandingRouteFallback() {
  return <div className="min-h-[100dvh] bg-bg" aria-hidden />
}

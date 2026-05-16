import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RouteChunkFallback } from '@/components/ui/RouteChunkFallback'
import { AppDialogProvider } from '@/contexts/appDialog/AppDialogProvider'
import { ThemeProvider } from '@/contexts/theme/ThemeProvider'
import { SchedulingSessionProvider } from '@/contexts/scheduling/SchedulingSessionProvider'
import { DashboardLayout, ComingSoonPanel } from '@/features/dashboard/Dashboard'
import { BarChart3, SlidersHorizontal } from 'lucide-react'

const LandingPage = lazy(async () => {
  const m = await import('@/features/landing/LandingPage')
  return { default: m.LandingPage }
})

const Scheduler = lazy(async () => {
  const m = await import('@/features/scheduling/Scheduler')
  return { default: m.Scheduler }
})

const SavedRunsPage = lazy(async () => {
  const m = await import('@/features/scheduling/SavedRunsPage')
  return { default: m.SavedRunsPage }
})

const EmailsView = lazy(async () => {
  const m = await import('@/features/scheduling/EmailsView')
  return { default: m.EmailsView }
})

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <SchedulingSessionProvider>
          <AppDialogProvider>
            <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<RouteChunkFallback />}>
                <LandingPage />
              </Suspense>
            }
          />
          <Route path="/app" element={<DashboardLayout />}>
            <Route index element={<Navigate to="scheduler" replace />} />
            <Route path="scheduler" element={<Scheduler />} />
            <Route path="runs/:runId?" element={<SavedRunsPage />} />
            <Route path="emails" element={<EmailsView />} />
            <Route
              path="insights"
              element={
                <ComingSoonPanel
                  icon={BarChart3}
                  title="Insights in Progress"
                  description="Course-level analytics, slot heatmaps, and scheduling quality trends are being designed for this dashboard."
                  accent="var(--accent-info)"
                />
              }
            />
            <Route
              path="settings"
              element={
                <ComingSoonPanel
                  icon={SlidersHorizontal}
                  title="Settings in Progress"
                  description="Theme presets, export preferences, and advanced scheduling controls will be available here soon."
                  accent="var(--accent-warning)"
                />
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppDialogProvider>
        </SchedulingSessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

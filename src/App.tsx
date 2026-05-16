import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RouteChunkFallback } from './components/ui/RouteChunkFallback'
import { ThemeProvider } from './contexts/ThemeProvider'
import { SchedulingSessionProvider } from './contexts/SchedulingSessionProvider'
import { DashboardLayout, ComingSoonPanel } from './features/Dashboard'
import { BarChart3, SlidersHorizontal } from 'lucide-react'

const LandingPage = lazy(async () => {
  const m = await import('./features/LandingPage')
  return { default: m.LandingPage }
})

const Scheduler = lazy(async () => {
  const m = await import('./features/Scheduler')
  return { default: m.Scheduler }
})

const SavedRunsPage = lazy(async () => {
  const m = await import('./features/SavedRunsPage')
  return { default: m.SavedRunsPage }
})

const EmailsView = lazy(async () => {
  const m = await import('./features/EmailsView')
  return { default: m.EmailsView }
})

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<RouteChunkFallback />}>
                <LandingPage />
              </Suspense>
            }
          />
          <Route
            path="/app"
            element={
              <SchedulingSessionProvider>
                <DashboardLayout />
              </SchedulingSessionProvider>
            }
          >
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
      </BrowserRouter>
    </ThemeProvider>
  )
}

import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LandingRouteFallback } from '@/components/ui/LandingRouteFallback'
import { BootGateProvider } from '@/contexts/boot/BootGateProvider'
import { AppDialogProvider } from '@/contexts/appDialog/AppDialogProvider'
import { ThemeProvider } from '@/contexts/theme/ThemeProvider'
import { SchedulingSessionProvider } from '@/contexts/scheduling/SchedulingSessionProvider'
import { DashboardLayout, ComingSoonPanel } from '@/features/dashboard/Dashboard'
import { BarChart3, SlidersHorizontal } from 'lucide-react'

const LandingPage = lazy(async () => {
  const m = await import('@/features/landing/LandingPage')
  return { default: m.LandingPage }
})

const PrivacyPage = lazy(async () => {
  const m = await import('@/features/landing/PrivacyPage')
  return { default: m.PrivacyPage }
})

const TermsPage = lazy(async () => {
  const m = await import('@/features/landing/TermsPage')
  return { default: m.TermsPage }
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
        <BootGateProvider>
        <SchedulingSessionProvider>
          <AppDialogProvider>
            <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<LandingRouteFallback />}>
                <LandingPage />
              </Suspense>
            }
          />
          <Route
            path="/privacy"
            element={
              <Suspense fallback={<LandingRouteFallback />}>
                <PrivacyPage />
              </Suspense>
            }
          />
          <Route
            path="/terms"
            element={
              <Suspense fallback={<LandingRouteFallback />}>
                <TermsPage />
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
        </BootGateProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

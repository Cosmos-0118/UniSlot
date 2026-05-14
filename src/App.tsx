import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeProvider'
import { SchedulingSessionProvider } from './contexts/SchedulingSessionProvider'
import { LandingPage } from './features/LandingPage'
import { DashboardLayout, ComingSoonPanel } from './features/Dashboard'
import { Scheduler } from './features/Scheduler'
import { EmailsView } from './features/EmailsView'
import { BarChart3, SlidersHorizontal } from 'lucide-react'

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
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

import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Layout } from '../components/layout/Layout'
import { useSchedulingSession } from '../contexts/useSchedulingSession'
import type { LucideIcon } from 'lucide-react'

export function DashboardLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { resetSession } = useSchedulingSession()

  const parts = location.pathname.split('/').filter(Boolean)
  const activeFeature = parts[0] === 'app' && parts[1] ? parts[1] : 'scheduler'

  const setActiveFeature = (feature: string) => {
    navigate(`/app/${feature}`)
  }

  const goHome = () => {
    resetSession()
    navigate('/')
  }

  return (
    <Layout activeFeature={activeFeature} setActiveFeature={setActiveFeature} onLogoClick={goHome}>
      <Outlet />
    </Layout>
  )
}

export function ComingSoonPanel({
  icon: Icon,
  title,
  description,
  accent,
}: {
  icon: LucideIcon
  title: string
  description: string
  accent: string
}) {
  return (
    <div className="flex h-full items-center justify-center p-4 sm:p-8">
      <div className="theme-card w-full max-w-xl rounded-3xl p-8 text-center">
        <div
          className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: `color-mix(in srgb, ${accent} 18%, transparent)` }}
        >
          <Icon className="size-7" style={{ color: accent }} />
        </div>
        <h2 className="text-2xl font-semibold text-text">{title}</h2>
        <p className="mt-3 text-text-muted">{description}</p>
      </div>
    </div>
  )
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { isLandingPath, removeBootVeil } from '@/shared/boot/bootVeil'

if (isLandingPath()) {
  removeBootVeil()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

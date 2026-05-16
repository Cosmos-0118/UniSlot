import type { Theme } from './context'

export type ThemeTransitionSource =
  | { clientX: number; clientY: number }
  | 'center'

const STORAGE_KEY = 'unislot-theme'
const COVER_MS = 90
const REVEAL_MS = 340

const THEME_BG: Record<Theme, string> = {
  dark: '#070a14',
  light: '#f7fbf9',
  crimson: '#11070d',
}

const THEME_LABEL: Record<Theme, string> = {
  dark: 'Midnight',
  light: 'Sage',
  crimson: 'Crimson',
}

let activeCurtain: HTMLDivElement | null = null
let activeTimers: ReturnType<typeof setTimeout>[] = []
let sequence = 0

function clearTimers() {
  for (const id of activeTimers) clearTimeout(id)
  activeTimers = []
}

function clearCurtain() {
  clearTimers()
  activeCurtain?.remove()
  activeCurtain = null
  document.documentElement.removeAttribute('data-theme-switching')
}

function persistTheme(next: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* private mode / quota */
  }
}

function applyThemeToDom(next: Theme) {
  document.documentElement.setAttribute('data-theme', next)
  persistTheme(next)
}

function prefersInstantSwitch() {
  if (typeof window === 'undefined') return true
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  return false
}

function schedule(ms: number, fn: () => void) {
  const id = window.setTimeout(fn, ms)
  activeTimers.push(id)
  return id
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function runCurtainTransition(current: Theme, next: Theme, syncReact: () => void) {
  clearCurtain()
  const gen = ++sequence

  const curtain = document.createElement('div')
  curtain.className = 'theme-curtain'
  curtain.setAttribute('role', 'status')
  curtain.setAttribute('aria-live', 'polite')
  curtain.setAttribute('aria-busy', 'true')
  curtain.style.setProperty('--theme-curtain-from', THEME_BG[current])
  curtain.style.setProperty('--theme-curtain-to', THEME_BG[next])

  const panel = document.createElement('div')
  panel.className = 'theme-curtain__panel'
  panel.innerHTML = `<span class="theme-curtain__spinner" aria-hidden="true"></span><span class="theme-curtain__label">Switching to ${THEME_LABEL[next]}</span>`

  curtain.append(panel)
  document.body.appendChild(curtain)
  activeCurtain = curtain
  document.documentElement.setAttribute('data-theme-switching', '')

  const finish = () => {
    if (gen !== sequence) return
    curtain.setAttribute('aria-busy', 'false')
    clearCurtain()
  }

  void (async () => {
    await waitForPaint()
    if (gen !== sequence) return

    curtain.classList.add('theme-curtain--cover')

    schedule(COVER_MS, () => {
      if (gen !== sequence) return

      applyThemeToDom(next)
      syncReact()

      void waitForPaint().then(() => {
        if (gen !== sequence) return
        curtain.classList.remove('theme-curtain--cover')
        curtain.classList.add('theme-curtain--reveal')
      })
    })

    const onRevealEnd = (event: TransitionEvent) => {
      if (event.target !== curtain || event.propertyName !== 'opacity') return
      if (!curtain.classList.contains('theme-curtain--reveal')) return
      curtain.removeEventListener('transitionend', onRevealEnd)
      finish()
    }

    curtain.addEventListener('transitionend', onRevealEnd)
    schedule(COVER_MS + REVEAL_MS + 120, finish)
  })()
}

export function applyThemeTransition(
  current: Theme,
  next: Theme,
  syncReact: () => void,
  _source: ThemeTransitionSource = 'center',
) {
  const instant = () => {
    applyThemeToDom(next)
    syncReact()
  }

  if (prefersInstantSwitch() || current === next) {
    instant()
    return
  }

  // Programmatic normalize (e.g. landing page) — no curtain
  if (_source === 'center') {
    instant()
    return
  }

  runCurtainTransition(current, next, syncReact)
}

/** Inline boot veil id — injected from index.html on the landing route only. */
export const BOOT_VEIL_ID = 'boot-veil'

/** Theme-matched backgrounds (keep in sync with index.css `--bg`). */
export const BOOT_VEIL_BG: Record<'dark' | 'light' | 'crimson', string> = {
  dark: '#090b10',
  light: '#f6f5f2',
  crimson: '#0a0a0b',
}

export function removeBootVeil(): void {
  document.getElementById(BOOT_VEIL_ID)?.remove()
}

export function isLandingPath(pathname = window.location.pathname): boolean {
  return pathname === '/' || pathname === ''
}

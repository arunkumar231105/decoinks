/**
 * Light (the default) / Dark / Auto (follows the phone or computer), the viewer's own choice
 * kept in this browser (owner, 19 Sep 2026). index.html applies it before the
 * page draws, so a dark screen never flashes white.
 */
export type ThemeMode = 'light' | 'dark' | 'system'
const KEY = 'printshop:theme'

export function getThemeMode(): ThemeMode {
  // Light unless the viewer chose otherwise — Auto is a choice, not the default.
  try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'system' ? v : 'light' } catch { return 'light' }
}

const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

export function applyThemeMode(mode: ThemeMode = getThemeMode()) {
  const dark = mode === 'dark' || (mode === 'system' && prefersDark())
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1d21' : '#ffffff')
}

export function setThemeMode(mode: ThemeMode) {
  try { localStorage.setItem(KEY, mode) } catch { /* storage blocked */ }
  applyThemeMode(mode)
}

// Auto follows the device when it switches between light and dark.
if (typeof window !== 'undefined') {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (getThemeMode() === 'system') applyThemeMode('system')
  })
}

/**
 * Printshop's notification sound: a soft two-note chime made with Web Audio,
 * so there is no file to load. Browsers only let a page play sound after the
 * person has touched it once; the first tap or key press anywhere unlocks it.
 * On/off is the viewer's own choice, kept in this browser.
 */
const KEY = 'printshop:notify-sound'
let ctx: AudioContext | null = null

export const soundEnabled = () => {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}
export const setSoundEnabled = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* storage blocked */ }
}

function audio(): AudioContext | null {
  if (ctx) return ctx
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  return ctx
}

// Unlock on the first touch — before that, play() is silently refused.
if (typeof window !== 'undefined') {
  const unlock = () => {
    const c = audio()
    if (c && c.state === 'suspended') c.resume().catch(() => {})
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

/** Two bell-like notes, a fifth apart, each fading out. `force` plays even when turned off (the preview). */
export function playChime(force = false) {
  if (!force && !soundEnabled()) return
  const c = audio()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
  const now = c.currentTime
  const master = c.createGain()
  master.gain.value = 0.22
  master.connect(c.destination)
  const note = (freq: number, at: number, length: number) => {
    // A sine with a quieter octave above reads as a soft bell, not a beep.
    for (const [mult, level] of [[1, 1], [2, 0.18]] as const) {
      const osc = c.createOscillator()
      const g = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq * mult
      g.gain.setValueAtTime(0.0001, now + at)
      g.gain.exponentialRampToValueAtTime(level, now + at + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + length)
      osc.connect(g).connect(master)
      osc.start(now + at)
      osc.stop(now + at + length + 0.05)
    }
  }
  note(880, 0, 0.55)      // A5
  note(1318.5, 0.14, 0.8) // E6
}

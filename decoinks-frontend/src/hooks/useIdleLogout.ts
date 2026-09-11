import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import toast from '../utils/toast'

// Auto-logout after this much inactivity. It was 20 minutes, which threw people
// out mid-job — reading an order, on a call, waiting on a factory — often enough
// that the owner asked for it to go. Three hours still ends a session left open
// on a shared machine overnight.
const IDLE_MINUTES = 180
const IDLE_MS = IDLE_MINUTES * 60 * 1000

// The last moment anyone touched the app, in any tab. Each tab used to keep its
// own clock, so a tab left in the background ran out and called logout — which
// revokes the one refresh token every tab shares — and threw the person out of
// the tab they were actively working in. Writes are throttled: a mousemove every
// few milliseconds does not need to reach storage.
const LAST_ACTIVITY_KEY = 'decoinks:last-activity'
const WRITE_EVERY_MS = 30 * 1000

const readShared = (): number => {
  try { return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || 0 } catch { return 0 }
}
const writeShared = (t: number) => {
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(t)) } catch { /* storage blocked — the tab's own clock still works */ }
}

/**
 * Logs the user out after IDLE_MS with no interaction anywhere in the app.
 * Each tab keeps a timer; when it runs out, the tab checks the shared
 * last-activity time first and only logs out if no tab has been touched for the
 * whole period — otherwise it waits out the remainder.
 */
export function useIdleLogout(enabled: boolean) {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const localActivityRef = useRef(0)

  useEffect(() => {
    if (!enabled) return

    const schedule = (ms: number) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(check, ms)
    }

    const check = async () => {
      const idleFor = Date.now() - Math.max(readShared(), localActivityRef.current)
      if (idleFor < IDLE_MS) { schedule(IDLE_MS - idleFor); return }
      await logout()
      toast.error(`Logged out after ${IDLE_MINUTES / 60} hours of inactivity. Please log in again.`)
      navigate('/login', { replace: true })
    }

    const activity = () => {
      const now = Date.now()
      if (now - localActivityRef.current > WRITE_EVERY_MS) writeShared(now)
      localActivityRef.current = now
      schedule(IDLE_MS)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'visibilitychange']
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }))
    activity() // start the clock

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      events.forEach((e) => window.removeEventListener(e, activity))
    }
  }, [enabled, logout, navigate])
}

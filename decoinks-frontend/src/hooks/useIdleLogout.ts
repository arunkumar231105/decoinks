import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import toast from '../utils/toast'

// Auto-logout after this much inactivity.
const IDLE_MINUTES = 20
const IDLE_MS = IDLE_MINUTES * 60 * 1000

/**
 * Logs the user out after IDLE_MS of no interaction (mouse, keyboard, scroll,
 * touch). The timer resets on any activity. On timeout it revokes the session
 * (logout) and sends the user back to the login screen.
 */
export function useIdleLogout(enabled: boolean) {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!enabled) return

    const expire = async () => {
      await logout()
      toast.error(`Logged out after ${IDLE_MINUTES} minutes of inactivity. Please log in again.`)
      navigate('/login', { replace: true })
    }

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(expire, IDLE_MS)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'visibilitychange']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset() // start the clock

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [enabled, logout, navigate])
}

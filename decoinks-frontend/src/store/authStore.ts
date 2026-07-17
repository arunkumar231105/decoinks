import { create } from 'zustand'
import { api, tokenMemory, resetSessionState } from '../services/api'
import type { AuthUser } from '../types/auth'

const SSO_REDIRECT_KEY = 'decoinks_sso_redirect_started_at'

function clearSsoRedirectGuard() {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(SSO_REDIRECT_KEY)
}

function redirectToAuthentik() {
  if (typeof window === 'undefined' || !window.location.hostname.endsWith('.decoinkssuite.com')) return false
  // If Authentik returned to the app but /auth/sso failed, never bounce the
  // browser straight back to Authentik. That creates an infinite reload loop.
  const lastRedirect = Number(window.sessionStorage.getItem(SSO_REDIRECT_KEY) || 0)
  if (lastRedirect && Date.now() - lastRedirect < 60_000) return false
  window.sessionStorage.setItem(SSO_REDIRECT_KEY, String(Date.now()))
  const rd = `${window.location.origin}${window.location.pathname}${window.location.search}`
  window.location.replace(`${window.location.origin}/outpost.goauthentik.io/start?rd=${encodeURIComponent(rd)}`)
  return true
}

interface AuthState {
  user:            AuthUser | null
  isAuthenticated: boolean
  isLoading:       boolean

  login:          (email: string, password: string) => Promise<void>
  logout:         () => Promise<void>
  logoutEverywhere: () => Promise<void>
  initAuth:       () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user:            null,
  isAuthenticated: false,
  isLoading:       true,   // assume we might have a valid refresh cookie until we check

  // ── Login ──────────────────────────────────────────────────────────────────
  login: async (email, password) => {
    clearSsoRedirectGuard()
    resetSessionState()   // clear any stale "session ended" guard from previous expiry
    const res = await api.post('/auth/login', { email, password })
    const { token, user } = res.data.data
    // Access token lives in memory only — never localStorage
    tokenMemory.set(token)
    set({ user, isAuthenticated: true, isLoading: false })
  },

  // ── Logout (this device) ───────────────────────────────────────────────────
  logout: async () => {
    await api.post('/auth/logout').catch(() => {})  // revokes cookie-based refresh token
    tokenMemory.set(null)
    set({ user: null, isAuthenticated: false, isLoading: false })
  },

  // ── Logout everywhere ──────────────────────────────────────────────────────
  logoutEverywhere: async () => {
    await api.post('/auth/logout-everywhere').catch(() => {})
    tokenMemory.set(null)
    set({ user: null, isAuthenticated: false, isLoading: false })
  },

  // ── Silent refresh on app mount ────────────────────────────────────────────
  // Called once from ProtectedRoute. Tries to get a new access token using the
  // httpOnly refresh cookie. Retries up to 3 times (2s apart) to handle
  // transient backend restarts, then gives up and redirects to login.
  initAuth: async () => {
    const MAX_ATTEMPTS = 3
    const RETRY_DELAY  = 2000

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await api.post('/auth/refresh')
        const { token, user } = res.data.data
        tokenMemory.set(token)
        // Refresh now returns the user, so skip the extra /auth/me round-trip.
        // Fall back to /auth/me only if an older backend didn't include it.
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false })
        } else {
          const meRes = await api.get('/auth/me')
          set({ user: meRes.data.data, isAuthenticated: true, isLoading: false })
        }
        clearSsoRedirectGuard()
        return
      } catch (err: any) {
        // 401/403 means the token itself is invalid — no point retrying
        const status = err?.response?.status
        if (status === 401 || status === 403) break

        // Any other error (502, network down, etc.) — retry if attempts remain
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY))
        }
      }
    }

    try {
      const res = await api.post('/auth/sso')
      const { token, user } = res.data.data
      tokenMemory.set(token)
      clearSsoRedirectGuard()
      set({ user, isAuthenticated: true, isLoading: false })
      return
    } catch {
      if (redirectToAuthentik()) return
    }

    tokenMemory.set(null)
    set({ user: null, isAuthenticated: false, isLoading: false })
  },
}))

// ── Global session-expired handler ────────────────────────────────────────────
// api.ts dispatches this event when a /auth/refresh call fails (cookie gone/expired).
// We listen here so any part of the app gets redirected to login.
if (typeof window !== 'undefined') {
  window.addEventListener('auth:session-expired', () => {
    tokenMemory.set(null)
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
    // Let the router handle the redirect — no hard window.location so we keep SPA state
    window.dispatchEvent(new CustomEvent('auth:redirect-to-login'))
  })
}

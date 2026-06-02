import { create } from 'zustand'
import { api, tokenMemory, resetSessionState } from '../services/api'
import type { AuthUser } from '../types/auth'

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
  // Called once from App.tsx. Tries to get a new access token using the
  // httpOnly refresh cookie. If the cookie is absent or expired, sets
  // isAuthenticated=false without showing a login prompt.
  initAuth: async () => {
    try {
      const res = await api.post('/auth/refresh')
      const { token } = res.data.data
      tokenMemory.set(token)
      // Fetch full user profile now that we have an access token
      const meRes = await api.get('/auth/me')
      set({ user: meRes.data.data, isAuthenticated: true, isLoading: false })
    } catch {
      tokenMemory.set(null)
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
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

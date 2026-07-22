import { useState, useEffect } from 'react'
import { api, tokenMemory } from '../services/api'

/**
 * Silent-refresh hook for standalone print pages.
 * Print pages open in new tabs which have no in-memory access token.
 * This hook first calls POST /auth/refresh (httpOnly cookie), then falls back
 * to the Authentik SSO exchange. The fallback matters for users who entered
 * through the reverse-proxy SSO session and do not yet have an app refresh
 * cookie in a newly opened print tab.
 */
export function usePrintAuth() {
  // If the same-tab token is already set (e.g. user navigated within the app)
  const [authReady, setAuthReady]   = useState(() => !!tokenMemory.get())
  const [authFailed, setAuthFailed] = useState(false)

  useEffect(() => {
    if (tokenMemory.get()) {
      setAuthReady(true)
      return
    }
    let cancelled = false

    const authenticate = async () => {
      for (const endpoint of ['/auth/refresh', '/auth/sso']) {
        try {
          const res = await api.post(endpoint)
          const token = res.data?.data?.token ?? res.data?.token
          if (!token) continue
          tokenMemory.set(token)
          if (!cancelled) setAuthReady(true)
          return
        } catch {
          // A refresh cookie is optional for SSO users; try the SSO exchange.
        }
      }
      if (!cancelled) setAuthFailed(true)
    }

    void authenticate()
    return () => { cancelled = true }
  }, [])

  return { authReady, authFailed }
}

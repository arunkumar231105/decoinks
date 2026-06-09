import { useState, useEffect } from 'react'
import { api, tokenMemory } from '../services/api'

/**
 * Silent-refresh hook for standalone print pages.
 * Print pages open in new tabs which have no in-memory access token.
 * This hook calls POST /auth/refresh (httpOnly cookie) on mount to get
 * a fresh access token before the page tries to load data.
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
    api.post('/auth/refresh')
      .then(res => {
        const token = res.data?.data?.token ?? res.data?.token
        if (token) tokenMemory.set(token)
        setAuthReady(true)
      })
      .catch(() => {
        setAuthFailed(true)
      })
  }, [])

  return { authReady, authFailed }
}

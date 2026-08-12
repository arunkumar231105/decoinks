/**
 * Portal session.
 *
 * The token lives in localStorage because the portal is a plain SPA served by
 * nginx with no refresh-cookie flow; it is scoped to the customer and expires
 * server-side. Components subscribe through `useAuth`.
 */
import { useSyncExternalStore } from 'react'

export interface PortalCustomer {
  id: string
  name: string
  username: string
}

const TOKEN_KEY = 'decoinks.portal.token'
const USER_KEY = 'decoinks.portal.customer'

let listeners: (() => void)[] = []
const emit = () => listeners.forEach(l => l())

const read = <T,>(key: string): T | null => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null } catch { return null }
}

let state = {
  token: localStorage.getItem(TOKEN_KEY),
  customer: read<PortalCustomer>(USER_KEY),
}

export const auth = {
  getToken: () => state.token,

  signIn(token: string, customer: PortalCustomer) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(customer))
    state = { token, customer }
    emit()
  },

  signOut() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    state = { token: null, customer: null }
    emit()
  },

  subscribe(fn: () => void) {
    listeners.push(fn)
    return () => { listeners = listeners.filter(l => l !== fn) }
  },

  snapshot: () => state,
}

export const useAuth = () => useSyncExternalStore(auth.subscribe, auth.snapshot, auth.snapshot)

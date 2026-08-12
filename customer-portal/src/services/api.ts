/**
 * Thin client for the customer-facing API.
 *
 * Every call goes to `/api/portal/*`, which nginx proxies to the backend, so no
 * host is hard-coded. Responses are unwrapped from the `{ data }` envelope the
 * rest of the suite uses.
 */

import { auth } from '../store/auth'

const BASE = '/api/portal'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      signal,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(auth.getToken() ? { Authorization: `Bearer ${auth.getToken()}` } : {}),
      },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }

  if (res.status === 401 || res.status === 403) {
    // The session is gone — drop it so the app falls back to the login screen.
    auth.signOut()
    throw new ApiError('Your session has expired. Please sign in again.', res.status)
  }
  if (!res.ok) {
    throw new ApiError(`Request failed (${res.status}). Please try again.`, res.status)
  }

  const body = await res.json().catch(() => null)
  if (body === null) throw new ApiError('The server returned an unreadable response.', res.status)
  return (body?.data ?? body) as T
}

/** Signs the customer in and stores the session. */
export async function login(username: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(body?.error || 'Invalid username or password', res.status)
  auth.signIn(body.token, body.customer)
  return body
}

export const endpoints = {
  summary: '/summary',
  orders: '/orders',
  artworks: '/artworks',
  profile: '/profile',
}

/* ── Formatting helpers shared by the pages ─────────────────────────────── */

export const money = (n: number | null | undefined) =>
  `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const num = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-US')

export const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v)

/** ISO timestamp → "Aug 04, 2026". Anything unparseable passes through. */
export const fmtDate = (v: string | null | undefined) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

/** ISO timestamp → "09:20 AM", or null when there is no meaningful time. */
export const fmtTime = (v: string | null | undefined) => {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return null   // date-only value
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

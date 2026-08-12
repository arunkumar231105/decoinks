/**
 * Thin client for the customer-facing API.
 *
 * Every call goes to `/api/portal/*`, which nginx proxies to the backend, so no
 * host is hard-coded. Responses are unwrapped from the `{ data }` envelope the
 * rest of the suite uses.
 */

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
      headers: { Accept: 'application/json' },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }

  if (res.status === 401 || res.status === 403) {
    throw new ApiError('Your session has expired. Please sign in again.', res.status)
  }
  if (!res.ok) {
    throw new ApiError(`Request failed (${res.status}). Please try again.`, res.status)
  }

  const body = await res.json().catch(() => null)
  if (body === null) throw new ApiError('The server returned an unreadable response.', res.status)
  return (body?.data ?? body) as T
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

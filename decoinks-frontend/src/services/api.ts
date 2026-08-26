import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios'

// ── In-memory token store ─────────────────────────────────────────────────────
// Access token lives only in memory (never localStorage/sessionStorage).
// authStore calls tokenMemory.set() after login / silent refresh.
// api.ts reads it on every request.
let _accessToken: string | null = null

export const tokenMemory = {
  get: ()              => _accessToken,
  set: (t: string | null) => { _accessToken = t },
}

// ── Axios instance ────────────────────────────────────────────────────────────
export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,   // send the httpOnly refresh-token cookie on every request
})

// ── Request interceptor — attach access token ─────────────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // Axios serializes FormData as JSON when the instance-level JSON content type
  // is left in place. Let the browser set multipart/form-data with its boundary.
  if (config.data instanceof FormData) {
    config.headers.delete('Content-Type')
  }
  const token = tokenMemory.get()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Silent-refresh state ──────────────────────────────────────────────────────
let isRefreshing = false
let refreshQueue: Array<{
  resolve: (token: string) => void
  reject:  (err: unknown)  => void
}> = []

function processQueue(err: unknown, newToken: string | null) {
  for (const { resolve, reject } of refreshQueue) {
    if (err) reject(err)
    else     resolve(newToken!)
  }
  refreshQueue = []
}

export function resetSessionState() {
  isRefreshing = false
  refreshQueue = []
}

// ── The SSO wall ──────────────────────────────────────────────────────────────
// When the Authentik session ends, the proxy does not answer 401. It answers 302
// to /outpost.goauthentik.io/start, which redirects on to decoinkssuite.com and
// finally serves the login page as 200 text/html. The browser follows all of
// that inside the XHR, so axios never sees the 302 — it sees either HTML where
// JSON was expected, or a network error when the cross-origin hop is blocked.
// Neither is a 401, so this used to fall through as "Failed to update order".
function isSsoWall(res: { headers?: any; request?: any } | undefined) {
  if (!res) return false
  const finalUrl: string = res.request?.responseURL || ''
  if (finalUrl.includes('/outpost.goauthentik.io/') || finalUrl.includes('/if/flow/')) return true
  const contentType = String(res.headers?.['content-type'] || '')
  return contentType.includes('text/html')
}

// The session is gone. Hand the app an error shaped like a real API failure, so
// the toasts already written as `err.response?.data?.message ?? '…'` say why
// instead of showing their fallback, and wake the redirect in authStore.
// 440 is not a backend status — nothing here returns it — so it cannot be
// mistaken for one the API actually sent.
function sessionExpiredError(message: string, originalReq?: AxiosRequestConfig) {
  tokenMemory.set(null)
  window.dispatchEvent(new CustomEvent('auth:session-expired'))
  return Object.assign(new Error(message), {
    isAxiosError: true,
    code: 'ERR_SESSION_EXPIRED',
    config: originalReq,
    response: { status: 440, data: { message, error: message } },
  })
}

const SESSION_ENDED = 'Your session has ended. Sign in again — the change was not saved.'
// A blocked request cannot be told apart from a dead network on the client, so
// this says both rather than claiming the one it cannot prove. Being wrong is
// cheap: the redirect re-runs SSO and a live session comes straight back.
const UNREACHABLE = 'The server could not be reached — most likely your sign-in ' +
  'session ended. Sign in again; the change was not saved.'

// ── Response interceptor — the SSO wall first, then silent refresh on 401 ─────
api.interceptors.response.use(
  (res) => {
    // A 200 carrying the login page is not a success, whatever the status says.
    if (isSsoWall(res)) return Promise.reject(sessionExpiredError(SESSION_ENDED, res.config))
    return res
  },
  async (err: AxiosError) => {
    const originalReq = err.config as AxiosRequestConfig & { _retried?: boolean }
    const isAuthCall = originalReq?.url === '/auth/refresh' || originalReq?.url === '/auth/login'

    // The proxy answered, and what it answered with was the login page.
    if (!isAuthCall && isSsoWall(err.response)) {
      return Promise.reject(sessionExpiredError(SESSION_ENDED, originalReq))
    }

    // Nothing came back at all. There are no CORS headers anywhere on the
    // outpost redirect chain, so once it leaves the origin the browser blocks
    // it and axios is left with no response — which is what actually happens
    // when the session ends, far more often than the HTML case above.
    // Timeouts and cancellations are excluded: those are not the wall.
    if (
      !isAuthCall && !err.response &&
      err.code !== 'ECONNABORTED' && err.code !== 'ERR_CANCELED'
    ) {
      return Promise.reject(sessionExpiredError(UNREACHABLE, originalReq))
    }

    // Only intercept 401s that haven't already been retried,
    // and never intercept the refresh/login calls themselves.
    if (
      err.response?.status !== 401 ||
      originalReq._retried ||
      originalReq.url === '/auth/refresh' ||
      originalReq.url === '/auth/login'
    ) {
      return Promise.reject(err)
    }

    originalReq._retried = true

    // If a refresh is already in flight, queue this request
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        refreshQueue.push({ resolve, reject })
      }).then((newToken) => {
        if (originalReq.headers) {
          (originalReq.headers as Record<string, string>).Authorization = `Bearer ${newToken}`
        }
        return api(originalReq)
      })
    }

    // We are the first 401 — kick off the refresh
    isRefreshing = true

    try {
      const { data } = await api.post<{ data: { token: string } }>('/auth/refresh')
      const newToken = data.data.token
      tokenMemory.set(newToken)
      processQueue(null, newToken)

      if (originalReq.headers) {
        (originalReq.headers as Record<string, string>).Authorization = `Bearer ${newToken}`
      }
      return api(originalReq)
    } catch (refreshErr) {
      // Refresh token itself is expired — user must log in again
      processQueue(refreshErr, null)
      tokenMemory.set(null)
      window.dispatchEvent(new CustomEvent('auth:session-expired'))
      return Promise.reject(refreshErr)
    } finally {
      isRefreshing = false
    }
  }
)

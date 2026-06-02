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
  const token = tokenMemory.get()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Silent-refresh state ──────────────────────────────────────────────────────
let isRefreshing  = false
let sessionEnded  = false   // true after a refresh fails — stops further attempts this session
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

// Called by authStore on successful login so the guard resets
export function resetSessionState() {
  sessionEnded = false
  isRefreshing = false
  refreshQueue = []
}

// ── Response interceptor — silent refresh on 401 ──────────────────────────────
api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const originalReq = err.config as AxiosRequestConfig & { _retried?: boolean }

    // Only intercept 401s that haven't already been retried,
    // and never intercept the refresh call itself (avoid infinite loop).
    if (
      err.response?.status !== 401 ||
      originalReq._retried ||
      originalReq.url === '/auth/refresh' ||
      originalReq.url === '/auth/login'
    ) {
      return Promise.reject(err)
    }

    // Refresh already failed this session — don't attempt again, just reject
    if (sessionEnded) {
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

      // Retry original request with new token
      if (originalReq.headers) {
        (originalReq.headers as Record<string, string>).Authorization = `Bearer ${newToken}`
      }
      return api(originalReq)
    } catch (refreshErr) {
      sessionEnded = true   // prevent any further refresh attempts until next login
      processQueue(refreshErr, null)
      tokenMemory.set(null)

      // Notify app to redirect to login — fires exactly once per expired session
      window.dispatchEvent(new CustomEvent('auth:session-expired'))
      return Promise.reject(refreshErr)
    } finally {
      isRefreshing = false
    }
  }
)

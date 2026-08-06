import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optional label shown in the heading, e.g. the page name */
  label?: string
}

interface State {
  hasError: boolean
  message:  string
}

/**
 * React error boundary.
 * Catches render/lifecycle errors in child components and shows a
 * friendly UI instead of an empty white screen.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <MyPage />
 *   </ErrorBoundary>
 */
// A failure that means "our JS bundle is out of sync with what the server
// serves" — the only real fix is to reload so the browser fetches the new
// index.html + new chunk file names. Match generously: browsers word these
// errors differently (Chrome, Firefox, Safari, Edge all use different text).
const STALE_CHUNK_RE = /(loading chunk|failed to fetch dynamically imported module|importing a module script failed|failed to import|stale chunk|has no matching export)/i

const RELOAD_KEY_PREFIX = 'decoinks:chunk-reload:'
const RELOAD_COOLDOWN_MS = 30_000

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message ?? 'Unknown error' }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', err, info.componentStack)
    // Auto-recover from a stale chunk once per 30s — the user should never
    // have to see the error UI for something a page reload fixes.
    if (STALE_CHUNK_RE.test(err?.message || '')) {
      const key = RELOAD_KEY_PREFIX + 'boundary'
      const now = Date.now()
      const last = Number(sessionStorage.getItem(key) || 0)
      if (now - last > RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem(key, String(now))
        // A tiny delay lets React finish the render pass so the UI does not
        // flicker on its way out.
        setTimeout(() => window.location.reload(), 100)
      }
    }
  }

  handleReload = () => {
    // Clear all reload cooldowns so a manual reload always gets one more try.
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(RELOAD_KEY_PREFIX))
      .forEach(k => sessionStorage.removeItem(k))
    window.location.reload()
  }

  handleReset = () => {
    // Clearing cooldowns here too lets the next lazy-load attempt reload if
    // the failure was truly stale-chunk-related.
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(RELOAD_KEY_PREFIX))
      .forEach(k => sessionStorage.removeItem(k))
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 360,
        padding: '40px 24px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: '#fef2f2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}>
          <AlertTriangle size={26} color="#dc2626" />
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>
          Something went wrong
          {this.props.label ? ` in ${this.props.label}` : ''}
        </h2>

        <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 380, margin: '0 0 6px', lineHeight: 1.6 }}>
          An unexpected error occurred while rendering this page. Your data is safe.
        </p>

        {this.state.message && (
          <code style={{
            display: 'block',
            fontSize: 11,
            color: '#9ca3af',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            padding: '6px 12px',
            maxWidth: 480,
            marginBottom: 24,
            wordBreak: 'break-all',
          }}>
            {this.state.message}
          </code>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button
            onClick={this.handleReset}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: '#fff',
              fontSize: 13,
              fontWeight: 600,
              color: '#374151',
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
          <button
            onClick={this.handleReload}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: '#4f46e5',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RotateCcw size={13} />
            Reload Page
          </button>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary

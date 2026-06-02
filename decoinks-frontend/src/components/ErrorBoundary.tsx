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
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message ?? 'Unknown error' }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', err, info.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReset = () => {
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

/**
 * Unified loading components.
 *
 *   <PageLoader />            — full-section centered spinner
 *   <Spinner size={24} />     — inline spinner, any size
 *   <SkeletonRows n={5} />    — shimmer rows for table bodies
 *   <SkeletonCard />          — shimmer block for cards / detail panels
 */

const shimmer: React.CSSProperties = {
  background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.4s infinite',
  borderRadius: 6,
}

// Inject the keyframe once
if (typeof document !== 'undefined') {
  const id = 'loading-state-keyframes'
  if (!document.getElementById(id)) {
    const s = document.createElement('style')
    s.id = id
    s.textContent = '@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}'
    document.head.appendChild(s)
  }
}

// ── Spinner ────────────────────────────────────────────────────────────────────
interface SpinnerProps {
  size?: number
  color?: string
  className?: string
}

export function Spinner({ size = 24, color = '#6366f1', className }: SpinnerProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        border: `${Math.max(2, Math.round(size / 8))}px solid #e5e7eb`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  )
}

// ── PageLoader ─────────────────────────────────────────────────────────────────
interface PageLoaderProps {
  label?: string
  minHeight?: number | string
}

export function PageLoader({ label, minHeight = 280 }: PageLoaderProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight, gap: 14 }}>
      <Spinner size={36} />
      {label && <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>{label}</p>}
    </div>
  )
}

// ── SkeletonRows (for table <tbody>) ──────────────────────────────────────────
interface SkeletonRowsProps {
  n?: number
  cols?: number
}

export function SkeletonRows({ n = 5, cols = 5 }: SkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} style={{ padding: '10px 16px' }}>
              <div style={{ ...shimmer, height: 14, width: j === 0 ? '40%' : '70%' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ── SkeletonCard ───────────────────────────────────────────────────────────────
interface SkeletonCardProps {
  lines?: number
}

export function SkeletonCard({ lines = 4 }: SkeletonCardProps) {
  const widths = ['60%', '85%', '70%', '50%', '80%', '40%']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ ...shimmer, height: i === 0 ? 20 : 14, width: widths[i % widths.length] }} />
      ))}
    </div>
  )
}

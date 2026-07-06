import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'

// Lightweight fallback shown while a route's code chunk loads (code-splitting).
function RouteFallback() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%',
        border: '3px solid #e2e8f0', borderTopColor: '#0d9488',
        animation: 'nq-spin 0.7s linear infinite',
      }} />
      <style>{'@keyframes nq-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  )
}

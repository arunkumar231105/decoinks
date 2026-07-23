import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import toast from '../utils/toast'
import { useAuthStore } from '../store/authStore'
import { useIdleLogout } from '../hooks/useIdleLogout'

export function ProtectedRoute() {
  const { isAuthenticated, isLoading, initAuth } = useAuthStore()
  const location = useLocation()
  const navigate  = useNavigate()

  // Auto-logout after the configured inactivity period (only while logged in)
  useIdleLogout(isAuthenticated)

  // Silent refresh on mount - calls POST /auth/refresh with the httpOnly cookie
  useEffect(() => {
    if (isLoading) initAuth()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for session-expired events dispatched by the api.ts interceptor
  // when /auth/refresh itself returns 401 (refresh token gone / revoked).
  useEffect(() => {
    function onSessionExpired() {
      toast.error('Session expired - please log in again.')
      navigate('/login', { replace: true })
    }
    window.addEventListener('auth:redirect-to-login', onSessionExpired)
    return () => window.removeEventListener('auth:redirect-to-login', onSessionExpired)
  }, [navigate])

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span style={{ color: '#0D9488', fontSize: 14 }}>Loading...</span>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}

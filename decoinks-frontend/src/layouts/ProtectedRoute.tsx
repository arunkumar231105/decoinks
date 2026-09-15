import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import toast from '../utils/toast'
import { useAuthStore } from '../store/authStore'

export function ProtectedRoute() {
  const { isAuthenticated, isLoading, initAuth } = useAuthStore()
  const location = useLocation()
  const navigate  = useNavigate()

  // No logout for inactivity: the owner asked for sessions to stay open until
  // someone signs out (the idle timer that did it was removed on 15 Sep 2026).

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

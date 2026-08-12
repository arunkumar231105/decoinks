import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import api from '../services/api'
import toast from 'react-hot-toast'

export function useSupplierAuth() {
  const { token, supplier, mustChangePw, login, logout } = useAuthStore()
  const navigate = useNavigate()

  const signIn = useCallback(
    async (username: string, password: string) => {
      const { data } = await api.post('/auth/login', { username, password })
      login(data.token, data.supplier, data.mustChangePw)
      return { mustChangePw: data.mustChangePw }
    },
    [login],
  )

  const signOut = useCallback(() => {
    logout()
    navigate('/login', { replace: true })
    toast.success('Logged out')
  }, [logout, navigate])

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await api.patch('/me/password', { currentPassword, newPassword })
    },
    [],
  )

  return {
    token,
    supplier,
    mustChangePw,
    isAuthenticated: !!token,
    signIn,
    signOut,
    changePassword,
  }
}

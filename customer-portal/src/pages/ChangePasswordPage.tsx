import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'

export default function ChangePasswordPage() {
  const navigate  = useNavigate()
  const { logout, token, supplier, login } = useAuthStore()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw]         = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [saving, setSaving]       = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (newPw !== confirmPw) { toast.error('Passwords do not match'); return }
    if (newPw.length < 8)    { toast.error('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      await api.patch('/me/password', { currentPassword: currentPw, newPassword: newPw })
      // Clear mustChangePw flag so guard won't redirect again
      if (token && supplier) login(token, supplier, false)
      toast.success('Password changed successfully')
      navigate('/')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to change password'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-sidebar flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4">
            <Lock size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Change Your Password</h1>
          <p className="text-white/50 text-sm mt-1">You must set a new password before continuing</p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { label: 'Temporary Password',   value: currentPw, set: setCurrentPw, auto: 'current-password' },
              { label: 'New Password',          value: newPw,     set: setNewPw,     auto: 'new-password' },
              { label: 'Confirm New Password',  value: confirmPw, set: setConfirmPw, auto: 'new-password' },
            ].map(({ label, value, set, auto }) => (
              <div key={label}>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className="input pr-10"
                    placeholder="••••••••"
                    autoComplete={auto}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            ))}

            <button
              type="submit"
              disabled={saving}
              className="btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-2"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? 'Saving...' : 'Set New Password'}
            </button>
          </form>

          <button
            onClick={() => { logout(); navigate('/login') }}
            className="w-full text-center text-xs text-gray-400 hover:text-gray-600 mt-4"
          >
            Back to Login
          </button>
        </div>
      </div>
    </div>
  )
}

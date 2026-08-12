import { FormEvent, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'

export default function ProfilePage() {
  const [currentPw, setCurrentPw]   = useState('')
  const [newPw, setNewPw]           = useState('')
  const [confirmPw, setConfirmPw]   = useState('')
  const [showPw, setShowPw]         = useState(false)
  const [saving, setSaving]         = useState(false)

  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/me').then((r) => r.data),
  })

  const profile = data?.supplier ?? {}

  const handleChangePw = async (e: FormEvent) => {
    e.preventDefault()
    if (newPw !== confirmPw) { toast.error('Passwords do not match'); return }
    if (newPw.length < 8)    { toast.error('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      await api.patch('/me/password', { currentPassword: currentPw, newPassword: newPw })
      toast.success('Password changed successfully')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to change password'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Profile</h2>
        <p className="text-sm text-gray-500 mt-1">Manage your account information.</p>
      </div>

      {/* Company info */}
      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-900">Company Information</h3>
        {[
          { label: 'Company Name', value: profile.name },
          { label: 'Email',        value: profile.email },
          { label: 'Phone',        value: profile.phone },
          { label: 'Address',      value: [profile.address_line1, profile.city, profile.state, profile.country].filter(Boolean).join(', ') },
        ].map(({ label, value }) => (
          <div key={label} className="flex gap-4">
            <dt className="w-36 text-sm text-gray-500 flex-shrink-0">{label}</dt>
            <dd className="text-sm text-gray-900 font-medium">{value || '—'}</dd>
          </div>
        ))}
      </div>

      {/* Change password */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">Change Password</h3>
        <form onSubmit={handleChangePw} className="space-y-4">
          {[
            { label: 'Current Password', value: currentPw, set: setCurrentPw },
            { label: 'New Password',     value: newPw,     set: setNewPw },
            { label: 'Confirm New Password', value: confirmPw, set: setConfirmPw },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className="input pr-10"
                  placeholder="••••••••"
                  required
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          ))}
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  )
}

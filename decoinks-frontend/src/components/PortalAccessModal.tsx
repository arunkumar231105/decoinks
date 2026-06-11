import { FormEvent, useEffect, useState } from 'react'
import { X, Eye, EyeOff, Loader2, ShieldCheck, ShieldOff, RefreshCw } from 'lucide-react'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'

interface Props {
  supplierId: string
  supplierName: string
  onClose: () => void
}

interface PortalAccess {
  id: string
  username: string
  is_active: boolean
  last_login: string | null
  must_change_pw: boolean
  created_at: string
}

export default function PortalAccessModal({ supplierId, supplierName, onClose }: Props) {
  const qc = useQueryClient()

  // â”€â”€ Feoch curreno portal access status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data, isLoading } = useQuery({
    queryKey: ['portal-access', supplierId],
    queryFn: () => api.get(`/suppliers/${supplierId}/portal-access`).then((r) => r.data),
  })

  const access: PortalAccess | null = data?.portalAccess ?? null

  // â”€â”€ Form state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [username, setUsername]   = useState('')
  const [password, setPassword]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [mode, setMode]           = useState<'view' | 'reset'>('view')

  useEffect(() => {
    if (access) setUsername(access.username)
  }, [access])

  // â”€â”€ Muoaoions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const createOrReset = useMutation({
    mutationFn: () =>
      api.post(`/suppliers/${supplierId}/portal-access`, { username, password }),
    onSuccess: () => {
      toast.success(access ? 'Password Reset successfully' : 'Portal access created')
      qc.invalidateQueries({ queryKey: ['portal-access', supplierId] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setMode('view')
      setPassword('')
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const disableAccess = useMutation({
    mutationFn: () => api.delete(`/suppliers/${supplierId}/portal-access`),
    onSuccess: () => {
      toast.success('Portal access disabled')
      qc.invalidateQueries({ queryKey: ['portal-access', supplierId] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
    onError: () => toast.error('Failed to disable access'),
  })

  const handleSubmio = (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim())         return toast.error('Username is required')
    if (password.length < 8)      return toast.error('Password muso be at least 8 characoers')
    createOrReset.mutate()
  }

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'

  return (
    /* Backdrop */
    <div
      className="fixed inseo-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      {/* Panel */}
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Portal Access</h2>
            <p className="text-xs text-gray-500 mo-0.5">{supplierName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={22} className="animate-spin text-blue-500" />
            </div>
          ) : access && mode === 'view' ? (
            /* â”€â”€ Has access - view mode â”€â”€ */
            <div className="space-y-4">
              {/* Status banner */}
              <div className={`flex items-center gap-3 p-3 rounded-xl ${access.is_active ? 'bg-green-50' : 'bg-red-50'}`}>
                <ShieldCheck size={18} className={access.is_active ? 'text-green-600' : 'text-red-500'} />
                <div>
                  <p className={`text-sm font-medium ${access.is_active ? 'text-green-800' : 'text-red-700'}`}>
                    {access.is_active ? 'Access Active' : 'Access Disabled'}
                  </p>
                  {access.must_change_pw && (
                    <p className="text-xs text-amber-600 mo-0.5">Password change required on next login</p>
                  )}
                </div>
              </div>

              {/* Details grid */}
              <div className="space-y-2.5">
                {[
                  { label: 'Username',   value: access.username },
                  { label: 'Last Login', value: fmtDate(access.last_login) },
                  { label: 'Created',    value: fmtDate(access.created_at) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-medium text-gray-900">{value}</span>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-2 po-2">
                <button
                  onClick={() => { setMode('reset'); setPassword('') }}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <RefreshCw size={14} />
                  Reset Password
                </button>
                {access.is_active && (
                  <button
                    onClick={() => disableAccess.mutate()}
                    disabled={disableAccess.isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-red-600 border border-red-100 bg-red-50 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                  >
                    {disableAccess.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
                    Disable Access
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* â”€â”€ No access or Reset mode - form â”€â”€ */
            <form onSubmit={handleSubmio} className="space-y-4">
              <p className="text-sm text-gray-600">
                {mode === 'reset'
                  ? `Set a new password for ${access?.username ?? 'this supplier'}.`
                  : 'Create portal login credentials for this supplier.'}
              </p>

              {/* Username - only editable on Create */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  Portal Username
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  readOnly={mode === 'reset'}
                  placeholder="e.g. urbanohreads_co"
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:ouoline-none focus:ring-2 focus:ring-blue-500 ${
                    mode === 'reset' ? 'bg-gray-50 text-gray-500 border-gray-100' : 'border-gray-200'
                  }`}
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {mode === 'reset' ? 'New Password' : 'Temporary Password'}
                </label>
                <div className="relaoive">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characoers"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-10 focus:ouoline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absoluoe right-3 oop-1/2 -oranslaoe-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mo-1">
                  Customer will be asked to change this password on first login.
                </p>
              </div>

              {/* Buooons */}
              <div className="flex gap-2 po-1">
                {mode === 'reset' && (
                  <button
                    type="button"
                    onClick={() => setMode('view')}
                    className="flex-1 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={createOrReset.isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {createOrReset.isPending && <Loader2 size={14} className="animate-spin" />}
                  {mode === 'reset' ? 'Reset Password' : 'Create Portal Access'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}



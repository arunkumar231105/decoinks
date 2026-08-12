import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Eye, EyeOff, KeyRound, RefreshCw, ShieldOff, UserRound } from 'lucide-react'
import { api } from '../services/api'
import toast from '../utils/toast'

/**
 * Customer Portal access.
 *
 * Staff pick a customer, set the username/email and password, and hand those
 * credentials to the customer, who then signs in at the Customer Portal. The
 * password is only ever sent here — it is stored hashed and never returned.
 */

interface CustomerRow { id: string; name: string; customer_number?: string; email?: string | null }
interface PortalAccess {
  id: string
  username: string
  email: string | null
  is_active: boolean
  last_login: string | null
  created_at: string
}

const randomPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(14))
  return Array.from(bytes, n => alphabet[n % alphabet.length]).join('')
}

export function PortalAccessPage() {
  const qc = useQueryClient()
  const [customerId, setCustomerId] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  const customers = useQuery({
    queryKey: ['customers', 'portal-access-picker'],
    // The list endpoint answers { data: { rows, total, ... } }.
    queryFn: () => api.get('/customers', { params: { limit: 500 } })
      .then(r => (r.data?.data?.rows ?? []) as CustomerRow[]),
  })

  const access = useQuery({
    queryKey: ['portal-access', customerId],
    queryFn: () => api.get(`/customers/${customerId}/portal-access`).then(r => r.data.portalAccess as PortalAccess | null),
    enabled: !!customerId,
  })

  const selected = useMemo(
    () => (customers.data ?? []).find(c => c.id === customerId),
    [customers.data, customerId])

  // Pre-fill from the existing account, or suggest the customer's email.
  useEffect(() => {
    if (!customerId) return
    if (access.data) {
      setUsername(access.data.username)
      setEmail(access.data.email ?? '')
    } else {
      setUsername(selected?.email ?? '')
      setEmail(selected?.email ?? '')
    }
    setPassword('')
  }, [customerId, access.data, selected])

  const save = useMutation({
    mutationFn: () => api.post(`/customers/${customerId}/portal-access`, { username, email, password }),
    onSuccess: () => {
      toast.success(access.data ? 'Password updated' : 'Portal access created')
      qc.invalidateQueries({ queryKey: ['portal-access', customerId] })
      setPassword('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not save portal access'),
  })

  const disable = useMutation({
    mutationFn: () => api.delete(`/customers/${customerId}/portal-access`),
    onSuccess: () => {
      toast.success('Portal access disabled')
      qc.invalidateQueries({ queryKey: ['portal-access', customerId] })
    },
    onError: () => toast.error('Could not disable portal access'),
  })

  const canSave = !!customerId && username.trim().length > 0 && password.length >= 8

  return (
    <div style={{ padding: '24px 32px', maxWidth: 860, margin: '0 auto' }}>
      <div className="al-panel" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <KeyRound size={18} style={{ color: '#2563EB' }} />
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', margin: 0 }}>Customer Portal Access</h2>
        </div>
        <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>
          Pick a customer, set their sign-in details, then share those credentials with them.
          They sign in at the Customer Portal and only ever see their own orders, artwork and invoices.
        </p>

        <div className="al-field">
          <label>Customer <span className="al-req">*</span></label>
          <select className="al-input" value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">
              {customers.isLoading ? 'Loading customers…' : '— Select a customer —'}
            </option>
            {(customers.data ?? []).map(c => (
              <option key={c.id} value={c.id}>
                {c.customer_number ? `${c.customer_number} — ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </div>

        {customerId && (
          <>
            {/* Current state */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 20px',
              padding: '12px 14px', borderRadius: 10,
              background: access.data ? (access.data.is_active ? '#ECFDF5' : '#FEF2F2') : '#F8FAFC',
              border: `1px solid ${access.data ? (access.data.is_active ? '#A7F3D0' : '#FECACA') : '#E2E8F0'}`,
            }}>
              {access.isLoading ? <RefreshCw size={16} className="spin" /> :
                access.data
                  ? (access.data.is_active ? <CheckCircle2 size={16} color="#059669" /> : <ShieldOff size={16} color="#DC2626" />)
                  : <UserRound size={16} color="#64748B" />}
              <div style={{ fontSize: 13, color: '#334155' }}>
                {access.isLoading ? 'Checking…'
                  : access.data
                    ? <>
                        Portal access <strong>{access.data.is_active ? 'active' : 'disabled'}</strong> — username <strong>{access.data.username}</strong>.
                        {' '}Last sign-in: {access.data.last_login ? new Date(access.data.last_login).toLocaleString() : 'never'}.
                      </>
                    : <>No portal account yet for this customer.</>}
              </div>
            </div>

            <div className="al-field">
              <label>Username or Email <span className="al-req">*</span></label>
              <input className="al-input" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="e.g. customer@company.com" autoComplete="off" />
            </div>

            <div className="al-field">
              <label>Contact Email</label>
              <input className="al-input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Where we can reach this account" autoComplete="off" />
            </div>

            <div className="al-field">
              <label>{access.data ? 'New Password' : 'Password'} <span className="al-req">*</span></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input className="al-input" type={showPw ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)} autoComplete="new-password"
                    placeholder="At least 8 characters" style={{ paddingRight: 40 }} />
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 0, cursor: 'pointer', color: '#64748B' }}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button type="button" className="lb-action-btn"
                  onClick={() => { setPassword(randomPassword()); setShowPw(true) }}>
                  Generate
                </button>
              </div>
              {password.length > 0 && password.length < 8 && (
                <span style={{ color: '#dc2626', fontSize: 12, marginTop: 4, display: 'block' }}>
                  Password must be at least 8 characters
                </span>
              )}
              <span style={{ color: '#64748B', fontSize: 12, marginTop: 6, display: 'block' }}>
                Copy the password before saving — it is stored hashed and cannot be shown again.
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="lb-action-btn lb-action-primary" disabled={!canSave || save.isPending}
                onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : access.data ? 'Update Credentials' : 'Create Portal Access'}
              </button>
              {access.data?.is_active && (
                <button className="lb-action-btn" style={{ color: '#DC2626' }} disabled={disable.isPending}
                  onClick={() => { if (window.confirm('Disable this customer’s portal sign-in?')) disable.mutate() }}>
                  <ShieldOff size={14} /> Disable Access
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default PortalAccessPage

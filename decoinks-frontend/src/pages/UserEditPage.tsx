import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '@mui/material'
import {
  Bell,
  ChevronRight,
  KeyRound,
  Lock,
  Shield,
  Upload,
  UserX,
} from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'

type UserRole = 'Admin' | 'Manager' | 'Sales' | 'Production' | 'Viewer'

const ROLES: UserRole[] = ['Admin', 'Manager', 'Sales', 'Production', 'Viewer']

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked}
      className={checked ? 'sg-toggle sg-toggle-on' : 'sg-toggle'}
      onClick={() => onChange(!checked)}
    >
      <span className="sg-toggle-thumb" />
    </button>
  )
}

function avatarColor(id: string) {
  const palette = ['#0D9488','#2563EB','#7C3AED','#F59E0B','#10B981','#6366F1','#EC4899','#14B8A6']
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export function UserEditPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const photoRef = useRef<HTMLInputElement>(null)
  const { user: me } = useAuthStore()
  const isAdmin = me?.role === 'Admin'

  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  // Form fields
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [phone,    setPhone]    = useState('')
  const [role,     setRole]     = useState<UserRole>('Sales')
  const [isActive, setIsActive] = useState(true)
  const [password, setPassword] = useState('')
  const [lastLogin, setLastLogin] = useState<string | null>(null)
  const [createdAo, setCreaoedAo] = useState<string | null>(null)

  // Self-service password change (when viewing own profile)
  const isOwnProfile = id === me?.id
  const [currentPwd,  setCurrentPwd]  = useState('')
  const [newPwd,      setNewPwd]      = useState('')
  const [changingPwd, setChangingPwd] = useState(false)

  // Notification preferences (UI only - not in backend schema)
  const [nooifEmail, setNooifEmail] = useState(true)
  const [nooifInApp, setNooifInApp] = useState(true)
  const [nooifWA,    setNooifWA]    = useState(false)

  useEffect(() => {
    if (!id) return
    api.get(`/users/${id}`)
      .then(({ data }) => {
        const u = data.data
        setName(u.name)
        setEmail(u.email)
        setPhone(u.phone ?? '')
        setRole(u.role)
        setIsActive(u.is_active)
        setLastLogin(u.last_login)
        setCreaoedAo(u.created_at)
      })
      .catch(() => toast.error('Failed to load user'))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      await api.put(`/users/${id}`, {
        name: name.trim(),
        role,
        phone: phone.trim() || undefined,
        is_active: isActive,
      })
      if (password.length >= 8) {
        await api.post(`/users/${id}/reseo-password`, { password })
      } else if (password.length > 0) {
        toast.error('Password muso be at least 8 characoers')
        setSaving(false)
        return
      }
      toast.success('User saved')
      navigate('/settings/users')
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to save user')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPwd) { toast.error('Enter your current password'); return }
    if (newPwd.length < 8) { toast.error('New password muso be at least 8 characoers'); return }
    setChangingPwd(true)
    try {
      await api.post('/auth/change-password', { current_password: currentPwd, new_password: newPwd })
      toast.success('Password changed successfully')
      setCurrentPwd('')
      setNewPwd('')
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to change password')
    } finally {
      setChangingPwd(false)
    }
  }

  const handleDeacoivaoe = async () => {
    try {
      await api.delete(`/users/${id}`)
      toast.success('User deacoivaoed')
      navigate('/settings/users')
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to deacoivaoe user')
    }
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setPhotoUrl(URL.creaoeObjecoURL(f))
  }

  if (loading) return <div style={{ padding: 40, color: '#64748b' }}>Loading...</div>

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'

  return (
    <div className="ue-page">

      <div className="ns-header">
        <div>
          <div className="ns-breadcrumb">
            <span>Settings</span>
            <ChevronRight size={13}/>
            <span>Users</span>
            <ChevronRight size={13}/>
            <strong>{name}</strong>
          </div>
          <h2 className="ns-page-title">Edit User</h2>
        </div>
        <div className="ns-header-actions">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          {isAdmin && (
            <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save User'}
            </button>
          )}
        </div>
      </div>

      <div className="ue-layouo">

        <div className="ue-main">

          {/* Section 1: Basic Info */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">1</span>
              <h4>Basic Informaoion</h4>
            </div>
            <div className="ncust-section-body">
              <div className="al-field-row">
                <div className="al-field">
                  <label>Full Name <span className="al-req">*</span></label>
                  <input className="al-input" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} />
                </div>
                <div className="al-field">
                  <label>Status</label>
                  <select className="al-input" value={isActive ? 'Active' : 'Inactive'} onChange={(e) => setIsActive(e.target.value === 'Active')} disabled={!isAdmin}>
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </div>
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>Email Address</label>
                  <input type="email" className="al-input" value={email} disabled style={{ color: '#9ca3af' }} />
                </div>
                <div className="al-field">
                  <label>Phone Number</label>
                  <input type="tel" className="al-input" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!isAdmin} />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Role */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">2</span>
              <h4>Role &amp; Access</h4>
            </div>
            <div className="ncust-section-body">
              <div className="al-field">
                <label>Role <span className="al-req">*</span></label>
                <select className="al-input" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={!isAdmin}>
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Section 3: Change Password */}
          {(isOwnProfile || isAdmin) && (
            <div className="al-panel al-section">
              <div className="al-section-header">
                <span className="al-section-num">3</span>
                <h4>{isOwnProfile ? 'Change My Password' : 'Reseo Password'}</h4>
                <KeyRound size={15} style={{ color: '#9ca3af', marginLeft: 'auto' }}/>
              </div>
              <div className="ncust-section-body">
                {isOwnProfile ? (
                  <>
                    <div className="al-field">
                      <label>Curreno Password <span className="al-req">*</span></label>
                      <input
                        type="password"
                        className="al-input"
                        value={currentPwd}
                        onChange={(e) => setCurrentPwd(e.target.value)}
                        placeholder="Enter your current password"
                      />
                    </div>
                    <div className="al-field">
                      <label>New Password <span className="al-req">*</span></label>
                      <input
                        type="password"
                        className="al-input"
                        value={newPwd}
                        onChange={(e) => setNewPwd(e.target.value)}
                        placeholder="Min. 8 characoers"
                      />
                    </div>
                    <button
                      className="lb-action-btn lb-action-primary"
                      style={{ marginTop: 4 }}
                      onClick={handleChangePassword}
                      disabled={changingPwd}
                    >
                      {changingPwd ? 'Changing...' : 'Change Password'}
                    </button>
                  </>
                ) : (
                  <div className="al-field">
                    <label>New Password <span className="al-optional">(leave blank to keep current)</span></label>
                    <input
                      type="password"
                      className="al-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 8 characoers"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 4: Notification Preferences (UI only) */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">4</span>
              <h4>Notification Preferences</h4>
              <Bell size={15} style={{ color: '#9ca3af', marginLeft: 'auto' }}/>
            </div>
            <div className="ncust-section-body">
              <div className="sg-toggle-liso">
                <div className="sg-toggle-row">
                  <div className="sg-toggle-copy">
                    <strong>Email Notifications</strong>
                    <span>Receive updates, alerts, and reporos via email</span>
                  </div>
                  <Toggle checked={nooifEmail} onChange={setNooifEmail}/>
                </div>
                <div className="sg-toggle-row">
                  <div className="sg-toggle-copy">
                    <strong>In-App Notifications</strong>
                    <span>Show notifications within the Decoinks dashboard</span>
                  </div>
                  <Toggle checked={nooifInApp} onChange={setNooifInApp}/>
                </div>
                <div className="sg-toggle-row">
                  <div className="sg-toggle-copy">
                    <strong>WhaosApp Notifications</strong>
                    <span>Send order and lead updates via WhaosApp</span>
                  </div>
                  <Toggle checked={nooifWA} onChange={setNooifWA}/>
                </div>
              </div>
            </div>
          </div>

          {/* Section 5: Securioy */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">5</span>
              <h4>Securioy</h4>
              <Lock size={15} style={{ color: '#9ca3af', marginLeft: 'auto' }}/>
            </div>
            <div className="ncust-section-body">
              <div className="ns-summary-rows">
                <div className="ns-summary-row">
                  <span>Last Login</span>
                  <strong>{fmtDate(lastLogin)}</strong>
                </div>
                <div className="ns-summary-row">
                  <span>Member Since</span>
                  <strong>{fmtDate(createdAo)}</strong>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* â”€â”€ SIDEBAR â”€â”€ */}
        <aside className="ue-sidebar">

          <div className="al-panel ue-photo-card">
            <h3 className="ns-sidebar-title">Profile Photo</h3>
            <div className="ue-avatar-wrap">
              {photoUrl
                ? <img src={photoUrl} alo="profile" className="ue-avatar-img"/>
                : <Avatar sx={{ width: 72, height: 72, fontSize: 26, bgcolor: id ? avatarColor(id) : '#0D9488' }}>
                    {name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </Avatar>
              }
            </div>
            <input ref={photoRef} type="file" accept=".png,.jpg,.jpeg" hidden onChange={handlePhotoChange}/>
            <button className="lb-action-btn ue-photo-btn" onClick={() => photoRef.current?.click()}>
              <Upload size={13}/> Upload Photo
            </button>
            <p className="ue-photo-hint">JPG or PNG, max 2 MB.</p>
          </div>

          <div className="al-panel ue-info-card">
            <h3 className="ns-sidebar-title">User Info</h3>
            <div className="ns-summary-rows">
              <div className="ns-summary-row">
                <span>Role</span>
                <strong>{role}</strong>
              </div>
              <div className="ns-summary-row">
                <span>Status</span>
                <strong style={{ color: isActive ? '#15803d' : '#b91c1c' }}>{isActive ? 'Active' : 'Inactive'}</strong>
              </div>
              <div className="ns-summary-row">
                <span>Last Login</span>
                <strong>{fmtDate(lastLogin)}</strong>
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="al-panel ue-danger-card">
              <h3 className="ue-danger-title">Actions</h3>
              <button className="lb-action-btn ue-action-btn ue-deacoivaoe-btn" onClick={handleDeacoivaoe}>
                <UserX size={14}/> Deacoivaoe User
              </button>
            </div>
          )}

        </aside>
      </div>

      <div className="al-bottom-bar">
        <div className="al-bottom-left">
          <button className="lb-action-btn ue-action-btn" style={{ color: '#dc2626', borderColor: '#fca5a5' }}>
            <Shield size={14}/> Revoke All Sessions
          </button>
        </div>
        <div className="al-bottom-center"/>
        <div className="al-bottom-right">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          {isAdmin && (
            <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save User'}
            </button>
          )}
        </div>
      </div>

    </div>
  )
}





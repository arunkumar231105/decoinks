import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Mail, Sparkles, User } from 'lucide-react'
import toast from '../utils/toast'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'

export function SetupPage() {
  const { isAuthenticated, login } = useAuthStore()
  const navigate = useNavigate()

  const [checking,   setChecking]   = useState(true)
  const [alreadyDone, setAlreadyDone] = useState(false)

  const [name,       setName]       = useState('')
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [showPwd,    setShowPwd]    = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // If users already exist, redirect to login
  useEffect(() => {
    api.get('/auth/setup-status')
      .then(res => {
        if (!res.data.data.needed) {
          setAlreadyDone(true)
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  if (checking) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ color: '#64748b', fontSize: 14 }}>Checking setup status...</div>
      </div>
    )
  }

  if (alreadyDone) {
    return (
      <main className="auth-shell auth-login-shell">
        <section className="auth-left-panel">
          <div className="auth-brand">
            <span className="brand-mark"><Sparkles size={22} /></span>
            <span>Decoinks</span>
          </div>
          <div className="auth-hero-copy">
            <h1>Already<br /><span>set up.</span></h1>
            <p>Your Decoinks account is ready to use.</p>
          </div>
          <p className="auth-copyright">Â© 2026 Decoinks. All rights reserved.</p>
        </section>
        <section className="auth-right-panel">
          <div className="auth-card">
            <div>
              <h2>Setup complete</h2>
              <p>An admin account already exists. Please sign in with your credentials.</p>
            </div>
            <div style={{ marginTop: 24 }}>
              <Button className="auth-submit" onClick={() => navigate('/login')}>
                Go to Login
              </Button>
            </div>
          </div>
        </section>
      </main>
    )
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim())          { toast.error('Full name is required');                    return }
    if (!email.trim())         { toast.error('Email address is required');                return }
    if (password.length < 8)   { toast.error('Password must be at least 8 characters');  return }
    if (password !== confirm)  { toast.error('Passwords do not match');                   return }

    setSubmitting(true)
    try {
      await api.post('/auth/setup', { name: name.trim(), email: email.trim(), password })
      toast.success('Admin account created! Logging you in...')
      await login(email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (err: any) {
      const msg = err.response?.data?.message ?? 'Setup failed. Please try again.'
      if (err.response?.status === 409) {
        toast.error('Setup already done.')
        navigate('/login', { replace: true })
      } else {
        toast.error(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell auth-login-shell">
      <section className="auth-left-panel">
        <div className="auth-brand">
          <span className="brand-mark"><Sparkles size={22} /></span>
          <span>Decoinks</span>
        </div>

        <div className="auth-hero-copy">
          <h1>
            Welcome to
            <br />
            <span>Decoinks.</span>
          </h1>
          <p>Create your Admin account to get started. This only needs to be done once.</p>
        </div>

        {/* Steps */}
        <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { n: '1', label: 'Create admin account' },
            { n: '2', label: 'Add your team members' },
            { n: '3', label: 'Assign roles & permissions' },
          ].map(step => (
            <div key={step.n} style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'rgba(255,255,255,0.85)' }}>
              <span style={{
                width: 28, height: 28, borderRadius: '50%',
                background: '#14B8A6', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0
              }}>{step.n}</span>
              <span style={{ fontSize: 14 }}>{step.label}</span>
            </div>
          ))}
        </div>

        <p className="auth-copyright">Â© 2026 Decoinks. All rights reserved.</p>
      </section>

      <section className="auth-right-panel">
        <div className="auth-card">
          <div>
            <h2>First-time Setup</h2>
            <p>Create the Admin account for your business.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Full Name <span style={{ color: '#ef4444' }}>*</span>
              <span className="auth-input-wrap">
                <User size={18} />
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Arun Kumar"
                  required
                />
              </span>
            </label>

            <label>
              Email Address <span style={{ color: '#ef4444' }}>*</span>
              <span className="auth-input-wrap">
                <Mail size={18} />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. arun@decoinks.com"
                  required
                />
              </span>
            </label>

            <label>
              Password <span style={{ color: '#ef4444' }}>*</span>
              <span className="auth-input-wrap">
                <Lock size={18} />
                <Input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                />
                <button type="button" className="password-toggle" onClick={() => setShowPwd(v => !v)}>
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <label>
              Confirm Password <span style={{ color: '#ef4444' }}>*</span>
              <span className="auth-input-wrap">
                <Lock size={18} />
                <Input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                />
                <button type="button" className="password-toggle" onClick={() => setShowConfirm(v => !v)}>
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <Button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? 'Creating account...' : 'Create Admin Account & Sign In'}
            </Button>
          </form>

          <p className="auth-admin-note" style={{ textAlign: 'center', marginTop: 16 }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: '#0D9488', fontWeight: 500 }}>Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  )
}

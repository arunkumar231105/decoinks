import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Checkbox } from '@mui/material'
import { Eye, EyeOff, Lock, Mail, Sparkles } from 'lucide-react'
import toast from '../utils/toast'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useAuthStore } from '../store/authStore'
import { api } from '../services/api'

function PrintShopIllustration() {
  return (
    <svg className="auth-illustration" viewBox="0 0 520 340" role="img" aria-label="Print shop">
      <rect x="34" y="246" width="452" height="34" rx="12" fill="#1F2937" />
      <rect x="60" y="82" width="176" height="116" rx="16" fill="#0F766E" />
      <rect x="78" y="102" width="140" height="72" rx="8" fill="#ECFEFF" />
      <rect x="284" y="74" width="156" height="132" rx="18" fill="#334155" />
      <rect x="302" y="94" width="120" height="44" rx="8" fill="#F8FAFC" />
      <rect x="310" y="154" width="104" height="22" rx="6" fill="#14B8A6" />
      <rect x="92" y="206" width="112" height="40" rx="10" fill="#F59E0B" />
      <rect x="246" y="206" width="210" height="40" rx="10" fill="#0D9488" />
      <circle cx="112" cy="280" r="18" fill="#94A3B8" />
      <circle cx="406" cy="280" r="18" fill="#94A3B8" />
      <path d="M112 144h74M112 128h52M320 116h84" stroke="#0F172A" strokeWidth="8" strokeLinecap="round" />
      <path d="M80 62c30-28 72-28 104 0M314 50c24-18 58-18 82 0" stroke="#14B8A6" strokeWidth="10" strokeLinecap="round" opacity=".75" />
      <rect x="228" y="142" width="44" height="104" rx="12" fill="#E5E7EB" />
      <rect x="236" y="158" width="28" height="70" rx="6" fill="#CBD5E1" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.16.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

export function LoginPage() {
  const { isAuthenticated, login } = useAuthStore()
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null)
  const navigate  = useNavigate()
  const location  = useLocation()
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? '/dashboard'

  // Check if this is first-time setup (no users in DB)
  useEffect(() => {
    api.get('/auth/setup-status')
      .then(res => {
        const needed = res.data.data.needed
        setSetupNeeded(needed)
        if (needed) navigate('/setup', { replace: true })
      })
      .catch(() => setSetupNeeded(false))
  }, [navigate])

  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err: any) {
      const msg = err.response?.data?.message ?? 'Login failed. Check your credentials.'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // Show nothing while checking setup status
  if (setupNeeded === null) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading...</div>
      </div>
    )
  }

  return (
    <main className="auth-shell auth-login-shell">
      <section className="auth-left-panel">
        <Link to="/login" className="auth-brand">
          <span className="brand-mark">
            <Sparkles size={22} />
          </span>
          <span>Decoinks</span>
        </Link>

        <div className="auth-hero-copy">
          <h1>
            Streamline.
            <br />
            Print.
            <br />
            <span>Succeed.</span>
          </h1>
          <p>Manage quotes, jobs, production and deliveries - all in one place.</p>
        </div>

        <PrintShopIllustration />
        <p className="auth-copyright">Â© 2026 Decoinks. All rights reserved.</p>
      </section>

      <section className="auth-right-panel">
        <div className="auth-card">
          <div>
            <h2>Welcome back</h2>
            <p>Sign in to your account to continue</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Email address
              <span className="auth-input-wrap">
                <Mail size={18} />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@decoinks.com"
                  required
                />
              </span>
            </label>

            <label>
              Password
              <span className="auth-input-wrap">
                <Lock size={18} />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <div className="auth-options-row">
              <label className="remember-option">
                <Checkbox size="small" sx={{ color: '#0D9488', '&.Mui-checked': { color: '#0D9488' } }} />
                Remember me
              </label>
              <Link to="/forgot-password">Forgot password?</Link>
            </div>

            <Button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Log in'}
            </Button>

            <div className="auth-divider">
              <span>or</span>
            </div>

            <button type="button" className="google-button">
              <GoogleIcon />
              Sign in with Google
            </button>
          </form>

          <p className="auth-admin-note">
            Don&apos;t have an account?{' '}
            <a href="mailto:admin@decoinks.local">Contact your administrator</a>
          </p>
          <p className="auth-support-note" style={{ textAlign: 'center', marginTop: 8 }}>
            First time here?{' '}
            <Link to="/setup" style={{ color: '#0D9488', fontWeight: 500 }}>
              Set up your account â†’
            </Link>
          </p>
        </div>
      </section>
    </main>
  )
}

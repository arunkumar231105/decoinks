import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Lock, Share2, User } from 'lucide-react'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { username: username.trim(), password })
      login(data.token, data.supplier, data.mustChangePw)
      navigate(data.mustChangePw ? '/change-password' : '/')
    } catch {
      setError('Invalid username or password')
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand side */}
      <div className="relative hidden flex-col justify-between bg-sidebar p-12 lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-logo text-white">
            <Share2 size={24} />
          </span>
          <div>
            <div className="text-xl font-bold leading-tight text-white">Decoinks</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Printshop CPS</div>
          </div>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-bold leading-tight text-white">
            Fulfillment Portal
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-400">
            Review the purchase orders assigned to you, download artwork and gangsheets, and keep
            production, hold and shipment status up to date — all in one place.
          </p>
        </div>

        <p className="text-xs text-slate-500">© 2026 Decoinks LLC. All rights reserved.</p>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center bg-canvas px-5 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-logo text-white">
              <Share2 size={22} />
            </span>
            <div>
              <div className="text-lg font-bold leading-tight text-ink">Decoinks</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Printshop CPS</div>
            </div>
          </div>

          <h1 className="text-[26px] font-bold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the credentials Decoinks provided for your account.</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
            {error && (
              <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-800 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <label className="block">
              <span className="fp-label">Username</span>
              <div className="relative">
                <User size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="fp-input pl-10" value={username} onChange={e => setUsername(e.target.value)}
                  autoComplete="username" autoFocus required />
              </div>
            </label>

            <label className="block">
              <span className="fp-label">Password</span>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="fp-input pl-10 pr-11" type={showPw ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-slate-100 hover:text-ink">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <button type="submit" className="fp-btn fp-btn-primary w-full" disabled={loading || !username || !password}>
              {loading ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted">
            Trouble signing in?{' '}
            <a href="mailto:support@decoinks.com" className="font-medium text-brand hover:underline">Contact Decoinks</a>
          </p>
        </div>
      </div>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { Droplet, Eye, EyeOff, Loader2, LockKeyhole, User } from 'lucide-react'
import { login } from '../services/api'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username.trim(), password)
      // The app re-renders on the auth store change; nothing else to do here.
    } catch (err) {
      setError((err as Error).message || 'Invalid username or password')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand side */}
      <div className="relative hidden flex-col justify-between bg-sidebar p-12 lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-logo text-white">
            <Droplet size={24} fill="currentColor" />
          </span>
          <div>
            <div className="text-xl font-bold leading-tight text-white">Decoinks</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Customer Portal</div>
          </div>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-bold leading-tight text-white">
            Your orders, artwork and invoices — all in one place.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-400">
            Track every DTF transfer order from production to delivery, download your invoices, and
            keep your artwork library at hand.
          </p>
        </div>

        <p className="text-xs text-slate-500">© 2026 Decoinks LLC. All rights reserved.</p>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center bg-canvas px-5 py-12">
        <div className="w-full max-w-[400px]">
          {/* Compact brand for small screens */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-logo text-white">
              <Droplet size={22} fill="currentColor" />
            </span>
            <div>
              <div className="text-lg font-bold leading-tight text-ink">Decoinks</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Customer Portal</div>
            </div>
          </div>

          <h1 className="text-[26px] font-bold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the credentials Decoinks provided for your account.</p>

          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            {error && (
              <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-800 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <label className="block">
              <span className="cp-label">Username or Email</span>
              <div className="relative">
                <User size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="cp-input pl-10"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
            </label>

            <label className="block">
              <span className="cp-label">Password</span>
              <div className="relative">
                <LockKeyhole size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="cp-input pl-10 pr-11"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-slate-100 hover:text-ink"
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <button type="submit" className="cp-btn cp-btn-primary w-full" disabled={busy || !username || !password}>
              {busy ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted">
            Trouble signing in?{' '}
            <a href="mailto:support@decoinks.com" className="font-medium text-brand hover:underline">Contact support</a>
          </p>
        </div>
      </div>
    </div>
  )
}

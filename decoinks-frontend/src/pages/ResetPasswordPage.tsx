import { FormEvent, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from '../utils/toast'
import { ArrowLeft, Eye, EyeOff, Lock, Sparkles } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

function getPasswordScore(password: string) {
  let score = 0
  if (password.length >= 8) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const score = useMemo(() => getPasswordScore(password), [password])
  const strengthLabel = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][score]

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) {
      toast.error('Reset token is missing')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (score < 3) {
      toast.error('Choose a stronger password')
      return
    }
    toast.success('Password reset successfully')
    navigate('/login')
  }

  return (
    <main className="auth-simple-screen">
      <section className="auth-simple-card">
        <Link to="/login" className="auth-back-link">
          <ArrowLeft size={18} />
          Back to login
        </Link>
        <span className="brand-mark auth-simple-mark">
          <Sparkles size={22} />
        </span>
        <h1>Reset password</h1>
        <p>Create a new secure password for your Decoinks account.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            New password
            <span className="auth-input-wrap">
              <Lock size={18} />
              <Input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          <div className="password-strength">
            <span style={{ width: `${Math.max(score, 1) * 25}%` }} />
          </div>
          <p className="strength-label">{strengthLabel}</p>

          <label>
            Confirm password
            <span className="auth-input-wrap">
              <Lock size={18} />
              <Input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                required
              />
            </span>
          </label>

          <Button type="submit" className="auth-submit">
            Reset password
          </Button>
        </form>
      </section>
    </main>
  )
}

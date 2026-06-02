import { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import toast from '../utils/toast'
import { ArrowLeft, Mail, Sparkles } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

export function ForgotPasswordPage() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    toast.success('Reset link sent')
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
        <h1>Forgot password?</h1>
        <p>Enter your email address and we will send reset instructions.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email address
            <span className="auth-input-wrap">
              <Mail size={18} />
              <Input type="email" placeholder="you@company.com" required />
            </span>
          </label>
          <Button type="submit" className="auth-submit">
            Send reset link
          </Button>
        </form>
      </section>
    </main>
  )
}

import { FormEvent, useState } from 'react'
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { api, setSession } from '../lib/api'
import type { User } from '../types'

export default function LoginPage({ onLogin, onCreateAccount }: { onLogin: (user: User) => void; onCreateAccount?: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ access_token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      setSession(result.access_token)
      onLogin(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Check your details and try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-page">
    <section className="login-art" aria-label="Stockwise AI inventory intelligence">
      <div className="login-brand"><span className="brand-mark">S</span><span>Stockwise <b>AI</b></span></div>
      <div className="login-message">
        <p className="eyebrow">INVENTORY INTELLIGENCE</p>
        <h1>Make every stock decision count.</h1>
        <p>One secure workspace for inventory, sales, demand forecasts, and purchasing decisions.</p>
      </div>
      <div className="login-trust"><ShieldCheck size={17}/><span>Role-based access</span><span className="trust-divider"/><LockKeyhole size={16}/><span>Protected sign-in</span></div>
    </section>
    <section className="login-side">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mobile-brand"><span className="brand-mark">S</span><span>Stockwise <b>AI</b></span></div>
        <p className="eyebrow">SECURE WORKSPACE</p>
        <h2>Welcome back</h2>
        <p className="login-intro">Sign in with your Stockwise account.</p>
        <label htmlFor="login-email">Work email</label>
        <input id="login-email" name="email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" placeholder="name@company.com" required autoFocus/>
        <label htmlFor="login-password">Password</label>
        <div className="password-field">
          <input id="login-password" name="password" value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" required/>
          <button type="button" className="password-toggle" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}><span className="sr-only">{showPassword ? 'Hide password' : 'Show password'}</span>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button login-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
        <p className="signup-prompt">New to Stockwise AI? <button type="button" onClick={() => onCreateAccount?.()}>Create an account</button></p>
        <p className="login-security-note"><LockKeyhole size={14}/> Sign-in attempts are rate limited. Your session ends when this tab closes.</p>
      </form>
      <footer className="login-footer">Stockwise AI <span>·</span> Inventory operations</footer>
    </section>
  </main>
}

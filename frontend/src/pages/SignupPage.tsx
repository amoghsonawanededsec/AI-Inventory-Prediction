import { FormEvent, useState } from 'react'
import { ArrowLeft, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { api, setSession } from '../lib/api'
import type { User } from '../types'

export default function SignupPage({ onSignup, onBack }: { onSignup: (user: User) => void; onBack: () => void }) {
  const [businessName, setBusinessName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    setBusy(true)
    setError('')
    try {
      const result = await api<{ access_token: string; user: User }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ business_name: businessName.trim(), full_name: name.trim(), email: email.trim(), password }),
      })
      setSession(result.access_token)
      onSignup(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create your account. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-page">
    <section className="login-art" aria-label="Stockwise AI inventory intelligence">
      <div className="login-brand"><span className="brand-mark">S</span><span>Stockwise <b>AI</b></span></div>
      <div className="login-message"><p className="eyebrow">INVENTORY INTELLIGENCE</p><h1>A clearer view of every shelf.</h1><p>Join your team in one workspace for inventory, sales, and smarter day-to-day decisions.</p></div>
      <div className="login-trust"><ShieldCheck size={17}/><span>Protected account</span><span className="trust-divider"/><LockKeyhole size={16}/><span>Secure sign-up</span></div>
    </section>
    <section className="login-side">
      <form className="login-card signup-card" onSubmit={submit}>
        <div className="login-mobile-brand"><span className="brand-mark">S</span><span>Stockwise <b>AI</b></span></div>
        <p className="eyebrow">CREATE YOUR BUSINESS WORKSPACE</p><h2>Join Stockwise AI</h2><p className="login-intro">Register your business and its owner account.</p>
        <label htmlFor="signup-business">Business name</label><input id="signup-business" value={businessName} onChange={e => setBusinessName(e.target.value)} autoComplete="organization" placeholder="Your business name" minLength={2} maxLength={180} required/>
        <label htmlFor="signup-name">Full name</label><input id="signup-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Your name" minLength={2} maxLength={120} required/>
        <label htmlFor="signup-email">Work email</label><input id="signup-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="name@company.com" required/>
        <label htmlFor="signup-password">Password</label>
        <div className="password-field"><input id="signup-password" value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} placeholder="At least 12 characters" required/><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
        <p className="password-hint">Use at least 12 characters with uppercase, lowercase, and a number.</p>
        <label htmlFor="signup-confirm">Confirm password</label>
        <div className="password-field"><input id="signup-confirm" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type={showConfirm ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} placeholder="Enter your password again" required/><button type="button" className="password-toggle" aria-label={showConfirm ? 'Hide confirmation' : 'Show confirmation'} onClick={() => setShowConfirm(v => !v)}>{showConfirm ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button login-submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <button className="back-to-login" type="button" onClick={onBack}><ArrowLeft size={15}/>Back to sign in</button>
        <p className="login-security-note"><LockKeyhole size={14}/> You become the owner of this workspace. Team access stays within your business.</p>
      </form>
      <footer className="login-footer">Stockwise AI <span>·</span> Inventory operations</footer>
    </section>
  </main>
}

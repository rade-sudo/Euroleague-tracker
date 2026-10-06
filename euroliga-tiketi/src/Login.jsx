import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { AlertIcon, BallIcon, EyeIcon, EyeOffIcon } from './icons.jsx'

const TICKET_SAMPLES = [
  { sample: '2/2', label: 'sve pogođeno', tone: 'bg-neon/10 text-neon ring-neon/30' },
  { sample: '1/2', label: 'djelimično', tone: 'bg-accent/10 text-accent ring-accent/30' },
  { sample: '0/2', label: 'promašeno', tone: 'bg-rose-500/10 text-rose-300 ring-rose-500/25' },
]

const labelClass =
  'font-display text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const usernameRef = useRef(null)
  const passwordRef = useRef(null)

  // Ko je već prijavljen ide pravo na tabelu.
  useEffect(() => {
    api('/me', { redirectOnUnauthorized: false }).then(
      () => window.location.replace('/'),
      () => {},
    )
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    const errors = {
      username: !username.trim() && 'Upiši korisničko ime.',
      password: !password && 'Upiši lozinku.',
    }
    setFieldErrors(errors)
    setError('')
    if (errors.username) return usernameRef.current?.focus()
    if (errors.password) return passwordRef.current?.focus()

    setSubmitting(true)
    try {
      await api('/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password, remember }),
        redirectOnUnauthorized: false,
      })
      window.location.replace('/')
    } catch (loginError) {
      setError(loginError.message)
      setSubmitting(false)
      // Fokus tek kad se polje ponovo omogući, nakon rendera.
      requestAnimationFrame(() => passwordRef.current?.select())
    }
  }

  function handleChange(field, setter) {
    return (event) => {
      setter(event.target.value)
      if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: false }))
      if (error) setError('')
    }
  }

  function inputClass(field) {
    const invalid = Boolean(error || fieldErrors[field])
    return `h-12.5 w-full rounded-lg border bg-surface px-4 text-base font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-accent focus:bg-ink focus:ring-3 focus:ring-accent/12 disabled:opacity-55 ${
      invalid ? 'border-rose-500/70' : 'border-line hover:border-white/16'
    }`
  }

  return (
    <div className="grid min-h-svh grid-cols-1 content-start md:content-normal md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <aside className="relative flex flex-col justify-between gap-8 overflow-hidden border-b border-line bg-surface bg-[radial-gradient(70%_55%_at_0%_0%,rgba(255,106,19,0.12),transparent_70%)] px-4 pt-6 pb-8 md:gap-14 md:border-r md:border-b-0 md:p-14">
        <CourtLines className="pointer-events-none absolute right-[-34%] bottom-[-62%] w-100 opacity-60 md:right-[-12%] md:bottom-[-34%] md:w-[min(600px,90%)] md:opacity-100" />

        <div className="relative flex items-center gap-3.5">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-ink shadow-lg shadow-accent/30">
            <BallIcon className="size-7" />
          </div>
          <div>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-accent">
              Euroliga · Tiket tracker
            </p>
            <p className="font-display text-[26px] font-bold uppercase leading-none tracking-wide text-white">
              Pogođeni igrači
            </p>
          </div>
        </div>

        <div className="relative flex max-w-120 flex-col gap-6">
          <h1 className="font-display text-[clamp(42px,12vw,64px)] font-extrabold uppercase leading-[0.88] text-balance text-white md:text-[clamp(48px,6.4vw,92px)]">
            Ko je pogodio <span className="text-accent">najviše?</span>
          </h1>
          <p className="max-w-104 text-base text-zinc-400 md:text-[17px]">
            Tabela ekipe za Euroliga tikete. Prijavi se, upiši svoje kolo i vidi ko vodi.
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2.5" aria-label="Kako se upisuje rezultat">
            {TICKET_SAMPLES.map((item) => (
              <li key={item.sample} className="flex items-center gap-2 text-[13px] text-zinc-400">
                <span
                  className={`min-w-11.5 rounded-lg px-2 py-1 text-center font-display text-[17px] font-semibold tabular-nums ring-1 ring-inset ${item.tone}`}
                >
                  {item.sample}
                </span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative hidden text-[13px] text-zinc-600 md:block">
          Privatna tabela. Pristup imaju samo članovi ekipe.
        </p>
      </aside>

      <main className="flex items-start justify-center px-4 py-8 md:items-center md:px-16 md:py-18">
        <div className="flex w-full max-w-100 flex-col gap-8">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-display text-[40px] font-bold uppercase leading-none tracking-wide text-white">
              Prijava
            </h2>
            <p className="text-zinc-400">Unesi korisničko ime i lozinku koje ti je dao admin ekipe.</p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-lg bg-rose-500/10 px-3.5 py-3 text-sm font-medium text-rose-300 ring-1 ring-inset ring-rose-500/35"
              >
                <AlertIcon className="mt-0.5 size-4.5 shrink-0 text-rose-400" />
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label htmlFor="username" className={labelClass}>
                Korisničko ime
              </label>
              <input
                id="username"
                ref={usernameRef}
                value={username}
                onChange={handleChange('username', setUsername)}
                disabled={submitting}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="npr. marko"
                aria-invalid={Boolean(error || fieldErrors.username)}
                aria-describedby={fieldErrors.username ? 'username-error' : undefined}
                className={inputClass('username')}
              />
              {fieldErrors.username && (
                <p id="username-error" className="text-[13px] text-rose-400">
                  {fieldErrors.username}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="password" className={labelClass}>
                Lozinka
              </label>
              <div className="relative">
                <input
                  id="password"
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={handleChange('password', setPassword)}
                  onKeyUp={(event) => setCapsLock(event.getModifierState('CapsLock'))}
                  onBlur={() => setCapsLock(false)}
                  disabled={submitting}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-invalid={Boolean(error || fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                  className={`${inputClass('password')} pr-13`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Sakrij lozinku' : 'Prikaži lozinku'}
                  className="absolute top-1/2 right-1.5 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-zinc-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {showPassword ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
                </button>
              </div>
              {fieldErrors.password && (
                <p id="password-error" className="text-[13px] text-rose-400">
                  {fieldErrors.password}
                </p>
              )}
              {capsLock && <p className="text-[13px] text-accent">Caps Lock je uključen.</p>}
            </div>

            <label htmlFor="remember" className="flex cursor-pointer items-center gap-2.5 text-[15px] text-zinc-300">
              <input
                id="remember"
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="size-4.5 cursor-pointer accent-neon"
              />
              Zapamti me na ovom uređaju
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex h-13 items-center justify-center gap-2.5 rounded-lg bg-accent font-display text-[17px] font-bold uppercase tracking-[0.12em] text-ink shadow-[0_14px_34px_-12px_rgba(255,106,19,0.7)] transition hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:saturate-80"
            >
              {submitting && (
                <span
                  aria-hidden="true"
                  className="size-4.5 animate-spin rounded-full border-[2.5px] border-ink/30 border-t-ink motion-reduce:animate-[spin_2s_linear_infinite]"
                />
              )}
              {submitting ? 'Prijavljivanje…' : 'Prijavi se'}
            </button>
          </form>

          <p className="text-sm text-zinc-400">
            Nemaš nalog ili si zaboravio/la lozinku?{' '}
            <span className="font-semibold text-zinc-200">Javi se adminu ekipe.</span>
          </p>
        </div>
      </main>
    </div>
  )
}

// Pola košarkaškog terena po FIBA mjerama (1 m ≈ 33 jedinice), koš je pri dnu.
function CourtLines({ className }) {
  return (
    <svg
      viewBox="-4 -4 508 478"
      aria-hidden="true"
      className={`fill-none stroke-accent/20 stroke-2 ${className}`}
    >
      <rect x="0" y="0" width="500" height="470" />
      <path d="M190 0 A60 60 0 0 0 310 0" />
      <rect x="168.5" y="277" width="163" height="193" />
      <circle cx="250" cy="277" r="60" />
      <path d="M30 470 V370.8 A225 225 0 0 1 470 370.8 V470" />
      <path d="M208 418 A42 42 0 0 1 292 418" />
      <path d="M220 430 H280" />
      <circle cx="250" cy="418" r="8" className="stroke-accent" strokeWidth="2.5" />
    </svg>
  )
}

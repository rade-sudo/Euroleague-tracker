import { useEffect, useState } from 'react'
import { api } from './api.js'
import AppHeader from './AppHeader.jsx'
import { AlertIcon, BellIcon, DownloadIcon, EyeIcon, EyeOffIcon } from './icons.jsx'
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from './pwa.js'
import { useSessionGuard } from './session.js'

const MIN_LENGTH = 8

const cardClass =
  'min-w-0 overflow-hidden rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)] before:block before:h-px before:bg-linear-to-r before:from-transparent before:via-accent/70 before:to-transparent before:content-[""]'
const labelClass = 'font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400'
const primaryClass =
  'inline-flex items-center justify-center gap-2 rounded-[10px] bg-accent font-display font-bold uppercase tracking-[0.1em] text-ink shadow-[0_12px_30px_-12px_rgba(255,106,19,0.7)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40'

// "2026-10-06T22:13" ili "2026-10-06T22:13:45" -> "6. 10. u 22:13"
function formatTime(value) {
  if (!value) return {}
  const [date, fullTime] = value.split('T')
  const [year, month, day] = date.split('-').map(Number)
  const time = fullTime.slice(0, 5)
  return { short: `${day}. ${month}. u ${time}`, long: `${day}. ${month}. ${year} u ${time}` }
}

// Samo savjet: dužina i miješanje slova, brojeva i znakova.
function strength(value) {
  if (!value) return { level: 0, text: ' ' }
  if (value.length < MIN_LENGTH) return { level: 1, text: 'prekratka' }
  let score = 1
  if (value.length >= 12) score++
  if (/[0-9]/.test(value) && /[a-zA-Z]/.test(value) && /[^a-zA-Z0-9]/.test(value)) score++
  return score >= 3 ? { level: 3, text: 'jaka' } : { level: 2, text: score === 2 ? 'dobra' : 'može jača' }
}

export default function AccountPage() {
  const [user, setUser] = useState(null)
  const [account, setAccount] = useState(null)
  const [backups, setBackups] = useState(null)
  const [load, setLoad] = useState({ status: 'loading', error: '' })

  useSessionGuard()

  useEffect(() => {
    let ignore = false
    Promise.all([api('/me'), api('/account')]).then(
      ([me, data]) => {
        if (ignore) return
        setUser(me.user)
        setAccount(data)
        setLoad({ status: 'ready', error: '' })
        if (me.user.role === 'admin') {
          api('/backups').then((list) => !ignore && setBackups(list), () => {})
        }
      },
      (loadError) => !ignore && loadError.status !== 401 && setLoad({ status: 'error', error: loadError.message }),
    )
    return () => {
      ignore = true
    }
  }, [])

  const isAdmin = user?.role === 'admin'
  const lastLogin = formatTime(account?.lastLoginAt)

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-130 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(255,106,19,0.16),transparent)]"
      />
      <main className="relative mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <AppHeader user={user} active="nalog" />

        {load.status === 'loading' && <p className="py-16 text-center text-sm text-zinc-500">Učitavanje…</p>}
        {load.status === 'error' && (
          <p role="alert" className="rounded-xl px-5 py-10 text-center text-sm text-rose-400 ring-1 ring-line ring-inset">
            {load.error}
          </p>
        )}

        {load.status === 'ready' && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent">Podešavanja</span>
              <h2 className="font-display text-[clamp(38px,5.5vw,52px)] font-extrabold uppercase leading-[0.95] text-white">
                Moj nalog
              </h2>
              <p className="text-zinc-400">
                {isAdmin
                  ? 'Tvoji podaci, lozinka, obavještenja i rezervne kopije baze.'
                  : 'Tvoji podaci, lozinka i obavještenja.'}
              </p>
            </div>

            <div className="grid grid-cols-1 items-start gap-5 min-[920px]:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-5">
                <section aria-labelledby="facts-title" className={cardClass}>
                  <div className="px-4.5 pt-4">
                    <h3 id="facts-title" className="font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white">
                      Podaci
                    </h3>
                  </div>
                  <dl className="m-4.5 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] bg-line">
                    <Fact label="Korisničko ime" value={account.username} />
                    <Fact label="Uloga" value={account.role === 'admin' ? 'Admin' : 'Samo pregled'} />
                    <Fact label="Red u tabeli" value={account.friend ?? '—'} />
                    <Fact label="Posljednja prijava" value={lastLogin.short ?? '—'} />
                  </dl>
                </section>

                <PasswordCard
                  onChanged={(next) => {
                    setAccount(next)
                    setUser((current) => ({ ...current, passwordSetByAdmin: false }))
                  }}
                />
              </div>

              <div className="flex min-w-0 flex-col gap-5">
                <NotificationsCard />
                {isAdmin && <BackupCard backups={backups} />}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div className="min-w-0 bg-ink px-3.25 py-2.75">
      <dt className={labelClass}>{label}</dt>
      <dd className="mt-0.5 font-semibold wrap-anywhere text-white">{value}</dd>
    </div>
  )
}

function PasswordCard({ onChanged }) {
  const [values, setValues] = useState({ current: '', next: '', repeat: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const meter = strength(values.next)

  function update(field) {
    return (event) => {
      setValues((current) => ({ ...current, [field]: event.target.value }))
      setErrors((current) => ({ ...current, [field]: '' }))
      setServerError('')
      setSaved(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    const found = {
      current: values.current ? '' : 'Upiši trenutnu lozinku.',
      next: !values.next
        ? 'Upiši novu lozinku.'
        : values.next.length < MIN_LENGTH
          ? `Nova lozinka mora imati najmanje ${MIN_LENGTH} znakova.`
          : values.next === values.current
            ? 'Nova lozinka mora biti drugačija od stare.'
            : '',
      repeat: values.repeat && values.repeat === values.next ? '' : 'Lozinke se ne poklapaju.',
    }
    setErrors(found)
    if (Object.values(found).some(Boolean)) return

    setBusy(true)
    try {
      const account = await api('/account/password', {
        method: 'POST',
        body: JSON.stringify({ current: values.current, next: values.next }),
      })
      setValues({ current: '', next: '', repeat: '' })
      setSaved(true)
      onChanged(account)
    } catch (submitError) {
      setServerError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="password-title" className={cardClass}>
      <div className="px-4.5 pt-4">
        <h3 id="password-title" className="font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white">
          Promijeni lozinku
        </h3>
        <p className="mt-0.5 text-[13.5px] text-zinc-400">
          Najmanje {MIN_LENGTH} znakova. Posle promjene te odjavljuje sa ostalih uređaja.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3.5 px-4.5 pt-3.5 pb-4.5">
        <PasswordField
          id="current"
          label="Trenutna lozinka"
          value={values.current}
          onChange={update('current')}
          error={errors.current}
          autoComplete="current-password"
          placeholder="••••••••"
        />
        <PasswordField
          id="next"
          label="Nova lozinka"
          value={values.next}
          onChange={update('next')}
          error={errors.next}
          autoComplete="new-password"
          placeholder={`Najmanje ${MIN_LENGTH} znakova`}
        >
          <div className="flex items-center gap-2.5" aria-live="polite">
            <div className="grid flex-1 grid-cols-3 gap-1">
              {[1, 2, 3].map((step) => (
                <i
                  key={step}
                  className={`h-1 rounded ${
                    meter.level >= step
                      ? meter.level === 1
                        ? 'bg-rose-400'
                        : meter.level === 2
                          ? 'bg-accent'
                          : 'bg-neon'
                      : 'bg-white/8'
                  }`}
                />
              ))}
            </div>
            <span className="min-w-24 text-right text-[12.5px] text-zinc-400">{meter.text}</span>
          </div>
        </PasswordField>
        <PasswordField
          id="repeat"
          label="Ponovi novu lozinku"
          value={values.repeat}
          onChange={update('repeat')}
          error={errors.repeat}
          autoComplete="new-password"
          placeholder="Ista kao gore"
        />
        <p className="flex items-start gap-2.5 rounded-[10px] bg-white/3 px-3.25 py-2.75 text-[13px] text-zinc-400 ring-1 ring-line ring-inset">
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-accent" />
          Na ovom uređaju ostaješ prijavljen. Na telefonu ili drugom računaru treba se ponovo prijaviti novom lozinkom.
        </p>
        {serverError && (
          <p role="alert" className="text-[13px] text-rose-400">
            {serverError}
          </p>
        )}
        <button type="submit" disabled={busy} className={`${primaryClass} h-11.5 px-5 text-base`}>
          {busy ? 'Čuvanje…' : 'Sačuvaj novu lozinku'}
        </button>
        {saved && (
          <p role="status" className="rounded-[10px] bg-neon/10 px-3.25 py-2.75 text-sm text-zinc-200 ring-1 ring-neon/32 ring-inset">
            ✓ Lozinka je promijenjena. Ostali uređaji su odjavljeni.
          </p>
        )}
      </form>
    </section>
  )
}

function PasswordField({ id, label, value, onChange, error, autoComplete, placeholder, children }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex flex-col gap-1.75">
      <label htmlFor={id} className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-11.5 w-full rounded-[9px] border bg-surface-2 py-0 pr-12 pl-3.5 font-medium text-white outline-none placeholder:text-zinc-600 focus:border-accent focus:bg-ink focus:ring-3 focus:ring-accent/12 ${
            error ? 'border-rose-500/60' : 'border-line'
          }`}
        />
        <button
          type="button"
          onClick={() => setShown((current) => !current)}
          aria-label={shown ? 'Sakrij lozinku' : 'Prikaži lozinku'}
          aria-pressed={shown}
          className="absolute top-1/2 right-1.25 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-zinc-400 transition hover:bg-white/5 hover:text-white"
        >
          {shown ? <EyeOffIcon className="size-4.5" /> : <EyeIcon className="size-4.5" />}
        </button>
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-[13px] text-rose-400">
          {error}
        </p>
      )}
    </div>
  )
}

function BackupCard({ backups }) {
  const files = backups?.files ?? []
  return (
    <section aria-labelledby="backup-title" className={cardClass}>
      <div className="px-4.5 pt-4">
        <h3 id="backup-title" className="font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white">
          Rezervna kopija baze
        </h3>
        <p className="mt-0.5 text-[13.5px] text-zinc-400">
          Svi prijatelji, kola, tiketi, rezultati, izvlačenja i nalozi. Vidi samo admin.
        </p>
      </div>
      <div className="flex flex-col gap-3.5 px-4.5 pt-3.5 pb-4.5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-ink p-3.5 ring-1 ring-line ring-inset">
          <div>
            <b className="block font-semibold text-white">Preuzmi kopiju sada</b>
            <small className="text-[13px] text-zinc-400">Jedan .sql fajl, vraća se uvozom u phpMyAdmin.</small>
          </div>
          <a href="/api/backup/download" download className={`${primaryClass} h-9.5 px-3.5 text-sm`}>
            <DownloadIcon className="size-4" />
            Preuzmi
          </a>
        </div>

        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-zinc-400">
          <span>
            Automatski: <b className="font-semibold text-white">svake nedjelje u 04:00</b>
          </span>
          <span>
            Čuva se <b className="font-semibold text-white">zadnjih {backups?.keep ?? 8}</b>
          </span>
        </div>

        {backups === null ? (
          <p className="text-sm text-zinc-500">Učitavanje kopija…</p>
        ) : files.length ? (
          <ul>
            {files.map((file, index) => {
              const time = formatTime(file.createdAt)
              return (
                <li
                  key={file.name}
                  className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-0.5 py-2.5 first:border-t-0"
                >
                  <span className="grid size-8.5 place-items-center rounded-lg bg-surface-2 font-display text-[10px] font-bold tracking-[0.08em] text-zinc-400 ring-1 ring-line ring-inset">
                    SQL
                  </span>
                  <div className="min-w-0">
                    <b className="block text-sm font-semibold wrap-anywhere text-white">
                      {time.long}
                      {index === 0 && (
                        <span className="ml-1.5 rounded bg-neon/10 px-1.5 py-px font-display text-[10px] font-bold uppercase tracking-[0.14em] text-neon">
                          Zadnja
                        </span>
                      )}
                    </b>
                    <small className="text-[12.5px] text-zinc-400">{Math.max(1, Math.round(file.size / 1024))} KB · automatska</small>
                  </div>
                  <a
                    href={`/api/backups/${encodeURIComponent(file.name)}`}
                    download
                    className="px-1 py-1.5 text-[13px] font-semibold text-accent underline-offset-4 hover:underline"
                  >
                    Preuzmi
                  </a>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="rounded-[10px] px-3.5 py-3 text-sm text-zinc-400 ring-1 ring-line ring-inset">
            Još nema automatskih kopija. Pojaviće se ovdje čim se podesi Cron u hPanelu.
          </p>
        )}

        <p className="flex items-start gap-2.5 rounded-[10px] bg-white/3 px-3.25 py-2.75 text-[13px] text-zinc-400 ring-1 ring-line ring-inset">
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-accent" />
          Kopije se čuvaju na serveru, van javnog foldera, pa ih niko ne može otvoriti preko linka.
        </p>
      </div>
    </section>
  )
}

// Obavještenja: ovaj uređaj (dozvola na telefonu) i izbor šta se prima (važi za sve uređaje naloga).
function NotificationsCard() {
  const [settings, setSettings] = useState(null)
  const [subscribed, setSubscribed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ tone: '', text: '' })

  useEffect(() => {
    let ignore = false
    api('/notifications').then(
      (data) => !ignore && setSettings(data),
      (loadError) => !ignore && setMessage({ tone: 'error', text: loadError.message }),
    )
    currentSubscription().then(
      (subscription) => !ignore && setSubscribed(Boolean(subscription)),
      () => !ignore && setSubscribed(false),
    )
    return () => {
      ignore = true
    }
  }, [])

  async function run(action, success = '') {
    setBusy(true)
    setMessage({ tone: '', text: '' })
    try {
      await action()
      if (success) setMessage({ tone: 'ok', text: success })
    } catch (actionError) {
      setMessage({ tone: 'error', text: actionError.message })
    } finally {
      setBusy(false)
    }
  }

  function toggle(type) {
    const types = settings.types.map((t) => (t.id === type.id ? { ...t, on: !t.on } : t))
    setSettings({ ...settings, types })
    run(async () => {
      const off = types.filter((t) => !t.on).map((t) => t.id)
      setSettings(await api('/notifications', { method: 'PUT', body: JSON.stringify({ off }) }))
    })
  }

  let device
  if (!pushSupported()) {
    device = isIos() && !isStandalone()
      ? 'Na iPhone-u obavještenja rade kad su Tiketi dodati na početni ekran (Safari → Podijeli → Dodaj na početni ekran), od iOS 16.4. Otvori Tikete sa početnog ekrana pa ih uključi ovdje.'
      : 'Ovaj pregledač ne podržava obavještenja.'
  } else if (Notification.permission === 'denied') {
    device = 'Obavještenja su blokirana za Tikete. Uključi ih u podešavanjima telefona ili pregledača, pa se vrati ovdje.'
  }

  return (
    <section aria-labelledby="notify-title" className={cardClass}>
      <div className="px-4.5 pt-4">
        <h3 id="notify-title" className="font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white">
          Obavještenja
        </h3>
        <p className="mt-0.5 text-[13.5px] text-zinc-400">Biraš šta želiš da primaš. Važi za sve tvoje uređaje.</p>
      </div>
      <div className="flex flex-col gap-3.5 px-4.5 pt-3.5 pb-4.5">
        {device ? (
          <p className="flex items-start gap-2.5 rounded-[10px] bg-white/3 px-3.25 py-2.75 text-[13px] text-zinc-400 ring-1 ring-line ring-inset">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-accent" />
            {device}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-ink p-3.5 ring-1 ring-line ring-inset">
            <div className="min-w-0">
              <b className="block font-semibold text-white">Ovaj uređaj</b>
              <small className="text-[13px] text-zinc-400">
                {subscribed === null
                  ? 'Provjeravam…'
                  : subscribed
                    ? 'Obavještenja stižu na ovaj uređaj.'
                    : 'Obavještenja nisu uključena.'}
              </small>
            </div>
            {subscribed ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => api('/push/test', { method: 'POST' }), 'Probno obavještenje je poslato.')}
                  className="h-9.5 rounded-[9px] px-3 text-[13px] font-semibold text-accent transition hover:bg-white/5"
                >
                  Probaj
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const data = await disablePush()
                      if (data) setSettings(data)
                      setSubscribed(false)
                    })
                  }
                  className="h-9.5 rounded-[9px] px-3 text-[13px] text-zinc-400 transition hover:bg-white/5 hover:text-white"
                >
                  Isključi
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy || !settings || subscribed === null}
                onClick={() =>
                  run(async () => {
                    setSettings(await enablePush(settings.publicKey))
                    setSubscribed(true)
                  }, 'Obavještenja su uključena na ovom uređaju.')
                }
                className={`${primaryClass} h-9.5 px-3.5 text-sm`}
              >
                <BellIcon className="size-4" />
                Uključi
              </button>
            )}
          </div>
        )}

        {message.text && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-[13px] ${message.tone === 'error' ? 'text-rose-400' : 'text-neon'}`}>
            {message.text}
          </p>
        )}

        {settings === null ? (
          <p className="text-sm text-zinc-500">Učitavanje…</p>
        ) : (
          <ul className="overflow-hidden rounded-[10px] ring-1 ring-line ring-inset">
            {settings.types.map((type) => (
              <li key={type.id} className="flex items-center gap-3.5 border-b border-line px-3.5 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <b className="flex flex-wrap items-center gap-1.5 font-semibold text-white">
                    {type.name}
                    {type.admin && (
                      <span className="rounded bg-accent/12 px-1.5 py-px font-display text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
                        Samo admin
                      </span>
                    )}
                  </b>
                  <small className="block text-[13px] text-zinc-400">{type.when}</small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={type.on}
                  aria-label={type.name}
                  onClick={() => toggle(type)}
                  className={`relative h-6.5 w-11 shrink-0 rounded-full transition after:absolute after:top-0.75 after:left-0.75 after:size-5 after:rounded-full after:transition after:content-[""] ${
                    type.on
                      ? 'bg-neon after:translate-x-4.5 after:bg-ink'
                      : 'bg-surface-hover ring-1 ring-white/16 ring-inset after:bg-zinc-400'
                  }`}
                />
              </li>
            ))}
          </ul>
        )}
        {settings !== null && (
          <p className="text-[13px] text-zinc-400">
            {settings.devices
              ? `Obavještenja za tvoj nalog stižu na ${settings.devices} ${settings.devices === 1 ? 'uređaj' : 'uređaja'}.`
              : 'Nijedan tvoj uređaj još ne prima obavještenja.'}
          </p>
        )}
      </div>
    </section>
  )
}

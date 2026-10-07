import { useState } from 'react'
import { LockIcon } from './icons.jsx'

const STORAGE_KEY = 'tiketi:podsjetnik-lozinka'

// "Kasnije" sakrije podsjetnik do sljedeće prijave: pamti se uz vrijeme ove prijave.
const marker = (user) => `${user.username}|${user.lastLoginAt}`

function wasDismissed(user) {
  try {
    return localStorage.getItem(STORAGE_KEY) === marker(user)
  } catch {
    return false
  }
}

// Podsjetnik na vrhu tabele za one koji još koriste lozinku koju im je dao admin.
export default function PasswordReminder({ user }) {
  const [hidden, setHidden] = useState(() => wasDismissed(user))
  if (!user.passwordSetByAdmin || hidden) return null

  function later() {
    try {
      localStorage.setItem(STORAGE_KEY, marker(user))
    } catch {
      // Bez localStorage-a podsjetnik se sakrije samo do osvježavanja stranice.
    }
    setHidden(true)
  }

  return (
    <section
      aria-label="Podsjetnik za lozinku"
      className="flex flex-wrap items-center gap-x-4.5 gap-y-3 rounded-xl bg-accent/12 px-4 py-3.5 ring-1 ring-accent/35 ring-inset"
    >
      <span className="grid size-9.5 shrink-0 place-items-center rounded-[10px] bg-accent text-ink">
        <LockIcon className="size-5" />
      </span>
      <div className="min-w-55 flex-1">
        <p className="font-display text-base font-bold uppercase tracking-[0.06em] text-accent">Postavi svoju lozinku</p>
        <p className="text-sm text-zinc-300">
          Još koristiš lozinku koju ti je dao admin. Promijeni je da niko drugi ne može ući na tvoj nalog.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={later}
          className="h-9.5 rounded-[9px] px-3 text-[13px] text-zinc-400 transition hover:bg-white/5 hover:text-white"
        >
          Kasnije
        </button>
        <a
          href="/nalog"
          className="inline-flex h-9.5 items-center rounded-[10px] bg-accent px-3.5 font-display text-sm font-bold uppercase tracking-[0.1em] text-ink shadow-[0_12px_30px_-12px_rgba(255,106,19,0.7)] transition hover:brightness-110"
        >
          Promijeni lozinku
        </a>
      </div>
    </section>
  )
}

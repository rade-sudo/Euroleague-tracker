import { logout } from './api.js'
import { BallIcon, UserIcon } from './icons.jsx'

const NAV = [
  { id: 'tabela', href: '/', label: 'Tabela' },
  { id: 'bubanj', href: '/bubanj', label: 'Bubanj' },
  { id: 'statistika', href: '/statistika', label: 'Statistika' },
  { id: 'kasa', href: '/kasa', label: 'Kasa' },
  { id: 'igraci', href: '/igraci', label: 'Igrači', adminOnly: true },
]

// Zaglavlje svih stranica: logo, navigacija, prijavljeni korisnik i odjava.
// children se prikazuje ispod korisnika (npr. status snimanja u tabeli).
export default function AppHeader({ user, active, children }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-ink shadow-lg shadow-accent/30">
          <BallIcon className="size-7" />
        </div>
        <div>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-accent">
            Euroliga · Tiket tracker
          </p>
          <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-white sm:text-4xl">
            Pogođeni igrači
          </h1>
        </div>
      </div>
      {user && (
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex flex-wrap items-center gap-x-4.5 gap-y-3">
            <nav
              aria-label="Glavna navigacija"
              className="inline-flex max-w-full overflow-x-auto rounded-[10px] bg-surface p-0.75 ring-1 ring-line ring-inset"
            >
              {NAV.filter((item) => !item.adminOnly || user.role === 'admin').map((item) => (
                <a
                  key={item.id}
                  href={item.href}
                  aria-current={item.id === active ? 'page' : undefined}
                  className={`shrink-0 rounded-lg px-2.5 py-1.75 font-display sm:px-3.5 text-sm font-bold uppercase tracking-[0.12em] transition ${
                    item.id === active
                      ? 'bg-accent/12 text-accent ring-1 ring-accent/35 ring-inset'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <UserBadge user={user} active={active} />
          </div>
          {children}
        </div>
      )}
    </header>
  )
}

// Ime vodi na "Moj nalog" (podaci, lozinka, a adminu i rezervne kopije).
function UserBadge({ user, active }) {
  const isAdmin = user.role === 'admin'
  return (
    <div className="flex items-center gap-3">
      <a
        href="/nalog"
        aria-current={active === 'nalog' ? 'page' : undefined}
        title="Moj nalog"
        className="flex items-center gap-2 rounded-lg bg-accent/12 py-1.25 pr-2 pl-2.5 text-sm ring-1 ring-accent/35 ring-inset transition hover:bg-accent/20"
      >
        <UserIcon className="size-3.5 text-accent" />
        <span className="font-semibold text-zinc-100">{user.username}</span>
        <span
          className={`rounded px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.18em] ring-1 ring-inset ${
            isAdmin ? 'bg-accent/10 text-accent ring-accent/30' : 'bg-white/5 text-zinc-400 ring-white/10'
          }`}
        >
          {isAdmin ? 'Admin' : 'Samo pregled'}
        </span>
      </a>
      <button
        type="button"
        onClick={logout}
        className="h-8 rounded-lg border border-line px-3 text-xs font-medium text-zinc-400 transition hover:border-white/20 hover:text-white"
      >
        Odjava
      </button>
    </div>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import { logout } from './api.js'
import { BallIcon, CashIcon, DrumIcon, FormIcon, LogoutIcon, PlayersIcon, StatsIcon, TableIcon, UserIcon } from './icons.jsx'

const NAV = [
  { id: 'tabela', href: '/', label: 'Tabela', short: 'Tabela', icon: TableIcon },
  { id: 'bubanj', href: '/bubanj', label: 'Bubanj', short: 'Bubanj', icon: DrumIcon },
  { id: 'statistika', href: '/statistika', label: 'Statistika', short: 'Statist.', icon: StatsIcon },
  { id: 'forma', href: '/forma', label: 'Forma', short: 'Forma', icon: FormIcon },
  { id: 'kasa', href: '/kasa', label: 'Kasa', short: 'Kasa', icon: CashIcon },
  // FANTASY ISKLJUČEN dok ne ide live (vrati i rutu u main.jsx):
  // { id: 'fantasy', href: '/fantasy', label: 'Fantasy', short: 'Fantasy', icon: TrophyIcon },
]

// Zaglavlje svih stranica: logo, navigacija i krug naloga (Moj nalog, Igrači za admina, Odjava).
// Na telefonu (uže od 640 px) navigacija je traka na dnu ekrana.
// children se prikazuje ispod kruga (npr. status snimanja u tabeli).
export default function AppHeader({ user, active, children }) {
  // Prostor na dnu stranice da donja traka ne prekrije sadržaj (samo na telefonu, vidi index.css).
  useEffect(() => {
    if (!user) return undefined
    document.body.classList.add('has-tabbar')
    return () => document.body.classList.remove('has-tabbar')
  }, [user])

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-accent text-ink shadow-lg shadow-accent/30 sm:size-12 sm:rounded-xl">
          <BallIcon className="size-6 sm:size-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[10px] font-semibold tracking-[0.26em] text-accent uppercase sm:text-xs sm:tracking-[0.3em]">
            Euroliga · Tiket tracker
          </p>
          <h1 className="truncate font-display text-[22px] leading-none font-bold tracking-wide text-white uppercase sm:text-4xl">
            Pogođeni igrači
          </h1>
        </div>
        {user && (
          <div className="sm:hidden">
            <AccountMenu user={user} active={active} />
          </div>
        )}
      </div>
      {user && (
        <div className={`${children ? 'flex' : 'hidden sm:flex'} flex-col items-start gap-3 sm:items-end`}>
          <div className="hidden items-center gap-x-4 sm:flex">
            <nav aria-label="Glavna navigacija" className="inline-flex max-w-full overflow-x-auto rounded-[10px] bg-surface p-0.75 ring-1 ring-line ring-inset">
              {NAV.map((item) => (
                <a
                  key={item.id}
                  href={item.href}
                  aria-current={item.id === active ? 'page' : undefined}
                  className={`shrink-0 rounded-lg px-3.5 py-1.75 font-display text-sm font-bold tracking-[0.12em] uppercase transition ${
                    item.id === active ? 'bg-accent/12 text-accent ring-1 ring-accent/35 ring-inset' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <AccountMenu user={user} active={active} />
          </div>
          {children}
        </div>
      )}
      {user && <TabBar active={active} />}
    </header>
  )
}

// Telefon: pet stranica na dnu ekrana, gdje je palac.
function TabBar({ active }) {
  return (
    <nav
      aria-label="Glavna navigacija"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/12 bg-surface/97 px-1.5 pt-1.5 pb-[calc(8px+env(safe-area-inset-bottom,0px))] backdrop-blur-md sm:hidden"
      style={{ paddingLeft: 'max(6px, env(safe-area-inset-left, 0px))', paddingRight: 'max(6px, env(safe-area-inset-right, 0px))' }}
    >
      {NAV.map((item) => {
        const on = item.id === active
        const Icon = item.icon
        return (
          <a
            key={item.id}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.75 rounded-[10px] pt-1.5 pb-1 transition ${on ? 'text-accent' : 'text-zinc-500 active:text-white'}`}
          >
            <Icon className={`size-5.5 ${on ? 'drop-shadow-[0_0_8px_rgba(255,106,19,0.45)]' : ''}`} />
            <b className="font-display text-[11.5px] font-bold tracking-[0.08em] uppercase">{item.short}</b>
          </a>
        )
      })}
    </nav>
  )
}

// Krug sa inicijalom: Moj nalog (podaci, lozinka, obavještenja), adminu i Igrači, pa Odjava.
// Admin ima narandžasti krug, drugari sivi.
function AccountMenu({ user, active }) {
  const menuId = useId()
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const isAdmin = user.role === 'admin'
  const initial = (user.username?.[0] ?? '?').toUpperCase()
  const circle = isAdmin ? 'bg-accent/12 text-accent ring-accent/35' : 'bg-white/6 text-white ring-white/16'

  function close(refocus) {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  // Klik van menija zatvara ga.
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  function onKeyDown(event) {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const itemClass =
    'flex items-center gap-2.75 rounded-[10px] px-2.5 py-2.5 text-[14.5px] font-medium text-zinc-300 outline-none transition hover:bg-surface-hover hover:text-white focus-visible:bg-surface-hover focus-visible:text-white'

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Nalog: ${user.username}`}
        title={user.username}
        onClick={() => {
          setOpen(!open)
          if (!open) setTimeout(() => menuRef.current?.querySelector('[role="menuitem"]')?.focus(), 0)
        }}
        className={`grid size-10 place-items-center rounded-full font-display text-[17px] font-extrabold ring-inset transition ${circle} ${
          open || active === 'nalog' ? 'ring-2 ring-accent' : 'ring-1 hover:ring-2'
        }`}
      >
        {initial}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Nalog"
          onKeyDown={onKeyDown}
          className="absolute top-[calc(100%+8px)] right-0 z-50 flex w-66 max-w-[calc(100vw-32px)] origin-top-right flex-col gap-px rounded-2xl bg-surface-2 p-1.5 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.95)] ring-1 ring-white/12 motion-safe:animate-[open-down_.15s_ease-out]"
        >
          <div className="mb-1 flex items-center gap-2.5 border-b border-line px-2.5 pt-2.5 pb-3">
            <span className={`grid size-9 place-items-center rounded-full font-display text-base font-extrabold ring-1 ring-inset ${circle}`}>{initial}</span>
            <div className="min-w-0">
              <b className="block truncate text-[15px] font-semibold text-white">{user.username}</b>
              <span
                className={`mt-0.5 inline-block rounded px-1.5 py-px font-display text-[10px] font-bold tracking-[0.16em] uppercase ${
                  isAdmin ? 'bg-accent/10 text-accent' : 'bg-white/5 text-zinc-400'
                }`}
              >
                {isAdmin ? 'Admin' : 'Samo pregled'}
              </span>
            </div>
          </div>
          <a href="/nalog" role="menuitem" aria-current={active === 'nalog' ? 'page' : undefined} className={itemClass}>
            <UserIcon className="size-4.5 shrink-0 text-zinc-400" />
            <span className="min-w-0">
              Moj nalog
              <small className="block text-xs font-normal text-zinc-500">
                lozinka, obavještenja{isAdmin ? ', rezervna kopija' : ''}
              </small>
            </span>
          </a>
          {isAdmin && (
            <>
              <div className="px-2.5 pt-2 pb-0.75 font-display text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Admin</div>
              <a href="/igraci" role="menuitem" aria-current={active === 'igraci' ? 'page' : undefined} className={itemClass}>
                <PlayersIcon className="size-4.5 shrink-0 text-zinc-400" />
                Igrači
              </a>
            </>
          )}
          <div className="mx-1.5 my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className={`${itemClass} text-rose-400 hover:text-rose-300 focus-visible:text-rose-300`}
          >
            <LogoutIcon className="size-4.5 shrink-0" />
            Odjava
          </button>
        </div>
      )}
    </div>
  )
}

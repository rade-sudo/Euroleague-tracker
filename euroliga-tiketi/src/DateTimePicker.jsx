import { useEffect, useId, useRef, useState } from 'react'
import { ArrowButton } from './Arrows.jsx'
import { ChevronIcon } from './icons.jsx'

const MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar']
const WEEKDAYS = ['pon', 'uto', 'sri', 'čet', 'pet', 'sub', 'ned']
const DAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']
// Draft je uveče: od 17:00 do 23:30, na pola sata.
const TIMES = Array.from({ length: 14 }, (_, i) => `${String(17 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

const pad = (n) => String(n).padStart(2, '0')
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function parse(value) {
  if (!value) return null
  const [date, time] = value.split('T')
  const [y, m, d] = date.split('-').map(Number)
  return { date, time: time.slice(0, 5), year: y, month: m - 1, day: d }
}

// "2026-10-20T20:00" → "uto 20. 10. u 20:00"
function label(value) {
  const p = parse(value)
  if (!p) return 'Termin nije zakazan'
  return `${DAYS[new Date(p.year, p.month, p.day).getDay()]} ${p.day}. ${p.month + 1}. u ${p.time}`
}

function CalendarIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  )
}

// Izbor dana i sata u stilu ostalih padajućih lista (kao izbor drugara u Kasi).
// Kalendar počinje od ponedjeljka; prošli dani se ne biraju. Escape i klik van zatvaraju.
export default function DateTimePicker({ value, onSave, disabled = false, ariaLabel = 'Termin' }) {
  const panelId = useId()
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('20:00')
  const [view, setView] = useState({ year: 0, month: 0 })

  useEffect(() => {
    if (!open) return undefined
    panelRef.current?.focus()
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  function show() {
    const current = parse(value)
    const base = current ? new Date(current.year, current.month, current.day) : new Date()
    setDate(current?.date ?? '')
    setTime(current?.time ?? '20:00')
    setView({ year: base.getFullYear(), month: base.getMonth() })
    setOpen(true)
  }

  function close() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function moveMonth(step) {
    setView(({ year, month }) => {
      const d = new Date(year, month + step, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  const today = dateKey(new Date())
  const first = new Date(view.year, view.month, 1)
  const offset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(view.year, view.month, i + 1))]
  const canGoBack = view.year > new Date().getFullYear() || (view.year === new Date().getFullYear() && view.month > new Date().getMonth())
  const changed = date && `${date}T${time}` !== value

  return (
    <div ref={rootRef} className="relative w-full max-w-80 min-w-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${ariaLabel}: ${label(value)}`}
        onClick={() => (open ? setOpen(false) : show())}
        className={`flex h-10 w-full items-center gap-2.5 rounded-[10px] border bg-surface-2 pr-3 pl-2.5 text-left transition disabled:opacity-50 ${
          open ? 'border-accent ring-3 ring-accent/12' : 'border-line hover:border-white/16'
        }`}
      >
        <CalendarIcon className={`size-4.5 shrink-0 ${value ? 'text-accent' : 'text-zinc-500'}`} />
        <span className={`min-w-0 flex-1 truncate text-sm ${value ? 'font-semibold text-white' : 'text-zinc-400'}`}>{label(value)}</span>
        <ChevronIcon direction="right" className={`size-4 shrink-0 transition ${open ? '-rotate-90 text-accent' : 'rotate-90 text-zinc-400'}`} />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={(event) => event.key === 'Escape' && close()}
          className="absolute top-[calc(100%+6px)] left-0 z-30 flex w-[min(320px,calc(100vw-32px))] flex-col gap-3 rounded-xl bg-surface-hover p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16),0_24px_48px_-16px_rgba(0,0,0,0.9)] outline-none"
        >
          <div className="flex items-center justify-between gap-2">
            <ArrowButton direction="left" size="sm" label="Prethodni mjesec" disabled={!canGoBack} onClick={() => moveMonth(-1)} />
            <b className="font-display text-[17px] font-bold tracking-[0.06em] text-white uppercase">
              {MONTHS[view.month]} {view.year}
            </b>
            <ArrowButton direction="right" size="sm" label="Sljedeći mjesec" onClick={() => moveMonth(1)} />
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((day) => (
              <span key={day} className="pb-0.5 font-display text-[11px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
                {day}
              </span>
            ))}
            {cells.map((cell, index) => {
              if (!cell) return <span key={`e${index}`} />
              const key = dateKey(cell)
              const past = key < today
              const selected = key === date
              return (
                <button
                  key={key}
                  type="button"
                  disabled={past}
                  aria-pressed={selected}
                  aria-label={`${cell.getDate()}. ${MONTHS[cell.getMonth()]}`}
                  onClick={() => setDate(key)}
                  className={`grid h-8.5 place-items-center rounded-lg text-sm tabular-nums transition disabled:pointer-events-none disabled:text-zinc-700 ${
                    selected
                      ? 'bg-accent font-bold text-ink'
                      : key === today
                        ? 'font-semibold text-accent ring-1 ring-accent/40 ring-inset hover:bg-white/6'
                        : 'text-zinc-200 hover:bg-white/6'
                  }`}
                >
                  {cell.getDate()}
                </button>
              )
            })}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-line pt-3">
            <span className="font-display text-[11px] font-semibold tracking-[0.2em] text-zinc-400 uppercase">Vrijeme</span>
            <div className="grid grid-cols-5 gap-1">
              {TIMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={t === time}
                  onClick={() => setTime(t)}
                  className={`h-8 rounded-lg text-[13px] tabular-nums transition ${
                    t === time ? 'bg-accent font-bold text-ink' : 'text-zinc-300 ring-1 ring-line ring-inset hover:text-white hover:ring-white/20'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onSave(null)
                  close()
                }}
                className="text-[13px] text-zinc-500 transition hover:text-rose-400"
              >
                Ukloni termin
              </button>
            ) : (
              <span />
            )}
            <span className="flex items-center gap-2">
              <button type="button" onClick={close} className="h-8.5 rounded-lg px-3 text-[13px] text-zinc-400 transition hover:text-white">
                Otkaži
              </button>
              <button
                type="button"
                disabled={!changed}
                onClick={() => {
                  onSave(`${date}T${time}`)
                  close()
                }}
                className="h-8.5 rounded-lg bg-accent px-3.5 font-display text-sm font-bold tracking-[0.1em] text-ink uppercase transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
              >
                Sačuvaj
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

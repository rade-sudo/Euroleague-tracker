import { useEffect, useId, useRef, useState } from 'react'
import { ChevronIcon } from './icons.jsx'

// Duža lista dobija polje za pretragu.
const SEARCH_FROM = 12

// Padajuća lista u stilu izbora drugara u Kasi: dugme sa izabranom stavkom, ispod lista.
// options: [{ value, label, sub?, lead? }] (lead je npr. oznaka pozicije ili avatar).
// Radi i sa tastature: strelice, Enter, Escape; kucanjem se pretražuje duga lista.
export default function Dropdown({ options, value, onChange, disabled = false, ariaLabel }) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const searchRef = useRef(null)
  const buttonRef = useRef(null)
  const selected = options.find((option) => option.value === value) ?? null
  const searchable = options.length > SEARCH_FROM
  const needle = query.trim().toLowerCase()
  const shown = needle ? options.filter((option) => `${option.label} ${option.sub ?? ''}`.toLowerCase().includes(needle)) : options

  useEffect(() => {
    if (!open) return undefined
    ;(searchRef.current ?? listRef.current)?.focus()
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, listId])

  function show() {
    setQuery('')
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
    setOpen(true)
  }

  function close() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function choose(option) {
    if (!option) return
    onChange(option.value)
    close()
  }

  function onKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (shown.length ? (index + 1) % shown.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (shown.length ? (index + shown.length - 1) % shown.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(shown[active])
    } else if (event.key === 'Escape') {
      close()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={selected ? `${ariaLabel}: ${selected.label}` : ariaLabel}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
          }
        }}
        className={`flex h-11.5 w-full items-center gap-2.5 rounded-[10px] border bg-surface-2 pr-3 pl-2.5 text-left transition disabled:cursor-default disabled:opacity-50 ${
          open ? 'border-accent ring-3 ring-accent/12' : 'border-line hover:border-white/16'
        }`}
      >
        {selected?.lead}
        <span className="min-w-0 flex-1 leading-tight">
          <b className={`block truncate ${selected && !selected.muted ? 'font-semibold text-white' : 'font-normal text-zinc-400'}`}>
            {selected?.label ?? 'Izaberi'}
          </b>
          {selected?.sub && <small className="block truncate text-xs text-zinc-400">{selected.sub}</small>}
        </span>
        <ChevronIcon direction="right" className={`size-4 shrink-0 transition ${open ? '-rotate-90 text-accent' : 'rotate-90 text-zinc-400'}`} />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+6px)] right-0 left-0 z-30 flex flex-col rounded-xl bg-surface-hover p-1.25 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16),0_24px_48px_-16px_rgba(0,0,0,0.9)]">
          {searchable && (
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={onKey}
              placeholder="Traži igrača ili klub"
              aria-label="Traži"
              aria-controls={listId}
              aria-activedescendant={shown.length ? `${listId}-${active}` : undefined}
              className="mb-1.25 h-9 rounded-lg bg-ink px-2.5 text-sm text-white ring-1 ring-line ring-inset placeholder:text-zinc-600 focus:outline-none focus:ring-accent"
            />
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-activedescendant={shown.length ? `${listId}-${active}` : undefined}
            onKeyDown={onKey}
            className="max-h-72 overflow-y-auto outline-none"
          >
            {shown.length === 0 && <li className="px-2.25 py-2 text-sm text-zinc-400">Nema rezultata.</li>}
            {shown.map((option, index) => {
              const isSelected = option.value === value
              return (
                <li
                  key={String(option.value)}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onPointerMove={() => index !== active && setActive(index)}
                  onClick={() => choose(option)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.25 py-1.75 ${index === active ? 'bg-white/6' : ''}`}
                >
                  {option.lead}
                  <span className="min-w-0 flex-1 leading-tight">
                    <b className={`block truncate ${option.muted ? 'font-normal text-zinc-400' : 'font-semibold text-white'}`}>{option.label}</b>
                    {option.sub && <small className="block truncate text-xs text-zinc-400">{option.sub}</small>}
                  </span>
                  <span className="w-4 text-center font-extrabold text-accent">{isSelected ? '✓' : ''}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

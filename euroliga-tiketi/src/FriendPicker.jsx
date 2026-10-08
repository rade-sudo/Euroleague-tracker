import { useEffect, useId, useRef, useState } from 'react'
import { ChevronIcon } from './icons.jsx'
import { BALANCE_TEXT, balanceState } from './money.js'

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function Avatar({ name, selected = false, size = 'size-8' }) {
  return (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-full font-display text-xs font-bold ${
        selected ? 'bg-accent text-ink' : 'bg-linear-to-br from-zinc-700 to-zinc-800 text-white ring-1 ring-white/10 ring-inset'
      }`}
    >
      {initials(name)}
    </span>
  )
}

// Izbor drugara za uplatu: dugme sa avatarom, imenom i stanjem u kasi, a ispod lista.
// Radi i sa tastature: strelice, Enter, Escape.
export default function FriendPicker({ friends, balances, value, onChange }) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const buttonRef = useRef(null)
  const selected = friends.find((friend) => friend.id === value) ?? friends[0]

  useEffect(() => {
    if (!open) return undefined
    listRef.current?.focus()
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  if (!selected) return null

  function show() {
    setActive(Math.max(0, friends.findIndex((friend) => friend.id === selected.id)))
    setOpen(true)
  }

  function choose(index) {
    onChange(friends[index].id)
    setOpen(false)
    buttonRef.current?.focus()
  }

  function onListKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (index + 1) % friends.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index + friends.length - 1) % friends.length)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Escape') {
      setOpen(false)
      buttonRef.current?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const selectedState = balanceState(balances[selected.id] ?? 0)

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Ko je uplatio: ${selected.name}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
          }
        }}
        className={`flex h-11.5 w-full items-center gap-2.5 rounded-[10px] border bg-surface-2 pr-3 pl-1.75 text-left transition ${
          open ? 'border-accent ring-3 ring-accent/12' : 'border-line hover:border-white/16'
        }`}
      >
        <Avatar name={selected.name} />
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate font-semibold text-white">{selected.name}</b>
          <small className={`block text-xs ${BALANCE_TEXT[selectedState.tone]}`}>{selectedState.text}</small>
        </span>
        <ChevronIcon
          direction="right"
          className={`size-4 shrink-0 transition ${open ? '-rotate-90 text-accent' : 'rotate-90 text-zinc-400'}`}
        />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label="Drugari"
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKey}
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-30 min-w-65 rounded-xl bg-surface-hover p-1.25 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16),0_24px_48px_-16px_rgba(0,0,0,0.9)] outline-none"
        >
          {friends.map((friend, index) => {
            const state = balanceState(balances[friend.id] ?? 0)
            const isSelected = friend.id === selected.id
            return (
              <li
                key={friend.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                onPointerMove={() => index !== active && setActive(index)}
                onClick={() => choose(index)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.25 py-1.75 ${index === active ? 'bg-white/6' : ''}`}
              >
                <Avatar name={friend.name} selected={isSelected} size="size-7.5" />
                <span className="min-w-0 flex-1 leading-tight">
                  <b className="block truncate font-semibold text-white">{friend.name}</b>
                  <small className={`block text-xs ${BALANCE_TEXT[state.tone]}`}>{state.text}</small>
                </span>
                <span className="w-4 text-center font-extrabold text-accent">{isSelected ? '✓' : ''}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

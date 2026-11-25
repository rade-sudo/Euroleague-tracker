import { useId, useState } from 'react'
import { searchPlayers } from './players.js'

// Polje za igrača sa prijedlozima sa spiska Eurolige. Ko ne izabere sa spiska,
// igrač se sačuva kako je upisan, a server ga pokuša prepoznati.
export default function PlayerInput({
  id,
  index,
  value,
  selected,
  onChange,
  onSelect,
  placeholder,
  ariaLabel,
  className,
  emptyText = 'Nema na spisku. Biće sačuvan kako je upisan.',
  // Ko je već izabrao igrača u ovom kolu (id igrača → ime), da se ne bira dvaput.
  takenBy = () => null,
  // Igrač koji nije u ponudi Maxbeta: siv je i ne može se izabrati.
  unavailable = () => false,
  // Forma uz prijedlog (granica, tip, šansa); null kad je nema za tog igrača.
  extra = null,
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const results = index && open && !selected ? searchPlayers(index, value) : []
  const showList = open && !selected && value.trim().length >= 2
  const choosable = (player) => !unavailable(player.id)

  // Sljedeći red koji se može izabrati, od reda "from" u smjeru "dir"; -1 ako ga nema.
  function nextChoosable(from, dir) {
    const n = results.length
    for (let i = 0; i < n; i++) {
      const k = (((from + dir * i) % n) + n) % n
      if (choosable(results[k])) return k
    }
    return -1
  }
  const active = results.length ? nextChoosable(Math.min(highlight, results.length - 1), 1) : -1

  function choose(player) {
    if (!choosable(player)) return
    onChange(player.name)
    onSelect(player)
    setOpen(false)
  }

  function handleKeyDown(event) {
    if (!showList || active < 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight(nextChoosable(active + 1, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight(nextChoosable(active - 1, -1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative min-w-0">
      <input
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          onSelect(null)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        maxLength={40}
        placeholder={placeholder}
        autoComplete="off"
        className={`${className} ${selected ? 'pr-24' : ''}`}
      />
      {selected && (
        <span className="pointer-events-none absolute top-1/2 right-2.5 max-w-22 -translate-y-1/2 truncate rounded bg-neon/10 px-1.5 py-0.5 text-[11px] font-semibold text-neon">
          ✓ {selected.club ?? 'sa spiska'}
        </span>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-[10px] bg-surface-2 py-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/12"
        >
          {results.length ? (
            results.map((player, index) => {
              const off = !choosable(player)
              const taken = takenBy(player.id)
              return (
                <li
                  key={player.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={off || undefined}
                  title={off ? 'Maxbet nema granicu za njega u ovom kolu' : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(player)
                  }}
                  onMouseEnter={() => !off && setHighlight(index)}
                  className={`flex ${extra ? 'items-center' : 'items-baseline'} justify-between gap-3 px-3 py-2 text-sm ${
                    off ? 'cursor-not-allowed' : 'cursor-pointer'
                  } ${index === active ? 'bg-white/6' : ''}`}
                >
                  {extra ? (
                    // Sa Formom: ime i klub lijevo, granica / tip / šansa desno.
                    <span className="min-w-0">
                      <span className={`block truncate ${off ? 'font-medium text-zinc-500' : taken ? 'font-semibold text-zinc-500' : 'font-semibold text-white'}`}>
                        {player.name}
                      </span>
                      <small className={`block text-xs ${player.active ? 'text-zinc-500' : 'text-zinc-600'}`}>
                        {player.club ?? ''}
                        {player.active ? '' : ' · ranije'}
                      </small>
                    </span>
                  ) : (
                    <span className={`truncate ${off ? 'font-medium text-zinc-500' : taken ? 'font-semibold text-zinc-500' : 'font-semibold text-white'}`}>
                      {player.name}
                    </span>
                  )}
                  {off ? (
                    <span className="shrink-0 text-xs text-zinc-500 italic">nije u ponudi Maxbeta</span>
                  ) : taken ? (
                    <span className="shrink-0 text-xs font-semibold text-accent">već izabran · {taken}</span>
                  ) : extra?.(player) ? (
                    <span className="shrink-0">{extra(player)}</span>
                  ) : (
                    <span className={`shrink-0 text-xs ${player.active ? 'text-zinc-500' : 'text-zinc-600'}`}>
                      {extra ? '' : (player.club ?? '')}
                      {player.active || extra ? '' : ' · ranije'}
                    </span>
                  )}
                </li>
              )
            })
          ) : (
            <li className="px-3 py-2 text-[13px] text-zinc-500">
              {emptyText}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

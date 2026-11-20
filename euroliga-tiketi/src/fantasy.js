// Zajedničko za stranicu Fantasy: pozicije, brojevi, imena i datumi.

const DAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']

export const NEED = { G: 3, F: 3, C: 2 }
export const POSITIONS = ['G', 'F', 'C']
export const POS_NAMES = { G: 'bek', F: 'krilo', C: 'centar' }

export const POS_TONE = {
  G: 'bg-accent/12 text-accent',
  F: 'bg-neon/10 text-neon',
  C: 'bg-sky/12 text-sky',
}

export const POS_EDGE = {
  G: 'shadow-[inset_2px_0_0_var(--color-accent),inset_0_0_0_1px_rgba(255,255,255,0.07)]',
  F: 'shadow-[inset_2px_0_0_var(--color-neon),inset_0_0_0_1px_rgba(255,255,255,0.07)]',
  C: 'shadow-[inset_2px_0_0_var(--color-sky),inset_0_0_0_1px_rgba(255,255,255,0.07)]',
}

export const cardClass =
  'min-w-0 rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)]'
export const labelClass = 'font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400'
export const buttonClass =
  'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100'
export const ghostButtonClass =
  'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium text-zinc-300 ring-1 ring-white/16 ring-inset transition hover:text-white disabled:cursor-default disabled:opacity-40'

// 168.5 → "168,5"; 109 → "109"
export function points(value) {
  if (value === null || value === undefined) return '–'
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',')
}

// Množilac: 1.5 → "1,5"
export function mult(value) {
  return String(value).replace('.', ',')
}

// "Kevin Punter" → "Punter"; "Wade Baldwin IV" → "Baldwin IV"
export function lastName(name) {
  const parts = name.split(' ')
  return parts.length > 1 ? parts.slice(1).join(' ') : name
}

// Kratko ime drugara: "Marko", a kad ima dvojica sa istim imenom "Milan K." i "Milan S.".
export function friendShortName(friend, friends) {
  if (!friend) return ''
  const [first, last = ''] = friend.name.split(' ')
  const same = friends.filter((f) => f.name.split(' ')[0] === first)
  return same.length > 1 && last ? `${first} ${last[0]}.` : first
}

// "2026-10-21T17:30" → "sri 21. 10. u 17:30"
export function dayTime(value) {
  if (!value) return ''
  const [date, time] = value.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  return `${DAYS[day]} ${d}. ${m}. u ${time.slice(0, 5)}`
}

// Igrači po id-u.
export function byId(players) {
  return new Map(players.map((p) => [p.id, p]))
}

// Koliko igrača svake pozicije još fali ekipi.
export function needLeft(roster, players) {
  const left = { ...NEED }
  for (const entry of roster) {
    const pos = players.get(entry.playerId)?.pos
    if (pos) left[pos]--
  }
  return left
}

export function sortByPosition(list, players) {
  return [...list].sort((a, b) => {
    const pa = players.get(a.playerId ?? a)
    const pb = players.get(b.playerId ?? b)
    return POSITIONS.indexOf(pa?.pos) - POSITIONS.indexOf(pb?.pos) || (pb?.avg ?? 0) - (pa?.avg ?? 0)
  })
}

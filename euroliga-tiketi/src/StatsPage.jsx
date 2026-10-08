import { useEffect, useState } from 'react'
import { api } from './api.js'
import AppHeader from './AppHeader.jsx'
import RoundWinners from './RoundWinners.jsx'
import { useSessionGuard } from './session.js'

const SORTS = [
  { id: 'count', label: 'Najčešće biran' },
  { id: 'best', label: 'Najbolji %' },
  { id: 'worst', label: 'Najgori %' },
]
// "Pouzdani" i "Ne donose sreću" traže bar ovoliko izbora.
const MIN_PICKS = 2

const pct = (hits, count) => (count ? Math.round((hits / count) * 100) : 0)
const pctTone = (value) => (value >= 70 ? 'text-neon' : value >= 40 ? 'text-accent' : 'text-rose-400')
const CELL_TONES = {
  hit: 'bg-neon/10 text-neon ring-neon/32',
  part: 'bg-accent/12 text-accent ring-accent/35',
  miss: 'bg-rose-500/10 text-rose-400 ring-rose-500/35',
}
const cellTone = (hits, count) => (hits === count ? 'hit' : hits === 0 ? 'miss' : 'part')
const playersWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'igrač' : 'igrača')

const labelClass = 'font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400'
const cardClass =
  'min-w-0 overflow-hidden rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)] before:block before:h-px before:bg-linear-to-r before:from-transparent before:via-accent/70 before:to-transparent before:content-[""]'

function group(picks, keyOf) {
  const groups = new Map()
  for (const pick of picks) {
    const key = keyOf(pick)
    const entry = groups.get(key) ?? { key, picks: [], hits: 0 }
    entry.picks.push(pick)
    entry.hits += pick.hit ? 1 : 0
    groups.set(key, entry)
  }
  return [...groups.values()]
}

const ratio = (g) => g.hits / g.picks.length
const roundsLabel = (rounds) => {
  if (!rounds.length) return 'još nema ocijenjenih kola'
  const min = Math.min(...rounds)
  const max = Math.max(...rounds)
  return min === max ? `kolo ${min}` : `kola ${min}–${max}`
}

export default function StatsPage() {
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState(null)
  const [load, setLoad] = useState({ status: 'loading', error: '' })
  const [friendFilter, setFriendFilter] = useState('all')
  const [sort, setSort] = useState('count')
  const [expanded, setExpanded] = useState(null)

  useSessionGuard()

  useEffect(() => {
    let ignore = false
    Promise.all([api('/me'), api('/stats')]).then(
      ([me, data]) => {
        if (ignore) return
        setUser(me.user)
        setStats(data)
        setLoad({ status: 'ready', error: '' })
      },
      (loadError) => !ignore && loadError.status !== 401 && setLoad({ status: 'error', error: loadError.message }),
    )
    return () => {
      ignore = true
    }
  }, [])

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-130 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(255,106,19,0.16),transparent)]"
      />
      <main className="relative mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <AppHeader user={user} active="statistika" />

        {load.status === 'loading' && <p className="py-16 text-center text-sm text-zinc-500">Učitavanje statistike…</p>}
        {load.status === 'error' && (
          <p role="alert" className="rounded-xl px-5 py-10 text-center text-sm text-rose-400 ring-1 ring-line ring-inset">
            {load.error}
          </p>
        )}
        {load.status === 'ready' && (
          <StatsContent
            stats={stats}
            me={user.friendId}
            friendFilter={friendFilter}
            onFriendFilter={(id) => {
              setFriendFilter(id)
              setExpanded(null)
            }}
            sort={sort}
            onSort={setSort}
            expanded={expanded}
            onToggle={(key) => setExpanded((current) => (current === key ? null : key))}
          />
        )}
        {load.status === 'ready' && <RoundWinners winners={stats.winners ?? []} friends={stats.friends} me={user.friendId} />}
      </main>
    </div>
  )
}

function StatsContent({ stats, me, friendFilter, onFriendFilter, sort, onSort, expanded, onToggle }) {
  const friendShort = new Map(stats.friends.map((f) => [f.id, f.short]))
  const picks = friendFilter === 'all' ? stats.picks : stats.picks.filter((p) => p.friendId === friendFilter)
  const players = group(picks, (p) => p.playerKey).map((g) => ({ ...g, name: g.picks[0].player, club: g.picks[0].club }))
  const hits = picks.filter((p) => p.hit).length
  const season = Number(stats.season.slice(1))
  const allRounds = [...new Set(stats.picks.map((p) => p.round))]

  const maxCount = players.length ? Math.max(...players.map((p) => p.picks.length)) : 0
  const mostPicked = players.filter((p) => p.picks.length === maxCount).map((p) => p.name)
  const repeated = players.filter((p) => p.picks.length >= MIN_PICKS)
  const mostReliable = [...repeated].sort((a, b) => ratio(b) - ratio(a) || b.picks.length - a.picks.length)[0]

  const sorted = [...players].sort((a, b) => {
    if (sort === 'best') return ratio(b) - ratio(a) || b.picks.length - a.picks.length || a.name.localeCompare(b.name)
    if (sort === 'worst') return ratio(a) - ratio(b) || b.picks.length - a.picks.length || a.name.localeCompare(b.name)
    return b.picks.length - a.picks.length || ratio(b) - ratio(a) || a.name.localeCompare(b.name)
  })
  const reliable = repeated
    .filter((p) => ratio(p) >= 0.5)
    .sort((a, b) => ratio(b) - ratio(a) || b.picks.length - a.picks.length)
    .slice(0, 4)
  const unlucky = repeated
    .filter((p) => ratio(p) < 0.5)
    .sort((a, b) => ratio(a) - ratio(b) || b.picks.length - a.picks.length)
    .slice(0, 4)
  const clubs = group(picks, (p) => p.club ?? 'Nepoznat klub')
    .sort((a, b) => b.picks.length - a.picks.length || b.hits - a.hits)
    .slice(0, 6)

  // Prvo "Cijela ekipa", pa ti, pa ostali.
  const chips = [
    { id: 'all', short: 'Cijela ekipa' },
    ...stats.friends.filter((f) => f.id === me),
    ...stats.friends.filter((f) => f.id !== me),
  ]
  const filterName = friendFilter === 'all' ? 'svi tiketi' : friendShort.get(friendFilter)

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent">
          Euroliga {season}/{String(season + 1).slice(2)} · {roundsLabel(allRounds)}
        </span>
        <h2 className="font-display text-[clamp(38px,5.5vw,56px)] font-extrabold uppercase leading-[0.95] text-balance text-white">
          Statistika igrača
        </h2>
        <p className="max-w-184 text-zinc-400">
          Svaki igrač kojeg smo stavili na tiket, koliko puta je biran i koliko puta je prošao. Broje se samo ocijenjena kola.
        </p>
      </div>

      <section aria-label="Ukupno" className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
        <Kpi label="Izbora" value={picks.length} sub={`${filterName}, ${roundsLabel(allRounds)}`} />
        <Kpi label="Različitih igrača" value={players.length} sub="sa spiska Eurolige" />
        <Kpi label="Prošlo" value={`${hits}/${picks.length}`} sub={`${pct(hits, picks.length)}% uspješnost`} />
        <Kpi
          label="Najčešće biran"
          value={mostPicked.length ? mostPicked.slice(0, 2).join(' i ') : '—'}
          sub={maxCount ? `${maxCount}×${mostReliable ? ` · najpouzdaniji: ${mostReliable.name}` : ''}` : 'još nema igrača'}
          highlight
          isName
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Čiji igrači">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={friendFilter === chip.id}
              onClick={() => onFriendFilter(chip.id)}
              className={`inline-flex h-8.5 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold ring-1 ring-inset transition ${
                friendFilter === chip.id
                  ? 'bg-accent/12 text-accent ring-accent/35'
                  : 'bg-surface text-zinc-400 ring-line hover:text-white'
              }`}
            >
              {chip.short}
              {chip.id === me && (
                <span className="rounded bg-accent px-1.25 py-px font-display text-[10px] font-bold uppercase tracking-[0.12em] text-ink">
                  Ti
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-[9px] bg-surface p-0.75 ring-1 ring-line ring-inset" role="group" aria-label="Poredak">
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={sort === option.id}
              onClick={() => onSort(option.id)}
              className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition ${
                sort === option.id ? 'bg-surface-hover text-white ring-1 ring-white/16 ring-inset' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 min-[960px]:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <section aria-labelledby="players-title" className={cardClass}>
          <CardHead id="players-title" title="Igrači" note={`${players.length} ${playersWord(players.length)}`} />
          <div
            aria-hidden="true"
            className="grid grid-cols-[28px_minmax(0,1fr)_56px_120px] items-center gap-3 border-y border-line bg-surface-2 px-4.5 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600 max-[560px]:grid-cols-[22px_minmax(0,1fr)_96px]"
          >
            <span>#</span>
            <span>Igrač</span>
            <span className="text-right max-[560px]:hidden">Biran</span>
            <span className="text-right">Prošao</span>
          </div>
          {sorted.length ? (
            sorted.map((player, index) => (
              <PlayerRow
                key={player.key}
                rank={index + 1}
                player={player}
                me={me}
                friendShort={friendShort}
                open={expanded === player.key}
                onToggle={() => onToggle(player.key)}
              />
            ))
          ) : (
            <p className="px-4.5 py-6.5 text-sm text-zinc-600">Nema ocijenjenih igrača.</p>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="reliable-title" className={cardClass}>
            <CardHead id="reliable-title" title="Pouzdani" note={`biran bar ${MIN_PICKS} puta`} />
            <MiniList items={reliable} empty="Još nema igrača biranog bar dva puta." />
          </section>
          <section aria-labelledby="unlucky-title" className={cardClass}>
            <CardHead id="unlucky-title" title="Ne donose sreću" note={`biran bar ${MIN_PICKS} puta`} />
            <MiniList items={unlucky} empty="Još nema igrača biranog bar dva puta." />
          </section>
          <section aria-labelledby="clubs-title" className={cardClass}>
            <CardHead id="clubs-title" title="Po klubu" note="najčešći" />
            {clubs.map((club) => (
              <MiniRow
                key={club.key}
                title={club.key}
                sub={[...new Set(club.picks.map((p) => p.player))].join(', ')}
                hits={club.hits}
                count={club.picks.length}
              />
            ))}
            <p className="border-t border-line px-4.5 pt-2.5 pb-3.5 text-[12.5px] text-zinc-600">
              Klub je trenutni, sa spiska Eurolige.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}

function Kpi({ label, value, sub, highlight = false, isName = false }) {
  return (
    <div
      className={`min-w-0 rounded-xl p-4 shadow-[0_14px_30px_-18px_rgba(0,0,0,0.8)] ring-1 ring-inset ${
        highlight ? 'bg-neon/10 ring-neon/32' : 'bg-surface ring-line'
      }`}
    >
      <span className={labelClass}>{label}</span>
      <strong
        className={`mt-1 block font-display font-extrabold leading-none tabular-nums wrap-anywhere ${
          isName ? 'text-[22px] leading-[1.1]' : 'text-[32px]'
        } ${highlight ? 'text-neon' : 'text-white'}`}
      >
        {value}
      </strong>
      <small className="mt-1 block text-[13px] text-zinc-400">{sub}</small>
    </div>
  )
}

function CardHead({ id, title, note }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4.5 pt-4 pb-3">
      <h3 id={id} className="font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white">
        {title}
      </h3>
      <span className="text-[13px] text-zinc-400">{note}</span>
    </div>
  )
}

function PlayerRow({ rank, player, me, friendShort, open, onToggle }) {
  const byFriend = group(player.picks, (p) => p.friendId)
  const percent = pct(player.hits, player.picks.length)
  const rounds = [...new Set(player.picks.map((p) => p.round))].sort((a, b) => a - b)
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[28px_minmax(0,1fr)_56px_120px] items-center gap-3 px-4.5 py-3 text-left transition hover:bg-white/2.5 max-[560px]:grid-cols-[22px_minmax(0,1fr)_96px]"
      >
        <span className="font-display text-base font-bold tabular-nums text-zinc-600">{rank}</span>
        <span className="min-w-0">
          <b className="block font-semibold wrap-anywhere text-white">{player.name}</b>
          <small className="text-[12.5px] text-zinc-400">
            {player.club ? `${player.club} · ` : ''}
            {rounds.length === 1 ? 'kolo' : 'kola'} {rounds.join(', ')}
          </small>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {byFriend.map((f) => (
              <span
                key={f.key}
                className={`rounded-full bg-white/5 px-1.75 py-px text-[11.5px] font-semibold tabular-nums ring-1 ring-inset ${
                  f.key === me ? 'text-accent ring-accent/35' : 'text-zinc-300 ring-line'
                }`}
              >
                {friendShort.get(f.key)} {f.hits}/{f.picks.length}
              </span>
            ))}
          </span>
        </span>
        <span className="text-right font-display text-xl font-bold tabular-nums text-white max-[560px]:hidden">
          {player.picks.length}
          <small className="-mt-0.5 block font-sans text-[11px] font-medium text-zinc-600">puta</small>
        </span>
        <span className="flex flex-col items-end gap-1.25">
          <span className="flex items-baseline gap-2">
            <b className="font-display text-lg font-bold tabular-nums text-white">
              {player.hits}
              <span className="text-zinc-600">/{player.picks.length}</span>
            </b>
            <span className={`font-display text-sm font-bold tabular-nums ${pctTone(percent)}`}>{percent}%</span>
          </span>
          <span className="h-1 w-full overflow-hidden rounded bg-white/6">
            <i
              className="block h-full rounded bg-neon shadow-[0_0_8px_rgba(184,255,60,0.5)]"
              style={{ width: `${percent}%` }}
            />
          </span>
        </span>
      </button>

      {open && (
        <ul className="mx-4.5 mb-3 ml-14.5 flex flex-col gap-1 max-[560px]:ml-13" aria-label={`Istorija: ${player.name}`}>
          {[...player.picks]
            .sort((a, b) => a.round - b.round)
            .map((pick, index) => (
              <li key={index} className="flex items-center gap-3 rounded-lg bg-ink px-3 py-1.5 text-[13px] ring-1 ring-line ring-inset">
                <span className="w-14 font-display text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
                  Kolo {pick.round}
                </span>
                <span className={`flex-1 font-semibold ${pick.friendId === me ? 'text-accent' : 'text-zinc-200'}`}>
                  {friendShort.get(pick.friendId)}
                </span>
                <span
                  className={`inline-grid size-6 place-items-center rounded-md font-display text-sm font-extrabold ${
                    pick.hit ? 'bg-neon/10 text-neon' : 'bg-rose-500/10 text-rose-400'
                  }`}
                  aria-label={pick.hit ? 'Prošao' : 'Nije prošao'}
                >
                  {pick.hit ? '✓' : '✗'}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

function MiniList({ items, empty }) {
  if (!items.length) return <p className="border-t border-line px-4.5 py-5 text-sm text-zinc-600">{empty}</p>
  return items.map((player) => (
    <MiniRow key={player.key} title={player.name} sub={player.club ?? ''} hits={player.hits} count={player.picks.length} />
  ))
}

function MiniRow({ title, sub, hits, count }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4.5 py-2.5">
      <div className="min-w-0">
        <b className="block font-semibold wrap-anywhere text-white">{title}</b>
        <small className="block text-[12.5px] text-zinc-400">{sub}</small>
      </div>
      <span
        className={`min-w-12.5 rounded-lg px-2.25 py-0.75 text-center font-display text-[17px] font-bold tabular-nums ring-1 ring-inset ${CELL_TONES[cellTone(hits, count)]}`}
      >
        {hits}/{count}
      </span>
    </div>
  )
}

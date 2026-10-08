import { TrophyIcon } from './icons.jsx'
import { km } from './money.js'

const DAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']
const FORM_ROUNDS = 5
const RESULT = /^(\d+)\/(\d+)$/

function parse(value) {
  const match = RESULT.exec(value ?? '')
  return match ? { hits: Number(match[1]), played: Number(match[2]) } : null
}

function tone({ hits, played }) {
  if (hits === played) return 'bg-neon/10 text-neon ring-neon/30'
  if (hits === 0) return 'bg-rose-500/10 text-rose-400 ring-rose-500/35'
  return 'bg-accent/12 text-accent ring-accent/35'
}

// "2026-10-08T17:30" → "čet u 17:30"
function deadlineText(value) {
  const date = new Date(value)
  return `${DAYS[date.getDay()]} u ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}


// Rezultat u kolu, sa peharom ako je osvojio kolo.
export function ResultCell({ result, won = false, className = '' }) {
  return (
    <span
      className={`relative inline-grid min-w-12 place-items-center rounded-lg px-2 py-0.75 font-display text-[17px] font-bold tabular-nums ring-1 ring-inset ${
        result ? tone(result) : 'text-zinc-600 ring-line'
      } ${className}`}
    >
      {result ? `${result.hits}/${result.played}` : '–'}
      {won && <WinMark />}
    </span>
  )
}

export function WinMark() {
  return (
    <span
      title="Pobjednik kola"
      className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-gold text-ink ring-2 ring-surface"
    >
      <TrophyIcon className="size-2.5" />
    </span>
  )
}

// Na vrhu Tabele: mjesto, uspješnost, pobjede kola, kasa, forma i tekuće kolo, za prijavljenog.
export default function MyOverview({ friends, rounds, results, winners, me }) {
  if (!me) return null
  const friend = friends.find((f) => f.id === me.friendId)
  if (!friend) return null

  const totals = friends.map((f) => {
    let hits = 0
    let played = 0
    for (const round of rounds) {
      const result = parse(results[f.id]?.[round.id])
      if (result) {
        hits += result.hits
        played += result.played
      }
    }
    return { id: f.id, hits, played, pct: played ? hits / played : null }
  })
  const ranked = totals.filter((t) => t.played).sort((a, b) => b.pct - a.pct || b.hits - a.hits)
  const mine = totals.find((t) => t.id === me.friendId)
  // Isti procenat i broj pogođenih dijele mjesto.
  const rankIndex = ranked.findIndex((t) => t.pct === mine.pct && t.hits === mine.hits)
  const rank = mine.played ? rankIndex + 1 : null

  const wonRound = (roundId) => winners[roundId]?.friendIds.includes(me.friendId) ?? false
  const wins = rounds.filter((round) => wonRound(round.id)).length
  const form = [...rounds].sort((a, b) => a.number - b.number).slice(-FORM_ROUNDS)
  const cash = me.cash ?? 0

  const stats = [
    {
      label: 'uspješnost',
      value: mine.played ? `${Math.round(mine.pct * 100)}%` : '—',
      tone: mine.pct >= 0.6 ? 'text-neon' : 'text-white',
    },
    { label: 'pogođeno', value: `${mine.hits}/${mine.played}`, tone: 'text-white' },
    { label: wins === 1 ? 'osvojeno kolo' : 'osvojenih kola', value: wins, tone: wins ? 'text-gold' : 'text-white' },
    {
      label: cash < -0.005 ? 'duguješ kasi' : cash > 0.005 ? 'kasa ti duguje' : 'kasa izmirena',
      value: `${cash < -0.005 ? '−' : ''}${km(Math.abs(cash))}`,
      tone: cash < -0.005 ? 'text-rose-400' : cash > 0.005 ? 'text-neon' : 'text-white',
      href: '/kasa',
    },
  ]

  return (
    <section
      aria-label="Tvoj pregled"
      className="grid grid-cols-1 gap-x-5.5 gap-y-4 rounded-[14px] bg-[linear-gradient(135deg,rgba(255,106,19,0.1),transparent_55%)] bg-surface p-4.5 shadow-[inset_0_0_0_1px_rgba(255,106,19,0.35),0_30px_60px_-30px_rgba(0,0,0,0.8)] min-[880px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[880px]:items-center"
    >
      <div className="flex items-center gap-3.5">
        <div className="grid size-18.5 shrink-0 place-items-center rounded-2xl bg-accent text-ink shadow-[0_14px_30px_-12px_rgba(255,106,19,0.7)]">
          <div className="text-center leading-none">
            <b className="block font-display text-[40px] font-extrabold leading-[0.9]">{rank ? `${rank}.` : '–'}</b>
            <small className="font-display text-[10px] font-bold uppercase tracking-[0.16em]">mjesto</small>
          </div>
        </div>
        <div className="min-w-0">
          <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent">Tvoj pregled</span>
          <h2 className="font-display text-[26px] font-extrabold uppercase leading-none text-white">{friend.name}</h2>
          <p className="mt-0.75 text-[13.5px] text-zinc-400">od {friends.length} drugara u tabeli</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[11px] bg-line sm:grid-cols-4">
          {stats.map((stat) => {
            const content = (
              <>
                <b className={`block font-display text-[26px] font-extrabold leading-none tabular-nums ${stat.tone}`}>{stat.value}</b>
                <small className="text-xs text-zinc-400">{stat.label}</small>
              </>
            )
            return stat.href ? (
              <a key={stat.label} href={stat.href} className="min-w-0 bg-ink px-3 py-2.5 transition hover:bg-surface-2">
                {content}
              </a>
            ) : (
              <div key={stat.label} className="min-w-0 bg-ink px-3 py-2.5">
                {content}
              </div>
            )
          })}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Forma po kolima</span>
          <div className="flex flex-wrap gap-1.5">
            {form.map((round) => (
              <div key={round.id} className="flex flex-col items-center gap-0.75">
                <ResultCell result={parse(results[me.friendId]?.[round.id])} won={wonRound(round.id)} />
                <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                  kolo {round.number}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {me.round && (
        <div className="flex min-w-50 flex-col gap-1 rounded-[11px] bg-ink px-3 py-2.5 text-[13.5px] ring-1 ring-line ring-inset">
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Kolo {me.round.number}</span>
          <b className={`font-semibold ${me.round.picks ? 'text-white' : 'text-accent'}`}>
            {me.round.picks
              ? `Predao · ${me.round.picks} ${me.round.picks % 10 === 1 && me.round.picks % 100 !== 11 ? 'igrač' : 'igrača'}`
              : 'Još nisi predao'}
          </b>
          {me.round.deadline && <span className="text-zinc-400">rok {deadlineText(me.round.deadline)}</span>}
          <a href="#round-title" className="text-[13px] font-semibold text-accent underline-offset-4 hover:underline">
            Na tiket →
          </a>
        </div>
      )}
    </section>
  )
}


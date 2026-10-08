import { ResultCell } from './MyOverview.jsx'

const cardClass =
  'min-w-0 rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)]'

// Statistika: ko je osvojio koje kolo i ko ima najviše pobjeda.
export default function RoundWinners({ winners, friends, me }) {
  if (!winners.length) return null
  const name = (id) => friends.find((friend) => friend.id === id)?.name ?? ''
  const counts = new Map()
  for (const winner of winners) {
    for (const id of winner.friendIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const most = [...counts.entries()].sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0])))
  const max = most[0]?.[1] ?? 1

  return (
    <section aria-labelledby="winners-title" className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent">Takmičenje između kola</span>
        <h2 id="winners-title" className="font-display text-3xl font-extrabold uppercase leading-none text-white">
          Pobjednici kola
        </h2>
        <p className="text-sm text-zinc-400">
          Najbolji tiket kola: veći procenat, pa više pogođenih, pa više poena igrača sa tiketa. Ako je i to isto, kolo se dijeli.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div className={cardClass}>
          <h3 className="border-b border-line px-4 py-3 font-display text-lg font-bold uppercase tracking-[0.03em] text-white">Po kolima</h3>
          {[...winners].reverse().map((winner) => (
            <div key={winner.round} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0">
              <span className="w-14 shrink-0 font-display text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
                Kolo {winner.round}
              </span>
              <b className="min-w-0 flex-1 font-semibold text-white">
                {winner.friendIds.map((id) => (
                  <span key={id} className={`mr-1.5 inline-block ${id === me ? 'text-accent' : ''}`}>
                    {name(id)}
                    {id === me ? ' (ti)' : ''}
                  </span>
                ))}
              </b>
              <small className="shrink-0 text-[12.5px] text-zinc-400">{winner.points} poena</small>
              <ResultCell result={{ hits: winner.hits, played: winner.played }} won />
            </div>
          ))}
        </div>
        <div className={cardClass}>
          <h3 className="border-b border-line px-4 py-3 font-display text-lg font-bold uppercase tracking-[0.03em] text-white">
            Najviše pobjeda
          </h3>
          {most.map(([id, count]) => (
            <div key={id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm">
              <b className={`w-36 shrink-0 truncate font-semibold ${id === me ? 'text-accent' : 'text-white'}`}>{name(id)}</b>
              <span className="h-2 flex-1 overflow-hidden rounded-md bg-white/6">
                <i className="block h-full rounded-md bg-gold" style={{ width: `${(count / max) * 100}%` }} />
              </span>
              <span className="w-6 text-right font-display text-lg font-extrabold text-gold">{count}</span>
            </div>
          ))}
          {counts.size < friends.length && <p className="px-4 py-2.5 text-[12.5px] text-zinc-500">Ostali još nisu osvojili kolo.</p>}
        </div>
      </div>
    </section>
  )
}

import { useState } from 'react'
import Dropdown from './Dropdown.jsx'
import { EmptyState, PosChip } from './FantasyTeam.jsx'
import { buttonClass, cardClass, dayTime, ghostButtonClass, labelClass, lastName, points, POSITIONS } from './fantasy.js'

// Stavka padajuće liste za igrača: pozicija, ime, klub i prosjek PIR-a.
const playerOption = (p) => ({
  value: p.id,
  label: p.name,
  sub: `${p.club ?? p.clubCode ?? '—'} · prosjek ${points(p.avg)}`,
  lead: <PosChip pos={p.pos} />,
})
const NO_WISH = { value: null, label: 'ne treba', muted: true }

function Avatar({ name }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-linear-to-br from-zinc-700 to-zinc-800 font-display text-xs font-bold text-white ring-1 ring-white/10 ring-inset">
      {initials}
    </span>
  )
}

// Izmjene (pusti jednog, uzmi slobodnog), red prednosti i razmjene sa drugarima.
export default function FantasyMoves({ ctx, act, busy }) {
  const { data, players, me, short } = ctx
  const [drop, setDrop] = useState(null)
  const [wishes, setWishes] = useState([null, null, null])

  if (data.draft.status !== 'done') {
    return <EmptyState title="Izmjene počinju posle drafta">Kad svako ima ekipu, posle svakog kola možeš pustiti jednog igrača i uzeti slobodnog.</EmptyState>
  }
  if (me === null) {
    return <EmptyState title="Nalog nije vezan za drugara">Izmjene radi svaki drugar za svoju ekipu.</EmptyState>
  }
  const next = data.next
  if (!next) {
    return <EmptyState title="Sezona je završena">Izmjena više nema.</EmptyState>
  }

  const roster = (data.rosters[me] ?? [])
    .map((entry) => players.get(entry.playerId))
    .filter(Boolean)
    .sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || a.avg - b.avg)
  const dropPlayer = roster.find((p) => p.id === drop) ?? roster[0]
  const free = data.players.filter((p) => p.owner === null && p.pos === dropPlayer?.pos)
  const processed = next.processed
  const wishList = (processed ? [wishes[0]] : wishes).map((id, index) => (free.some((p) => p.id === id) ? id : index === 0 ? free[0]?.id ?? null : null))
  const mine = data.transfers.mine
  const pending = mine.find((t) => t.status === 'pending' && t.round === next.round)
  const used = data.transfers.usedThisRound
  const myPlace = data.priority.indexOf(me) + 1

  function submit() {
    const chosen = wishList.filter((id) => id !== null)
    if (!dropPlayer || !chosen.length) return
    act('/fantasy/transfers', {
      body: { drop: dropPlayer.id, wishes: chosen },
      done: processed ? `${lastName(players.get(chosen[0]).name)} je tvoj.` : 'Zahtjev poslat. Javiće ti se kad se obradi.',
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2.5">
        <div>
          <h3 className="font-display text-[26px] font-extrabold uppercase leading-none text-white">Izmjene za kolo {next.round}</h3>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            {processed
              ? `Zahtjevi su obrađeni. Slobodnog igrača sada uzimaš odmah, „ko prvi“, do roka: ${dayTime(next.deadline)}.`
              : `Jedna izmjena po kolu. Zahtjevi se primaju do ${dayTime(next.processAt)}, onda se obrade po redu prednosti. Posle toga slobodni igrači idu „ko prvi“ do roka.`}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${used ? 'bg-accent/12 text-accent' : 'bg-neon/10 text-neon'}`}>
          {pending ? 'zahtjev poslat' : used ? 'izmjena iskorištena' : '1 izmjena slobodna'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className={`${cardClass} flex flex-col gap-3 p-4`}>
          <h4 className="font-display text-lg font-bold uppercase tracking-[0.03em] text-white">Pusti jednog, uzmi slobodnog</h4>
          <div className="flex flex-col gap-1.5">
            <span className={labelClass}>Puštaš</span>
            <Dropdown ariaLabel="Puštaš" options={roster.map(playerOption)} value={dropPlayer?.id ?? null} onChange={setDrop} disabled={used} />
          </div>
          <span className={labelClass}>{processed ? 'Uzimaš odmah' : 'Uzimaš (redom želja: ako neko uzme prvog, ide drugi)'}</span>
          {wishList.map((id, index) => (
            <div key={index} className="grid grid-cols-[26px_minmax(0,1fr)] items-center gap-2">
              <i className="grid size-5.5 place-items-center rounded-full bg-surface-hover font-display text-[13px] font-extrabold not-italic text-zinc-400">{index + 1}</i>
              <Dropdown
                ariaLabel={`Želja ${index + 1}`}
                options={index > 0 ? [NO_WISH, ...free.map(playerOption)] : free.map(playerOption)}
                value={id}
                disabled={used}
                onChange={(value) => {
                  const nextWishes = [...wishes]
                  nextWishes[index] = value
                  setWishes(nextWishes)
                }}
              />
            </div>
          ))}
          <div>
            <button type="button" disabled={busy || used || !free.length} onClick={submit} className={buttonClass}>
              {processed ? 'Uzmi odmah' : 'Pošalji zahtjev'}
            </button>
          </div>
          {mine.length > 0 && (
            <div className="flex flex-col gap-2">
              {mine.slice(0, 5).map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-[10px] bg-ink px-3 py-2.5 text-sm ring-1 ring-line ring-inset">
                  <span className="text-xs text-zinc-500">K{t.round}</span>
                  <span className="text-rose-400 line-through decoration-rose-400/50">{players.get(t.drop)?.name}</span>
                  <span className="text-zinc-600">→</span>
                  {t.status === 'done' ? (
                    <span className="font-semibold text-neon">{players.get(t.got)?.name}</span>
                  ) : (
                    t.wishes.map((id, index) => (
                      <span key={id} className={t.status === 'failed' ? 'text-zinc-400' : 'font-semibold text-neon'}>
                        {index > 0 && <span className="font-normal text-zinc-600">ili </span>}
                        {players.get(id)?.name}
                      </span>
                    ))
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {t.status === 'pending' && (
                      <>
                        <span className="rounded-full bg-accent/12 px-2.5 py-0.5 text-[13px] font-semibold text-accent">čeka obradu · {myPlace}. na redu</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => act(`/fantasy/transfers/${t.id}`, { method: 'DELETE', done: 'Zahtjev povučen.' })}
                          className={`${ghostButtonClass} h-7.5 px-2.5 text-[13px]`}
                        >
                          Povuci
                        </button>
                      </>
                    )}
                    {t.status === 'done' && <span className="rounded-full bg-neon/10 px-2.5 py-0.5 text-[13px] font-semibold text-neon">prošla</span>}
                    {t.status === 'failed' && <span className="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[13px] font-semibold text-rose-400">nije prošla</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <section className={`${cardClass} flex flex-col gap-3 p-4`}>
            <h4 className="font-display text-lg font-bold uppercase tracking-[0.03em] text-white">Red prednosti</h4>
            <p className="m-0 text-[13.5px] text-zinc-400">Obrnuto od tabele: posljednji prvi bira. Mijenja se posle svakog kola.</p>
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {data.priority.map((friendId, index) => {
                const total = data.standings.find((row) => row.friendId === friendId)?.total ?? 0
                return (
                  <li key={friendId} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${friendId === me ? 'bg-accent/12 text-white' : 'text-zinc-300'}`}>
                    <span className="w-4.5 font-display font-extrabold text-zinc-600">{index + 1}.</span>
                    {short(friendId)}
                    <small className="ml-auto text-zinc-400">{points(total)} bod.</small>
                  </li>
                )
              })}
            </ol>
          </section>
          {data.settings.trades && <Trades ctx={ctx} act={act} busy={busy} />}
        </div>
      </div>
    </div>
  )
}

const SWAP_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5.5 text-accent">
    <path d="M7 7h12l-3-3M17 17H5l3 3" />
  </svg>
)

function TradeCard({ trade, ctx, act, busy }) {
  const { players, me, short } = ctx
  const incoming = trade.to === me
  const mineGives = incoming ? trade.get : trade.give
  const mineGets = incoming ? trade.give : trade.get
  const other = incoming ? trade.from : trade.to
  const side = (label, id) => {
    const p = players.get(id)
    return (
      <div className="flex min-w-0 flex-col gap-0.75">
        <small className="text-[11px] font-semibold tracking-[0.16em] text-zinc-400 uppercase">{label}</small>
        <b className="font-display text-[19px] leading-[1.05] font-bold wrap-anywhere text-white uppercase">{p?.name}</b>
        <span className="text-[12.5px] text-zinc-400">
          {p?.pos} · {p?.clubCode} · {points(p?.avg ?? 0)}
        </span>
      </div>
    )
  }
  const text = {
    pending: incoming ? `${short(other)} ti nudi razmjenu, važi do roka kola.` : `Ponudio si razmjenu drugaru ${short(other)}. Čeka odgovor.`,
    accepted: incoming ? 'Prihvatio si razmjenu. Igrači su već u novim ekipama.' : `${short(other)} je prihvatio razmjenu.`,
    declined: incoming ? `Odbio si ponudu. ${short(other)} je dobio obavještenje.` : `${short(other)} je odbio ponudu.`,
    cancelled: 'Ponuda više ne važi.',
  }[trade.status]
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl bg-ink p-3.5 ring-1 ring-inset ${
        trade.status === 'accepted' ? 'ring-neon/35' : trade.status === 'pending' ? 'ring-accent/38' : 'opacity-75 ring-line'
      }`}
    >
      <p className="m-0 text-[13.5px] text-zinc-400">{text}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
        {side('Dobijaš', mineGets)}
        {SWAP_ICON}
        {side('Daješ', mineGives)}
      </div>
      {trade.status === 'pending' && (
        <div className="flex flex-wrap gap-2">
          {incoming ? (
            <>
              <button type="button" disabled={busy} onClick={() => act(`/fantasy/trades/${trade.id}`, { method: 'PUT', body: { action: 'accept' }, done: `${lastName(players.get(mineGets)?.name ?? '')} je tvoj.` })} className={buttonClass}>
                Prihvati
              </button>
              <button type="button" disabled={busy} onClick={() => act(`/fantasy/trades/${trade.id}`, { method: 'PUT', body: { action: 'decline' } })} className={ghostButtonClass}>
                Odbij
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => act(`/fantasy/trades/${trade.id}`, { method: 'PUT', body: { action: 'cancel' }, done: 'Ponuda povučena.' })} className={ghostButtonClass}>
              Povuci ponudu
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Trades({ ctx, act, busy }) {
  const { data, players, me, short } = ctx
  const others = data.friends.filter((f) => f.id !== me)
  const [friendId, setFriendId] = useState(others[0]?.id ?? null)
  const [get, setGet] = useState(null)
  const [give, setGive] = useState(null)

  const theirs = (data.rosters[friendId] ?? [])
    .map((x) => players.get(x.playerId))
    .filter(Boolean)
    .sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.avg - a.avg)
  const getPlayer = theirs.find((p) => p.id === get) ?? theirs[0]
  const mineSame = (data.rosters[me] ?? []).map((x) => players.get(x.playerId)).filter((p) => p && p.pos === getPlayer?.pos)
  const givePlayer = mineSame.find((p) => p.id === give) ?? mineSame[0]

  return (
    <section className={`${cardClass} flex flex-col gap-3 p-4`}>
      <h4 className="font-display text-lg font-bold uppercase tracking-[0.03em] text-white">Razmjena</h4>
      {data.trades.map((trade) => (
        <TradeCard key={trade.id} trade={trade} ctx={ctx} act={act} busy={busy} />
      ))}
      <div className="flex flex-col gap-2">
        <span className={labelClass}>Ponudi razmjenu</span>
        <Dropdown
          ariaLabel="Drugar"
          options={others.map((f) => ({ value: f.id, label: f.name, sub: `${(data.rosters[f.id] ?? []).length} igrača u ekipi`, lead: <Avatar name={f.name} /> }))}
          value={friendId}
          onChange={(id) => {
            setFriendId(id)
            setGet(null)
          }}
        />
        <span className={labelClass}>Tražiš</span>
        <Dropdown ariaLabel="Tražiš" options={theirs.map(playerOption)} value={getPlayer?.id ?? null} onChange={setGet} />
        <span className={labelClass}>Daješ (ista pozicija)</span>
        <Dropdown ariaLabel="Daješ" options={mineSame.map(playerOption)} value={givePlayer?.id ?? null} onChange={setGive} />
        <div>
          <button
            type="button"
            disabled={busy || !getPlayer || !givePlayer}
            onClick={() => act('/fantasy/trades', { body: { give: givePlayer.id, get: getPlayer.id }, done: `Ponuda poslata drugaru ${short(friendId)}.` })}
            className={ghostButtonClass}
          >
            Ponudi razmjenu
          </button>
        </div>
      </div>
      <p className="m-0 text-[13.5px] text-zinc-400">Razmjena je 1 za 1, ista pozicija, i ne troši izmjenu.</p>
    </section>
  )
}

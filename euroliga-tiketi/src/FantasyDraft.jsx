import { useEffect, useState } from 'react'
import { PosChip } from './FantasyTeam.jsx'
import { buttonClass, cardClass, dayTime, ghostButtonClass, lastName, NEED, needLeft, points, POS_EDGE, POSITIONS } from './fantasy.js'

const ROSTER = 8
const LIST_LIMIT = 80
const FORM_MAX = 40

// Draft: sat i ko bira, slobodni igrači, tabla svih izbora. Admin pokreće, pauzira i poništava.
export default function FantasyDraft({ ctx, act, busy }) {
  const { data, players, me, isAdmin, short } = ctx
  const { draft } = data
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const current = draft.current
  const live = draft.status === 'live'
  const picking = current?.friendId ?? null
  const myTurn = live && picking === me
  const canPick = live && (myTurn || isAdmin)
  const pickerNeed = picking === null ? null : needLeft(data.rosters[picking] ?? [], players)
  const myNeed = me === null ? null : needLeft(data.rosters[me] ?? [], players)

  const search = query.trim().toLowerCase()
  const free = data.players
    .filter((p) => p.owner === null)
    .filter((p) => filter === 'all' || p.pos === filter)
    .filter((p) => !search || p.name.toLowerCase().includes(search) || (p.club ?? '').toLowerCase().includes(search) || (p.clubCode ?? '').toLowerCase().includes(search))
    .slice(0, LIST_LIMIT)

  function take(player) {
    if (!myTurn && !window.confirm(`Izabrati ${player.name} za ${short(picking)}?`)) return
    act('/fantasy/draft/pick', { body: { playerId: player.id }, done: `${lastName(player.name)} je ${myTurn ? 'tvoj' : `kod ${short(picking)}`}.` })
  }

  function fixPosition(player) {
    const next = POSITIONS[(POSITIONS.indexOf(player.pos) + 1) % POSITIONS.length]
    if (window.confirm(`${player.name}: promijeniti poziciju iz ${player.pos} u ${next}?`)) {
      act(`/fantasy/players/${player.id}/position`, { method: 'PUT', body: { position: next }, done: `${player.name} je sada ${next}.` })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DraftStatus ctx={ctx} act={act} busy={busy} myNeed={myNeed} />

      <div className="grid grid-cols-1 gap-4 min-[980px]:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className={`${cardClass} flex flex-col gap-3 p-4`}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h4 className="font-display text-lg font-bold uppercase tracking-[0.03em] text-white">{canPick ? 'Biraj igrača' : 'Slobodni igrači'}</h4>
            <span className="rounded px-1.5 py-px text-[11px] font-semibold text-zinc-400 ring-1 ring-white/10 ring-inset">
              prosjek PIR{data.formRounds.length ? `, forma kola ${data.formRounds[0]}–${data.formRounds.at(-1)}` : ''}
            </span>
          </div>
          {canPick && !myTurn && (
            <p className="m-0 rounded-lg bg-accent/12 px-3 py-2 text-[13px] text-accent">Biraš umjesto drugara {short(picking)}.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Traži igrača ili klub"
              className="h-9 min-w-38 flex-1 rounded-lg bg-ink px-2.5 text-sm text-white ring-1 ring-white/16 ring-inset placeholder:text-zinc-600 focus:outline-none focus:ring-accent"
            />
            <div className="inline-flex rounded-[9px] bg-ink p-0.75 ring-1 ring-line ring-inset">
              {['all', ...POSITIONS].map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                  className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium ${filter === id ? 'bg-surface-hover text-white ring-1 ring-white/16 ring-inset' : 'text-zinc-400 hover:text-white'}`}
                >
                  {id === 'all' ? 'Svi' : id}
                </button>
              ))}
            </div>
          </div>
          <div className="flex max-h-130 flex-col overflow-y-auto rounded-xl ring-1 ring-line ring-inset">
            {free.length === 0 && <p className="m-0 px-3 py-3 text-sm text-zinc-400">Nema slobodnih igrača za ovu pretragu.</p>}
            {free.map((player) => {
              const allowed = canPick && (pickerNeed?.[player.pos] ?? 0) > 0
              return (
                <div
                  key={player.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line px-3 py-2.25 last:border-b-0 min-[461px]:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {isAdmin && draft.status !== 'live' ? (
                      <button type="button" title="Ispravi poziciju" onClick={() => fixPosition(player)} className="rounded-[5px] hover:ring-1 hover:ring-white/30">
                        <PosChip pos={player.pos} />
                      </button>
                    ) : (
                      <PosChip pos={player.pos} />
                    )}
                    <div className="min-w-0">
                      <b className="block truncate font-semibold text-white">{player.name}</b>
                      <span className="text-xs font-semibold tracking-[0.06em] text-zinc-400">{player.club ?? player.clubCode}</span>
                    </div>
                  </div>
                  <FormBars form={player.form} />
                  <div className="min-w-10 text-right font-display text-xl leading-none font-extrabold text-white tabular-nums">
                    {points(player.avg)}
                    <small className="mt-0.5 block font-sans text-[10px] font-semibold tracking-[0.12em] text-zinc-600 uppercase">
                      {player.games} {player.games === 1 ? 'meč' : 'meča'}
                    </small>
                  </div>
                  {canPick ? (
                    <button
                      type="button"
                      disabled={busy || !allowed}
                      title={allowed ? undefined : 'Ova pozicija je popunjena'}
                      onClick={() => take(player)}
                      className={`${buttonClass} h-8 px-3 text-[13px]`}
                    >
                      Uzmi
                    </button>
                  ) : (
                    <span className="hidden min-[461px]:block" />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className={`${cardClass} flex min-w-0 flex-col gap-3 p-4`}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h4 className="font-display text-lg font-bold uppercase tracking-[0.03em] text-white">Tabla drafta</h4>
            <span className="rounded px-1.5 py-px text-[11px] font-semibold text-zinc-400 ring-1 ring-white/10 ring-inset">
              {draft.picks.length} od {draft.total} izbora
            </span>
          </div>
          <Board ctx={ctx} />
        </section>
      </div>
    </div>
  )
}

function FormBars({ form }) {
  return (
    <div className="hidden h-6.5 items-end gap-0.5 min-[461px]:flex" aria-label="PIR po kolima">
      {form.map((value, index) =>
        value === null ? (
          <i key={index} title="nije igrao" className="block h-0.5 w-1.25 rounded-[1px] bg-rose-400" />
        ) : (
          <i
            key={index}
            title={String(value)}
            style={{ height: `${Math.max(3, Math.min(26, (value / FORM_MAX) * 26))}px` }}
            className={`block w-1.25 rounded-t-[2px] ${value >= 20 ? 'bg-neon' : 'bg-zinc-600'}`}
          />
        ),
      )}
    </div>
  )
}

function DraftStatus({ ctx, act, busy, myNeed }) {
  const { data, me, isAdmin, short, offset } = ctx
  const { draft, settings } = data
  const current = draft.current
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (draft.status !== 'live') return undefined
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [draft.status])

  const mine = draft.status === 'live' && current?.friendId === me
  const needs = myNeed && (
    <div className="flex gap-1.5">
      {POSITIONS.map((pos) => (
        <span key={pos} className={`inline-flex items-center gap-1.25 rounded-[7px] bg-ink py-0.75 pr-2 pl-1 text-[13px] text-white ring-1 ring-line ring-inset ${myNeed[pos] <= 0 ? 'opacity-45' : ''}`}>
          <PosChip pos={pos} />
          {NEED[pos] - myNeed[pos]}/{NEED[pos]}
        </span>
      ))}
    </div>
  )

  let clock = null
  let title
  let note
  let actions = null
  if (current) {
    const left = draft.status === 'live' ? Math.max(0, Math.ceil((current.endsAt - (now + offset)) / 1000)) : current.remaining
    const share = Math.max(0, Math.min(1, left / settings.pickSeconds))
    const round = Math.ceil(current.no / data.friends.length)
    clock = (
      <div
        className="grid size-14.5 shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(${mine ? 'var(--color-neon)' : 'var(--color-accent)'} ${share * 360}deg, var(--color-surface-hover) 0)` }}
      >
        <span className="grid size-12 place-items-center rounded-full bg-surface-2 font-display text-xl font-extrabold text-white tabular-nums">{left}</span>
      </div>
    )
    title = draft.status === 'paused' ? 'Draft je pauziran' : mine ? 'Ti si na redu' : `Bira ${short(current.friendId)}`
    note = `Izbor ${current.no} od ${draft.total} · krug ${round} od ${ROSTER} · ${round % 2 ? 'redom 1→6' : 'unazad 6→1'}`
    if (isAdmin) {
      actions = (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => act('/fantasy/draft/pause', { body: { paused: draft.status === 'live' } })}
            className={ghostButtonClass}
          >
            {draft.status === 'live' ? 'Pauza' : 'Nastavi'}
          </button>
          <button
            type="button"
            disabled={busy || draft.picks.length === 0}
            onClick={() => {
              const last = draft.picks.at(-1)
              const player = ctx.players.get(last.playerId)
              if (window.confirm(`Poništiti posljednji izbor (${player?.name}, ${short(last.friendId)})?`)) {
                act('/fantasy/draft/undo', { done: 'Posljednji izbor je poništen.' })
              }
            }}
            className={ghostButtonClass}
          >
            Poništi posljednji
          </button>
        </div>
      )
    }
  } else if (draft.status === 'done') {
    title = 'Draft je završen'
    note = 'Svako ima 8 igrača. Petorku i kapitena biraš u tabu Moja ekipa.'
    if (isAdmin && !data.rounds.length) {
      actions = (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Poništiti posljednji izbor? Draft se vraća u tok.')) act('/fantasy/draft/undo', { done: 'Posljednji izbor je poništen.' })
          }}
          className={ghostButtonClass}
        >
          Poništi posljednji
        </button>
      )
    }
  } else {
    title = 'Draft još nije počeo'
    note = `${settings.draftAt ? `Draft veče: ${dayTime(settings.draftAt)}. ` : ''}Redoslijed: ${draft.order.map((id, index) => `${index + 1}. ${short(id)}`).join(', ')}.`
    if (isAdmin) {
      actions = (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Pokrenuti ${settings.mode === 'trial' ? 'probni ' : ''}draft? Prvi bira ${short(draft.order[0])}.`)) {
              act('/fantasy/draft/start', { done: 'Draft je počeo.' })
            }
          }}
          className={buttonClass}
        >
          {settings.mode === 'trial' ? 'Pokreni probni draft' : 'Pokreni draft'}
        </button>
      )
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4.5 gap-y-3 rounded-[14px] px-4 py-3.5 ring-inset ${
        mine ? 'bg-[linear-gradient(90deg,rgba(184,255,60,0.1),transparent_70%)] bg-surface-2 ring-[1.5px] ring-neon/35' : 'bg-surface-2 ring-1 ring-line'
      }`}
    >
      {clock}
      <div className="min-w-56 flex-1">
        <b className="block font-display text-[22px] leading-[1.05] font-extrabold text-white uppercase">{title}</b>
        <small className="text-[13.5px] text-zinc-400">{note}</small>
      </div>
      {needs}
      {actions}
    </div>
  )
}

function Board({ ctx }) {
  const { data, players, me, short } = ctx
  const { draft } = data
  const order = draft.order
  const byNo = new Map(draft.picks.map((pick) => [pick.no, pick]))
  const nextNo = draft.current?.no ?? null
  const latest = draft.picks.at(-1)?.no

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-130 table-fixed border-separate border-spacing-1 text-[12.5px]">
        <thead>
          <tr>
            <th className="w-6.5" />
            {order.map((friendId) => (
              <th key={friendId} className={`truncate px-1 py-1 text-center font-display text-xs font-semibold tracking-[0.1em] uppercase ${friendId === me ? 'text-accent' : 'text-white'}`}>
                {short(friendId)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: ROSTER }, (_, round) => (
            <tr key={round}>
              <td className="w-6.5 text-center font-display text-xs font-bold text-zinc-600">{round + 1}</td>
              {order.map((friendId, col) => {
                const k = round % 2 === 0 ? col : order.length - 1 - col
                const no = round * order.length + k + 1
                const pick = byNo.get(no)
                if (pick) {
                  const player = players.get(pick.playerId)
                  return (
                    <td key={friendId}>
                      <div
                        title={`${no}. izbor${pick.auto ? ', izabrala aplikacija' : ''}`}
                        className={`flex min-h-10.5 min-w-0 flex-col gap-px rounded-[7px] bg-ink px-1.75 py-1.25 ${POS_EDGE[player?.pos] ?? ''} ${no === latest ? 'animate-[pop_0.45s_cubic-bezier(.3,1.6,.5,1)]' : ''}`}
                      >
                        <b className="truncate font-semibold text-white">{player ? lastName(player.name) : '—'}</b>
                        <small className="truncate text-[11px] text-zinc-400">
                          {player?.pos} · {player?.clubCode}
                          {pick.auto ? ' · auto' : ''}
                        </small>
                      </div>
                    </td>
                  )
                }
                if (no === nextNo) {
                  return (
                    <td key={friendId}>
                      <div className="grid min-h-10.5 place-items-center rounded-[7px] border-[1.5px] border-accent bg-accent/12 font-semibold text-accent">
                        {friendId === me ? 'Ti' : 'bira…'}
                      </div>
                    </td>
                  )
                }
                return (
                  <td key={friendId}>
                    <div className="min-h-10.5 rounded-[7px] border border-dashed border-line" />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

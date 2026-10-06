import { useEffect, useState } from 'react'
import { api } from './api.js'
import { ChevronIcon, LockIcon, XIcon } from './icons.jsx'

const DAYS = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota']

const STEPS = [
  'Drugari upisuju igrače',
  'Ti zaključaš kolo, svi vide sve tikete',
  'Ti označiš ✓ / ✗, rezultat ide u tabelu',
]
const PHASE = { open: 1, locked: 2, done: 3 }

const eyebrowClass =
  'font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent'
const primaryButtonClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[9px] bg-accent px-4.5 font-display text-[15px] font-bold uppercase tracking-[0.1em] text-ink shadow-[0_12px_30px_-12px_rgba(255,106,19,0.7)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40'
const smallLinkClass =
  'text-[13px] font-medium text-accent underline-offset-4 transition hover:underline'

// 1 igrač, 2 igrača, 5 igrača, 21 igrač
function players(n) {
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'igrač' : 'igrača'}`
}

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function formatDeadline(value) {
  const date = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${DAYS[date.getDay()]} ${date.getDate()}. ${date.getMonth() + 1}. u ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Bez izbora prikazujemo najnovije kolo koje još nije završeno, inače najnovije.
function defaultRound(rounds) {
  const sorted = [...rounds].sort((a, b) => b.number - a.number)
  return sorted.find((round) => round.status !== 'done') ?? sorted[0] ?? null
}

function ticketResult(picks) {
  const pending = picks.filter((pick) => pick.hit === null).length
  const hits = picks.filter((pick) => pick.hit === true).length
  const tone = pending ? 'none' : hits === picks.length ? 'hit' : hits === 0 ? 'miss' : 'part'
  return { pending, text: `${hits}/${picks.length}`, tone }
}

const CELL_TONES = {
  hit: 'bg-neon/10 text-neon ring-neon/30',
  part: 'bg-accent/12 text-accent ring-accent/35',
  miss: 'bg-rose-500/10 text-rose-400 ring-rose-500/35',
  none: 'text-zinc-600 ring-line',
}

function resultTone(value) {
  const [hits, played] = value.split('/').map(Number)
  return hits === played ? 'hit' : hits === 0 ? 'miss' : 'part'
}

export default function RoundTickets({ rounds, friends, results, user, isAdmin, onRoundChange, onResultChange }) {
  const [selectedId, setSelectedId] = useState(null)
  const [tickets, setTickets] = useState(null)
  const [editingFriendId, setEditingFriendId] = useState(null)
  const [deadlineDraft, setDeadlineDraft] = useState(null)
  const [player, setPlayer] = useState('')
  const [tip, setTip] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sortedRounds = [...rounds].sort((a, b) => a.number - b.number)
  const round = rounds.find((r) => r.id === selectedId) ?? defaultRound(rounds)
  const roundId = round?.id
  const status = round?.status
  const reveal = isAdmin && editingFriendId ? editingFriendId : null

  useEffect(() => {
    if (!roundId) return undefined
    let ignore = false
    api(`/rounds/${roundId}/tickets${reveal ? `?reveal=${reveal}` : ''}`).then(
      (data) => !ignore && setTickets({ roundId, list: data.tickets }),
      (loadError) => !ignore && setError(loadError.message),
    )
    return () => {
      ignore = true
    }
  }, [roundId, status, reveal])

  if (!round) return null

  const phase = PHASE[round.status]
  const loaded = tickets?.roundId === round.id
  const byFriend = new Map(loaded ? tickets.list.map((ticket) => [ticket.friendId, ticket]) : [])
  const ticketFriendId = editingFriendId ?? user.friendId
  const ticketFriend = friends.find((friend) => friend.id === ticketFriendId)
  const ownTicket = byFriend.get(ticketFriendId)
  const submitted = loaded ? tickets.list.filter((ticket) => ticket.count > 0).length : 0
  const totalPicks = loaded ? tickets.list.reduce((sum, ticket) => sum + ticket.count, 0) : 0
  const pendingPicks = loaded
    ? tickets.list.reduce((sum, ticket) => sum + (ticket.picks ?? []).filter((pick) => pick.hit === null).length, 0)
    : 0
  const roundIndex = sortedRounds.findIndex((r) => r.id === round.id)

  function selectRound(target) {
    if (!target) return
    setSelectedId(target.id)
    setEditingFriendId(null)
    setDeadlineDraft(null)
    setError('')
  }

  function updateTicket(friendId, update) {
    setTickets((prev) => ({
      ...prev,
      list: prev.list.map((ticket) => {
        if (ticket.friendId !== friendId) return ticket
        const picks = update(ticket.picks ?? [])
        return { ...ticket, picks, count: picks.length }
      }),
    }))
  }

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy(false)
    }
  }

  function addPick(event) {
    event.preventDefault()
    if (!player.trim()) {
      setError('Upiši ime igrača.')
      return
    }
    run(async () => {
      const pick = await api(`/rounds/${round.id}/picks`, {
        method: 'POST',
        body: JSON.stringify({ friendId: ticketFriendId, player, tip }),
      })
      updateTicket(ticketFriendId, (picks) => [...picks, pick])
      setPlayer('')
      setTip('')
      document.getElementById('pick-player')?.focus()
    })
  }

  function removePick(pick) {
    run(async () => {
      await api(`/picks/${pick.id}`, { method: 'DELETE' })
      updateTicket(ticketFriendId, (picks) => picks.filter((p) => p.id !== pick.id))
    })
  }

  function gradePick(friendId, pick, value) {
    const hit = pick.hit === value ? null : value
    run(async () => {
      const { result } = await api(`/picks/${pick.id}`, { method: 'PUT', body: JSON.stringify({ hit }) })
      updateTicket(friendId, (picks) => picks.map((p) => (p.id === pick.id ? { ...p, hit } : p)))
      onResultChange(friendId, round.id, result ?? '')
    })
  }

  function updateRound(changes, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    run(async () => {
      onRoundChange(await api(`/rounds/${round.id}`, { method: 'PUT', body: JSON.stringify(changes) }))
      setEditingFriendId(null)
      setDeadlineDraft(null)
    })
  }

  const pill = {
    1: { label: 'Unos otvoren', tone: 'bg-neon/10 text-neon', glow: true },
    2: { label: 'Zaključano · mečevi u toku', tone: 'bg-accent/12 text-accent', glow: true },
    3: { label: 'Završeno', tone: 'bg-white/6 text-zinc-300', glow: false },
  }[phase]

  return (
    <section
      aria-labelledby="round-title"
      className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_30px_60px_-30px_rgba(0,0,0,0.8)]"
    >
      <div className="h-px bg-linear-to-r from-transparent via-accent/70 to-transparent" />

      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line bg-surface-2 px-5 py-5.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={eyebrowClass}>Regularna sezona</span>
          <div className="flex items-center gap-3">
            <h2
              id="round-title"
              className="font-display text-[40px] font-extrabold uppercase leading-[0.95] text-white"
            >
              Kolo {round.number}
            </h2>
            {sortedRounds.length > 1 && (
              <div className="flex gap-1">
                <RoundNavButton
                  direction="left"
                  label="Prethodno kolo"
                  disabled={roundIndex <= 0}
                  onClick={() => selectRound(sortedRounds[roundIndex - 1])}
                />
                <RoundNavButton
                  direction="right"
                  label="Sljedeće kolo"
                  disabled={roundIndex >= sortedRounds.length - 1}
                  onClick={() => selectRound(sortedRounds[roundIndex + 1])}
                />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-zinc-400">
            <span
              className={`inline-flex items-center gap-1.75 rounded-full py-0.75 pr-2.5 pl-2 font-display text-xs font-bold uppercase tracking-[0.14em] ${pill.tone}`}
            >
              <span
                className={`size-1.75 rounded-full bg-current ${pill.glow ? 'shadow-[0_0_8px_currentColor]' : ''}`}
              />
              {pill.label}
            </span>
            {phase === 1 && (
              <DeadlineMeta
                deadline={round.deadline}
                isAdmin={isAdmin}
                draft={deadlineDraft}
                busy={busy}
                onEdit={() => setDeadlineDraft(round.deadline ?? '')}
                onDraftChange={setDeadlineDraft}
                onCancel={() => setDeadlineDraft(null)}
                onSave={() => updateRound({ deadline: deadlineDraft || null })}
              />
            )}
            {phase === 1 && loaded && (
              <span>
                Predalo {submitted} od {friends.length}
              </span>
            )}
            {phase === 2 && loaded && <span>{players(totalPicks)} na tiketima</span>}
            {phase === 3 && loaded && (
              <span>
                {pendingPicks ? `Čeka ocjenu: ${players(pendingPicks)}` : 'Svi rezultati su upisani u tabelu'}
              </span>
            )}
          </div>
        </div>

        {isAdmin && phase === 1 && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              updateRound(
                { status: 'locked' },
                `Zaključati kolo ${round.number}? Drugari više neće moći mijenjati tikete, a svi će vidjeti sve igrače.`,
              )
            }
            className={primaryButtonClass}
          >
            <LockIcon className="size-4" />
            Zaključaj kolo
          </button>
        )}
        {isAdmin && phase === 2 && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              updateRound({ status: 'done' }, `Završiti kolo ${round.number} i preći na ocjenjivanje igrača?`)
            }
            className={primaryButtonClass}
          >
            Mečevi gotovi, ocijeni
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 p-5">
        {error && (
          <p role="alert" className="text-[13px] text-rose-400">
            {error}
          </p>
        )}
        {!loaded ? (
          <p className="py-6 text-center text-sm text-zinc-500">Učitavanje tiketa…</p>
        ) : phase === 1 ? (
          <div className="grid grid-cols-1 gap-5 min-[860px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3.5">
              {!ticketFriend ? (
                <p className="rounded-xl px-4 py-6 text-sm text-zinc-400 ring-1 ring-line ring-inset">
                  Tvoj nalog nije povezan ni sa jednim redom u tabeli, pa nemaš svoj tiket. Javi se adminu.
                </p>
              ) : !ownTicket?.picks ? (
                <p className="py-6 text-center text-sm text-zinc-500">Učitavanje tiketa…</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="min-w-0 truncate font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white">
                      {editingFriendId ? `Tiket · ${ticketFriend.name}` : 'Tvoj tiket'}
                    </h3>
                    {editingFriendId ? (
                      <button type="button" onClick={() => setEditingFriendId(null)} className={smallLinkClass}>
                        Nazad na moj tiket
                      </button>
                    ) : (
                      <span className="shrink-0 text-[13px] text-zinc-400">{players(ownTicket.count)}</span>
                    )}
                  </div>
                  <div className="rounded-xl bg-ink ring-1 ring-line ring-inset">
                    {ownTicket.picks.length ? (
                      ownTicket.picks.map((pick, index) => (
                        <PickRow key={pick.id} index={index} pick={pick}>
                          <button
                            type="button"
                            onClick={() => removePick(pick)}
                            disabled={busy}
                            aria-label={`Ukloni ${pick.player}`}
                            className="grid size-8 place-items-center rounded-lg text-zinc-600 transition hover:bg-rose-500/10 hover:text-rose-400"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </PickRow>
                      ))
                    ) : (
                      <p className="px-3.5 py-5.5 text-center text-sm text-zinc-400">
                        {editingFriendId
                          ? 'Još nema nijednog igrača na ovom tiketu.'
                          : 'Još nisi dodao nijednog igrača za ovo kolo.'}
                      </p>
                    )}
                  </div>
                  <form
                    onSubmit={addPick}
                    noValidate
                    className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                  >
                    <input
                      id="pick-player"
                      value={player}
                      onChange={(event) => {
                        setPlayer(event.target.value)
                        if (error) setError('')
                      }}
                      maxLength={40}
                      placeholder="Igrač, npr. Vezenkov"
                      autoComplete="off"
                      aria-label="Igrač"
                      className="h-11 min-w-0 rounded-[9px] border border-line bg-surface-2 px-3.25 text-white outline-none placeholder:text-zinc-600 focus:border-accent focus:ring-3 focus:ring-accent/12"
                    />
                    <input
                      value={tip}
                      onChange={(event) => setTip(event.target.value)}
                      maxLength={30}
                      placeholder="Tip, npr. 15+ poena"
                      autoComplete="off"
                      aria-label="Tip"
                      className="h-11 min-w-0 rounded-[9px] border border-line bg-surface-2 px-3.25 text-white outline-none placeholder:text-zinc-600 focus:border-accent focus:ring-3 focus:ring-accent/12"
                    />
                    <button type="submit" disabled={busy} className={primaryButtonClass}>
                      Dodaj
                    </button>
                  </form>
                  <p className="flex items-start gap-2.5 rounded-[10px] bg-white/3 px-3.25 py-2.75 text-[13px] text-zinc-400 ring-1 ring-line ring-inset">
                    <LockIcon className="mt-0.5 size-4 shrink-0 text-accent" />
                    <span>
                      {editingFriendId
                        ? 'Upisuješ igrače umjesto drugara. On ih vidi na svom tiketu, a ostali tek kad zaključaš kolo.'
                        : 'Ostali ne vide tvoje igrače dok admin ne zaključa kolo. Do tada ih možeš mijenjati. Sve se čuva odmah, ne treba posebno slati.'}
                    </span>
                  </p>
                </>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white">Ekipa</h3>
                <span className="text-[13px] text-zinc-400">igrači skriveni</span>
              </div>
              <div className="flex flex-col overflow-hidden rounded-xl ring-1 ring-line ring-inset">
                {friends
                  .filter((friend) => friend.id !== user.friendId)
                  .map((friend) => {
                    const count = byFriend.get(friend.id)?.count ?? 0
                    const editing = friend.id === editingFriendId
                    return (
                      <div
                        key={friend.id}
                        className={`flex items-center gap-3 border-b border-line px-3.5 py-2.75 last:border-b-0 ${editing ? 'bg-accent/6' : ''}`}
                      >
                        <TicketAvatar name={friend.name} />
                        <div className="min-w-0 flex-1 font-semibold text-white">
                          <span className="block truncate">{friend.name}</span>
                          <small className={`block text-[13px] font-normal ${count ? 'text-zinc-400' : 'text-zinc-600'}`}>
                            {count ? `Predao · ${players(count)}` : 'Još nije predao'}
                          </small>
                        </div>
                        {count > 0 && (
                          <span className="flex gap-1" aria-label="Igrači su skriveni do zaključavanja">
                            {Array.from({ length: Math.min(count, 6) }, (_, i) => (
                              <i
                                key={i}
                                className="h-5.5 w-6.5 rounded-[5px] bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.07)_0_4px,rgba(255,255,255,0.02)_4px_8px)] ring-1 ring-line ring-inset"
                              />
                            ))}
                          </span>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setEditingFriendId(editing ? null : friend.id)}
                            className={`${smallLinkClass} shrink-0`}
                          >
                            {editing ? 'Zatvori' : 'Upiši'}
                          </button>
                        )}
                      </div>
                    )
                  })}
              </div>
              {isAdmin && (
                <p className="text-[13px] text-zinc-400">
                  Kao admin možeš otvoriti tiket drugara i upisati igrače umjesto njega, ako te zamoli.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3.5">
            {[...friends]
              .sort((a, b) => (b.id === user.friendId) - (a.id === user.friendId))
              .map((friend) => (
                <TicketCard
                  key={friend.id}
                  friend={friend}
                  picks={byFriend.get(friend.id)?.picks ?? []}
                  manualResult={results[friend.id]?.[round.id] ?? ''}
                  isMe={friend.id === user.friendId}
                  phase={phase}
                  canGrade={isAdmin && phase === 3}
                  busy={busy}
                  onGrade={(pick, value) => gradePick(friend.id, pick, value)}
                />
              ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4.5 gap-y-2.5 border-t border-line bg-surface-2 px-5 py-3.5 text-[13px]">
        {STEPS.map((step, index) => (
          <span key={step} className={index + 1 === phase ? 'text-white' : 'text-zinc-600'}>
            <b className={`font-display ${index + 1 === phase ? 'text-accent' : ''}`}>{index + 1}.</b> {step}
          </span>
        ))}
      </div>
    </section>
  )
}

function RoundNavButton({ direction, label, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-8 place-items-center rounded-lg text-zinc-400 ring-1 ring-line ring-inset transition hover:text-white hover:ring-white/20 disabled:pointer-events-none disabled:opacity-30"
    >
      <ChevronIcon direction={direction} className="size-4" />
    </button>
  )
}

function DeadlineMeta({ deadline, isAdmin, draft, busy, onEdit, onDraftChange, onCancel, onSave }) {
  if (isAdmin && draft !== null) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <label htmlFor="round-deadline">Rok:</label>
        <input
          id="round-deadline"
          type="datetime-local"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          className="h-8 rounded-lg border border-line bg-ink px-2 text-sm text-white outline-none focus:border-accent"
        />
        <button type="button" onClick={onSave} disabled={busy} className={smallLinkClass}>
          Sačuvaj
        </button>
        <button type="button" onClick={onCancel} className="text-[13px] text-zinc-500 hover:text-zinc-300">
          Otkaži
        </button>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-2">
      {deadline ? `Rok: ${formatDeadline(deadline)}` : isAdmin ? 'Rok nije postavljen' : null}
      {isAdmin && (
        <button type="button" onClick={onEdit} className={smallLinkClass}>
          {deadline ? 'Promijeni' : 'Postavi rok'}
        </button>
      )}
    </span>
  )
}

function TicketAvatar({ name, isMe = false }) {
  return (
    <span
      className={`grid size-8.5 shrink-0 place-items-center rounded-full font-display text-sm font-bold ${
        isMe
          ? 'bg-accent text-ink'
          : 'bg-linear-to-br from-zinc-700 to-zinc-800 text-white ring-1 ring-white/10 ring-inset'
      }`}
    >
      {initials(name)}
    </span>
  )
}

function PickRow({ index, pick, children, compact = false }) {
  return (
    <div
      className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-dashed border-line px-3.5 last:border-b-0 ${
        compact ? 'py-2.5' : 'py-3'
      }`}
    >
      <span className="font-display text-[15px] font-bold tabular-nums text-zinc-600">{index + 1}</span>
      <div className="min-w-0">
        <div className="font-semibold wrap-anywhere text-white">{pick.player}</div>
        <div className="text-[13px] text-zinc-400">{pick.tip || 'bez tipa'}</div>
      </div>
      {children}
    </div>
  )
}

function TicketCard({ friend, picks, manualResult, isMe, phase, canGrade, busy, onGrade }) {
  const finished = phase === 3
  const result = picks.length ? ticketResult(picks) : null

  let foot = null
  if (finished && result) {
    foot = (
      <>
        <span>{result.pending ? `čeka ocjenu (${result.pending})` : 'upisano u tabelu'}</span>
        <Cell tone={result.tone}>{result.pending ? '…' : result.text}</Cell>
      </>
    )
  } else if (finished) {
    foot = manualResult ? (
      <>
        <span>upisano ručno</span>
        <Cell tone={resultTone(manualResult)}>{manualResult}</Cell>
      </>
    ) : (
      <>
        <span>prazno u tabeli</span>
        <Cell tone="none">–</Cell>
      </>
    )
  } else if (picks.length) {
    foot = (
      <>
        <span>{players(picks.length)}</span>
        <span>zaključano</span>
      </>
    )
  }

  return (
    <article
      className={`flex min-w-0 flex-col rounded-xl bg-ink ring-1 ring-inset ${
        isMe ? 'shadow-[0_0_0_3px_rgba(255,106,19,0.12)] ring-accent/35' : 'ring-line'
      }`}
    >
      <div className="flex items-center gap-2.75 border-b border-line px-3.5 py-3.25">
        <TicketAvatar name={friend.name} isMe={isMe} />
        <div className="min-w-0 flex-1 truncate text-base font-semibold text-white">{friend.name}</div>
        {isMe && (
          <span className="rounded bg-accent/12 px-1.5 py-px font-display text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Ti
          </span>
        )}
      </div>

      {picks.length ? (
        picks.map((pick, index) => (
          <PickRow key={pick.id} index={index} pick={pick} compact>
            {canGrade ? (
              <span className="inline-flex gap-1" role="group" aria-label={`Ocjena za ${pick.player}`}>
                <GradeButton pressed={pick.hit === true} tone="yes" disabled={busy} onClick={() => onGrade(pick, true)} />
                <GradeButton pressed={pick.hit === false} tone="no" disabled={busy} onClick={() => onGrade(pick, false)} />
              </span>
            ) : finished ? (
              <MarkState hit={pick.hit} />
            ) : (
              <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-accent">U toku</span>
            )}
          </PickRow>
        ))
      ) : (
        <p className="flex-1 px-3.5 py-4.5 text-sm text-zinc-600">
          {finished && manualResult ? 'Igrači nisu upisani, rezultat je unesen ručno.' : 'Nije igrao ovo kolo.'}
        </p>
      )}

      {foot && (
        <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-line px-3.5 py-2.75 text-[13px] text-zinc-400">
          {foot}
        </div>
      )}
    </article>
  )
}

function Cell({ tone, children }) {
  return (
    <span
      className={`min-w-12.5 rounded-lg px-2.25 py-0.75 text-center font-display text-lg font-bold tabular-nums ring-1 ring-inset ${CELL_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

function MarkState({ hit }) {
  if (hit === null) {
    return (
      <span
        title="Čeka ocjenu"
        className="inline-grid size-7 place-items-center rounded-[7px] font-display text-[13px] font-extrabold text-zinc-600 ring-1 ring-line ring-inset"
      >
        …
      </span>
    )
  }
  return (
    <span
      className={`inline-grid size-7 place-items-center rounded-[7px] font-display text-base font-extrabold ${
        hit ? 'bg-neon/10 text-neon' : 'bg-rose-500/10 text-rose-400'
      }`}
      aria-label={hit ? 'Pogođeno' : 'Promašeno'}
    >
      {hit ? '✓' : '✗'}
    </span>
  )
}

function GradeButton({ pressed, tone, disabled, onClick }) {
  const pressedClass = tone === 'yes' ? 'bg-neon text-ink' : 'bg-rose-400 text-ink'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={tone === 'yes' ? 'Pogođeno' : 'Promašeno'}
      className={`h-7.5 w-8.5 rounded-[7px] font-display text-base font-extrabold transition ${
        pressed ? pressedClass : 'bg-surface-2 text-zinc-600 ring-1 ring-line ring-inset hover:text-white'
      }`}
    >
      {tone === 'yes' ? '✓' : '✗'}
    </button>
  )
}

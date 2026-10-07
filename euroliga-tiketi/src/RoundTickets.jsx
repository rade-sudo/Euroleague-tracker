import { Fragment, useEffect, useEffectEvent, useState } from 'react'
import { api } from './api.js'
import { ChevronIcon, LockIcon, XIcon } from './icons.jsx'
import PlayerInput from './PlayerInput.jsx'
import { buildPlayerIndex } from './players.js'

const DAYS = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota']
const SHORT_DAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']

const STEPS = [
  'Drugari upisuju igrače',
  'Ti zaključaš kolo, svi vide sve tikete',
  'Ti označiš ✓ / ✗, rezultat ide u tabelu',
]
const PHASE = { open: 1, locked: 2, done: 3 }
// Dok se čekaju rezultati utakmica, tiketi se osvježavaju na 5 minuta.
const RESULTS_POLL_MS = 5 * 60 * 1000
const GAME_LENGTH_MS = 105 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const eyebrowClass =
  'font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent'
const primaryButtonClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[9px] bg-accent px-4.5 font-display text-[15px] font-bold uppercase tracking-[0.1em] text-ink shadow-[0_12px_30px_-12px_rgba(255,106,19,0.7)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40'
const smallLinkClass =
  'text-[13px] font-medium text-accent underline-offset-4 transition hover:underline'
const panelTitleClass = 'font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white'

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

const pad = (n) => String(n).padStart(2, '0')

// Datumi sa servera su po našoj zoni: "2026-10-08" ili "2026-10-08T17:30".
function localDate(value) {
  return new Date(value.length === 10 ? `${value}T00:00` : value)
}

function formatDeadline(value) {
  const date = new Date(value)
  return `${DAYS[date.getDay()]} ${date.getDate()}. ${date.getMonth() + 1}. u ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// "Četvrtak 8. 10."
function dayTitle(value) {
  const date = localDate(value)
  const name = DAYS[date.getDay()]
  return `${name[0].toUpperCase()}${name.slice(1)} ${date.getDate()}. ${date.getMonth() + 1}.`
}

// "čet 8. 10."
function shortDate(value) {
  const date = localDate(value)
  return `${SHORT_DAYS[date.getDay()]} ${date.getDate()}. ${date.getMonth() + 1}.`
}

const shortDay = (value) => SHORT_DAYS[localDate(value).getDay()]
const timeOf = (value) => value.slice(11, 16)

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

// Utakmica i dan za svaki gameId iz rasporeda kola.
function indexGames(schedule) {
  const games = new Map()
  for (const day of schedule) {
    for (const game of day.games) games.set(game.id, { game, day })
  }
  return games
}

// Po vremenu utakmice; igrači bez utakmice idu na kraj.
function sortByGame(picks, games) {
  const start = (pick) => games.get(pick.gameId)?.game.startsAt ?? '9999'
  return [...picks].sort((a, b) => start(a).localeCompare(start(b)) || a.id - b.id)
}

// Igrači tiketa po danima, sa rednim brojem kroz cijeli tiket.
function groupByDay(picks, games) {
  const groups = []
  sortByGame(picks, games).forEach((pick, index) => {
    const day = games.get(pick.gameId)?.day ?? null
    const key = day?.date ?? 'bez-utakmice'
    let group = groups.find((g) => g.key === key)
    if (!group) {
      group = { key, day, picks: [] }
      groups.push(group)
    }
    group.picks.push({ pick, index })
  })
  return groups
}

// "čet 8. 10. u 17:30 i pet 9. 10. u 19:45"
function joinDeadlines(days) {
  return days.map((day, i) => (
    <Fragment key={day.date}>
      {i === 0 ? '' : i === days.length - 1 ? ' i ' : ', '}
      <b className="font-semibold text-white">
        {shortDate(day.date)} u {timeOf(day.deadline)}
      </b>
    </Fragment>
  ))
}

const isUnderTip = (tip) => tip.startsWith('-') || tip.startsWith('−')

// Isto pravilo kao na serveru: nije igrao = prošao, "+" traži više od granice, "−" manje.
function lineVerdict(pick) {
  if (pick.didPlay === null) return null
  if (!pick.didPlay) return true
  if (pick.line === null) return null
  return isUnderTip(pick.tip) ? pick.points < pick.line : pick.points > pick.line
}

function pickBadge(pick, autoGrade, isAdmin) {
  const verdict = lineVerdict(pick)
  const mark = verdict ? '✓' : '✗'
  if (autoGrade) {
    if (pick.gradedBy === 'auto') return { tone: 'auto', text: 'automatski' }
    if (pick.hit === null && pick.didPlay && pick.line === null) return { tone: 'diff', text: 'čeka granicu' }
    if (isAdmin && pick.gradedBy === 'admin' && verdict !== null && verdict !== pick.hit) {
      return { tone: 'diff', text: `po granici ${mark}, ostaje tvoja` }
    }
    return null
  }
  // Stara kola: ocjena je ručna, a admin vidi da li se slaže sa granicom.
  if (!isAdmin || pick.didPlay === null) return null
  if (verdict === null) return { tone: 'wait', text: 'bez granice' }
  if (pick.hit === null) return { tone: 'diff', text: `po granici ${mark}` }
  return verdict === pick.hit
    ? { tone: 'same', text: 'slaže se' }
    : { tone: 'diff', text: `po granici ${mark}, ostaje tvoja` }
}

const BADGE_TONES = {
  same: 'bg-neon/10 text-neon',
  diff: 'bg-accent/12 text-accent',
  wait: 'bg-white/5 text-zinc-600',
  auto: 'bg-[#7cc4ff]/10 text-[#7cc4ff]',
}

export default function RoundTickets({ rounds, friends, results, user, isAdmin, onRoundChange, onResultChange, onRoundResults }) {
  const [selectedId, setSelectedId] = useState(null)
  const [tickets, setTickets] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [editingFriendId, setEditingFriendId] = useState(null)
  const [deadlineDraft, setDeadlineDraft] = useState(null)
  const [player, setPlayer] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [playerIndex, setPlayerIndex] = useState(null)
  const [tip, setTip] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sortedRounds = [...rounds].sort((a, b) => a.number - b.number)
  const round = rounds.find((r) => r.id === selectedId) ?? defaultRound(rounds)
  const roundId = round?.id
  const status = round?.status
  const reveal = isAdmin && editingFriendId ? editingFriendId : null

  // Spisak igrača Eurolige za prijedloge pri upisu; bez njega polje radi kao obično.
  useEffect(() => {
    let ignore = false
    api('/players').then(
      (catalog) => !ignore && setPlayerIndex(buildPlayerIndex(catalog)),
      () => {},
    )
    return () => {
      ignore = true
    }
  }, [])

  // Server sam zaključava dane i upisuje ocjene, pa faza kola i rezultati stižu uz tikete.
  const applyServerRound = useEffectEvent((data) => {
    if (data.round.status !== status) onRoundChange(data.round)
    onRoundResults(data.round.id, data.results)
  })

  useEffect(() => {
    if (!roundId) return undefined
    let ignore = false
    api(`/rounds/${roundId}/tickets${reveal ? `?reveal=${reveal}` : ''}`).then(
      (data) => {
        if (ignore) return
        setTickets({
          roundId,
          list: data.tickets,
          twoPicks: data.twoPicks ?? [],
          schedule: data.schedule ?? [],
          autoGrade: Boolean(data.autoGrade),
        })
        applyServerRound(data)
      },
      (loadError) => !ignore && setError(loadError.message),
    )
    return () => {
      ignore = true
    }
  }, [roundId, status, reveal, refreshKey])

  // Ponovno učitavanje u trenutku roka sljedećeg dana tiketa i, dok traju utakmice, na 5 minuta.
  useEffect(() => {
    if (!tickets) return undefined
    const now = Date.now()
    const times = []
    for (const day of tickets.schedule) {
      if (!day.ticket) continue
      if (!day.locked) times.push(localDate(day.deadline).getTime())
      for (const game of day.games) {
        const start = localDate(game.startsAt).getTime()
        if (!game.played && start <= now) times.push(Math.max(start + GAME_LENGTH_MS, now + RESULTS_POLL_MS))
      }
    }
    const games = indexGames(tickets.schedule)
    const waitingStats = tickets.list.some((ticket) =>
      ticket.picks.some((pick) => pick.didPlay === null && games.get(pick.gameId)?.game.played),
    )
    if (waitingStats) times.push(now + RESULTS_POLL_MS)
    if (!times.length) return undefined
    const delay = Math.max(Math.min(...times) - now, 0) + 2000
    if (delay > DAY_MS) return undefined
    const timer = setTimeout(() => setRefreshKey((key) => key + 1), delay)
    return () => clearTimeout(timer)
  }, [tickets])

  if (!round) return null

  const phase = PHASE[round.status]
  const loaded = tickets?.roundId === round.id
  const schedule = loaded ? tickets.schedule : []
  const games = indexGames(schedule)
  const ticketDays = schedule.filter((day) => day.ticket)
  const scheduled = ticketDays.length > 0
  const autoGrade = loaded && tickets.autoGrade
  const byFriend = new Map(loaded ? tickets.list.map((ticket) => [ticket.friendId, ticket]) : [])
  // Izvučeni iz bubnja u ovom kolu biraju po 2 igrača.
  const twoPicks = new Set(loaded ? tickets.twoPicks : [])
  const ticketFriendId = editingFriendId ?? user.friendId
  const ticketFriend = friends.find((friend) => friend.id === ticketFriendId)
  const ownTicket = byFriend.get(ticketFriendId)
  const submitted = loaded ? tickets.list.filter((ticket) => ticket.count > 0).length : 0
  const totalPicks = loaded ? tickets.list.reduce((sum, ticket) => sum + ticket.count, 0) : 0
  const allVisible = loaded ? tickets.list.flatMap((ticket) => ticket.picks) : []
  const pendingPicks = allVisible.filter((pick) => pick.hit === null).length
  const linesEntered = allVisible.filter((pick) => pick.line !== null).length
  const roundIndex = sortedRounds.findIndex((r) => r.id === round.id)
  const myGameIds = new Set((ownTicket?.picks ?? []).map((pick) => pick.gameId))
  const lockedDays = ticketDays.filter((day) => day.locked)
  const showForm = phase === 1 && ticketFriend && ownTicket
  const steps = scheduled
    ? [
        'Drugari biraju igrače',
        'Dani tiketa se zaključavaju sami',
        `${isAdmin ? 'Ti upisuješ' : 'Admin upisuje'} granice, ✓ / ✗ ide samo`,
      ]
    : STEPS

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
        const before = ticket.picks
        const picks = update(before)
        return { ...ticket, picks, count: ticket.count + picks.length - before.length }
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
        body: JSON.stringify({ friendId: ticketFriendId, player, tip, playerId: selectedPlayer?.id }),
      })
      updateTicket(ticketFriendId, (picks) => [...picks, pick])
      setPlayer('')
      setSelectedPlayer(null)
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
      updateTicket(friendId, (picks) =>
        picks.map((p) => (p.id === pick.id ? { ...p, hit, gradedBy: hit === null ? null : 'admin' } : p)),
      )
      onResultChange(friendId, round.id, result ?? '')
    })
  }

  function saveLine(friendId, pick, raw) {
    const text = raw.trim().replace(',', '.')
    if (text === (pick.line === null ? '' : String(pick.line))) return
    run(async () => {
      const data = await api(`/picks/${pick.id}/line`, { method: 'PUT', body: JSON.stringify({ line: text || null }) })
      updateTicket(friendId, (picks) => picks.map((p) => (p.id === pick.id ? data.pick : p)))
      onRoundResults(round.id, data.results)
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

  function board(dayFilter, finished) {
    const cards = [...friends]
      .sort((a, b) => (b.id === user.friendId) - (a.id === user.friendId))
      .map((friend) => {
        const all = byFriend.get(friend.id)?.picks ?? []
        return { friend, picks: sortByGame(dayFilter ? all.filter((p) => games.get(p.gameId)?.day === dayFilter) : all, games) }
      })
      .filter((card) => !dayFilter || card.picks.length > 0)
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] gap-3.5">
        {cards.map(({ friend, picks }) => (
          <TicketCard
            key={friend.id}
            friend={friend}
            picks={picks}
            games={games}
            manualResult={results[friend.id]?.[round.id] ?? ''}
            isMe={friend.id === user.friendId}
            twoPicks={twoPicks.has(friend.id)}
            finished={finished}
            isAdmin={isAdmin}
            autoGrade={autoGrade}
            busy={busy}
            onGrade={(pick, value) => gradePick(friend.id, pick, value)}
            onLine={(pick, value) => saveLine(friend.id, pick, value)}
          />
        ))}
      </div>
    )
  }

  const pill = {
    1: { label: 'Unos otvoren', tone: 'bg-neon/10 text-neon', glow: true },
    2: { label: 'Zaključano · mečevi u toku', tone: 'bg-accent/12 text-accent', glow: true },
    3: { label: 'Završeno', tone: 'bg-white/6 text-zinc-300', glow: false },
  }[phase]

  const errorMessage = error && (
    <p role="alert" className="text-[13px] text-rose-400">
      {error}
    </p>
  )

  return (
    <section
      aria-labelledby="round-title"
      className="rounded-[14px] border border-line bg-surface shadow-[0_30px_60px_-30px_rgba(0,0,0,0.8)]"
    >
      <div className="h-px rounded-t-[14px] bg-linear-to-r from-transparent via-accent/70 to-transparent" />

      {/* Bez overflow-hidden na kartici, da se spisak igrača ne odsiječe; uglovi se zaobljavaju po dijelovima. */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-t-[13px] border-b border-line bg-surface-2 px-5 py-5.5">
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
            {phase === 1 && scheduled && (
              <>
                <span>Rok: {joinDeadlines(ticketDays)}</span>
                <span className="inline-flex items-center gap-1.25 rounded-md bg-[#7cc4ff]/10 px-2 py-0.5 text-xs font-semibold text-[#7cc4ff] ring-1 ring-[#7cc4ff]/30 ring-inset">
                  ⏱ automatski iz rasporeda
                </span>
              </>
            )}
            {phase === 1 && loaded && !scheduled && (
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
            {phase > 1 && loaded && isAdmin && allVisible.length > 0 && (
              <span>
                Granice upisane: {linesEntered} od {allVisible.length}
              </span>
            )}
          </div>
        </div>

        {isAdmin && phase === 1 && loaded && !scheduled && (
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
        {!showForm && errorMessage}
        {!loaded ? (
          <p className="py-6 text-center text-sm text-zinc-500">Učitavanje tiketa…</p>
        ) : phase === 1 ? (
          <>
            <div className="grid grid-cols-1 gap-5 min-[860px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-3.5">
                {!ticketFriend ? (
                  <p className="rounded-xl px-4 py-6 text-sm text-zinc-400 ring-1 ring-line ring-inset">
                    Tvoj nalog nije povezan ni sa jednim redom u tabeli, pa nemaš svoj tiket. Javi se adminu.
                  </p>
                ) : !ownTicket ? (
                  <p className="py-6 text-center text-sm text-zinc-500">Učitavanje tiketa…</p>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <h3 className={`min-w-0 truncate ${panelTitleClass}`}>
                          {editingFriendId ? `Tiket · ${ticketFriend.name}` : 'Tvoj tiket'}
                        </h3>
                        {twoPicks.has(ticketFriendId) && (
                          <TwoPicksTag>{editingFriendId ? 'Bira 2 igrača' : 'Biraš 2 igrača'}</TwoPicksTag>
                        )}
                      </div>
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
                        groupByDay(ownTicket.picks, games).map((group) => (
                          <Fragment key={group.key}>
                            {group.day && <TicketDayHeader day={group.day} />}
                            {group.picks.map(({ pick, index }) => (
                              <PickRow key={pick.id} index={index} pick={pick} game={games.get(pick.gameId)}>
                                {(!group.day?.locked || isAdmin) && (
                                  <button
                                    type="button"
                                    onClick={() => removePick(pick)}
                                    disabled={busy}
                                    aria-label={`Ukloni ${pick.player}`}
                                    className="grid size-8 place-items-center rounded-lg text-zinc-600 transition hover:bg-rose-500/10 hover:text-rose-400"
                                  >
                                    <XIcon className="size-3.5" />
                                  </button>
                                )}
                              </PickRow>
                            ))}
                          </Fragment>
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
                      <PlayerInput
                        id="pick-player"
                        index={playerIndex}
                        value={player}
                        selected={selectedPlayer}
                        onChange={(text) => {
                          setPlayer(text)
                          if (error) setError('')
                        }}
                        onSelect={setSelectedPlayer}
                        placeholder="Igrač, npr. Vezenkov"
                        ariaLabel="Igrač"
                        emptyText={
                          scheduled
                            ? 'Nema na spisku. Provjeri kako se piše, ili javi adminu da osvježi spisak.'
                            : undefined
                        }
                        className="h-11 w-full min-w-0 rounded-[9px] border border-line bg-surface-2 px-3.25 text-white outline-none placeholder:text-zinc-600 focus:border-accent focus:ring-3 focus:ring-accent/12"
                      />
                      <input
                        value={tip}
                        onChange={(event) => setTip(event.target.value)}
                        maxLength={30}
                        placeholder="Tip, npr. + ili -"
                        autoComplete="off"
                        aria-label="Tip"
                        className="h-11 min-w-0 rounded-[9px] border border-line bg-surface-2 px-3.25 text-white outline-none placeholder:text-zinc-600 focus:border-accent focus:ring-3 focus:ring-accent/12"
                      />
                      <button type="submit" disabled={busy} className={primaryButtonClass}>
                        Dodaj
                      </button>
                    </form>
                    {errorMessage}
                    <p className="flex items-start gap-2.5 rounded-[10px] bg-white/3 px-3.25 py-2.75 text-[13px] text-zinc-400 ring-1 ring-line ring-inset">
                      <LockIcon className="mt-0.5 size-4 shrink-0 text-accent" />
                      <span>
                        {editingFriendId
                          ? scheduled
                            ? 'Upisuješ igrače umjesto drugara. On ih vidi na svom tiketu, a ostali tek kad se njihov dan tiketa zaključa.'
                            : 'Upisuješ igrače umjesto drugara. On ih vidi na svom tiketu, a ostali tek kad zaključaš kolo.'
                          : scheduled
                            ? 'Ostali ne vide tvoje igrače dok se njihov dan tiketa ne zaključa, pola sata prije prve utakmice. Do tada ih možeš mijenjati. Sve se čuva odmah, ne treba posebno slati.'
                            : 'Ostali ne vide tvoje igrače dok admin ne zaključa kolo. Do tada ih možeš mijenjati. Sve se čuva odmah, ne treba posebno slati.'}
                      </span>
                    </p>
                  </>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className={panelTitleClass}>Ekipa</h3>
                  <span className="text-[13px] text-zinc-400">igrači skriveni</span>
                </div>
                <div className="flex flex-col overflow-hidden rounded-xl ring-1 ring-line ring-inset">
                  {friends
                    .filter((friend) => friend.id !== user.friendId)
                    .map((friend) => {
                      const ticket = byFriend.get(friend.id)
                      const count = ticket?.count ?? 0
                      const hidden = count - (ticket?.picks.length ?? 0)
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
                          {twoPicks.has(friend.id) && <TwoPicksTag>2 igrača</TwoPicksTag>}
                          {hidden > 0 && (
                            <span className="flex gap-1" aria-label="Igrači su skriveni do zaključavanja">
                              {Array.from({ length: Math.min(hidden, 6) }, (_, i) => (
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

                {scheduled && (
                  <>
                    <div className="mt-1 flex items-baseline justify-between gap-3">
                      <h3 className={panelTitleClass}>Utakmice kola {round.number}</h3>
                      <span className="text-[13px] text-zinc-400">vrijeme po našoj zoni</span>
                    </div>
                    <GamesList schedule={schedule} highlight={myGameIds} />
                  </>
                )}
              </div>
            </div>

            {lockedDays.map((day) => {
              const content = board(day, false)
              return (
                <div key={day.date} className="flex flex-col gap-3.5 border-t border-line pt-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className={panelTitleClass}>{dayTitle(day.date)} · zaključano</h3>
                    <span className="text-[13px] text-zinc-400">svi vide igrače tog dana</span>
                  </div>
                  {content}
                </div>
              )
            })}
          </>
        ) : (
          board(null, phase === 3)
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4.5 gap-y-2.5 rounded-b-[13px] border-t border-line bg-surface-2 px-5 py-3.5 text-[13px]">
        {steps.map((step, index) => (
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

function TicketDayHeader({ day }) {
  return (
    <div className="flex justify-between gap-2.5 border-b border-line bg-white/2 px-3.5 py-2 font-display text-xs font-bold uppercase tracking-[0.14em] text-zinc-400 first:rounded-t-xl">
      <span>{dayTitle(day.date)}</span>
      <em className={`not-italic ${day.ticket && !day.locked ? 'text-accent' : 'text-zinc-600'}`}>
        {!day.ticket ? 'nema tiketa' : day.locked ? 'zaključano' : `rok ${timeOf(day.deadline)}`}
      </em>
    </div>
  )
}

function GamesList({ schedule, highlight }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-line ring-inset">
      {schedule.map((day) => (
        <Fragment key={day.date}>
          <div
            className={`flex justify-between gap-2.5 border-b border-line bg-surface-2 px-3.5 py-1.75 font-display text-xs font-bold uppercase tracking-[0.14em] ${
              day.ticket ? 'text-white' : 'text-zinc-400'
            }`}
          >
            <span>{dayTitle(day.date)}</span>
            <em
              className={`not-italic text-[11px] tracking-[0.06em] ${
                day.ticket ? 'rounded-full bg-accent px-1.75 text-ink' : 'text-zinc-600'
              }`}
            >
              {!day.ticket
                ? 'ne igramo, jedna utakmica'
                : day.locked
                  ? 'tiket · zaključan'
                  : `tiket · rok ${timeOf(day.deadline)}`}
            </em>
          </div>
          {day.games.map((game, index) => {
            const first = index === 0 && day.ticket
            const mine = highlight.has(game.id)
            return (
              <div
                key={game.id}
                className={`grid grid-cols-[46px_minmax(0,1fr)] items-center gap-2.5 border-b border-line px-3.5 py-2 text-sm last:border-b-0 ${
                  day.ticket ? '' : 'opacity-45'
                } ${first ? 'bg-accent/12' : ''}`}
              >
                <time
                  dateTime={game.startsAt}
                  className={`font-display text-[15px] font-bold tabular-nums ${first ? 'text-accent' : 'text-white'}`}
                >
                  {timeOf(game.startsAt)}
                </time>
                <span
                  className={`wrap-anywhere ${day.ticket ? '' : 'line-through decoration-white/30'} ${
                    mine ? 'font-semibold text-white' : 'text-zinc-300'
                  }`}
                >
                  {game.home} – {game.away}
                  {mine ? ' ●' : ''}
                </span>
              </div>
            )
          })}
        </Fragment>
      ))}
    </div>
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

// Red na tvom tiketu: igrač, ispod tip, ispod utakmica i vrijeme.
function PickRow({ index, pick, game, children }) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-dashed border-line px-3.5 py-3 last:border-b-0">
      <span className="font-display text-[15px] font-bold tabular-nums text-zinc-600">{index + 1}</span>
      <div className="min-w-0">
        <div className="font-semibold wrap-anywhere text-white">{pick.player}</div>
        <div className="text-[13px] text-zinc-400">{pick.tip || 'bez tipa'}</div>
        {game && (
          <div className="flex items-center gap-1.25 text-[12.5px] text-zinc-400">
            <span className="size-1.25 shrink-0 rounded-full bg-accent" />
            <span className="min-w-0 wrap-anywhere">
              {game.game.home} – {game.game.away} · {shortDay(game.day.date)} u {timeOf(game.game.startsAt)}
            </span>
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

function TwoPicksTag({ children }) {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-[5px] bg-neon/10 px-1.75 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-neon">
      {children}
    </span>
  )
}

function TicketCard({ friend, picks, games, manualResult, isMe, twoPicks, finished, isAdmin, autoGrade, busy, onGrade, onLine }) {
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
        {twoPicks && <TwoPicksTag>2 igrača</TwoPicksTag>}
        {isMe && (
          <span className="rounded bg-accent/12 px-1.5 py-px font-display text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Ti
          </span>
        )}
      </div>

      {picks.length ? (
        picks.map((pick) => (
          <BoardPick
            key={pick.id}
            pick={pick}
            game={games.get(pick.gameId)}
            finished={finished}
            isAdmin={isAdmin}
            autoGrade={autoGrade}
            busy={busy}
            onGrade={(value) => onGrade(pick, value)}
            onLine={(value) => onLine(pick, value)}
          />
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

// Igrač na zaključanom tiketu: utakmica, granica (admin je upisuje), poeni i ocjena.
function BoardPick({ pick, game, finished, isAdmin, autoGrade, busy, onGrade, onLine }) {
  const badge = pickBadge(pick, autoGrade, isAdmin)
  const gameOver = pick.didPlay !== null
  const sign = pick.tip || '+'

  let side
  if (isAdmin && (finished || gameOver)) {
    side = (
      <span className="inline-flex gap-1" role="group" aria-label={`Ocjena za ${pick.player}`}>
        <GradeButton pressed={pick.hit === true} tone="yes" disabled={busy} onClick={() => onGrade(true)} />
        <GradeButton pressed={pick.hit === false} tone="no" disabled={busy} onClick={() => onGrade(false)} />
      </span>
    )
  } else if (pick.hit !== null || finished || gameOver) {
    side = <MarkState hit={pick.hit} />
  } else {
    side = <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-accent">U toku</span>
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-dashed border-line px-3.5 py-2.75 last:border-b-0">
      <div className="min-w-0">
        <div className="font-semibold wrap-anywhere text-white">{pick.player}</div>
        {game && (
          <div className="text-[12.5px] text-zinc-400">
            <span className="mr-1.5 inline-block rounded bg-white/6 px-1.5 font-display text-[11px] font-bold uppercase tracking-widest text-zinc-400">
              {shortDay(game.day.date)}
            </span>
            {game.game.home} – {game.game.away} · {timeOf(game.game.startsAt)}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {isAdmin ? (
            <label className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-400">
              granica
              <input
                key={`${pick.id}:${pick.line}`}
                defaultValue={pick.line ?? ''}
                onBlur={(event) => onLine(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                inputMode="decimal"
                placeholder="—"
                maxLength={5}
                aria-label={`Granica za ${pick.player}`}
                className={`h-7.5 w-16 rounded-[7px] border px-2 text-center font-display text-[15px] font-bold text-white outline-none focus:border-solid focus:border-accent ${
                  pick.line === null ? 'border-dashed border-accent/35 bg-accent/12' : 'border-white/16 bg-surface-2'
                }`}
              />
              {sign}
            </label>
          ) : (
            <span className="text-[13px] text-zinc-400">{pick.line === null ? sign : `granica ${pick.line} ${sign}`}</span>
          )}
          {pick.didPlay === true && (
            <span className="text-[12.5px] tabular-nums text-zinc-400">
              <strong className="font-display text-[15px] font-bold text-white">{pick.points}</strong> poena
            </span>
          )}
          {pick.didPlay === false && <span className="text-[12.5px] text-zinc-400">nije igrao</span>}
          {badge && (
            <span className={`rounded-[5px] px-1.75 py-px text-[11.5px] font-semibold ${BADGE_TONES[badge.tone]}`}>
              {badge.text}
            </span>
          )}
        </div>
      </div>
      {side}
    </div>
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

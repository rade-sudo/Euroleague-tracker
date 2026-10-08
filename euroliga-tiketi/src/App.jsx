import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import AppHeader from './AppHeader.jsx'
import NotificationPrompt from './NotificationPrompt.jsx'
import PasswordReminder from './PasswordReminder.jsx'
import { BallIcon, PlusIcon, XIcon } from './icons.jsx'
import RoundTickets from './RoundTickets.jsx'
import { useSessionGuard } from './session.js'

// Ranije su se podaci čuvali samo u pregledaču; ključ ostaje zbog jednokratnog uvoza u bazu.
const LEGACY_STORAGE_KEY = 'euroliga-tiketi:v1'
const RESULT_PATTERN = /^(\d+)\/(\d+)$/
const SAVE_DELAY_MS = 400

const loadAll = () => Promise.all([api('/me'), api('/state')])

function readLegacyData() {
  try {
    const saved = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY))
    if (Array.isArray(saved?.friends) && saved.friends.length > 0) return saved
  } catch {
    // Nema starih podataka ili localStorage nije dostupan.
  }
  return null
}

function clearLegacyData() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // localStorage nije dostupan, nema šta da se briše.
  }
}

// Prazno polje znači da prijatelj nije igrao to kolo i ne ulazi u statistiku.
function parseResult(value) {
  if (!value) return { status: 'empty' }
  const match = RESULT_PATTERN.exec(value)
  if (!match) return { status: 'invalid' }
  const hits = Number(match[1])
  const played = Number(match[2])
  if (played === 0 || hits > played) return { status: 'invalid' }
  return { status: 'valid', hits, played }
}

// Na mobilnoj numeričkoj tastaturi nema "/", pa i "1.2", "1,2" ili "1-2" postaju "1/2".
function normalizeResult(raw) {
  return raw
    .replace(/[.,:\-\s]/g, '/')
    .replace(/[^\d/]/g, '')
    .replace(/\/+/g, '/')
}

const formatPct = (pct) => (pct === null ? '—' : `${Math.round(pct * 100)}%`)
const roundsLabel = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'kolo' : 'kola')

function pctTone(pct) {
  if (pct >= 0.7) return 'text-neon'
  if (pct >= 0.4) return 'text-accent'
  return 'text-rose-400'
}

function cellTone(parsed) {
  if (parsed.status === 'empty') {
    return 'bg-transparent text-zinc-300 ring-white/[0.06] hover:ring-white/15'
  }
  if (parsed.status === 'invalid') {
    return 'bg-ink text-rose-300 ring-white/10 not-focus:bg-rose-500/10 not-focus:ring-rose-500/70'
  }
  if (parsed.hits === parsed.played) return 'bg-neon/10 text-neon ring-neon/30'
  if (parsed.hits === 0) return 'bg-rose-500/10 text-rose-300 ring-rose-500/25'
  return 'bg-accent/10 text-accent ring-accent/30'
}

export default function App() {
  const [data, setData] = useState({ friends: [], rounds: [], results: {} })
  const [user, setUser] = useState(null)
  const [load, setLoad] = useState({ status: 'loading', error: '' })
  const [save, setSave] = useState({ status: 'saved', error: '' })
  const [legacyData, setLegacyData] = useState(readLegacyData)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [nameError, setNameError] = useState('')
  const scrollRef = useRef(null)
  const tableRef = useRef(null)
  const nameInputRef = useRef(null)
  const saveTimers = useRef(new Map())
  const inFlight = useRef(0)
  const { friends, rounds, results } = data
  const ready = load.status === 'ready'
  const isAdmin = user?.role === 'admin'

  const applyLoaded = useCallback(([me, state]) => {
    setUser(me.user)
    setData(state)
    setLoad({ status: 'ready', error: '' })
  }, [])

  const applyLoadError = useCallback((error) => {
    // 401: api() već preusmjerava na prijavu, pa ostajemo na učitavanju umjesto da trepne greška.
    if (error.status === 401) return
    setLoad({ status: 'error', error: error.message })
  }, [])

  const fetchState = useCallback(
    () => loadAll().then(applyLoaded, applyLoadError),
    [applyLoaded, applyLoadError],
  )

  useEffect(() => {
    let ignore = false
    loadAll().then(
      (loaded) => !ignore && applyLoaded(loaded),
      (error) => !ignore && applyLoadError(error),
    )
    return () => {
      ignore = true
    }
  }, [applyLoaded, applyLoadError])

  useSessionGuard()

  // Upozori prije zatvaranja stranice ako neki rezultat još nije stigao do baze.
  useEffect(() => {
    function handleBeforeUnload(event) {
      if (saveTimers.current.size > 0 || inFlight.current > 0) event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  async function persist(request, { resyncOnError = false } = {}) {
    inFlight.current += 1
    setSave({ status: 'saving', error: '' })
    try {
      await request()
      inFlight.current -= 1
      if (inFlight.current === 0) setSave({ status: 'saved', error: '' })
    } catch (error) {
      inFlight.current -= 1
      setSave({ status: 'error', error: error.message })
      if (resyncOnError) fetchState()
    }
  }

  function cancelPendingSaves(matches) {
    for (const [key, timer] of saveTimers.current) {
      if (matches(key)) {
        clearTimeout(timer)
        saveTimers.current.delete(key)
      }
    }
  }

  function retryLoad() {
    setLoad({ status: 'loading', error: '' })
    fetchState()
  }

  async function importLegacyData() {
    setBusy(true)
    try {
      setData(await api('/import', { method: 'POST', body: JSON.stringify(legacyData) }))
      clearLegacyData()
      setLegacyData(null)
      setSave({ status: 'saved', error: '' })
    } catch (error) {
      setSave({ status: 'error', error: error.message })
    } finally {
      setBusy(false)
    }
  }

  function discardLegacyData() {
    if (!window.confirm('Obrisati stare podatke iz pregledača? Ovo se ne može vratiti.')) return
    clearLegacyData()
    setLegacyData(null)
  }

  const totals = useMemo(() => {
    const byFriend = {}
    for (const friend of friends) {
      let hits = 0
      let played = 0
      let roundsPlayed = 0
      for (const round of rounds) {
        const parsed = parseResult(results[friend.id]?.[round.id])
        if (parsed.status !== 'valid') continue
        hits += parsed.hits
        played += parsed.played
        roundsPlayed += 1
      }
      byFriend[friend.id] = { hits, played, roundsPlayed, pct: played ? hits / played : null }
    }
    return byFriend
  }, [friends, rounds, results])

  const overall = useMemo(() => {
    let hits = 0
    let played = 0
    for (const total of Object.values(totals)) {
      hits += total.hits
      played += total.played
    }
    return { hits, played, pct: played ? hits / played : null }
  }, [totals])

  const leader = useMemo(() => {
    let best = null
    for (const friend of friends) {
      const total = totals[friend.id]
      if (!total.played) continue
      if (!best || total.pct > best.pct || (total.pct === best.pct && total.hits > best.hits)) {
        best = { ...total, id: friend.id, name: friend.name }
      }
    }
    return best
  }, [friends, totals])

  const nextRoundNumber = rounds.reduce((max, round) => Math.max(max, round.number), 0) + 1

  async function addFriend(event) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) {
      setNameError('Upiši ime prijatelja.')
      return
    }
    if (friends.some((friend) => friend.name.toLowerCase() === name.toLowerCase())) {
      setNameError(`„${name}“ je već na listi.`)
      return
    }
    setBusy(true)
    try {
      const friend = await api('/friends', { method: 'POST', body: JSON.stringify({ name }) })
      setData((prev) => ({ ...prev, friends: [...prev.friends, friend] }))
      setNewName('')
      setNameError('')
    } catch (error) {
      setNameError(error.message)
    } finally {
      setBusy(false)
    }
  }

  function removeFriend(friend) {
    if (!window.confirm(`Obrisati „${friend.name}“ i sve upisane rezultate?`)) return
    cancelPendingSaves((key) => key.startsWith(`${friend.id}:`))
    persist(() => api(`/friends/${friend.id}`, { method: 'DELETE' }), { resyncOnError: true })
    setData((prev) => {
      const nextResults = { ...prev.results }
      delete nextResults[friend.id]
      return {
        ...prev,
        friends: prev.friends.filter((f) => f.id !== friend.id),
        results: nextResults,
      }
    })
  }

  async function addRound() {
    setBusy(true)
    try {
      const round = await api('/rounds', { method: 'POST' })
      setData((prev) => ({ ...prev, rounds: [...prev.rounds, round] }))
      requestAnimationFrame(() => {
        const el = scrollRef.current
        el?.scrollTo({ left: el.scrollWidth, behavior: 'smooth' })
      })
    } catch (error) {
      setSave({ status: 'error', error: error.message })
    } finally {
      setBusy(false)
    }
  }

  function removeRound(round) {
    const hasResults = friends.some((friend) => results[friend.id]?.[round.id])
    if (hasResults && !window.confirm(`Kolo ${round.number} ima upisane rezultate. Obrisati ga?`)) {
      return
    }
    cancelPendingSaves((key) => key.endsWith(`:${round.id}`))
    persist(() => api(`/rounds/${round.id}`, { method: 'DELETE' }), { resyncOnError: true })
    setData((prev) => ({
      ...prev,
      rounds: prev.rounds.filter((r) => r.id !== round.id),
      results: Object.fromEntries(
        Object.entries(prev.results).map(([friendId, byRound]) => {
          const next = { ...byRound }
          delete next[round.id]
          return [friendId, next]
        }),
      ),
    }))
  }

  function replaceRound(round) {
    setData((prev) => ({ ...prev, rounds: prev.rounds.map((r) => (r.id === round.id ? round : r)) }))
  }

  // Rezultat koji je server upisao poslije ocjene igrača.
  function applyResult(friendId, roundId, value) {
    setData((prev) => ({
      ...prev,
      results: { ...prev.results, [friendId]: { ...prev.results[friendId], [roundId]: value } },
    }))
  }

  // Rezultati jednog kola sa servera (npr. posle automatskih ocjena): {friendId: "2/3"}.
  function applyRoundResults(roundId, values) {
    setData((prev) => {
      const next = { ...prev.results }
      let changed = false
      for (const friend of prev.friends) {
        const value = values[friend.id] ?? ''
        if ((next[friend.id]?.[roundId] ?? '') !== value) {
          next[friend.id] = { ...next[friend.id], [roundId]: value }
          changed = true
        }
      }
      return changed ? { ...prev, results: next } : prev
    })
  }

  function setResult(friendId, roundId, raw) {
    const value = normalizeResult(raw)
    setData((prev) => ({
      ...prev,
      results: {
        ...prev.results,
        [friendId]: { ...prev.results[friendId], [roundId]: value },
      },
    }))

    // Snimamo tek kad korisnik zastane, i samo ispravan ili prazan unos.
    // Nedovršen unos ("1/") ostaje crven i ne šalje se na server.
    const key = `${friendId}:${roundId}`
    cancelPendingSaves((pendingKey) => pendingKey === key)
    if (parseResult(value).status === 'invalid') return
    saveTimers.current.set(
      key,
      setTimeout(() => {
        saveTimers.current.delete(key)
        persist(() =>
          api('/results', { method: 'PUT', body: JSON.stringify({ friendId, roundId, value }) }),
        )
      }, SAVE_DELAY_MS),
    )
  }

  // Enter / strelice gore-dole skaču na isto kolo kod sljedećeg ili prethodnog prijatelja.
  function handleCellKeyDown(event, row, col) {
    let step = 0
    if (event.key === 'Enter' || event.key === 'ArrowDown') step = 1
    if (event.key === 'ArrowUp') step = -1
    if (!step) return
    event.preventDefault()
    tableRef.current?.querySelector(`[data-cell="${row + step}-${col}"]`)?.focus()
  }

  const stickyLeft =
    'sticky left-0 z-10 border-r border-line shadow-[8px_0_16px_-12px_rgba(0,0,0,0.9)]'
  const stickyRight =
    'sm:sticky sm:right-0 z-10 border-l border-line sm:shadow-[-8px_0_16px_-12px_rgba(0,0,0,0.9)]'

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-130 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(255,106,19,0.16),transparent)]"
      />

      <main className="relative mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <AppHeader user={ready ? user : null} active="tabela">
          {isAdmin && <SaveStatus save={save} />}
        </AppHeader>

        {ready && <PasswordReminder user={user} />}
        {ready && <NotificationPrompt />}

        {isAdmin && legacyData && friends.length === 0 && (
          <LegacyImportBanner
            data={legacyData}
            busy={busy}
            onImport={importLegacyData}
            onDiscard={discardLegacyData}
          />
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Prijatelji" value={friends.length} />
          <StatTile label="Kola" value={rounds.length} />
          <StatTile
            label="Ukupno pogođeno"
            value={`${overall.hits}/${overall.played}`}
            sub={overall.played ? `${formatPct(overall.pct)} uspješnost` : 'Još nema rezultata'}
          />
          <StatTile
            label="Najbolji procenat"
            value={leader ? leader.name : '—'}
            sub={
              leader
                ? `${formatPct(leader.pct)} · ${leader.hits}/${leader.played}`
                : 'Još nema rezultata'
            }
            highlight
          />
        </section>

        {isAdmin && (
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 shadow-lg shadow-black/30 sm:flex-row sm:items-start sm:justify-between">
          <form onSubmit={addFriend} className="flex flex-1 flex-col gap-1.5 sm:max-w-md">
            <div className="flex gap-2">
              <label htmlFor="friend-name" className="sr-only">
                Ime prijatelja
              </label>
              <input
                id="friend-name"
                ref={nameInputRef}
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value)
                  if (nameError) setNameError('')
                }}
                placeholder="Ime prijatelja"
                maxLength={24}
                autoComplete="off"
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'friend-name-error' : undefined}
                className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-ink px-3.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
              />
              <button
                type="submit"
                disabled={!ready || busy}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 font-display text-sm font-bold uppercase tracking-wider text-ink shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              >
                <PlusIcon className="size-4" />
                Dodaj<span className="hidden sm:inline"> prijatelja</span>
              </button>
            </div>
            {nameError && (
              <p id="friend-name-error" className="px-1 text-xs text-rose-400">
                {nameError}
              </p>
            )}
          </form>

          <button
            type="button"
            onClick={addRound}
            disabled={!ready || busy}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-neon/30 bg-neon/6 px-4 font-display text-sm font-bold uppercase tracking-wider text-neon transition hover:border-neon/60 hover:bg-neon/10 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >
            <PlusIcon className="size-4" />
            Novo kolo
            <span className="text-neon/50">#{nextRoundNumber}</span>
          </button>
        </section>
        )}

        {ready && rounds.length > 0 && (
          <RoundTickets
            rounds={rounds}
            friends={friends}
            results={results}
            user={user}
            isAdmin={isAdmin}
            onRoundChange={replaceRound}
            onResultChange={applyResult}
            onRoundResults={applyRoundResults}
          />
        )}

        <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/50">
          <div className="h-px bg-linear-to-r from-transparent via-accent/70 to-transparent" />

          {load.status === 'loading' ? (
            <LoadingState />
          ) : load.status === 'error' ? (
            <ErrorState message={load.error} onRetry={retryLoad} />
          ) : friends.length === 0 ? (
            <EmptyState
              onAddClick={isAdmin ? () => nameInputRef.current?.focus() : undefined}
            />
          ) : (
            <>
              <div
                ref={scrollRef}
                className="overflow-x-auto [scrollbar-color:#2a2e38_transparent] scrollbar-thin"
              >
                <table ref={tableRef} className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      <th
                        scope="col"
                        className={`${stickyLeft} w-full border-b bg-surface-2 px-3 py-3 text-left sm:px-4`}
                      >
                        Prijatelj
                      </th>
                      {rounds.map((round) => (
                        <th
                          key={round.id}
                          scope="col"
                          className="group/round relative border-b border-line bg-surface-2 px-1.5 py-2 text-center"
                        >
                          <span className="block">Kolo</span>
                          <span className="block text-lg leading-tight tracking-normal text-zinc-100">
                            {round.number}
                          </span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => removeRound(round)}
                              aria-label={`Obriši kolo ${round.number}`}
                              className="absolute top-1 right-1 grid size-5 place-items-center rounded text-zinc-600 transition hover:bg-rose-500/10 hover:text-rose-400 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/round:opacity-100"
                            >
                              <XIcon className="size-3" />
                            </button>
                          )}
                        </th>
                      ))}
                      <th
                        scope="col"
                        className={`${stickyRight} border-b bg-surface-2 px-3 py-3 text-right text-accent sm:px-4`}
                      >
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {friends.map((friend, row) => {
                      const total = totals[friend.id]
                      const isLeader = leader?.id === friend.id
                      return (
                        <tr key={friend.id} className="group [&:last-child>*]:border-b-0">
                          <th
                            scope="row"
                            className={`${stickyLeft} relative border-b bg-surface px-3 py-2.5 text-left font-normal transition-colors group-hover:bg-surface-hover sm:px-4`}
                          >
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-accent opacity-0 transition-opacity group-hover:opacity-100"
                            />
                            <div className="flex min-w-28 items-center gap-2 sm:min-w-52 sm:gap-3">
                              <Avatar name={friend.name} isLeader={isLeader} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-zinc-100">{friend.name}</p>
                                {isLeader && (
                                  <p className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-neon">
                                    Lider
                                  </p>
                                )}
                              </div>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => removeFriend(friend)}
                                  aria-label={`Obriši ${friend.name}`}
                                  className="grid size-6 shrink-0 place-items-center rounded-md text-zinc-600 sm:size-7 transition hover:bg-rose-500/10 hover:text-rose-400 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                                >
                                  <XIcon className="size-3.5" />
                                </button>
                              )}
                            </div>
                          </th>

                          {rounds.map((round, col) => {
                            const value = results[friend.id]?.[round.id] ?? ''
                            const parsed = parseResult(value)
                            return (
                              <td
                                key={round.id}
                                className="border-b border-line bg-surface px-1.5 py-2.5 text-center transition-colors group-hover:bg-surface-hover"
                              >
                                {!isAdmin ? (
                                  <span
                                    className={`inline-grid h-10 w-16 place-items-center rounded-lg font-display text-base font-semibold tabular-nums ring-1 ring-inset ${
                                      parsed.status === 'empty' ? 'text-zinc-700 ring-white/6' : cellTone(parsed)
                                    }`}
                                  >
                                    {parsed.status === 'empty' ? '–' : value}
                                  </span>
                                ) : (
                                <input
                                  data-cell={`${row}-${col}`}
                                  value={value}
                                  onChange={(event) => setResult(friend.id, round.id, event.target.value)}
                                  onKeyDown={(event) => handleCellKeyDown(event, row, col)}
                                  inputMode="decimal"
                                  maxLength={5}
                                  placeholder="–"
                                  autoComplete="off"
                                  aria-label={`${friend.name}, kolo ${round.number}`}
                                  aria-invalid={parsed.status === 'invalid'}
                                  title={
                                    parsed.status === 'invalid'
                                      ? 'Format: pogođeni/odigrani, npr. 1/2'
                                      : undefined
                                  }
                                  className={`h-10 w-16 rounded-lg text-center font-display text-base font-semibold tabular-nums outline-none ring-1 ring-inset transition placeholder:text-zinc-700 focus:bg-ink focus:ring-2 focus:ring-accent ${cellTone(parsed)}`}
                                />
                                )}
                              </td>
                            )
                          })}

                          <td
                            className={`${stickyRight} border-b bg-surface px-3 py-2.5 transition-colors group-hover:bg-surface-hover sm:px-4`}
                          >
                            <TotalCell total={total} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <Legend showKeyboardHint={isAdmin} />
            </>
          )}
        </section>
      </main>
    </div>
  )
}

function StatTile({ label, value, sub, highlight = false }) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-lg shadow-black/30 ${
        highlight ? 'border-neon/20 bg-neon/4' : 'border-line bg-surface'
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p
        className={`mt-1 truncate font-display text-2xl font-bold tabular-nums sm:text-3xl ${
          highlight ? 'text-neon' : 'text-white'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs tabular-nums text-zinc-400">{sub}</p>}
    </div>
  )
}

function TotalCell({ total }) {
  if (!total.played) {
    return (
      <div className="w-24 text-right sm:w-36">
        <p className="font-display text-xl text-zinc-600">—</p>
        <p className="text-[11px] text-zinc-600">nije igrao/la</p>
      </div>
    )
  }

  const pct = Math.round(total.pct * 100)
  return (
    <div className="w-24 space-y-1.5 sm:w-36">
      <div className="flex items-baseline justify-end gap-2">
        <span className="font-display text-xl font-bold tabular-nums text-white">
          {total.hits}
          <span className="text-zinc-500">/{total.played}</span>
        </span>
        <span className={`font-display text-sm font-bold tabular-nums ${pctTone(total.pct)}`}>
          {pct}%
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/6">
        <div
          className="h-full rounded-full bg-neon shadow-[0_0_10px_rgba(184,255,60,0.6)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-right text-[11px] tabular-nums text-zinc-500">
        {total.roundsPlayed} {roundsLabel(total.roundsPlayed)}
      </p>
    </div>
  )
}

function Avatar({ name, isLeader }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <span
      className={`grid size-8 shrink-0 place-items-center rounded-full font-display text-xs font-bold sm:size-9 sm:text-sm ${
        isLeader
          ? 'bg-neon text-ink shadow-[0_0_14px_rgba(184,255,60,0.45)]'
          : 'bg-linear-to-br from-zinc-700 to-zinc-800 text-zinc-100 ring-1 ring-white/10'
      }`}
    >
      {initials}
    </span>
  )
}

function Legend({ showKeyboardHint }) {
  const items = [
    { sample: '2/2', label: 'sve pogođeno', tone: 'bg-neon/10 text-neon ring-neon/30' },
    { sample: '1/2', label: 'djelimično', tone: 'bg-accent/10 text-accent ring-accent/30' },
    { sample: '0/2', label: 'promašeno', tone: 'bg-rose-500/10 text-rose-300 ring-rose-500/25' },
    { sample: '–', label: 'prazno = nije igrao/la', tone: 'text-zinc-600 ring-white/10' },
  ]
  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span
              className={`min-w-9 rounded-md px-1.5 py-0.5 text-center font-display text-sm font-semibold ring-1 ring-inset ${item.tone}`}
            >
              {item.sample}
            </span>
            {item.label}
          </li>
        ))}
      </ul>
      {showKeyboardHint && (
        <p className="hidden sm:block">
          <kbd className="rounded border border-line bg-ink px-1.5 py-0.5 font-sans text-[11px] text-zinc-400">
            Enter
          </kbd>{' '}
          prelazi na sljedećeg prijatelja
        </p>
      )}
    </div>
  )
}

function SaveStatus({ save }) {
  const variants = {
    saved: {
      dot: 'bg-neon shadow-[0_0_8px_rgba(184,255,60,0.8)]',
      text: 'text-zinc-500',
      label: 'Sačuvano u bazi',
    },
    saving: {
      dot: 'animate-pulse bg-accent shadow-[0_0_8px_rgba(255,106,19,0.8)]',
      text: 'text-zinc-400',
      label: 'Čuvanje…',
    },
    error: {
      dot: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]',
      text: 'text-rose-400',
      label: `Nije sačuvano: ${save.error}`,
    },
  }
  const variant = variants[save.status]
  return (
    <p role="status" className={`flex items-center gap-2 text-xs ${variant.text}`}>
      <span className={`size-2 shrink-0 rounded-full ${variant.dot}`} />
      {variant.label}
    </p>
  )
}

function LegacyImportBanner({ data, busy, onImport, onDiscard }) {
  const roundCount = data.rounds?.length ?? 0
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/6 p-4 shadow-lg shadow-black/30 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-display text-sm font-bold uppercase tracking-wider text-accent">
          Pronađeni stari podaci
        </p>
        <p className="mt-0.5 text-sm text-zinc-400">
          U ovom pregledaču su sačuvani prijatelji ({data.friends.length}) i kola ({roundCount}) od
          prije. Prebaci ih u bazu da ih ne izgubiš.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="h-10 rounded-lg px-3 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
        >
          Odbaci
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          className="h-10 rounded-lg bg-accent px-4 font-display text-sm font-bold uppercase tracking-wider text-ink shadow-lg shadow-accent/25 transition hover:brightness-110 disabled:opacity-40"
        >
          Prebaci u bazu
        </button>
      </div>
    </section>
  )
}

function LoadingState() {
  return (
    <div className="space-y-px p-4" aria-label="Učitavanje">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 py-3">
          <span className="size-9 animate-pulse rounded-full bg-white/6" />
          <span className="h-4 w-40 animate-pulse rounded bg-white/6" />
          <span className="ml-auto h-4 w-24 animate-pulse rounded bg-white/6" />
        </div>
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-2xl border border-rose-500/30 bg-rose-500/10 font-display text-2xl font-bold text-rose-400">
        !
      </div>
      <h2 className="mt-4 font-display text-xl font-bold uppercase tracking-wide text-white">
        Podaci nisu učitani
      </h2>
      <p className="mt-1 max-w-md text-sm text-zinc-400">{message}</p>
      <p className="mt-1 max-w-md text-xs text-zinc-600">
        Provjeri da je MySQL u Laragonu pokrenut i da aplikaciju pokrećeš sa npm run dev.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-10 items-center rounded-lg border border-accent/40 px-4 font-display text-sm font-bold uppercase tracking-wider text-accent transition hover:bg-accent/10"
      >
        Pokušaj ponovo
      </button>
    </div>
  )
}

function EmptyState({ onAddClick }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-2xl border border-line bg-surface-2 text-accent">
        <BallIcon className="size-7" />
      </div>
      <h2 className="mt-4 font-display text-xl font-bold uppercase tracking-wide text-white">
        Još nema prijatelja
      </h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">
        {onAddClick
          ? 'Dodaj ekipu koja igra tikete, pa za svako kolo upisuj koliko je igrača pogođeno od odigranih.'
          : 'Admin još nije dodao ekipu. Tabela će se pojaviti ovdje čim upiše prve rezultate.'}
      </p>
      {onAddClick && (
        <button
          type="button"
          onClick={onAddClick}
          className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg border border-accent/40 px-4 font-display text-sm font-bold uppercase tracking-wider text-accent transition hover:bg-accent/10"
        >
          <PlusIcon className="size-4" />
          Dodaj prvog prijatelja
        </button>
      )}
    </div>
  )
}

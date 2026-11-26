import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import AppHeader from './AppHeader.jsx'
import { XIcon } from './icons.jsx'
import { ABSENCE_SOURCES, bestPicks, enrichRound, sureOut, fix1, FORMA_GRID, hitsOver, hitsUnder, pctTone, playedCount, readMaxbetHash } from './forma.js'
import FormaAccuracy from './FormaAccuracy.jsx'
import FormaImport from './FormaImport.jsx'
import FormaPlayer, { SourceTag, TipChip } from './FormaPlayer.jsx'
import { useSessionGuard } from './session.js'

const MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar']
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec']
const DAY_SHORT = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']
const SORTS = [
  { id: 'proj', label: 'Projekcija' },
  { id: 'chance', label: 'Šansa za tiket' },
  { id: 'form', label: 'Forma' },
]
const SORT_FNS = {
  proj: (a, b) => b.proj.pts.value - a.proj.pts.value,
  // Ko nije u ponudi Maxbeta nema šansu: ide na kraj.
  chance: (a, b) => b.offered - a.offered || b.chance.pct - a.chance.pct,
  form: (a, b) => b.formPct - a.formPct,
}

// 1 granica, 2 granice, 5 granica, 21 granica.
const linesWord = (n) => (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'granice' : 'granica')

const cardClass =
  'min-w-0 overflow-hidden rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)] before:block before:h-px before:bg-linear-to-r before:from-transparent before:via-accent/70 before:to-transparent before:content-[""]'
const cardHeadClass = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-b border-line px-4.5 py-3.5'
const h2Class = 'font-display text-xl font-bold tracking-[0.06em] text-white uppercase'
const segClass = 'inline-flex max-w-full overflow-x-auto rounded-[9px] bg-surface p-0.75 ring-1 ring-line ring-inset'
const segButtonClass = (on) =>
  `shrink-0 rounded-[7px] px-2.75 py-1.5 font-display text-[13px] font-bold tracking-[0.1em] uppercase transition ${
    on ? 'bg-surface-hover text-white ring-1 ring-white/12 ring-inset' : 'text-zinc-400 hover:text-white'
  }`

const parseDate = (value) => new Date(`${value.slice(0, 10)}T00:00`)
// "čet 20. i pet 21. novembar"; kad se kolo prelije u drugi mjesec, mjesec ide uz svaki dan.
function roundDaysLabel(games) {
  const dates = [...new Set(games.map((game) => game.startsAt.slice(0, 10)))].map(parseDate)
  if (!dates.length) return ''
  const sameMonth = dates.every((d) => d.getMonth() === dates[0].getMonth())
  const parts = dates.map((d) => `${DAY_SHORT[d.getDay()]} ${d.getDate()}.${sameMonth ? '' : ` ${MONTHS[d.getMonth()]}`}`)
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} i ${parts.at(-1)}` : parts[0]
  return sameMonth ? `${joined} ${MONTHS[dates[0].getMonth()]}` : joined
}
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1)
// "Čet 20. nov"
const gameDay = (game) => {
  const d = parseDate(game.startsAt)
  return `${capitalize(DAY_SHORT[d.getDay()])} ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`
}
const gameTime = (game) => game.startsAt.slice(11, 16)
const gamesWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'utakmica' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'utakmice' : 'utakmica')

export default function FormaPage() {
  const [user, setUser] = useState(null)
  const [data, setData] = useState(null)
  const [load, setLoad] = useState({ status: 'loading', error: '' })
  const [roundState, setRoundState] = useState({ busy: false, error: '' })
  const [view, setView] = useState({ game: null, side: 'both', sort: 'proj', open: null })
  // Vrijeme otvaranja stranice: po njemu se zna koje utakmice još nisu počele.
  const [openedAt] = useState(() => Date.now())
  // Granice sa Maxbeta (dugme „Granice → Forma“ otvara /forma#maxbet=…); import = prikazan ekran uvoza.
  const [maxbetRows, setMaxbetRows] = useState(() => readMaxbetHash(window.location.hash))
  const [importOpen, setImportOpen] = useState(() => readMaxbetHash(window.location.hash) !== null)
  // Kolo ili Tačnost Forme; pamti se u adresi (?pogled=tacnost).
  const [page, setPage] = useState(() => (new URLSearchParams(window.location.search).get('pogled') === 'tacnost' ? 'tacnost' : 'kolo'))

  function changePage(next) {
    setPage(next)
    const url = new URL(window.location.href)
    if (next === 'tacnost') url.searchParams.set('pogled', 'tacnost')
    else url.searchParams.delete('pogled')
    window.history.replaceState(null, '', url)
  }

  useSessionGuard()

  // Saigrači po timu: minute odsutnih idu igračima iste pozicije.
  const players = useMemo(() => (data?.players ? enrichRound(data) : []), [data])

  // Admin: igra / upitan / ne igra (null = vrati na izvore). Projekcije se preračunaju sa servera.
  async function saveAbsence(playerId, status) {
    await api('/forma/absence', { method: 'PUT', body: JSON.stringify({ round: data.round, playerId, status }) })
    setData(await api(`/forma?round=${data.round}`))
  }

  function closeImport() {
    setImportOpen(false)
    setMaxbetRows(null)
    window.history.replaceState(null, '', window.location.pathname)
  }

  // Posle uvoza Forma pokazuje nove granice.
  function reloadRound() {
    api(`/forma?round=${data.round}`).then(setData, () => {})
  }

  useEffect(() => {
    let ignore = false
    Promise.all([api('/me'), api('/forma')]).then(
      ([me, forma]) => {
        if (ignore) return
        setUser(me.user)
        setData(forma)
        setLoad({ status: 'ready', error: '' })
      },
      (loadError) => !ignore && loadError.status !== 401 && setLoad({ status: 'error', error: loadError.message }),
    )
    return () => {
      ignore = true
    }
  }, [])

  // Klik na igrača iz "Najbolje šanse kola" otvara ga i skroluje do njega (kad se red iscrta).
  function jumpTo(player, gameId) {
    setView((current) => ({ ...current, game: gameId, side: 'both', open: player.id }))
    setTimeout(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      document.getElementById(`forma-${player.id}`)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    }, 0)
  }

  function changeRound(number) {
    setRoundState({ busy: true, error: '' })
    api(`/forma?round=${number}`).then(
      (forma) => {
        setData(forma)
        setView((current) => ({ ...current, game: null, side: 'both', open: null }))
        setRoundState({ busy: false, error: '' })
      },
      (error) => setRoundState({ busy: false, error: error.message }),
    )
  }

  // Granica sa Maxbeta: ista ide na tikete tog kola (server ih ažurira).
  async function saveLine(playerId, line) {
    const result = await api('/forma/lines', {
      method: 'PUT',
      body: JSON.stringify({ round: data.round, playerId, line }),
    })
    setData((current) => ({
      ...current,
      // U utakmici sa uvezenim Maxbetom igrač bez granice nije u ponudi.
      players: current.players.map((player) =>
        player.id === playerId ? { ...player, line: result.line, offer: player.offer === null ? null : result.line !== null } : player,
      ),
    }))
  }

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-130 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(255,106,19,0.16),transparent)]"
      />
      <main className="relative mx-auto max-w-6xl space-y-5.5 px-4 py-8 sm:px-6 sm:py-12">
        <AppHeader user={user} active="forma" />

        {load.status === 'loading' && <p className="py-16 text-center text-sm text-zinc-500">Učitavanje forme…</p>}
        {load.status === 'error' && (
          <p role="alert" className="rounded-xl px-5 py-10 text-center text-sm text-rose-400 ring-1 ring-line ring-inset">
            {load.error}
          </p>
        )}
        {load.status === 'ready' && importOpen && data.isAdmin && data.round !== null && (
          <FormaImport data={data} players={players} maxbetRows={maxbetRows} onClose={closeImport} onSaved={reloadRound} />
        )}
        {load.status === 'ready' && !(importOpen && data.isAdmin && data.round !== null) && (
          <>
            {/* Kolo ili Tačnost: vidi svako, a adresa /forma?pogled=tacnost se može poslati drugaru. */}
            <div className={segClass} role="group" aria-label="Pogled">
              {[
                ['kolo', data.round === null ? 'Kolo' : `Kolo ${data.round}`],
                ['tacnost', 'Tačnost'],
              ].map(([id, label]) => (
                <button key={id} type="button" aria-pressed={page === id} onClick={() => changePage(id)} className={segButtonClass(page === id)}>
                  {label}
                </button>
              ))}
            </div>
            {page === 'tacnost' ? (
              <FormaAccuracy />
            ) : (
              <FormaContent
                data={data}
                players={players}
                onImport={() => setImportOpen(true)}
                view={view}
                onView={(patch) => setView((current) => ({ ...current, ...patch }))}
                onJump={jumpTo}
                openedAt={openedAt}
                roundState={roundState}
                onRound={changeRound}
                onSaveLine={saveLine}
                onSaveAbsence={saveAbsence}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

function FormaContent({ data, players, onImport, view, onView, onJump, openedAt, roundState, onRound, onSaveLine, onSaveAbsence }) {
  const numbers = data.rounds.map((round) => round.number)
  const index = numbers.indexOf(data.round)

  if (data.round === null) {
    return (
      <p className="rounded-xl px-5 py-10 text-center text-sm text-zinc-400 ring-1 ring-line ring-inset">
        Raspored sezone još nije učitan sa Euroleague sajta. Pokušaj ponovo za koji minut.
      </p>
    )
  }

  const gameOfTeam = new Map()
  for (const game of data.games) {
    gameOfTeam.set(game.home, game)
    gameOfTeam.set(game.away, game)
  }
  const game = data.games.find((g) => g.id === view.game) ?? data.games[0]

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Prethodno kolo"
            disabled={index <= 0 || roundState.busy}
            onClick={() => onRound(numbers[index - 1])}
            className="grid size-8 place-items-center rounded-lg bg-surface text-zinc-400 ring-1 ring-white/12 ring-inset transition hover:text-white disabled:opacity-40"
          >
            ‹
          </button>
          <div className={roundState.busy ? 'opacity-60' : ''}>
            <b className="font-display text-[22px] font-bold tracking-wider text-white uppercase">Kolo {data.round}</b>{' '}
            <span className="text-[13px] text-zinc-400">· {roundDaysLabel(data.games)}</span>
          </div>
          <button
            type="button"
            aria-label="Sljedeće kolo"
            disabled={index >= numbers.length - 1 || roundState.busy}
            onClick={() => onRound(numbers[index + 1])}
            className="grid size-8 place-items-center rounded-lg bg-surface text-zinc-400 ring-1 ring-white/12 ring-inset transition hover:text-white disabled:opacity-40"
          >
            ›
          </button>
        </div>
        {data.pending !== 0 && (
          <span className="rounded-md border border-dashed border-gold/40 px-2 py-1 text-xs text-gold">
            {data.pending === null
              ? 'Istorija utakmica se još nije počela učitavati sa Euroleague sajta.'
              : `Istorija se učitava sa Euroleague sajta: još ${data.pending} ${gamesWord(data.pending)}.`}
          </span>
        )}
      </div>
      {roundState.error && (
        <p role="alert" className="text-sm text-rose-400">
          {roundState.error}
        </p>
      )}

      {!data.games.length ? (
        <p className="rounded-xl px-5 py-10 text-center text-sm text-zinc-400 ring-1 ring-line ring-inset">
          Kolo {data.round} nema utakmica u rasporedu.
        </p>
      ) : (
        <>
          <BestPicks
            players={players}
            games={data.games}
            gameOfTeam={gameOfTeam}
            onJump={onJump}
            now={openedAt}
            onImport={data.isAdmin ? onImport : null}
          />

          <div className="flex gap-2 overflow-x-auto pb-0.5" role="tablist" aria-label="Utakmice kola">
            {data.games.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={g.id === game.id}
                onClick={() => onView({ game: g.id, side: 'both', open: null })}
                className={`flex min-w-37.5 shrink-0 flex-col gap-0.75 rounded-[10px] px-3.5 py-2.25 text-left ring-1 ring-inset transition ${
                  g.id === game.id ? 'bg-accent/10 ring-accent/45' : 'bg-surface ring-line hover:bg-surface-hover'
                }`}
              >
                <b className="font-display text-[17px] font-bold tracking-[0.06em] text-white">
                  {g.home} – {g.away}
                </b>
                <small className="text-xs text-zinc-400">
                  {gameDay(g)} · {gameTime(g)}
                  {g.played ? ' · odigrano' : ''}
                </small>
                {!g.played && (
                  <span
                    className={`self-start rounded-[5px] px-1.5 py-px font-display text-[10.5px] font-bold tracking-widest uppercase ${
                      g.offer === null ? 'bg-white/4 text-zinc-500' : 'bg-gold/10 text-gold'
                    }`}
                  >
                    {g.offer === null ? 'Čeka Maxbet' : `Maxbet · ${g.offer} ${linesWord(g.offer)}`}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2.5">
            <div className={segClass} role="group" aria-label="Tim">
              {[
                ['both', 'Oba tima'],
                ['home', game.homeName],
                ['away', game.awayName],
              ].map(([id, label]) => (
                <button key={id} type="button" aria-pressed={view.side === id} onClick={() => onView({ side: id })} className={segButtonClass(view.side === id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className={segClass} role="group" aria-label="Poredak">
              {SORTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={view.sort === option.id}
                  onClick={() => onView({ sort: option.id })}
                  className={segButtonClass(view.sort === option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4.5">
            {(view.side === 'both' ? ['home', 'away'] : [view.side]).map((side) => (
              <TeamCard
                key={`${game.id}-${side}`}
                game={game}
                side={side}
                players={players.filter((p) => p.team === game[side]).sort(SORT_FNS[view.sort])}
                open={view.open}
                onToggle={(id) => onView({ open: view.open === id ? null : id })}
                isAdmin={data.isAdmin}
                onSaveLine={onSaveLine}
                onSaveAbsence={onSaveAbsence}
                injuries={data.injuries}
              />
            ))}
          </div>
        </>
      )}

      <Method />
    </>
  )
}

function BestPicks({ players, games, gameOfTeam, onJump, now, onImport }) {
  const best = bestPicks(players, games, gameOfTeam, now)
  if (!best.length) return null

  return (
    <section className={cardClass} aria-labelledby="forma-best">
      <div className={cardHeadClass}>
        <div>
          <h2 id="forma-best" className={h2Class}>
            Najbolje šanse kola
          </h2>
          <p className="mt-0.5 text-[13px] text-zinc-400">
            Poredano po šansi da tip prođe. Granica je sa Maxbeta gdje ju je admin upisao, a ostalo je naša procjena.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <TipChip tip="+" small /> preko granice
          </span>
          <span className="flex items-center gap-1.5">
            <TipChip tip="−" small /> ispod granice
          </span>
          {onImport && (
            <button
              type="button"
              onClick={onImport}
              className="rounded-[7px] px-2.5 py-1 font-display text-xs font-bold tracking-[0.08em] text-gold uppercase ring-1 ring-gold/35 ring-inset transition hover:bg-gold/10"
            >
              Uvezi sa Maxbeta
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-px bg-line">
        {best.map((p) => {
          const last5 = p.last10.slice(0, 5)
          const hits = (p.chance.tip === '+' ? hitsOver : hitsUnder)(last5, p.line)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onJump(p, gameOfTeam.get(p.team)?.id)}
              className="flex flex-col gap-2 bg-surface px-4 py-3.5 text-left transition hover:bg-surface-hover"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <b className="block leading-tight font-semibold text-white">{p.name}</b>
                  <small className="text-xs text-zinc-400">
                    {p.team} – {p.opp} · {p.home ? 'kod kuće' : 'u gostima'}
                  </small>
                </div>
                <span className={`font-display text-[28px] leading-none font-extrabold tabular-nums ${pctTone(p.chance.pct)}`}>
                  {p.chance.pct}
                  <small className="text-sm">%</small>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-400">
                <span className="flex items-center gap-1">
                  <SourceTag source={p.lineSrc} /> <b className="font-semibold text-white tabular-nums">{p.line}</b>
                  <TipChip tip={p.chance.tip} small />
                </span>
                <span>
                  Proj. <b className="font-semibold text-white tabular-nums">{fix1(p.proj.pts.value)}</b>
                </span>
                <span>
                  Zadnjih 5:{' '}
                  <b className="font-semibold text-white tabular-nums">
                    {hits}/{playedCount(last5)}
                  </b>
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function TeamCard({ game, side, players, open, onToggle, isAdmin, onSaveLine, onSaveAbsence, injuries }) {
  const home = side === 'home'
  const code = game[side]
  const name = home ? game.homeName : game.awayName
  const opp = home ? game.away : game.home
  const oppName = home ? game.awayName : game.homeName
  const labelClass = 'font-display text-[10px] font-semibold tracking-[0.16em] text-zinc-400 uppercase'

  return (
    <section className={cardClass} aria-label={name}>
      <div className={cardHeadClass}>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-[10px] bg-accent/12 font-display text-sm font-extrabold tracking-[0.04em] text-accent ring-1 ring-accent/35 ring-inset">
            {code}
          </span>
          <div>
            <h2 className={h2Class}>{name}</h2>
            <p className="mt-0.5 text-[13px] text-zinc-400">
              {home ? 'Kod kuće' : 'U gostima'} protiv {oppName} · {gameDay(game)} u {gameTime(game)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-zinc-400">
          <span>
            <i className="mr-1.25 inline-block size-2.5 rounded-[3px] bg-neon/50 align-[-1px]" />
            iznad prosjeka / preko granice
          </span>
          <span>
            <i className="mr-1.25 inline-block size-2.5 rounded-[3px] bg-rose-400/50 align-[-1px]" />
            ispod
          </span>
          <span>starije → novije</span>
        </div>
      </div>
      <div className={`hidden items-center gap-3.5 border-b border-line bg-surface-2 px-4.5 py-2.25 min-[861px]:grid ${FORMA_GRID}`}>
        <span className={labelClass}>Igrač</span>
        <span className={labelClass}>Poeni · zadnjih 5</span>
        <span className={labelClass}>Asistencije</span>
        <span className={labelClass}>Skokovi</span>
        <span className={`${labelClass} text-right`}>Protiv {opp}</span>
        <span className={`${labelClass} text-right`}>Projekcija</span>
      </div>
      {players.length ? (
        players.map((player) => (
          <FormaPlayer
            key={player.id}
            player={player}
            open={open === player.id}
            onToggle={() => onToggle(player.id)}
            opponentName={oppName}
            isAdmin={isAdmin}
            onSaveLine={onSaveLine}
          />
        ))
      ) : (
        <p className="px-4.5 py-6 text-sm text-zinc-400">Još nema igrača sa odigranom utakmicom ove sezone.</p>
      )}
      {isAdmin && <Absences team={code} players={players} injuries={injuries} onSave={onSaveAbsence} />}
    </section>
  )
}

const ABSENCE_STATES = [
  ['in', 'Igra', 'bg-neon/12 text-neon'],
  ['maybe', 'Upitan', 'bg-gold/14 text-gold'],
  ['out', 'Ne igra', 'bg-rose-500/14 text-rose-400'],
]
const SOURCE_CHIPS = {
  basketnews: 'bg-violet-400/12 text-violet-300',
  maxbet: 'bg-gold/10 text-gold',
  dnp: 'bg-white/5 text-zinc-400',
  admin: 'bg-accent/12 text-accent',
}
const STATUS_NAMES = { out: 'Out', doubtful: 'Doubtful', uncertain: 'Uncertain', expected: 'Expected', in: 'igra', maybe: 'upitan' }
// Status za dugmad: Out/Doubtful = ne igra, Uncertain = upitan, Expected = igra.
const buttonState = (status) => ({ out: 'out', doubtful: 'out', uncertain: 'maybe', maybe: 'maybe' })[status] ?? 'in'

// Admin: ko ne igra u timu, odakle se zna i koliko minuta oslobađa. Drugari vide samo oznake na igračima.
function Absences({ team, players, injuries, onSave }) {
  const [state, setState] = useState({ busy: null, error: '' })
  const absent = players.filter((p) => p.absence).sort((a, b) => b.absence.min - a.absence.min)
  const others = injuries?.other?.[team] ?? []

  async function save(playerId, status) {
    setState({ busy: playerId, error: '' })
    try {
      await onSave(playerId, status)
      setState({ busy: null, error: '' })
    } catch (error) {
      setState({ busy: null, error: error.message })
    }
  }

  return (
    <div className="border-t border-line bg-surface-2/60">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4.5 pt-3 pb-2">
        <h3 className="font-display text-sm font-bold tracking-[0.14em] text-white uppercase">
          Ko ne igra
          <small className="ml-1.5 font-sans text-xs font-medium tracking-normal text-zinc-400 normal-case">vidi samo admin</small>
        </h3>
        <AbsencePicker players={players.filter((p) => !p.absence)} disabled={state.busy !== null} onPick={(id) => save(id, 'out')} />
      </div>
      {absent.length ? (
        absent.map((p) => {
          const a = p.absence
          const pressed = buttonState(a.status)
          return (
            <div
              key={p.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 border-t border-line px-4.5 py-2.75 min-[861px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_88px_auto]"
            >
              <div className="min-w-0">
                <b className="block truncate font-semibold text-white">
                  {p.name} <span className="font-display text-xs font-bold text-zinc-500">{p.pos}</span>
                </b>
                <small className="block text-xs text-zinc-400 tabular-nums">
                  zadnjih 5: {p.last10.slice(0, 5).map((g) => (g.dnp ? 'DNP' : g.min)).join(' · ')}
                </small>
              </div>
              <div className="col-span-2 row-start-2 flex min-w-0 flex-col gap-0.75 min-[861px]:col-span-1 min-[861px]:row-start-auto">
                <span className={`self-start rounded-[5px] px-1.75 py-0.5 font-display text-[10.5px] font-bold tracking-[0.08em] whitespace-nowrap uppercase ${SOURCE_CHIPS[a.source]}`}>
                  {ABSENCE_SOURCES[a.source]}
                  {a.source === 'basketnews' || a.source === 'admin' ? ` · ${STATUS_NAMES[a.status]}` : ''}
                </span>
                {a.comment && <small className="text-xs leading-snug text-zinc-500">{a.comment}</small>}
                {a.source === 'maxbet' && (
                  <small className="text-xs leading-snug text-zinc-500">Redovan ({fix1(p.season.min)} min), a uvoz sa Maxbeta ga nema.</small>
                )}
              </div>
              <div className="text-right tabular-nums">
                <b className={`font-display text-lg font-extrabold ${sureOut(a) && a.min >= 0.5 ? 'text-white' : 'text-zinc-500'}`}>
                  {sureOut(a) ? Math.round(a.min) : 0} min
                </b>
                <small className="block text-[11px] text-zinc-500">
                  {sureOut(a) ? (a.min > 0 ? `oslobađa (${p.pos})` : 'već ne igra') : a.weight === 0 ? 'igra' : 'samo oznaka'}
                </small>
              </div>
              <div className="col-span-2 flex items-center gap-1.5 justify-self-start min-[861px]:col-span-1 min-[861px]:justify-self-end">
                <div role="group" aria-label={`${p.name}: igra ili ne`} className="inline-flex rounded-lg p-0.5 ring-1 ring-white/12 ring-inset">
                  {ABSENCE_STATES.map(([status, label, on]) => (
                    <button
                      key={status}
                      type="button"
                      disabled={state.busy !== null}
                      aria-pressed={pressed === status}
                      onClick={() => pressed !== status && save(p.id, status)}
                      className={`rounded-md px-2 py-1 font-display text-xs font-bold tracking-[0.06em] uppercase transition disabled:opacity-60 ${
                        pressed === status ? on : 'text-zinc-500 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Moja oznaka se briše skroz: igrač se vraća na BasketNews / Maxbet, ili nestaje sa spiska. */}
                {a.source === 'admin' ? (
                  <button
                    type="button"
                    disabled={state.busy !== null}
                    onClick={() => save(p.id, null)}
                    aria-label={`Obriši moju oznaku za ${p.name}`}
                    title="Obriši moju oznaku"
                    className="grid size-7.5 place-items-center rounded-lg text-zinc-500 ring-1 ring-white/12 transition ring-inset hover:bg-rose-500/10 hover:text-rose-400 hover:ring-rose-400/40 disabled:opacity-60"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                ) : (
                  <span aria-hidden="true" className="hidden size-7.5 min-[861px]:block" />
                )}
              </div>
            </div>
          )
        })
      ) : (
        <p className="border-t border-line px-4.5 py-3 text-[13px] text-zinc-400">Nema odsutnih. Svi koji igraju minute su na raspolaganju.</p>
      )}
      {state.error && (
        <p role="alert" className="px-4.5 pb-2 text-xs text-rose-400">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line px-4.5 py-2.5 text-xs text-zinc-400">
        <span>
          {injuries?.okAt ? (
            <>
              <a href={injuries.url} target="_blank" rel="noreferrer" className="text-zinc-300 underline decoration-white/20 underline-offset-2 hover:text-white">
                BasketNews
              </a>{' '}
              pročitan {shortWhen(injuries.okAt)} · {injuries.count} igrača
            </>
          ) : (
            'BasketNews još nije pročitan.'
          )}
          {injuries?.error && <span className="text-rose-400"> · zadnji pokušaj: {injuries.error}</span>}
        </span>
        {others.length > 0 && (
          <span>
            Bez minuta u sezoni: {others.map((o) => `${o.name} (${STATUS_NAMES[o.status]})`).join(', ')}
          </span>
        )}
      </div>
    </div>
  )
}

// "2026-11-24T12:30" → "danas u 12:30" / "24.11 u 12:30".
function shortWhen(value) {
  const date = new Date(value)
  const today = new Date().toDateString() === date.toDateString()
  return `${today ? 'danas' : `${date.getDate()}.${date.getMonth() + 1}`} u ${value.slice(11, 16)}`
}

function Method() {
  const items = [
    [
      '1. Baza',
      '45% forma zadnjih 5 (novija utakmica nosi više), 35% prosjek sezone, 20% istorija protiv protivnika. Ako je protiv njega igrao manje od 4 puta, taj dio nosi manje.',
    ],
    ['2. Minute', 'Ako zadnjih 5 igra više minuta nego u sezoni, projekcija raste (najviše ±10%).'],
    ['3. Domaćin / gost', 'Kod kuće +3%, u gostima −3%. Kasnije ovo računamo za svakog igrača posebno.'],
    ['4. Odbrana protivnika', 'Koliko poena protivnik prima od igrača te pozicije, u odnosu na prosjek lige (najviše ±15%).'],
    [
      '5. Odsutni saigrači',
      'Ko sigurno ne igra (Out na BasketNewsu, ili admin označi "Ne igra") oslobađa svoje minute iz zadnjih 5. Tri četvrtine idu igračima iste pozicije, po minutama u sezoni. Od 3 utakmice bez njih uzima se i stvarni prosjek. "Nema ga na Maxbetu", "nije igrao zadnju" i upitni dobiju samo oznaku.',
    ],
    [
      'Granica',
      'Prava granica sa Maxbeta kad je admin upiše. Do tada procjena po Maxbetovom pravilu, naučenom iz uvezenih granica (vidi Tačnost); dok ih nema 60, 60% prosjek sezone + 40% forma. Zaokruženo na .5.',
    ],
    [
      'Šansa za tiket',
      'Projekcija naspram granice, uz to koliko igrač oscilira. Stalan igrač na 17 uz granicu 15.5 je sigurniji od onog koji igra 8 pa 26. Nikad preko 80%.',
    ],
    [
      'Maxbet zna nešto',
      'Kad je Maxbet granica bar 3 poena (kod većih granica 20%) iznad naše procjene granice, a odsutni saigrači to ne objašnjavaju, kladionica vjerovatno zna nešto što mi ne znamo. Šansa se tada prepolovi prema 50% i igrač ne ulazi u najbolje šanse. Niža granica se ne označava.',
    ],
  ]
  return (
    <footer className={cardClass}>
      <div className={cardHeadClass}>
        <div>
          <h2 className={h2Class}>Kako se računa projekcija</h2>
          <p className="mt-0.5 text-[13px] text-zinc-400">Ista formula za poene, asistencije i skokove.</p>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-x-7 gap-y-4 px-4.5 py-4 text-[13px] leading-relaxed text-zinc-400">
        {items.map(([title, text]) => (
          <div key={title}>
            <b className="font-semibold text-white">{title}</b>
            <p className="mt-1">{text}</p>
          </div>
        ))}
      </div>
    </footer>
  )
}

const LIST_HEIGHT = 300

// Meni "+ Označi da ne igra": igrači po minutama, sa pozicijom. Lista je fixed (ne siječe je kartica tima)
// i otvara se iznad dugmeta kad dolje nema mjesta. Strelice, Enter i Escape rade kao u pravom meniju.
function AbsencePicker({ players, disabled, onPick }) {
  const listId = useId()
  const buttonRef = useRef(null)
  const listRef = useRef(null)
  const [menu, setMenu] = useState(null)
  const [active, setActive] = useState(0)
  const options = [...players].sort((a, b) => b.season.min - a.season.min)

  function openMenu() {
    const rect = buttonRef.current.getBoundingClientRect()
    const width = Math.min(300, window.innerWidth - 32)
    const below = window.innerHeight - rect.bottom
    setMenu({
      left: Math.max(16, Math.min(rect.right - width, window.innerWidth - 16 - width)),
      width,
      ...(below < LIST_HEIGHT + 16 && rect.top > below ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    })
    setActive(0)
    setTimeout(() => listRef.current?.focus(), 0)
  }

  function close(refocus = true) {
    setMenu(null)
    if (refocus) buttonRef.current?.focus()
  }

  function pick(player) {
    close()
    onPick(player.id)
  }

  // Klik van menija, skrol ili promjena veličine prozora zatvara meni.
  useEffect(() => {
    if (!menu) return undefined
    const onPointer = (event) => {
      if (!listRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) close(false)
    }
    const onScroll = (event) => {
      if (!listRef.current?.contains(event.target)) close(false)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [menu])

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      setActive(next)
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (options[active]) pick(options[active])
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      close(event.key === 'Escape')
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled || !options.length}
        aria-haspopup="listbox"
        aria-expanded={Boolean(menu)}
        aria-controls={menu ? listId : undefined}
        onClick={() => (menu ? close() : openMenu())}
        className={`inline-flex h-8 items-center gap-2 rounded-lg bg-ink pr-2.5 pl-3 font-display text-[13px] font-bold tracking-[0.06em] uppercase ring-1 transition ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${
          menu ? 'text-white ring-accent/60' : 'text-zinc-300 ring-white/12 hover:text-white hover:ring-white/25'
        }`}
      >
        + Označi da ne igra
        <svg aria-hidden="true" viewBox="0 0 12 12" className={`size-3 fill-none stroke-current stroke-[1.6] transition ${menu ? 'rotate-180' : ''}`}>
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menu && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label="Igrač koji ne igra"
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onKeyDown}
          style={{ position: 'fixed', left: menu.left, width: menu.width, top: menu.top, bottom: menu.bottom, maxHeight: LIST_HEIGHT }}
          className="z-50 overflow-y-auto overscroll-contain rounded-xl bg-surface-2 p-1 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/12 outline-none motion-safe:animate-[open-down_.14s_ease-out]"
        >
          <li role="presentation" className="px-2.5 pt-1.5 pb-1 font-display text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
            Po minutama u sezoni
          </li>
          {options.map((p, index) => (
            <li
              key={p.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onPointerMove={() => setActive(index)}
              onClick={() => pick(p)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${
                index === active ? 'bg-white/7 text-white' : 'text-zinc-300'
              }`}
            >
              <span className="grid size-5.5 shrink-0 place-items-center rounded-md bg-white/5 font-display text-[11px] font-extrabold text-zinc-400 ring-1 ring-white/12 ring-inset">
                {p.pos}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{fix1(p.season.min)} min</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

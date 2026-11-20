import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import AppHeader from './AppHeader.jsx'
import { useSessionGuard } from './session.js'

const RULES = [
  { id: 'all', label: 'Svih 6' },
  { id: 'pause', label: 'Pauza jedno izvlačenje', recommended: true },
  { id: 'cycle', label: 'Fer krug' },
]
const RULE_TEXT = {
  all: 'Svih 6 je u bubnju za svako izvlačenje. Isti čovjek može biti izvučen više puta zaredom.',
  pause: 'Ko je izvučen u prošlom izvlačenju, pauzira jedno. Kad se kolo igra dva dana, izvučeni za prvi dan ne ulaze u bubanj za drugi. U bubnju je uvijek 4.',
  cycle: 'Niko ne bira drugi put dok svi ne dođu na red. Svako bira tačno jednom u 3 izvlačenja.',
}

const SPIN_MS = 2200
const TICK_MS = 120
// Lopte miruju na dnu bubnja (gornji lijevi ugao lopte, u procentima stakla).
const REST = [[17, 66], [38.5, 69], [60, 66], [27.5, 47], [49, 49], [38, 28]]
const CENTER = [38.5, 38.5]
const IDLE = { phase: 'idle', positions: null, winner: null }

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function randomSpots(ids) {
  return Object.fromEntries(
    ids.map((id) => {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.sqrt(Math.random()) * 30
      return [id, [CENTER[0] + Math.cos(angle) * radius, CENTER[1] + Math.sin(angle) * radius]]
    }),
  )
}

function restSpots(ids) {
  return Object.fromEntries(ids.map((id, index) => [id, REST[index % REST.length]]))
}

// "2026-10-06T20:15" -> "6. 10. u 20:15"
function formatTime(value) {
  if (!value) return ''
  const [date, time] = value.split('T')
  const [, month, day] = date.split('-').map(Number)
  return `${day}. ${month}. u ${time}`
}

const DAY_NAMES = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota']
const DAY_ACCUSATIVE = ['nedjelju', 'ponedjeljak', 'utorak', 'srijedu', 'četvrtak', 'petak', 'subotu']
const DAY_SHORT = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']
const weekday = (date) => new Date(`${date}T00:00`).getDay()
// Dan izvlačenja: "petak", "za petak", "pet"; null za kolo bez rasporeda.
const dayName = (date) => DAY_NAMES[weekday(date)]
const dayAcc = (date) => DAY_ACCUSATIVE[weekday(date)]
const dayShort = (date) => DAY_SHORT[weekday(date)]

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1)
const ballWord = (n) => (n === 1 ? 'lopta' : n >= 2 && n <= 4 ? 'lopte' : 'lopti')

export default function DrumPage() {
  const [user, setUser] = useState(null)
  const [draw, setDraw] = useState(null)
  const [load, setLoad] = useState({ status: 'loading', error: '' })
  const [anim, setAnim] = useState(IDLE)
  const [error, setError] = useState('')
  const tickRef = useRef(null)

  useSessionGuard()

  useEffect(() => {
    let ignore = false
    Promise.all([api('/me'), api('/draw')]).then(
      ([me, state]) => {
        if (ignore) return
        setUser(me.user)
        setDraw(state)
        setLoad({ status: 'ready', error: '' })
      },
      (loadError) => {
        if (!ignore && loadError.status !== 401) setLoad({ status: 'error', error: loadError.message })
      },
    )
    return () => {
      ignore = true
      clearInterval(tickRef.current)
    }
  }, [])

  const isAdmin = user?.role === 'admin'
  const busy = anim.phase !== 'idle'

  async function selectDay(day) {
    if (busy || day === draw.day) return
    setError('')
    try {
      setDraw(await api(`/draw?day=${day}`))
    } catch (dayError) {
      setError(dayError.message)
    }
  }

  async function skipDay(skip) {
    setError('')
    try {
      setDraw(await api('/draw/skip', { method: 'POST', body: JSON.stringify({ roundId: draw.round.id, day: draw.day, skip }) }))
    } catch (skipError) {
      setError(skipError.message)
    }
  }

  async function animateDraw(request) {
    const ids = draw.people.filter((p) => p.status === 'in').map((p) => p.friendId)
    setError('')
    const motion = !reduceMotion()
    setAnim({ phase: 'spinning', positions: randomSpots(ids), winner: null })
    if (motion) {
      tickRef.current = setInterval(() => {
        setAnim((current) => (current.phase === 'spinning' ? { ...current, positions: randomSpots(ids) } : current))
      }, TICK_MS)
    }
    const started = Date.now()
    let result
    try {
      result = await request()
    } catch (drawError) {
      clearInterval(tickRef.current)
      setAnim(IDLE)
      setError(drawError.message)
      return
    }
    if (motion) await sleep(Math.max(0, SPIN_MS - (Date.now() - started)))
    clearInterval(tickRef.current)

    const winner = result.drawnFriendId
    if (ids.includes(winner)) {
      const others = ids.filter((id) => id !== winner)
      setAnim({ phase: 'reveal', winner, positions: { ...restSpots(others), [winner]: CENTER } })
      await sleep(motion ? 900 : 300)
      setAnim((current) => ({ ...current, phase: 'gone' }))
      await sleep(motion ? 350 : 0)
    }
    setDraw(result.state)
    setAnim(IDLE)
  }

  function drawNext() {
    animateDraw(() => api('/draw', { method: 'POST', body: JSON.stringify({ roundId: draw.round.id, day: draw.day }) }))
  }

  function replace(slot, person) {
    const when = draw.day ? `za ${dayAcc(draw.day)}` : 'u ovom kolu'
    if (!window.confirm(`Izvući zamjenu za ${person.short}? On ${when} neće birati 2 igrača.`)) return
    animateDraw(() =>
      api('/draw/replace', { method: 'POST', body: JSON.stringify({ roundId: draw.round.id, day: draw.day, slot }) }),
    )
  }

  async function cancelDraw() {
    const what = draw.day ? `za ${dayAcc(draw.day)} (kolo ${draw.round.number})` : `za kolo ${draw.round.number}`
    if (!window.confirm(`Poništiti izvlačenje ${what}? U istoriji ostaje zapisano da je poništeno.`)) {
      return
    }
    setError('')
    try {
      setDraw(await api('/draw/cancel', { method: 'POST', body: JSON.stringify({ roundId: draw.round.id, day: draw.day }) }))
    } catch (cancelError) {
      setError(cancelError.message)
    }
  }

  async function changeRule(rule) {
    setError('')
    try {
      setDraw(await api('/draw/rule', { method: 'PUT', body: JSON.stringify({ rule, day: draw.day }) }))
    } catch (ruleError) {
      setError(ruleError.message)
    }
  }

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-130 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(255,106,19,0.16),transparent)]"
      />
      <main className="relative mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <AppHeader user={user} active="bubanj" />

        {load.status === 'loading' && <p className="py-16 text-center text-sm text-zinc-500">Učitavanje bubnja…</p>}
        {load.status === 'error' && (
          <p role="alert" className="rounded-xl px-5 py-10 text-center text-sm text-rose-400 ring-1 ring-line ring-inset">
            {load.error}
          </p>
        )}
        {load.status === 'ready' && !draw.round && (
          <p className="rounded-xl bg-surface px-5 py-14 text-center text-sm text-zinc-400 ring-1 ring-line ring-inset">
            Još nema nijednog kola. Bubanj radi kad admin otvori kolo u tabeli.
          </p>
        )}
        {load.status === 'ready' && draw.round && (
          <DrumContent
            draw={draw}
            user={user}
            isAdmin={isAdmin}
            anim={anim}
            busy={busy}
            error={error}
            onDraw={drawNext}
            onReplace={replace}
            onCancel={cancelDraw}
            onRuleChange={changeRule}
            onSelectDay={selectDay}
            onSkip={skipDay}
          />
        )}
      </main>
    </div>
  )
}

function DrumContent({ draw, user, isAdmin, anim, busy, error, onDraw, onReplace, onCancel, onRuleChange, onSelectDay, onSkip }) {
  const { round, people, day } = draw
  const byId = Object.fromEntries(people.map((p) => [p.friendId, p]))
  const days = draw.days ?? []
  const dayInfo = days.find((d) => d.date === day) ?? null
  const skipped = Boolean(dayInfo?.skipped)
  const current = draw.draws.filter((d) => d.roundNumber === round.number && (d.day ?? null) === day && !d.cancelledAt)
  const active = current.filter((d) => !d.replacedAt).sort((a, b) => a.slot - b.slot)
  const inDrum = people.filter((p) => p.status === 'in')
  const roundDone = round.status === 'done'
  const complete = active.length >= 2
  const lastActive = active.reduce((latest, d) => (!latest || d.drawnAt > latest.drawnAt ? d : latest), null)
  const meDrawn = active.some((d) => d.friendId === user.friendId)

  let caption
  if (anim.phase === 'spinning') caption = <b className="font-semibold text-white">Bubanj se okreće…</b>
  else if (complete) caption = day ? `Izvlačenje za ${dayAcc(day)} je završeno.` : `Izvlačenje za kolo ${round.number} je završeno.`
  else if (skipped) caption = `Za ${dayAcc(day)} se ne izvlači.`
  else
    caption = (
      <>
        U bubnju{day ? ` za ${dayAcc(day)}` : ''}: <b className="font-semibold text-white">{inDrum.length}</b>{' '}
        {ballWord(inDrum.length)}. Izvučena lopta ne vraća se u bubanj.
      </>
    )

  const balls = anim.positions
    ? Object.keys(anim.positions).map(Number)
    : inDrum.map((p) => p.friendId)
  const positions = anim.positions ?? restSpots(balls)

  return (
    <>
      {isAdmin && (
        <section
          aria-label="Podešavanja bubnja"
          className="flex flex-wrap items-center gap-x-6.5 gap-y-3 rounded-xl border border-dashed border-white/16 px-4 py-3.5"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600">
              Pravilo bubnja
            </span>
            <div className="inline-flex flex-wrap rounded-[9px] bg-surface p-0.75 ring-1 ring-line ring-inset">
              {RULES.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={draw.rule === rule.id}
                  onClick={() => draw.rule !== rule.id && onRuleChange(rule.id)}
                  className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition ${
                    draw.rule === rule.id
                      ? 'bg-surface-hover text-white ring-1 ring-white/16 ring-inset'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {rule.label}
                  {rule.recommended && <span className="ml-1 text-[11px] text-neon">prijedlog</span>}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy || roundDone || current.length === 0}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-zinc-400 transition hover:text-white disabled:pointer-events-none disabled:opacity-40"
          >
            Poništi izvlačenje{day ? ` za ${dayAcc(day)}` : ''}
          </button>
        </section>
      )}

      {day && (
        <DayPicker days={days} selected={day} busy={busy} byId={byId} onSelect={onSelectDay} />
      )}

      <section
        aria-label={`Izvlačenje za kolo ${round.number}`}
        className="grid grid-cols-1 overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_30px_60px_-30px_rgba(0,0,0,0.8)] min-[880px]:grid-cols-2"
      >
        <div className="col-span-full h-px bg-linear-to-r from-transparent via-accent/70 to-transparent" />

        <div className="flex flex-col items-center gap-4.5 bg-surface-2 bg-[radial-gradient(70%_60%_at_50%_45%,rgba(255,106,19,0.09),transparent_70%)] px-5 pt-7 pb-6 min-[880px]:border-r min-[880px]:border-line">
          <div className="relative aspect-square w-[min(320px,78vw)] max-w-full">
            <div className={`absolute inset-0 rounded-full ${anim.phase === 'spinning' ? 'animate-[spin_1.1s_linear_infinite] motion-reduce:animate-none' : ''}`} aria-hidden="true">
              <svg viewBox="0 0 100 100" className="block size-full">
                <circle cx="50" cy="50" r="48.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
                <circle cx="50" cy="50" r="48.5" fill="none" stroke="rgba(255,106,19,0.55)" strokeWidth="1.6" strokeDasharray="1.2 6.4" />
                <path d="M50 1.5 A48.5 48.5 0 0 1 84.3 15.7" fill="none" stroke="#ff6a13" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="absolute inset-[7%] overflow-hidden rounded-full bg-[radial-gradient(60%_45%_at_35%_25%,rgba(255,255,255,0.08),transparent_60%),radial-gradient(circle_at_50%_50%,#141720,#0c0e13_70%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16),inset_0_-20px_40px_rgba(0,0,0,0.6),0_20px_50px_-20px_rgba(0,0,0,0.9)]">
              {balls.length ? (
                balls.map((id) => (
                  <Ball
                    key={id}
                    label={byId[id]?.short ?? ''}
                    position={positions[id]}
                    spinning={anim.phase === 'spinning'}
                    picked={anim.winner === id}
                    gone={anim.winner === id && anim.phase === 'gone'}
                  />
                ))
              ) : (
                <p className="absolute inset-0 grid place-items-center p-[22%] text-center text-sm text-zinc-600">
                  Bubanj je prazan za ovo kolo.
                </p>
              )}
            </div>
          </div>
          <p className="max-w-[30ch] text-center text-sm text-zinc-400">{caption}</p>
        </div>

        <div className="flex min-w-0 flex-col gap-4.5 px-5 py-6">
          <div className="flex flex-col gap-1.5">
            <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent">Ko bira 2 igrača</span>
            <h2 className="font-display text-[40px] font-extrabold uppercase leading-[0.95] text-white">
              Kolo {round.number}
              {day && <span className="text-accent"> · {dayName(day)}</span>}
            </h2>
            <p className="text-zinc-400">
              {day
                ? `Tiket za ${dayAcc(day)} igra 8 igrača, 2 tiketa po 4. Svako bira jednog, a dvojica izvučenih biraju po dva. Rok ${dayShort(day)} u ${dayInfo.deadline.slice(11, 16)}.`
                : 'Igramo 2 tiketa po 4 igrača. Svako bira jednog, a dvojica izvučenih biraju po dva.'}
            </p>
          </div>

          <div className="grid gap-2.5">
            {[1, 2].map((slot) => {
              const entry = active.find((d) => d.slot === slot)
              const person = entry && byId[entry.friendId]
              if (!person) {
                const drawing = busy && anim.phase !== 'idle' && slot === active.length + 1
                return (
                  <div
                    key={slot}
                    className="grid min-h-18.5 grid-cols-[44px_minmax(0,1fr)] items-center gap-3.5 rounded-xl border-[1.5px] border-dashed border-white/16 px-4 py-3"
                  >
                    <span className="text-center font-display text-[34px] font-extrabold leading-none text-zinc-600">{slot}</span>
                    <span className="text-sm text-zinc-600">{drawing ? 'Izvlači se…' : 'Još nije izvučen'}</span>
                  </div>
                )
              }
              const me = person.friendId === user.friendId
              return (
                <div
                  key={slot}
                  className={`grid min-h-18.5 animate-[pop_0.45s_cubic-bezier(.3,1.6,.5,1)] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl bg-[linear-gradient(90deg,rgba(184,255,60,0.1),transparent_70%)] bg-ink px-4 py-3 ring-1 ring-neon/35 ring-inset motion-reduce:animate-none ${
                    me ? 'shadow-[0_0_0_3px_rgba(184,255,60,0.1)]' : ''
                  }`}
                >
                  <span className="text-center font-display text-[34px] font-extrabold leading-none text-neon">{slot}</span>
                  <div className="min-w-0">
                    <b className="block font-display text-2xl font-bold uppercase leading-[1.05] wrap-anywhere text-white">
                      {person.short}
                    </b>
                    <small className="text-[13px] text-zinc-400">{person.name}</small>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="whitespace-nowrap rounded-[5px] bg-neon/10 px-1.75 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-neon">
                      {me ? 'Ti · 2 igrača' : '2 igrača'}
                      {day ? ` · ${dayShort(day)}` : ''}
                    </span>
                    {isAdmin && !roundDone && (
                      <button
                        type="button"
                        onClick={() => onReplace(slot, person)}
                        disabled={busy}
                        className="text-xs text-zinc-500 underline-offset-4 transition hover:text-accent hover:underline disabled:pointer-events-none"
                      >
                        Izvuci zamjenu
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {error && (
            <p role="alert" className="text-[13px] text-rose-400">
              {error}
            </p>
          )}

          <DrawAction
            round={round}
            day={day}
            skipped={skipped}
            onSkip={onSkip}
            isAdmin={isAdmin}
            busy={busy}
            activeCount={active.length}
            inDrumCount={inDrum.length}
            roundDone={roundDone}
            complete={complete}
            meDrawn={meDrawn}
            savedAt={lastActive ? `${formatTime(lastActive.drawnAt)}, izvukao ${lastActive.drawnBy ?? 'admin'}` : ''}
            onDraw={onDraw}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 min-[880px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white">Ko je u bubnju</h2>
            <span className="text-[13px] text-zinc-400">{inDrum.length} u bubnju</span>
          </div>
          <p className="text-sm text-zinc-400">{RULE_TEXT[draw.rule]}</p>
          <div className="flex flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-line ring-inset">
            {people.map((person) => (
              <PersonRow key={person.friendId} person={person} roundNumber={round.number} day={day} />
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white">Istorija izvlačenja</h2>
            <span className="text-[13px] text-zinc-400">svako izvlačenje se čuva</span>
          </div>
          <History draws={draw.draws} byId={byId} currentRound={round.number} currentDay={day} />
        </div>
      </section>
    </>
  )
}

// Kolo koje se igra dva dana: kartica za svaki dan tiketa, sa izvučenima ili rokom.
function DayPicker({ days, selected, busy, byId, onSelect }) {
  return (
    <section aria-label="Dan izvlačenja" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-2.5">
      {days.map((day) => {
        const active = day.date === selected
        const done = day.drawn.length >= 2
        const date = new Date(`${day.date}T00:00`)
        const state = day.skipped
          ? { label: 'ne izvlači se', tone: 'bg-white/6 text-zinc-400' }
          : done
            ? { label: 'izvučeno', tone: 'bg-neon/10 text-neon' }
            : day.drawn.length
              ? { label: '1 od 2', tone: 'bg-accent/12 text-accent' }
              : { label: 'čeka', tone: 'bg-accent/12 text-accent' }
        return (
          <button
            key={day.date}
            type="button"
            onClick={() => onSelect(day.date)}
            disabled={busy}
            aria-pressed={active}
            className={`flex items-center gap-3 rounded-xl p-3 text-left transition disabled:cursor-wait ${
              active
                ? 'bg-[linear-gradient(90deg,rgba(255,106,19,0.12),transparent_80%)] bg-surface ring-[1.5px] ring-accent ring-inset'
                : 'bg-surface ring-1 ring-line ring-inset hover:ring-white/16'
            }`}
          >
            <span
              className={`grid size-13 shrink-0 place-items-center rounded-[11px] leading-none ${
                active ? 'bg-accent text-ink' : 'bg-surface-2 text-white ring-1 ring-line ring-inset'
              }`}
            >
              <span className="text-center">
                <b className="block font-display text-[22px] font-extrabold">{date.getDate()}.</b>
                <small className="font-display text-[10px] font-bold uppercase tracking-[0.14em]">{dayShort(day.date)}</small>
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <b className="block font-display text-[19px] font-bold uppercase tracking-[0.03em] text-white">
                {dayName(day.date)} {date.getDate()}. {date.getMonth() + 1}.
              </b>
              <small className="block truncate text-[13px] text-zinc-400">
                {day.drawn.length
                  ? `Izvučeni: ${day.drawn.map((id) => byId[id]?.short ?? '?').join(' i ')}`
                  : `rok ${day.deadline.slice(11, 16)}${day.skipped ? '' : ' · još nije izvučeno'}`}
              </small>
            </span>
            <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${state.tone}`}>{state.label}</span>
          </button>
        )
      })}
    </section>
  )
}

function Ball({ label, position, spinning, picked, gone }) {
  const [left, top] = position ?? CENTER
  return (
    <div
      style={{ left: `${left}%`, top: `${top}%` }}
      className={`absolute grid aspect-square w-[23%] place-items-center rounded-full bg-[radial-gradient(circle_at_34%_30%,#ffa15c,#ff6a13_45%,#c84a06_100%)] ${
        spinning
          ? 'transition-[left,top] duration-120 ease-linear'
          : 'transition-[left,top,scale,opacity] duration-600 ease-[cubic-bezier(.3,1.4,.5,1)]'
      } ${
        picked
          ? 'z-3 scale-135 shadow-[0_0_0_3px_#b8ff3c,0_0_30px_rgba(184,255,60,0.6)]'
          : 'shadow-[inset_-4px_-6px_10px_rgba(0,0,0,0.35),0_6px_12px_rgba(0,0,0,0.5)]'
      } ${gone ? 'scale-40 opacity-0' : ''}`}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 size-full">
        <g fill="none" stroke="rgba(10,11,15,0.28)" strokeWidth="2.2">
          <path d="M50 2v96M2 50h96" />
          <path d="M17 15c16 18 16 52 0 70M83 15c-16 18-16 52 0 70" />
        </g>
      </svg>
      <span className="relative font-display text-[clamp(11px,3.4vw,14px)] font-extrabold uppercase tracking-[0.04em] text-ink [text-shadow:0_1px_0_rgba(255,255,255,0.25)]">
        {label}
      </span>
    </div>
  )
}

const CHECK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)
const INFO_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.01" />
  </svg>
)

function Notice({ tone = 'info', children }) {
  const tones = {
    info: 'bg-white/3 text-zinc-400 ring-line',
    ok: 'bg-neon/10 text-zinc-300 ring-neon/35 [&>svg]:text-neon',
    me: 'bg-neon/10 font-semibold text-white ring-neon/35 [&>svg]:text-neon',
  }
  return (
    <p className={`flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-sm ring-1 ring-inset ${tones[tone]}`}>
      {tone === 'info' ? INFO_ICON : CHECK_ICON}
      <span>{children}</span>
    </p>
  )
}

function DrawAction({ round, day, skipped, onSkip, isAdmin, busy, activeCount, inDrumCount, roundDone, complete, meDrawn, savedAt, onDraw }) {
  const when = day ? `za ${dayAcc(day)}` : `u kolu ${round.number}`
  if (meDrawn && !isAdmin) {
    return <Notice tone="me">Izvučen si! {day ? `Za ${dayAcc(day)} biraš` : `U kolu ${round.number} biraš`} 2 igrača. Oznaka te čeka na tvom tiketu.</Notice>
  }
  if (skipped) {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice>Za {dayAcc(day)} se ne izvlači: igra se jedan tiket, pa svako bira po jednog igrača.</Notice>
        {isAdmin && !roundDone && (
          <button type="button" onClick={() => onSkip(false)} disabled={busy} className="w-fit text-[13px] text-zinc-400 underline underline-offset-4 transition hover:text-white">
            Ipak izvlačimo za {dayAcc(day)}
          </button>
        )}
      </div>
    )
  }
  if (complete) {
    return <Notice tone="ok">Sačuvano {savedAt}. Svi vide rezultat.</Notice>
  }
  if (roundDone) {
    return <Notice>Kolo {round.number} je završeno, izvlačenje više nije moguće.</Notice>
  }
  if (isAdmin) {
    if (!inDrumCount && !busy) return <Notice>U bubnju nema nikoga za izvlačenje.</Notice>
    return (
      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onDraw}
          disabled={busy}
          className="inline-flex h-12.5 w-fit items-center justify-center gap-2.25 rounded-[10px] bg-accent px-5.5 font-display text-[17px] font-bold uppercase tracking-[0.12em] text-ink shadow-[0_14px_34px_-12px_rgba(255,106,19,0.7)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-45"
        >
          {busy ? 'Izvlači se…' : activeCount === 0 ? 'Izvuci prvog' : 'Izvuci drugog'}
        </button>
        {day && activeCount === 0 && !busy && (
          <button type="button" onClick={() => onSkip(true)} className="w-fit text-[13px] text-zinc-400 underline underline-offset-4 transition hover:text-white">
            Ne izvlačimo za ovaj dan (jedan tiket)
          </button>
        )}
      </div>
    )
  }
  return activeCount ? (
    <Notice>Izvlačenje je u toku. Drugi izvučeni će se pojaviti ovdje.</Notice>
  ) : (
    <Notice>Izvlačenje {when} još nije održano. Admin izvlači prije roka tog dana.</Notice>
  )
}

function PersonRow({ person, roundNumber, day }) {
  const firstName = person.name.split(' ')[0]
  const chip = {
    in: { label: 'U bubnju', className: 'bg-accent/12 text-accent' },
    drawn: { label: 'Bira 2 igrača', className: 'bg-neon/10 text-neon' },
    out: { label: 'Van bubnja', className: 'bg-white/5 text-zinc-600' },
  }[person.status]
  const sub =
    person.status === 'drawn'
      ? day ? `izvučen za ${dayAcc(day)}` : `izvučen u kolu ${roundNumber}`
      : person.status === 'out'
        ? lowerFirst(person.reason ?? 'van bubnja')
        : 'čeka izvlačenje'
  return (
    <div className="flex items-center gap-3 border-b border-line px-3.5 py-2.75 last:border-b-0">
      <span
        className={`size-7.5 shrink-0 rounded-full ${
          person.status === 'in'
            ? 'bg-[radial-gradient(circle_at_34%_30%,#ffa15c,#ff6a13_45%,#c84a06)] shadow-[inset_-2px_-3px_5px_rgba(0,0,0,0.35)]'
            : 'bg-surface-hover ring-1 ring-white/16 ring-inset'
        }`}
      />
      <div className="min-w-0 flex-1 font-semibold text-white">
        <span className="block truncate">{person.name}</span>
        <small className="block text-[13px] font-normal text-zinc-400">
          {person.short !== firstName && `${person.short} · `}
          {sub}
        </small>
      </div>
      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${chip.className}`}>{chip.label}</span>
    </div>
  )
}

function History({ draws, byId, currentRound, currentDay }) {
  const rounds = []
  for (const entry of draws) {
    const day = entry.day ?? null
    let group = rounds.find((r) => r.number === entry.roundNumber && r.day === day)
    if (!group) {
      group = { number: entry.roundNumber, day, entries: [] }
      rounds.push(group)
    }
    group.entries.push(entry)
  }
  const name = (friendId) => byId[friendId]?.short ?? 'nepoznat'

  if (!rounds.length) {
    return (
      <p className="rounded-xl bg-surface px-3.5 py-5 text-sm text-zinc-500 ring-1 ring-line ring-inset">
        Još nema izvlačenja.
      </p>
    )
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-line ring-inset">
      {rounds.map((group) => {
        const valid = group.entries.filter((d) => !d.cancelledAt)
        const active = valid.filter((d) => !d.replacedAt).sort((a, b) => a.slot - b.slot)
        const replaced = valid.filter((d) => d.replacedAt)
        const cancelGroups = Object.entries(
          group.entries
            .filter((d) => d.cancelledAt && !d.replacedAt)
            .reduce((acc, d) => ({ ...acc, [d.cancelledAt]: [...(acc[d.cancelledAt] ?? []), d] }), {}),
        )
        const last = active.reduce((latest, d) => (!latest || d.drawnAt > latest.drawnAt ? d : latest), null)
        const isCurrent = group.number === currentRound && group.day === (currentDay ?? null)
        return (
          <div key={`${group.number}-${group.day}`} className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line px-3.5 py-3 last:border-b-0">
            <span
              className={`pt-0.5 font-display text-[13px] font-bold uppercase tracking-[0.12em] ${isCurrent ? 'text-accent' : 'text-zinc-600'}`}
            >
              Kolo {group.number}
              {group.day && ` · ${dayShort(group.day)}`}
            </span>
            <span className={`font-semibold ${active.length ? 'text-white' : 'text-zinc-600'}`}>
              {active.length ? active.map((d) => name(d.friendId)).join(' i ') : 'Nije izvučeno'}
              {isCurrent && active.length === 1 && ' · drugi se izvlači'}
            </span>
            {last && (
              <span className="col-start-2 text-[13px] text-zinc-400">
                {formatTime(last.drawnAt)} · izvukao {last.drawnBy ?? 'admin'}
              </span>
            )}
            {replaced.map((old) => {
              const replacement = active.find((d) => d.slot === old.slot)
              return (
                <span key={old.id} className="col-start-2 text-[13px] text-zinc-500">
                  Zamjena: {replacement ? name(replacement.friendId) : '?'} umjesto {name(old.friendId)}
                </span>
              )
            })}
            {cancelGroups.map(([at, entries]) => (
              <span key={at} className="col-start-2 text-[13px] text-zinc-500">
                Poništeno {formatTime(at)}: {entries.map((d) => name(d.friendId)).join(' i ')}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

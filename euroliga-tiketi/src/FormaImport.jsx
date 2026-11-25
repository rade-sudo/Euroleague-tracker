import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { chanceFor, maxbetBookmarklet } from './forma.js'

const LABELS = { new: 'nova', chg: 'promijenjena', same: 'ista', chk: 'provjeri', out: 'nije u kolu' }
const STATUS_TONES = {
  new: 'bg-neon/10 text-neon',
  chg: 'bg-gold/12 text-gold',
  same: 'bg-white/5 text-zinc-400',
  chk: 'bg-rose-500/12 text-rose-400',
  out: 'bg-white/4 text-zinc-500',
}
const COUNT_TONES = { all: 'text-white', new: 'text-neon', chg: 'text-gold', same: 'text-zinc-400', chk: 'text-rose-400', out: 'text-zinc-500' }
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec']
const DAY_SHORT = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']
const GRID = 'min-[901px]:grid-cols-[34px_minmax(150px,1.2fr)_minmax(170px,1.3fr)_150px_140px_110px]'
const cardClass =
  'min-w-0 overflow-hidden rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)] before:block before:h-px before:bg-linear-to-r before:from-transparent before:via-accent/70 before:to-transparent before:content-[""]'
const h2Class = 'font-display text-[22px] font-bold tracking-[0.06em] text-white uppercase'

const defaultOn = (row) => row.status === 'new' || row.status === 'chg'
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const gameWhen = (game) => {
  const d = new Date(`${game.startsAt.slice(0, 10)}T00:00`)
  return `${capitalize(DAY_SHORT[d.getDay()])} ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]} · ${game.startsAt.slice(11, 16)}`
}
const playersWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'igrač' : 'igrača')

// Pregled granica pročitanih sa Maxbeta (dugme „Granice → Forma“) i čuvanje svih odjednom.
// Bez redova prikazuje samo uputstvo i dugme za trake sa oznakama.
export default function FormaImport({ data, players, maxbetRows, onClose, onSaved }) {
  const [preview, setPreview] = useState({ status: maxbetRows ? 'loading' : 'idle', error: '', rows: [] })
  const [choices, setChoices] = useState({})
  const [onRows, setOnRows] = useState({})
  const [filter, setFilter] = useState('all')
  const [save, setSave] = useState({ busy: false, error: '', done: null })
  const [readAt] = useState(() => new Date())

  useEffect(() => {
    if (!maxbetRows) return
    let ignore = false
    api('/forma/maxbet', { method: 'POST', body: JSON.stringify({ round: data.round, rows: maxbetRows }) }).then(
      (result) => {
        if (ignore) return
        setPreview({ status: 'ready', error: '', rows: result.rows })
        setOnRows(Object.fromEntries(result.rows.map((row) => [row.key, defaultOn(row)])))
      },
      (error) => !ignore && setPreview({ status: 'error', error: error.message, rows: [] }),
    )
    return () => {
      ignore = true
    }
  }, [maxbetRows, data.round])

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const rows = preview.rows
  const count = (status) => rows.filter((row) => status === 'all' || row.status === status).length
  const chosen = (row) => (row.player ? row.player : choices[row.key] && choices[row.key] !== 'skip' ? byId.get(choices[row.key]) ?? null : null)
  const picked = rows.filter((row) => onRows[row.key] && row.status !== 'out' && chosen(row))
  const pending = rows.filter((row) => row.status === 'chk' && onRows[row.key] && !chosen(row)).length
  const onTickets = picked.reduce((sum, row) => sum + row.tickets, 0)

  async function saveAll() {
    setSave({ busy: true, error: '', done: null })
    try {
      const result = await api('/forma/maxbet/save', {
        method: 'POST',
        body: JSON.stringify({
          round: data.round,
          lines: picked.map((row) => ({
            playerId: chosen(row).id,
            line: row.line.toFixed(1),
            // Ime koje je admin sam povezao postaje nadimak, pa se sljedeći put prepoznaje.
            ...(row.player ? {} : { alias: row.name }),
          })),
        }),
      })
      setSave({ busy: false, error: '', done: result })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      onSaved()
    } catch (error) {
      setSave({ busy: false, error: error.message, done: null })
    }
  }

  const groups = [
    ...data.games.map((game) => ({ key: game.id, title: `${game.homeName} – ${game.awayName}`, when: gameWhen(game) })),
    { key: 'out', title: `Ne igraju u kolu ${data.round}`, when: 'Maxbet već nudi sljedeće kolo, ovi se preskaču' },
    { key: 'none', title: 'Nisu prepoznati', when: 'Izaberi igrača ili preskoči' },
  ]
  const groupOf = (row) => (row.status === 'out' ? 'out' : row.gameId ?? 'none')

  return (
    <div className="flex flex-col gap-5">
      {maxbetRows && (
        <section className={cardClass} aria-labelledby="imp-h">
          <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-b border-line px-4.5 py-4">
            <div>
              <button type="button" onClick={onClose} className="text-[13px] text-zinc-400 transition hover:text-white">
                ‹ Nazad na Formu
              </button>
              <h2 id="imp-h" className={h2Class}>
                Uvoz granica · Kolo {data.round}
              </h2>
              <p className="mt-0.75 text-[13px] text-zinc-400">
                Pročitano sa Maxbeta danas u {readAt.toTimeString().slice(0, 5)} · {maxbetRows.length} {playersWord(maxbetRows.length)} ·{' '}
                {data.games.length} utakmica kola {data.round}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-gold/10 px-2 py-0.75 font-display text-[11px] font-bold tracking-[0.1em] text-gold uppercase ring-1 ring-gold/30 ring-inset">
              Maxbet · Ukupno poena
            </span>
          </div>

          {save.done && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-neon/25 bg-neon/7 px-4.5 py-3.5">
              <span>
                <b className="text-neon">
                  Sačuvano {save.done.saved} granica
                  {save.done.games ? ` · ${save.done.games} ${save.done.games === 1 ? 'utakmica' : 'utakmice'}` : ''}
                  {save.done.out ? ` · ${save.done.out} ${playersWord(save.done.out)} nije u ponudi` : ''}.
                </b>{' '}
                {save.done.tickets ? `${save.done.tickets} igrača na tiketima kola ${data.round} ima novu granicu.` : ''}
              </span>
              <button type="button" onClick={onClose} className="text-[13px] text-zinc-400 transition hover:text-white">
                Otvori Formu ›
              </button>
            </div>
          )}

          {preview.status === 'loading' && <p className="px-4.5 py-7 text-center text-zinc-400">Prepoznajem igrače…</p>}
          {preview.status === 'error' && (
            <p role="alert" className="px-4.5 py-7 text-center text-rose-400">
              {preview.error}
            </p>
          )}
          {preview.status === 'ready' && (
            <>
              <div className="flex flex-wrap gap-px border-b border-line bg-line" role="group" aria-label="Prikaži">
                {[
                  ['all', 'Pročitano'],
                  ['new', 'Nove granice'],
                  ['chg', 'Promijenjene'],
                  ['same', 'Iste kao sad'],
                  ['chk', 'Provjeri igrača'],
                  ['out', `Nisu u kolu ${data.round}`],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    className={`flex min-w-0 flex-[1_1_120px] flex-col gap-0.5 px-4 py-3 text-left transition hover:bg-surface-hover ${
                      filter === id ? 'bg-surface-2 shadow-[inset_0_-2px_0_var(--color-accent)]' : 'bg-surface'
                    }`}
                  >
                    <b className={`font-display text-[26px] leading-none font-extrabold tabular-nums ${COUNT_TONES[id]}`}>{count(id)}</b>
                    <span className="text-xs text-zinc-400">{label}</span>
                  </button>
                ))}
              </div>

              {groups.map((group) => {
                const groupRows = rows.filter((row) => groupOf(row) === group.key && (filter === 'all' || row.status === filter))
                if (!groupRows.length) return null
                const selectable = groupRows.filter((row) => row.status !== 'out')
                const allOn = selectable.length > 0 && selectable.every((row) => onRows[row.key])
                return (
                  <div key={group.key} className="border-b border-line last:border-b-0">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line bg-surface-2 px-4.5 py-2.5">
                      <div>
                        <b className="font-display text-base font-bold tracking-[0.06em] text-white uppercase">{group.title}</b>{' '}
                        <small className="text-xs text-zinc-400">· {group.when}</small>
                      </div>
                      {selectable.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setOnRows((current) => ({ ...current, ...Object.fromEntries(selectable.map((row) => [row.key, !allOn])) }))
                          }
                          className="px-1 py-0.5 text-xs text-zinc-400 transition hover:text-white"
                        >
                          {allOn ? 'Odznači sve' : 'Označi sve'}
                        </button>
                      )}
                    </div>
                    <div className={`hidden items-center gap-3 border-b border-line px-4.5 py-2 min-[901px]:grid ${GRID}`}>
                      {['', 'Na Maxbetu', 'Naš igrač', 'Granica', 'Stanje', 'Projekcija'].map((label, i) => (
                        <span
                          key={i}
                          className={`font-display text-[10px] font-semibold tracking-[0.16em] text-zinc-400 uppercase ${i === 5 ? 'text-right' : ''}`}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    {groupRows.map((row) => (
                      <ImportRow
                        key={row.key}
                        row={row}
                        on={!!onRows[row.key]}
                        onToggle={(on) => setOnRows((current) => ({ ...current, [row.key]: on }))}
                        choice={choices[row.key] ?? ''}
                        onChoice={(value) => {
                          setChoices((current) => ({ ...current, [row.key]: value }))
                          setOnRows((current) => ({ ...current, [row.key]: value !== '' && value !== 'skip' }))
                        }}
                        player={chosen(row) ? byId.get(chosen(row).id) : null}
                        options={row.suggestions.length ? row.suggestions : players}
                      />
                    ))}
                  </div>
                )
              })}
              {!rows.some((row) => filter === 'all' || row.status === filter) && (
                <p className="px-4.5 py-7 text-center text-zinc-400">Nema igrača u ovoj grupi.</p>
              )}
            </>
          )}
        </section>
      )}

      <HowTo hasRows={!!maxbetRows} onClose={onClose} />
      {/* Traka za čuvanje; na telefonu stoji iznad donje trake sa stranicama. */}
      {maxbetRows && preview.status === 'ready' && (
        <div className="fixed inset-x-0 bottom-0 z-20 max-sm:bottom-[calc(65px+env(safe-area-inset-bottom,0px))] max-sm:pb-3 border-t border-white/12 bg-surface/96 pt-3 pr-[max(16px,env(safe-area-inset-right,0px))] pb-[calc(12px+env(safe-area-inset-bottom,0px))] pl-[max(16px,env(safe-area-inset-left,0px))]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <p className="text-[13px] text-zinc-400">
              Označeno <b className="text-white tabular-nums">{picked.length}</b> granica
              {onTickets > 0 && (
                <>
                  {' '}
                  · <b className="text-white tabular-nums">{onTickets}</b> igrača na tiketima dobija novu granicu
                </>
              )}
              {pending > 0 && <span className="text-rose-400"> · {pending} bez izabranog igrača se preskače</span>}
              {save.error && (
                <span role="alert" className="text-rose-400">
                  {' '}
                  · {save.error}
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-[9px] px-4 font-display text-[15px] font-bold tracking-[0.08em] text-zinc-400 uppercase ring-1 ring-white/12 ring-inset transition hover:text-white"
              >
                Odustani
              </button>
              <button
                type="button"
                disabled={!picked.length || save.busy}
                onClick={saveAll}
                className="h-10 rounded-[9px] bg-accent px-4 font-display text-[15px] font-bold tracking-[0.08em] text-ink uppercase disabled:opacity-45"
              >
                Sačuvaj {picked.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ImportRow({ row, on, onToggle, choice, onChoice, player, options }) {
  const out = row.status === 'out'
  const ours = row.player ?? (player ? { name: player.name, pos: player.pos } : null)
  const c = player ? chanceFor(player, row.line) : null
  const stripDiacritics = (s) => s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
  const selectId = `maxbet-pick-${row.key}`

  return (
    <div
      className={`grid grid-cols-[30px_1fr_auto] items-center gap-x-2.5 gap-y-1.5 border-b border-line px-4 py-3 last:border-b-0 min-[901px]:gap-3 min-[901px]:px-4.5 min-[901px]:py-2.5 ${GRID} ${
        out ? 'opacity-50' : on ? '' : 'opacity-45'
      }`}
    >
      <input
        type="checkbox"
        id={`maxbet-row-${row.key}`}
        checked={on && !out}
        disabled={out}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={`Uvezi granicu za ${row.name}`}
        className="size-5 cursor-pointer accent-accent"
      />
      <div className="min-w-0 min-[901px]:col-auto">
        <b className="block font-semibold text-white">{row.name}</b>
        <small className="text-xs text-zinc-500">{row.team}</small>
      </div>
      <div className="col-span-full flex min-w-0 items-center gap-2 pl-10 min-[901px]:col-span-1 min-[901px]:pl-0">
        {row.player || out ? (
          <>
            <span className="grid size-5.5 shrink-0 place-items-center rounded-md bg-white/5 font-display text-[11px] font-extrabold text-zinc-400 ring-1 ring-white/12 ring-inset">
              {ours.pos}
            </span>
            <b className="truncate font-semibold text-zinc-300">{ours.name}</b>
            {stripDiacritics(ours.name) === stripDiacritics(row.name) && ours.name !== row.name && (
              <span className="text-xs text-zinc-500">· kvačice</span>
            )}
          </>
        ) : (
          <>
            <label htmlFor={selectId} className="sr-only">
              Izaberi igrača za {row.name}
            </label>
            <select
              id={selectId}
              value={choice}
              onChange={(event) => onChoice(event.target.value === '' || event.target.value === 'skip' ? event.target.value : Number(event.target.value))}
              className="h-8 w-full min-w-0 rounded-[7px] border border-rose-400/45 bg-ink px-2 text-white"
            >
              <option value="">Izaberi igrača…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} · {option.team}
                </option>
              ))}
              <option value="skip">Preskoči</option>
            </select>
          </>
        )}
      </div>
      <div className="col-start-3 row-start-1 flex items-center justify-end gap-2 min-[901px]:col-auto min-[901px]:row-auto min-[901px]:justify-start">
        <span
          className={`font-display text-base font-bold tabular-nums text-zinc-500 ${row.old !== null && row.old !== row.line ? 'line-through decoration-white/35' : ''}`}
        >
          {row.old === null ? '—' : row.old}
        </span>
        <span className="text-zinc-500">→</span>
        <span className="font-display text-xl font-extrabold text-white tabular-nums">{row.line}</span>
      </div>
      <div className="col-start-2 min-[901px]:col-auto">
        <span className={`rounded-[5px] px-1.75 py-0.5 font-display text-[10.5px] font-bold tracking-[0.1em] whitespace-nowrap uppercase ${STATUS_TONES[row.status]}`}>
          {LABELS[row.status]}
          {row.out ? ` · ${row.out}` : ''}
        </span>
        {row.tickets > 0 && (
          <span className="mt-0.75 block text-[11px] text-gold">
            na {row.tickets} {row.tickets === 1 ? 'tiketu' : 'tiketa'}
          </span>
        )}
      </div>
      <div className="col-start-3 text-right min-[901px]:col-auto">
        {c ? (
          <>
            <b className="font-display text-[17px] font-extrabold text-accent tabular-nums">{player.proj.pts.value.toFixed(1)}</b>
            <small className="block text-[11.5px] text-zinc-400">
              <span className={`font-display font-extrabold ${c.tip === '+' ? 'text-neon' : 'text-sky'}`}>{c.tip}</span> {c.pct}%
            </small>
          </>
        ) : (
          <small className="text-[11.5px] text-zinc-400">—</small>
        )}
      </div>
    </div>
  )
}

// Uputstvo i dugme za trake sa oznakama (href se postavlja ručno: React blokira javascript: linkove).
function HowTo({ hasRows, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.setAttribute('href', maxbetBookmarklet(window.location.origin))
  }, [])

  return (
    <section className={cardClass} aria-labelledby="how-h">
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-b border-line px-4.5 py-4">
        <div>
          {!hasRows && (
            <button type="button" onClick={onClose} className="text-[13px] text-zinc-400 transition hover:text-white">
              ‹ Nazad na Formu
            </button>
          )}
          <h2 id="how-h" className={h2Class}>
            Kako se uvozi
          </h2>
          <p className="mt-0.75 text-[13px] text-zinc-400">Dugme se dodaje jednom, posle je uvoz jedan klik.</p>
        </div>
      </div>
      <div className="grid gap-px bg-line min-[901px]:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-2.5 bg-surface px-4.5 py-4">
          <h3 className="font-display text-sm font-bold tracking-[0.14em] text-white uppercase">Svako kolo</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 leading-snug text-zinc-300 marker:font-display marker:font-bold marker:text-accent">
            <li>
              Na računaru otvori <span className="rounded-md bg-ink px-1.5 py-0.5 font-mono text-xs text-zinc-400">sportsbook.maxbet.ba</span> →{' '}
              <b>Igrači</b> → Euroliga.
            </li>
            <li>
              Klikni <b>Granice → Forma</b> u trakama sa oznakama. Lista se sama skroluje do kraja i pokupi sve igrače.
            </li>
            <li>
              Otvori se ova stranica. Pregledaj, riješi crvene redove i klikni <b>Sačuvaj</b>.
            </li>
          </ol>
          <p className="text-[13px] leading-normal text-zinc-400">
            Granica ide u Formu i na tikete tog kola. Ako je Maxbet kasnije promijeni, samo ponovi uvoz: vidjećeš staru i novu vrijednost.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 bg-surface px-4.5 py-4">
          <h3 className="font-display text-sm font-bold tracking-[0.14em] text-white uppercase">Jednom: dodaj dugme</h3>
          <p className="text-[13px] leading-normal text-zinc-400">Prevuci dugme u trake sa oznakama pregledača (Ctrl+Shift+B ih prikazuje).</p>
          <a
            ref={ref}
            href="#"
            draggable="true"
            onClick={(event) => event.preventDefault()}
            className="inline-flex cursor-grab items-center gap-2 self-start rounded-[9px] bg-accent px-3.5 py-2.25 font-display text-[15px] font-extrabold tracking-[0.06em] text-ink uppercase no-underline shadow-[0_8px_20px_-8px_rgba(255,106,19,0.6)]"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
              <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
            </svg>
            Granice → Forma
          </a>
          <p className="text-[13px] leading-normal text-zinc-400">
            Dugme vidi samo admin. Radi u Chrome-u i Edge-u na računaru, kad je Maxbet otvoren direktno, ne kroz maxbet.ba.
          </p>
        </div>
      </div>
    </section>
  )
}

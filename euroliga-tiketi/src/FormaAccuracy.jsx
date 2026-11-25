import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { fix1 } from './forma.js'
import { BUCKETS, calibrationVerdict, MIN_SAMPLE, roundAccuracy, summarize } from './formaAccuracy.js'

const cardClass =
  'min-w-0 overflow-hidden rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)] before:block before:h-px before:bg-linear-to-r before:from-transparent before:via-accent/70 before:to-transparent before:content-[""]'
const cardHeadClass = 'border-b border-line px-4.5 py-3.5'
const h2Class = 'font-display text-xl font-bold tracking-[0.06em] text-white uppercase'
const h3Class = 'font-display text-sm font-bold tracking-[0.14em] text-white uppercase'
const subClass = 'mt-0.5 text-[13px] text-zinc-400'

const COLORS = { neon: '#b8ff3c', gold: '#ffc53d', rose: '#fb7185', accent: '#ff6a13', muted: '#a1a1aa', faint: '#71717a', line: 'rgba(255,255,255,0.07)', text: '#e4e4e7' }
const toneOf = (pct) => (pct === null ? 'text-zinc-500' : pct >= 60 ? 'text-neon' : pct >= 52 ? 'text-gold' : 'text-rose-400')
const colorOf = (pct) => (pct >= 60 ? COLORS.neon : pct >= 52 ? COLORS.gold : COLORS.rose)
const TAG_TONES = {
  warn: 'bg-gold/10 text-gold',
  abs: 'bg-violet-400/12 text-violet-300',
  up: 'bg-neon/8 text-neon',
  '': 'bg-white/5 text-zinc-400',
}
// Kola se skidaju po tri istovremeno; podaci ostaju dok je stranica otvorena.
const PARALLEL = 3
const cache = new Map()

async function loadRound(round) {
  if (!cache.has(round)) cache.set(round, api(`/forma/accuracy?round=${round}`))
  try {
    return await cache.get(round)
  } catch (error) {
    cache.delete(round)
    throw error
  }
}

export default function FormaAccuracy() {
  const [state, setState] = useState({ status: 'loading', season: '', total: 0, rounds: [], error: '' })

  useEffect(() => {
    let ignore = false
    api('/forma/accuracy').then(
      async (list) => {
        if (ignore) return
        setState((s) => ({ ...s, season: list.season, total: list.rounds.length }))
        const queue = [...list.rounds]
        const results = []
        const worker = async () => {
          while (queue.length && !ignore) {
            const round = queue.shift()
            results.push(roundAccuracy(await loadRound(round)))
            if (!ignore) setState((s) => ({ ...s, rounds: [...results].sort((a, b) => a.round - b.round) }))
          }
        }
        try {
          await Promise.all(Array.from({ length: PARALLEL }, worker))
          if (!ignore) setState((s) => ({ ...s, status: 'ready' }))
        } catch (error) {
          if (!ignore) setState((s) => ({ ...s, status: 'error', error: error.message }))
        }
      },
      (error) => !ignore && setState((s) => ({ ...s, status: 'error', error: error.message })),
    )
    return () => {
      ignore = true
    }
  }, [])

  const summary = useMemo(() => (state.status === 'ready' ? summarize(state.rounds) : null), [state.status, state.rounds])

  if (state.status === 'error') {
    return (
      <p role="alert" className="rounded-xl px-5 py-10 text-center text-sm text-rose-400 ring-1 ring-line ring-inset">
        {state.error}
      </p>
    )
  }
  if (!summary) {
    return (
      <p className="rounded-xl px-5 py-10 text-center text-sm text-zinc-400 ring-1 ring-line ring-inset" role="status">
        {state.total ? `Računam kola: ${state.rounds.length} od ${state.total}…` : 'Učitavanje odigranih kola…'}
      </p>
    )
  }
  if (!state.rounds.length) {
    return (
      <p className="rounded-xl px-5 py-10 text-center text-sm text-zinc-400 ring-1 ring-line ring-inset">
        Još nema odigranog kola sa zapisnicima. Tačnost se pojavi poslije prvog kola.
      </p>
    )
  }

  const first = state.rounds[0].round
  const last = state.rounds.at(-1).round
  return (
    <>
      <section className={cardClass} aria-labelledby="acc-sum">
        <div className={cardHeadClass}>
          <h2 id="acc-sum" className={h2Class}>
            Sezona {state.season} · kola {first}–{last}
          </h2>
          <p className={subClass}>
            Forma za svako odigrano kolo, izračunata kakva je bila prije utakmica. Tip se ocjenjuje samo gdje postoji Maxbet granica, a
            projekcija za sva kola.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-line min-[861px]:grid-cols-4">
          <Kpi label="Tip pogođen" value={summary.tip.pct} unit="%" note={summary.tip.n ? `${summary.tip.hits} od ${summary.tip.n} igrača sa Maxbet granicom` : 'još nema Maxbet granica'} />
          <Kpi label="Najbolje šanse kola" value={summary.best.pct} unit="%" note={summary.best.n ? `${summary.best.hits} od ${summary.best.n} (5 po kolu)` : 'još nema kola sa granicama'} />
          <div className="flex min-w-0 flex-col gap-1 bg-surface px-4.5 py-4">
            <span className="font-display text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">Greška projekcije</span>
            <b className="font-display text-[38px] leading-none font-extrabold text-white tabular-nums">±{fix1(summary.err ?? 0)}</b>
            <small className="text-[12.5px] leading-snug text-zinc-500">
              poena u prosjeku{summary.errMaxbet !== null ? ` · ${fix1(summary.errMaxbet)} kod igrača sa granicom` : ''}
            </small>
          </div>
          <Kpi
            label="Vi i Forma"
            value={summary.agree.pct}
            unit="%"
            note={
              summary.agree.n || summary.against.n
                ? `kad ste igrali uz Formu (${summary.agree.n}) · ${summary.against.pct ?? '—'}% protiv nje (${summary.against.n})`
                : 'još nema tiketa sa granicom i tipom + ili −'
            }
          />
        </div>
      </section>

      <Calibration summary={summary} />
      <PerRound rows={summary.perRound} />

      <section className={cardClass} aria-labelledby="acc-tags">
        <div className="grid gap-px bg-line min-[861px]:grid-cols-2">
          <BarList id="acc-tags" title="Oznake" sub="da li upozorenja valjaju" rows={summary.tags} />
          <BarList title="Po vrsti" sub="gdje je Forma jača" rows={summary.kinds} />
        </div>
      </section>

      <Misses summary={summary} />
    </>
  )
}

function Kpi({ label, value, unit, note }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-4.5 py-4">
      <span className="font-display text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">{label}</span>
      <b className={`font-display text-[38px] leading-none font-extrabold tabular-nums ${toneOf(value)}`}>
        {value === null ? '—' : `${value}${unit}`}
      </b>
      <small className="text-[12.5px] leading-snug text-zinc-500">{note}</small>
    </div>
  )
}

// "Kad Forma kaže X%, koliko stvarno prođe?": stub = stvarno, crtica = obećano.
function Calibration({ summary }) {
  const verdict = calibrationVerdict(summary)
  const W = 560
  const H = 280
  const L = 40
  const R = 10
  const T = 16
  const B = 44
  const y = (v) => T + (H - T - B) * (1 - (Math.max(20, Math.min(100, v)) - 20) / 80)
  const bw = (W - L - R) / BUCKETS.length
  return (
    <section className={cardClass} aria-labelledby="acc-cal">
      <div className={cardHeadClass}>
        <h2 id="acc-cal" className={h2Class}>
          Kad Forma kaže X%, koliko stvarno prođe?
        </h2>
        <p className={subClass}>Ako je Forma poštena, narandžasta crtica i stub su na istoj visini. Samo igrači sa Maxbet granicom.</p>
      </div>
      <div className="grid gap-px bg-line min-[861px]:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-3 bg-surface px-4.5 py-4">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Obećana i stvarna šansa po grupama" className="block h-auto w-full">
            {[20, 40, 60, 80, 100].map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={COLORS.line} />
                <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={COLORS.faint} fontFamily="Barlow">
                  {t}%
                </text>
              </g>
            ))}
            {summary.buckets.map((b, i) => {
              const x = L + i * bw + bw * 0.22
              const w = bw * 0.56
              const promised = b.promised ?? (b.from + Math.min(b.to, 80)) / 2
              return (
                <g key={b.label}>
                  {b.n > 0 && (
                    <>
                      <rect x={x} y={y(b.pct)} width={w} height={y(20) - y(b.pct)} rx="4" fill={b.pct >= promised - 2 ? COLORS.neon : COLORS.gold} fillOpacity="0.8" />
                      <text x={x + w / 2} y={y(b.pct) - 7} textAnchor="middle" fontSize="13" fontWeight="800" fill={COLORS.text} fontFamily="Barlow Condensed">
                        {b.pct}%
                      </text>
                    </>
                  )}
                  <line x1={x - 6} x2={x + w + 6} y1={y(promised)} y2={y(promised)} stroke={COLORS.accent} strokeWidth="2.5" strokeDasharray="5 4" />
                  <text x={x + w / 2} y={H - B + 18} textAnchor="middle" fontSize="12" fontWeight="700" fill={COLORS.muted} fontFamily="Barlow Condensed">
                    {b.label}
                  </text>
                  <text x={x + w / 2} y={H - B + 33} textAnchor="middle" fontSize="10.5" fill={COLORS.faint} fontFamily="Barlow">
                    {b.n} {b.n === 1 ? 'igrač' : 'igrača'}
                  </text>
                </g>
              )
            })}
          </svg>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-400">
            <span>
              <i className="mr-1.5 inline-block h-2.5 w-3 rounded-[2px] bg-neon align-[-1px]" />
              stvarno prošlo (na nivou ili bolje)
            </span>
            <span>
              <i className="mr-1.5 inline-block h-2.5 w-3 rounded-[2px] bg-gold align-[-1px]" />
              stvarno prošlo (ispod obećanog)
            </span>
            <span>
              <i className="mr-1.5 inline-block w-3.5 border-t-2 border-dashed border-accent align-[3px]" />
              šta je Forma rekla
            </span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3 bg-surface px-4.5 py-4">
          <div className="rounded-[10px] bg-surface-2 px-3.5 py-3 text-[13.5px] leading-relaxed text-zinc-400 ring-1 ring-white/12 ring-inset">
            <b
              className={`mb-1 block font-display text-[13px] font-bold tracking-[0.12em] uppercase ${
                verdict.tone === 'good' ? 'text-neon' : verdict.tone === 'warn' ? 'text-gold' : 'text-zinc-400'
              }`}
            >
              Šta ovo znači
            </b>
            {verdict.text}
          </div>
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead>
              <tr className="font-display text-[10.5px] tracking-[0.14em] text-zinc-500 uppercase">
                <th className="pb-1.5 text-left font-semibold">Forma kaže</th>
                <th className="pb-1.5 text-right font-semibold">Igrača</th>
                <th className="pb-1.5 text-right font-semibold">Prošlo</th>
              </tr>
            </thead>
            <tbody>
              {summary.buckets.map((b) => (
                <tr key={b.label} className="border-t border-line">
                  <td className="py-1.75 text-zinc-300">{b.label}</td>
                  <td className="py-1.75 text-right text-zinc-500">{b.n}</td>
                  <td className="py-1.75 text-right">
                    {b.n ? (
                      <>
                        <b className="font-semibold text-white">{b.pct}%</b> <span className="text-zinc-500">({b.hits})</span>
                      </>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.sample < MIN_SAMPLE && <p className="text-xs text-zinc-500">Grafikon postaje pouzdan od {MIN_SAMPLE} igrača sa Maxbet granicom.</p>}
        </div>
      </div>
    </section>
  )
}

// Kolo po kolo: stub = greška projekcije (lijeva skala), tačka = tip pogođen (desna skala).
function PerRound({ rows }) {
  const W = 900
  const H = 230
  const L = 44
  const R = 48
  const T = 18
  const B = 32
  const maxErr = Math.max(5, Math.ceil(Math.max(...rows.map((r) => r.err ?? 0))))
  const ey = (v) => T + (H - T - B) * (1 - v / maxErr)
  const hy = (v) => T + (H - T - B) * (1 - v / 100)
  const step = (W - L - R) / Math.max(rows.length, 1)
  return (
    <section className={cardClass} aria-labelledby="acc-rounds">
      <div className={cardHeadClass}>
        <h2 id="acc-rounds" className={h2Class}>
          Kolo po kolo
        </h2>
        <p className={subClass}>Stub = greška projekcije u poenima (niže je bolje). Tačka = tip pogođen, gdje ima Maxbet granica.</p>
      </div>
      <div className="overflow-x-auto px-4.5 py-4">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Greška projekcije i pogođen tip po kolima" className="block h-auto w-full min-w-160">
          {Array.from({ length: maxErr + 1 }, (_, t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={ey(t)} y2={ey(t)} stroke={COLORS.line} />
              <text x={L - 8} y={ey(t) + 4} textAnchor="end" fontSize="11" fill={COLORS.faint} fontFamily="Barlow">
                ±{t}
              </text>
            </g>
          ))}
          {[0, 50, 100].map((t) => (
            <text key={t} x={W - R + 8} y={hy(t) + 4} fontSize="11" fill={COLORS.faint} fontFamily="Barlow">
              {t}%
            </text>
          ))}
          {rows.map((r, i) => {
            const x = L + i * step + step * 0.25
            const w = step * 0.5
            return (
              <g key={r.round}>
                <rect x={x} y={ey(r.err)} width={w} height={ey(0) - ey(r.err)} rx="3" fill={COLORS.muted} fillOpacity="0.35" />
                <text x={x + w / 2} y={ey(r.err) - 5} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={COLORS.text} fontFamily="Barlow Condensed">
                  {fix1(r.err)}
                </text>
                <text x={x + w / 2} y={H - 12} textAnchor="middle" fontSize="11" fontWeight="700" fill={COLORS.muted} fontFamily="Barlow Condensed">
                  {r.round}
                </text>
                {r.tip.pct !== null && (
                  <>
                    <circle cx={x + w / 2} cy={hy(r.tip.pct)} r="6" fill={colorOf(r.tip.pct)} stroke="#12141a" strokeWidth="2" />
                    <text x={x + w / 2 + 10} y={hy(r.tip.pct) + 4} fontSize="12" fontWeight="800" fill={colorOf(r.tip.pct)} fontFamily="Barlow Condensed">
                      {r.tip.pct}% ({r.tip.n})
                    </text>
                  </>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </section>
  )
}

function BarList({ id, title, sub, rows }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-surface px-4.5 py-4">
      <h3 id={id} className={h3Class}>
        {title}
        <small className="ml-1.5 font-sans text-xs font-medium tracking-normal text-zinc-400 normal-case">{sub}</small>
      </h3>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_72px] items-center gap-3 border-t border-line py-1.75 text-[13px] first-of-type:border-t-0">
          <div className="min-w-0">
            {row.tone !== undefined ? (
              <span className={`rounded px-1.5 py-px text-[11px] font-semibold ${TAG_TONES[row.tone]}`}>{row.label}</span>
            ) : (
              <b className="font-semibold text-zinc-200">{row.label}</b>
            )}
            {row.sub && <small className="block text-xs text-zinc-500">{row.sub}</small>}
          </div>
          <div className="relative h-2 rounded-full bg-white/6">
            {row.pct !== null && <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${row.pct}%`, background: colorOf(row.pct) }} />}
            <span className="absolute -inset-y-0.75 left-1/2 w-px bg-white/12" />
          </div>
          <div className="text-right tabular-nums">
            <b className={`font-display text-lg font-extrabold ${toneOf(row.pct)}`}>{row.pct === null ? '—' : `${row.pct}%`}</b>
            <small className="block text-[11px] text-zinc-500">
              {row.n} {row.n === 1 ? 'igrač' : 'igrača'}
            </small>
          </div>
        </div>
      ))}
    </div>
  )
}

function Misses({ summary }) {
  return (
    <section className={cardClass} aria-labelledby="acc-miss">
      <div className={cardHeadClass}>
        <h2 id="acc-miss" className={h2Class}>
          Najveći promašaji
        </h2>
        <p className={subClass}>Tip Forme nije prošao, poredano po tome koliko je projekcija promašila.</p>
      </div>
      {summary.misses.length ? (
        <div className="overflow-x-auto px-4.5 pt-1.5 pb-1">
          <table className="w-full min-w-150 border-collapse text-[13px] tabular-nums">
            <thead>
              <tr className="font-display text-[10.5px] tracking-[0.14em] text-zinc-500 uppercase">
                <th className="pt-2 pb-1.5 text-left font-semibold">Igrač</th>
                <th className="pt-2 pb-1.5 pl-3.5 text-left font-semibold">Kolo</th>
                <th className="pt-2 pb-1.5 pl-3.5 text-right font-semibold">Projekcija</th>
                <th className="pt-2 pb-1.5 pl-3.5 text-right font-semibold">Granica</th>
                <th className="pt-2 pr-2 pb-1.5 pl-3.5 text-right font-semibold">Dao</th>
                <th className="pt-2 pb-1.5 pl-8 text-left font-semibold">Možda zašto</th>
              </tr>
            </thead>
            <tbody>
              {summary.misses.map((m) => (
                <tr key={`${m.round}-${m.p.id}`} className="border-t border-line">
                  <td className="py-2.5">
                    <b className="font-semibold text-white">{m.p.name}</b>{' '}
                    <span className="rounded bg-white/5 px-1.5 py-px text-[10.5px] font-semibold text-zinc-400">{m.p.team}</span>
                  </td>
                  <td className="py-2.5 pl-3.5 text-zinc-300">{m.round}</td>
                  <td className="py-2.5 pl-3.5 text-right text-zinc-300">{fix1(m.p.proj.pts.value)}</td>
                  <td className="py-2.5 pl-3.5 text-right text-zinc-300">
                    {m.p.line} {m.p.chance.tip}
                  </td>
                  <td className="py-2.5 pr-2 pl-3.5 text-right font-display text-[17px] font-extrabold text-rose-400">{m.pts}</td>
                  <td className="border-l border-line py-2.5 pl-8 text-[12.5px] text-zinc-400">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {m.p.guard && <span className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${TAG_TONES.warn}`}>Maxbet zna nešto</span>}
                      {m.p.boost && <span className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${TAG_TONES.abs}`}>Ne igraju saigrači</span>}
                      {m.reason || (!m.p.guard && !m.p.boost ? 'bez jasnog razloga u brojkama' : '')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4.5 py-5 text-sm text-zinc-400">Još nema promašenih tipova sa Maxbet granicom.</p>
      )}
      <p className="border-t border-line px-4.5 py-3 text-[12.5px] leading-relaxed text-zinc-500">
        Ne broje se igrači iz rotacije koji nisu igrali: <b className="font-semibold text-zinc-400">{summary.dnp.n}</b> ove sezone. Forma je
        njih <b className="font-semibold text-zinc-400">{summary.dnp.flagged}</b> unaprijed označila („Ne igra“, „Nije igrao x/5“ ili nije u ponudi
        Maxbeta).
      </p>
    </section>
  )
}

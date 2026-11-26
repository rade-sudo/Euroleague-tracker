import { useMemo, useState } from 'react'
import { friendStats, MIN_GROUP } from './friendStats.js'

// Statistika drugara (Statistika → Drugari): tabela ko kako pogađa, pa detalj izabranog drugara.

const cardClass =
  'min-w-0 overflow-hidden rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)] before:block before:h-px before:bg-linear-to-r before:from-transparent before:via-accent/70 before:to-transparent before:content-[""]'
const headClass = 'border-b border-line px-4.5 py-3.5'
const h2Class = 'font-display text-[22px] font-bold tracking-[0.03em] text-white uppercase'
const COLORS = { neon: '#b8ff3c', gold: '#ffc53d', rose: '#fb7185', accent: '#ff6a13', faint: '#71717a', muted: '#a1a1aa', line: 'rgba(255,255,255,0.07)' }

const tone = (pct) => (pct === null ? 'text-zinc-500' : pct >= 58 ? 'text-neon' : pct >= 50 ? 'text-gold' : 'text-rose-400')
const barColor = (pct) => (pct >= 58 ? COLORS.neon : pct >= 50 ? COLORS.gold : COLORS.rose)
// Kockica kola: udio prošlih (svi ili 2/3 zeleno, pola žuto, manje crveno).
const roundTone = (hits, n) => (hits / n >= 2 / 3 ? 'bg-neon/12 text-neon' : hits / n >= 0.5 ? 'bg-gold/12 text-gold' : 'bg-rose-500/12 text-rose-400')
const initial = (name) => (name.trim()[0] ?? '?').toUpperCase()

function Bar({ pct, avg }) {
  return (
    <span className="relative h-1.75 min-w-12 flex-1 rounded-full bg-white/6">
      {pct !== null && <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: barColor(pct) }} />}
      {avg !== null && avg !== undefined && <span className="absolute -inset-y-0.75 w-0.5 bg-white/55" style={{ left: `${avg}%` }} />}
    </span>
  )
}

export default function FriendStats({ stats, me }) {
  const data = useMemo(() => friendStats(stats), [stats])
  const [selected, setSelected] = useState(me ?? data.friends[0]?.id ?? null)
  const friend = data.friends.find((f) => f.id === selected) ?? data.friends[0]

  if (!data.team.n) {
    return (
      <p className="rounded-xl px-5 py-10 text-center text-sm text-zinc-400 ring-1 ring-line ring-inset">
        Još nema ocijenjenih igrača. Statistika drugara se pojavi poslije prvog ocijenjenog kola.
      </p>
    )
  }

  return (
    <>
      <section className={cardClass} aria-labelledby="fs-board">
        <div className={headClass}>
          <h2 id="fs-board" className={h2Class}>
            Ko kako pogađa
          </h2>
          <p className="mt-0.5 text-[13px] text-zinc-400">
            Klikni drugara za detalje. Bijela crta = prosjek ekipe ({data.team.pct}%).
          </p>
        </div>
        {/* Telefon: svaki drugar u dva reda, da se sve vidi bez skrolovanja u stranu. */}
        <div className="min-[700px]:hidden">
          {data.friends.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelected(f.id)}
              aria-pressed={f.id === friend?.id}
              className={`grid w-full grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 border-t border-line px-3.5 py-3 text-left tabular-nums transition first:border-t-0 ${
                f.id === friend?.id ? 'bg-accent/6' : 'active:bg-surface-hover'
              }`}
            >
              <span className="row-span-3 self-start pt-1 font-display text-[15px] font-extrabold text-zinc-500">{f.total.n ? i + 1 : '–'}</span>
              <span className="flex min-w-0 items-center gap-2.25">
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full font-display text-[13px] font-extrabold ring-1 ring-inset ${
                    f.id === me ? 'bg-accent/12 text-accent ring-accent/35' : 'bg-white/6 text-white ring-white/12'
                  }`}
                >
                  {initial(f.short)}
                </span>
                <b className="truncate font-semibold text-white">{f.short}</b>
                {f.id === me && <span className="rounded-[3px] bg-accent px-1 font-display text-[9.5px] font-bold tracking-[0.12em] text-ink uppercase">Ti</span>}
                <b className={`ml-auto font-display text-xl font-extrabold ${tone(f.total.pct)}`}>{f.total.pct === null ? '—' : `${f.total.pct}%`}</b>
                <small className="text-[11.5px] text-zinc-500">
                  {f.total.hits}/{f.total.n}
                </small>
              </span>
              <span className="flex">
                <Bar pct={f.total.pct} avg={data.team.pct} />
              </span>
              <span className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-1.5">
                <span className="inline-flex gap-0.75">
                  {f.last5.map((r) => (
                    <i
                      key={r.round}
                      title={`kolo ${r.round}: ${r.hits}/${r.n}`}
                      className={`grid h-4.25 min-w-4.25 place-items-center rounded-[5px] px-0.5 font-display text-[11px] font-extrabold not-italic ${roundTone(r.hits, r.n)}`}
                    >
                      {r.hits}
                    </i>
                  ))}
                </span>
                <span className="text-xs text-zinc-400">
                  {f.strongest ? (
                    <>
                      najjači: <b className="font-semibold text-neon">{f.strongest}</b>
                    </>
                  ) : (
                    <span className="text-zinc-600">premalo igrača za „najjači“</span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="hidden overflow-x-auto min-[700px]:block">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className="font-display text-[10.5px] tracking-[0.14em] text-zinc-500 uppercase">
                <th className="w-9 px-3 pt-2.5 pb-1.5" />
                <th className="px-3 pt-2.5 pb-1.5 text-left font-semibold">Drugar</th>
                <th className="px-3 pt-2.5 pb-1.5 text-left font-semibold">Prolazi</th>
                <th className="hidden px-3 pt-2.5 pb-1.5 text-left font-semibold min-[700px]:table-cell">Zadnjih 5 kola</th>
                <th className="hidden px-3 pt-2.5 pb-1.5 text-left font-semibold min-[700px]:table-cell">Najjači u</th>
              </tr>
            </thead>
            <tbody>
              {data.friends.map((f, i) => (
                <tr
                  key={f.id}
                  onClick={() => setSelected(f.id)}
                  className={`cursor-pointer border-t border-line transition ${f.id === friend?.id ? 'bg-accent/6' : 'hover:bg-surface-hover'}`}
                >
                  <td className="px-3 py-2.5 font-display text-base font-extrabold text-zinc-500">{f.total.n ? i + 1 : '–'}</td>
                  <td className="px-3 py-2.5">
                    <button type="button" onClick={() => setSelected(f.id)} aria-pressed={f.id === friend?.id} className="flex items-center gap-2.25 text-left">
                      <span
                        className={`grid size-7.5 shrink-0 place-items-center rounded-full font-display text-sm font-extrabold ring-1 ring-inset ${
                          f.id === me ? 'bg-accent/12 text-accent ring-accent/35' : 'bg-white/6 text-white ring-white/12'
                        }`}
                      >
                        {initial(f.short)}
                      </span>
                      <b className="font-semibold text-white">{f.short}</b>
                      {f.id === me && (
                        <span className="rounded-[3px] bg-accent px-1 font-display text-[9.5px] font-bold tracking-[0.12em] text-ink uppercase">Ti</span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex min-w-38 items-center gap-2.5">
                      <b className={`w-11 font-display text-xl font-extrabold ${tone(f.total.pct)}`}>{f.total.pct === null ? '—' : `${f.total.pct}%`}</b>
                      <Bar pct={f.total.pct} avg={data.team.pct} />
                    </span>
                    <small className="text-xs text-zinc-500">
                      {f.total.hits} od {f.total.n}
                    </small>
                  </td>
                  <td className="hidden px-3 py-2.5 min-[700px]:table-cell">
                    <span className="inline-flex gap-0.75">
                      {f.last5.map((r) => (
                        <i
                          key={r.round}
                          title={`kolo ${r.round}: ${r.hits}/${r.n}`}
                          className={`grid h-4.5 min-w-4.5 place-items-center rounded-[5px] px-0.5 font-display text-[11px] font-extrabold not-italic ${roundTone(r.hits, r.n)}`}
                        >
                          {r.hits}
                        </i>
                      ))}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs text-zinc-400 min-[700px]:table-cell">
                    {f.strongest ? <b className="font-semibold text-neon">{f.strongest}</b> : <span className="text-zinc-600">premalo igrača</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4.5 py-2.5 text-xs text-zinc-500">
          Kockice: koliko je igrača prošlo u kolu (zeleno skoro svi, žuto pola, crveno manje). Pređi mišem za „prošlo / igrača“.
        </p>
      </section>

      {friend && <FriendDetail friend={friend} team={data.team} teamTrend={data.teamTrend} isMe={friend.id === me} />}
    </>
  )
}

function FriendDetail({ friend, team, teamTrend, isMe }) {
  const f = friend
  const recentTrend = f.recent.pct === null || f.total.pct === null ? '' : f.recent.pct >= f.total.pct + 5 ? ' · u usponu' : f.recent.pct <= f.total.pct - 5 ? ' · pada' : ''
  return (
    <section className={cardClass} aria-labelledby="fs-detail">
      <div className={headClass}>
        <h2 id="fs-detail" className={h2Class}>
          {f.name}
          {isMe && <span className="ml-2 align-[3px] font-sans text-xs font-semibold tracking-normal text-accent normal-case">to si ti</span>}
        </h2>
        <p className="mt-0.5 text-[13px] text-zinc-400">
          {f.rounds} {f.rounds === 1 ? 'kolo' : 'kola'} · {f.total.n} ocijenjenih igrača
        </p>
      </div>
      {!f.total.n ? (
        <p className="px-4.5 py-6 text-sm text-zinc-400">Još nema ocijenjenih igrača.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px bg-line min-[861px]:grid-cols-4">
            <Kpi label="Prolazi" value={`${f.total.pct}%`} valueTone={tone(f.total.pct)} note={`${f.total.hits} od ${f.total.n} · ekipa ${team.pct}%`} />
            <Kpi
              label={`Zadnja ${f.recent.rounds} kola`}
              value={`${f.recent.hits}/${f.recent.n}`}
              note={`${f.recent.pct}%${recentTrend}`}
            />
            <Kpi
              label="Najduži niz"
              value={f.streak.length}
              note={f.streak.length ? `prolaza zaredom (${f.streak.from === f.streak.to ? `kolo ${f.streak.from}` : `kolo ${f.streak.from}–${f.streak.to}`})` : 'još nijedan prolaz'}
            />
            <Kpi
              label="Uz Formu"
              value={f.withForma.n ? `${f.withForma.pct}%` : '—'}
              valueTone={tone(f.withForma.pct)}
              note={
                f.withForma.n || f.againstForma.n
                  ? `${f.withForma.hits} od ${f.withForma.n} · protiv nje ${f.againstForma.n ? `${f.againstForma.pct}%` : '—'} (${f.againstForma.n})`
                  : 'pamti se od sada, pri dodavanju igrača'
              }
            />
          </div>

          {(f.strong || f.weak) && (
            <div className="grid gap-px border-t border-line bg-line min-[861px]:grid-cols-2">
              {f.strong && <Callout good title={`Jaka strana: ${f.strong.label.toLowerCase()}`} item={f.strong} />}
              {f.weak && <Callout title={`Slaba strana: ${f.weak.label.toLowerCase()}`} item={f.weak} />}
            </div>
          )}

          <div className="grid gap-px border-t border-line bg-line min-[861px]:grid-cols-2 min-[1000px]:grid-cols-4">
            {f.splits.map((dim) => (
              <div key={dim.id} className="flex min-w-0 flex-col gap-1 bg-surface px-4.5 py-3.5">
                <h3 className="mb-1 font-display text-[13px] font-bold tracking-[0.14em] text-white uppercase">{dim.title}</h3>
                {dim.rows.map((row) => {
                  const small = row.n < MIN_GROUP
                  return (
                    <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_70px_52px] items-center gap-2.5 py-1 text-[13px] tabular-nums">
                      <span className="truncate text-zinc-300">
                        {row.label} <small className="text-[11.5px] text-zinc-500">{row.n}</small>
                      </span>
                      {small ? <span className="h-1.75 rounded-full bg-white/4" /> : <Bar pct={row.pct} avg={row.team.pct} />}
                      <b className={`text-right font-display text-base font-extrabold ${small ? 'text-zinc-500' : tone(row.pct)}`}>
                        {row.n === 0 ? '—' : small ? `${row.hits}/${row.n}` : `${row.pct}%`}
                      </b>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <Trend mine={f.trend} team={teamTrend} name={f.short} />
          <p className="border-t border-line px-4.5 py-2.5 text-xs text-zinc-500">
            Bijela crta na trakama = ekipa u istoj grupi. Grupa sa manje od {MIN_GROUP} igrača je siva, bez procenta. „Nije igrao“ se broji kao prošao.
          </p>
        </>
      )}
    </section>
  )
}

function Kpi({ label, value, note, valueTone = 'text-white' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.75 bg-surface px-4.5 py-3.5">
      <span className="font-display text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">{label}</span>
      <b className={`font-display text-[34px] leading-none font-extrabold tabular-nums ${valueTone}`}>{value}</b>
      <small className="text-[12.5px] leading-snug text-zinc-500">{note}</small>
    </div>
  )
}

function Callout({ good = false, title, item }) {
  return (
    <div className="flex items-start gap-3 bg-surface px-4.5 py-3.5">
      <span
        className={`grid size-7.5 shrink-0 place-items-center rounded-[9px] font-display text-base font-extrabold ${
          good ? 'bg-neon/12 text-neon' : 'bg-rose-500/12 text-rose-400'
        }`}
      >
        {good ? '↑' : '↓'}
      </span>
      <div>
        <b className="block font-semibold text-white first-letter:uppercase">{title}</b>
        <p className="mt-0.5 text-[13px] text-zinc-400 tabular-nums">
          {item.hits} od {item.n} ({item.pct}%). Ekipa na tome ima {item.team}%.
        </p>
      </div>
    </div>
  )
}

// Kroz sezonu: drugar narandžasto, ekipa isprekidano (zadnja 3 kola zajedno).
function Trend({ mine, team, name }) {
  const points = mine.filter((p) => p.pct !== null)
  if (points.length < 2) return null
  const W = 900
  const H = 170
  const L = 40
  const R = 16
  const T = 14
  const B = 28
  const rounds = mine.map((p) => p.round)
  const x = (round) => L + (W - L - R) * (rounds.length > 1 ? rounds.indexOf(round) / (rounds.length - 1) : 0.5)
  const y = (v) => T + (H - T - B) * (1 - v / 100)
  const line = (list) => list.filter((p) => p.pct !== null).map((p) => `${x(p.round)},${y(p.pct)}`).join(' ')
  const last = points.at(-1)
  return (
    <div className="overflow-x-auto border-t border-line px-4.5 py-3.5">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Uspješnost kroz sezonu: ${name} i ekipa`} className="block h-auto w-full min-w-155">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={COLORS.line} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={COLORS.faint} fontFamily="Barlow">
              {t}%
            </text>
          </g>
        ))}
        {rounds.map((round) => (
          <text key={round} x={x(round)} y={H - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill={COLORS.muted} fontFamily="Barlow Condensed">
            {round}
          </text>
        ))}
        <polyline points={line(team)} fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 4" />
        <polyline points={line(mine)} fill="none" stroke={COLORS.accent} strokeWidth="2.5" />
        <circle cx={x(last.round)} cy={y(last.pct)} r="5" fill={COLORS.accent} stroke="#12141a" strokeWidth="2" />
        <text x={x(last.round) - 8} y={y(last.pct) - 10} textAnchor="end" fontSize="13" fontWeight="800" fill={COLORS.accent} fontFamily="Barlow Condensed">
          {last.pct}%
        </text>
      </svg>
      <p className="mt-1.5 text-xs text-zinc-500">
        Narandžasto = {name} kroz sezonu (zadnja 3 kola zajedno, da ne skače) · isprekidano = ekipa
      </p>
    </div>
  )
}

import { useState } from 'react'
import { fix1, FORMA_GRID, hitsOver, hitsUnder, pctTone, playedCount } from './forma.js'

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec']
const meterTone = (value) => (value >= 65 ? 'bg-neon' : value >= 55 ? 'bg-gold' : 'bg-rose-400')
const FLAG_TONES = {
  up: 'bg-neon/8 text-neon',
  down: 'bg-rose-500/10 text-rose-400',
  warn: 'bg-gold/10 text-gold',
  abs: 'bg-violet-400/12 text-violet-300',
  '': 'bg-white/5 text-zinc-400',
}
const shortDate = (date) => {
  const [, month, day] = date.split('-').map(Number)
  return `${day}. ${MONTHS_SHORT[month - 1]}`
}

export function TipChip({ tip, small }) {
  return (
    <span
      title={tip === '+' ? 'preko granice' : 'ispod granice'}
      className={`inline-grid place-items-center rounded-[7px] px-1.5 font-display font-extrabold ring-1 ring-inset ${
        small ? 'h-4.5 min-w-4.5 text-[13px]' : 'h-6.5 min-w-7 text-lg'
      } ${tip === '+' ? 'bg-neon/10 text-neon ring-neon/32' : 'bg-sky/10 text-sky ring-sky/32'}`}
    >
      {tip}
    </span>
  )
}

// Odakle je granica: Maxbet (upisao admin) ili naša procjena.
export function SourceTag({ source }) {
  return source === 'maxbet' ? (
    <span className="inline-block rounded px-1.25 py-px align-[1px] font-display text-[10px] font-bold tracking-[0.1em] text-gold uppercase ring-1 ring-gold/30 ring-inset bg-gold/10">
      Maxbet
    </span>
  ) : (
    <span
      title="Naša procjena, admin je mijenja kad izađe Maxbet"
      className="inline-block rounded px-1.25 py-px align-[1px] font-display text-[10px] font-bold tracking-[0.1em] text-zinc-400 uppercase italic ring-1 ring-white/12 ring-inset"
    >
      procjena
    </span>
  )
}

// Maxbet je objavio granice za utakmicu, a ovog igrača nema u ponudi.
export function NotOfferedTag() {
  return (
    <span
      title="Maxbet nema granicu za njega u ovom kolu, pa se ne može dodati na tiket"
      className="inline-block rounded-[5px] bg-white/3 px-1.75 py-0.5 font-display text-[11px] font-bold tracking-widest whitespace-nowrap text-zinc-400 uppercase ring-1 ring-white/12 ring-inset"
    >
      Nije u ponudi
    </span>
  )
}

// Zadnjih 5: starije lijevo, najnovija desno. Poeni su zeleni/crveni prema granici,
// asistencije i skokovi prema prosjeku sezone.
function FormCells({ player, stat, small }) {
  const games = player.last10.slice(0, 5).reverse()
  const ref = player.season[stat]
  const size = small ? 'h-5.5 w-5.25' : 'size-6.25'
  const text = small ? 'text-xs' : 'text-[13px]'
  return (
    <span className="flex gap-0.75">
      {games.map((game, index) => {
        if (game.dnp) {
          return (
            <span
              key={index}
              title={`kolo ${game.round}: nije igrao`}
              className={`grid place-items-center rounded-md font-display text-[10px] font-bold text-zinc-500 ring-1 ring-white/12 ring-inset ${size}`}
            >
              DNP
            </span>
          )
        }
        const value = game[stat]
        let tone = 'bg-white/4 text-zinc-300'
        if (stat === 'pts' && player.offered) tone = value > player.line ? 'bg-neon/10 text-neon' : 'bg-rose-500/10 text-rose-400'
        else if (value >= ref * 1.2 && value - ref >= 1) tone = 'bg-neon/10 text-neon'
        else if (value <= ref * 0.8 && ref - value >= 1) tone = 'bg-rose-500/10 text-rose-400'
        return (
          <span
            key={index}
            title={`kolo ${game.round}: ${game.home ? '' : '@'}${game.opp}, ${game.min} min`}
            className={`grid place-items-center rounded-md font-display font-bold tabular-nums ${size} ${text} ${tone}`}
          >
            {value}
          </span>
        )
      })}
    </span>
  )
}

function FormColumn({ player, stat, label }) {
  const small = stat !== 'pts'
  return (
    <div className={`col-span-2 flex min-w-0 items-center gap-2 min-[861px]:col-span-1 ${player.offered ? '' : 'opacity-45'}`}>
      <span className="w-7.5 font-display text-[11px] font-bold tracking-[0.12em] text-zinc-500 min-[861px]:hidden">{label}</span>
      <FormCells player={player} stat={stat} small={small} />
      <span className="min-w-7.5 font-display text-[15px] font-bold text-white tabular-nums">
        {fix1(player.proj[stat].form)}
        <small className="block text-[10px] font-semibold tracking-[0.06em] text-zinc-500">sez. {fix1(player.season[stat])}</small>
      </span>
    </div>
  )
}

export default function FormaPlayer({ player, open, onToggle, opponentName, isAdmin, onSaveLine }) {
  const pts = player.proj.pts
  const c = player.chance
  return (
    <>
      <button
        type="button"
        id={`forma-${player.id}`}
        onClick={onToggle}
        aria-expanded={open}
        className={`grid w-full scroll-mt-4 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2.5 border-b border-line px-4 py-3.25 text-left transition hover:bg-surface-2 min-[861px]:gap-3.5 min-[861px]:px-4.5 min-[861px]:py-2.75 ${FORMA_GRID} ${
          open ? 'bg-surface-2' : ''
        }`}
      >
        <div className={`flex min-w-0 items-center gap-2.5 ${player.offered ? '' : 'opacity-45'}`}>
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/5 font-display text-xs font-extrabold text-zinc-400 ring-1 ring-white/12 ring-inset">
            {player.pos}
          </span>
          <div className="min-w-0">
            <b className="block truncate font-semibold text-white">{player.name}</b>
            <small className="block text-xs text-zinc-400 tabular-nums">{fix1(pts.min5)} min zadnjih 5</small>
            {player.flags.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-1">
                {player.flags.map((flag) => (
                  <span
                    key={flag.label}
                    title={flag.title}
                    className={`max-w-full rounded px-1.5 py-px text-[10.5px] leading-snug font-semibold wrap-break-word ${FLAG_TONES[flag.tone]}`}
                  >
                    {flag.label}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <FormColumn player={player} stat="pts" label="PTS" />
        <FormColumn player={player} stat="ast" label="AST" />
        <FormColumn player={player} stat="reb" label="REB" />
        <div className="col-span-2 flex items-baseline gap-2 text-left min-[861px]:col-span-1 min-[861px]:block min-[861px]:text-right">
          {pts.n ? (
            <>
              <b className="font-display text-[17px] font-bold text-white tabular-nums">{fix1(pts.vs)}</b>
              <small className="text-[11px] text-zinc-400 min-[861px]:block">
                poena · {pts.n} {pts.n === 1 ? 'meč' : 'meča'} vs {player.opp}
              </small>
            </>
          ) : (
            <small className="text-[11px] text-zinc-400 min-[861px]:block">nije igrao protiv {player.opp}</small>
          )}
        </div>
        <div className="col-start-2 row-start-1 flex flex-col items-end gap-0.75 text-right min-[861px]:col-start-auto min-[861px]:row-start-auto">
          <b
            className={`font-display leading-none font-extrabold tabular-nums ${
              player.offered ? 'text-2xl text-accent' : 'text-xl text-zinc-500'
            }`}
          >
            {fix1(pts.value)}
          </b>
          <span className="text-xs text-zinc-400 tabular-nums">
            <b className="font-semibold text-zinc-300">{fix1(player.proj.ast.value)}</b> as ·{' '}
            <b className="font-semibold text-zinc-300">{fix1(player.proj.reb.value)}</b> sk
          </span>
          {player.offered ? (
            <span className="inline-flex items-center gap-1.25 text-xs text-zinc-400">
              <SourceTag source={player.lineSrc} /> <b className="text-white tabular-nums">{player.line}</b>
              <TipChip tip={c.tip} small />
              <span className={`font-display text-sm font-extrabold tabular-nums ${pctTone(c.pct)}`}>{c.pct}%</span>
            </span>
          ) : (
            <NotOfferedTag />
          )}
        </div>
      </button>
      {open && <PlayerDetail player={player} opponentName={opponentName} isAdmin={isAdmin} onSaveLine={onSaveLine} />}
    </>
  )
}

function PointsChart({ player }) {
  const games = player.last10.slice().reverse()
  const W = 340
  const H = 168
  const left = 26
  const right = 8
  const top = 14
  const bottom = 30
  const projection = player.proj.pts.value
  // Bez ponude nema granice: stubići su neutralni, bez zlatne linije.
  const line = player.offered ? player.line : null
  const maxValue = Math.max(...games.map((g) => g.pts), line ?? 0, projection) + 4
  const yMax = Math.ceil(maxValue / 5) * 5
  const y = (v) => top + (H - top - bottom) * (1 - v / yMax)
  const bw = (W - left - right) / Math.max(games.length, 1)
  const step = yMax > 20 ? 10 : 5
  const ticks = Array.from({ length: Math.floor(yMax / step) + 1 }, (_, i) => i * step)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Poeni u zadnjih 10 utakmica" className="block h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / .06)" />
          <text x={left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#71717a" fontFamily="Barlow">
            {t}
          </text>
        </g>
      ))}
      {games.map((g, i) => {
        const x = left + i * bw + bw * 0.18
        const w = bw * 0.64
        const recent = i >= games.length - 5
        return (
          <g key={i}>
            {g.dnp ? (
              <text x={x + w / 2} y={y(0) - 5} textAnchor="middle" fontSize="9" fill="#71717a" fontFamily="Barlow">
                DNP
              </text>
            ) : (
              <>
                <rect
                  x={x}
                  y={y(g.pts)}
                  width={w}
                  height={y(0) - y(g.pts)}
                  rx="3"
                  fill={line === null ? '#a1a1aa' : g.pts > line ? '#b8ff3c' : '#fb7185'}
                  fillOpacity={recent ? 0.9 : 0.45}
                />
                <text x={x + w / 2} y={y(g.pts) - 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#e4e4e7" fontFamily="Barlow Condensed">
                  {g.pts}
                </text>
              </>
            )}
            <text x={x + w / 2} y={H - 15} textAnchor="middle" fontSize="9.5" fill="#a1a1aa" fontFamily="Barlow Condensed">
              {g.home ? '' : '@'}
              {g.opp}
            </text>
            <text x={x + w / 2} y={H - 4} textAnchor="middle" fontSize="8.5" fill="#71717a" fontFamily="Barlow">
              {g.round}.
            </text>
          </g>
        )
      })}
      {line !== null && <line x1={left} x2={W - right} y1={y(line)} y2={y(line)} stroke="#ffc53d" strokeWidth="1.5" strokeDasharray="5 4" />}
      <line x1={left} x2={W - right} y1={y(projection)} y2={y(projection)} stroke="#ff6a13" strokeWidth="1.5" strokeDasharray="1.5 3" />
    </svg>
  )
}

const sectionClass = 'flex min-w-0 flex-col gap-3 bg-surface-2 px-4.5 py-4'
const h3Class = 'font-display text-sm font-bold tracking-[0.14em] text-white uppercase'
const h3SmallClass = 'ml-1.5 font-sans text-xs font-medium tracking-normal text-zinc-400 normal-case'
const emptyClass = 'rounded-lg bg-white/3 px-3 py-2.5 text-[13px] text-zinc-400'

function PlayerDetail({ player, opponentName, isAdmin, onSaveLine }) {
  const pts = player.proj.pts
  const n = player.h2h.length
  const avg = (key) => fix1(player.h2h.reduce((sum, g) => sum + g[key], 0) / n)
  const h2hHits = hitsOver(player.h2h, player.line)

  return (
    <div className="grid gap-px border-b border-line bg-line motion-safe:animate-[open-down_.18s_ease-out] min-[861px]:grid-cols-[1.15fr_1fr_1fr]">
      <section className={sectionClass}>
        <h3 className={h3Class}>
          Poeni, zadnjih {player.last10.length}
          <small className={h3SmallClass}>jače boje = zadnjih 5</small>
        </h3>
        {player.last10.length ? (
          <PointsChart player={player} />
        ) : (
          <div className={emptyClass}>Još nema zapisnika njegovih utakmica.</div>
        )}
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-zinc-400">
          {player.offered && (
            <span>
              <i className="mr-1.25 inline-block w-3.5 border-t-2 border-dashed border-gold align-[3px]" />
              granica {player.line}
            </span>
          )}
          <span>
            <i className="mr-1.25 inline-block w-3.5 border-t-2 border-dotted border-accent align-[3px]" />
            projekcija {fix1(pts.value)}
          </span>
          {player.offered && (
            <span>
              <b className="text-neon">■</b> preko · <b className="text-rose-400">■</b> ispod
            </span>
          )}
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={h3Class}>
          Protiv {opponentName}
          <small className={h3SmallClass}>zadnje 3 sezone</small>
        </h3>
        {n ? (
          <>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="font-display text-[10.5px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                  <th className="pb-1.5 text-left font-semibold">Utakmica</th>
                  <th className="pb-1.5 text-right font-semibold">Pts</th>
                  <th className="pb-1.5 text-right font-semibold">As</th>
                  <th className="pb-1.5 text-right font-semibold">Sk</th>
                  <th className="pb-1.5 text-right font-semibold">Min</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {player.h2h.map((g, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1.5 text-zinc-300">
                      {g.season} · {shortDate(g.date)}
                      {g.home ? '' : ' @'}
                    </td>
                    <td className="py-1.5 text-right font-bold text-white">{g.pts}</td>
                    <td className="py-1.5 text-right text-zinc-300">{g.ast}</td>
                    <td className="py-1.5 text-right text-zinc-300">{g.reb}</td>
                    <td className="py-1.5 text-right text-zinc-300">{g.min}</td>
                  </tr>
                ))}
                <tr className="border-t border-white/12 font-semibold text-white">
                  <td className="py-1.5">Prosjek ({n})</td>
                  <td className="py-1.5 text-right">{avg('pts')}</td>
                  <td className="py-1.5 text-right">{avg('ast')}</td>
                  <td className="py-1.5 text-right">{avg('reb')}</td>
                  <td className="py-1.5 text-right">{avg('min')}</td>
                </tr>
              </tbody>
            </table>
            {player.offered ? (
              <p className="text-xs leading-relaxed text-zinc-500">
                Preko granice {player.line} protiv njih:{' '}
                <b className={h2hHits / n >= 0.5 ? 'text-neon' : 'text-rose-400'}>
                  {h2hHits}/{n}
                </b>
                {n < 3 ? ' · malo utakmica, projekcija ovome daje manju težinu' : ''}
              </p>
            ) : (
              n < 3 && <p className="text-xs leading-relaxed text-zinc-500">Malo utakmica, projekcija ovome daje manju težinu.</p>
            )}
          </>
        ) : (
          <div className={emptyClass}>
            Nije igrao protiv {opponentName} u zadnje 3 sezone. Projekcija se pravi samo iz forme i sezone.
          </div>
        )}
      </section>

      <section className={sectionClass}>
        <h3 className={h3Class}>
          Projekcija
          <small className={h3SmallClass}>
            {player.home ? 'kod kuće' : 'u gostima'} protiv {player.opp}
          </small>
        </h3>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[9px] bg-line">
          {[
            ['pts', 'poena', 'text-accent'],
            ['ast', 'asistencija', 'text-white'],
            ['reb', 'skokova', 'text-white'],
          ].map(([key, label, tone]) => (
            <div key={key} className="bg-surface px-2.5 py-2">
              <b className={`block font-display text-xl font-extrabold tabular-nums ${tone}`}>{fix1(player.proj[key].value)}</b>
              <small className="text-[11.5px] text-zinc-400">{label}</small>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-px overflow-hidden rounded-[9px] bg-line">
          {pts.steps.map((s) => (
            <div key={s.label} className={`flex justify-between gap-2.5 px-2.5 py-1.75 text-[13px] ${s.absence ? 'bg-violet-400/7' : 'bg-surface'}`}>
              <span className={s.absence ? 'text-violet-300' : 'text-zinc-400'}>{s.label}</span>
              {s.delta === undefined ? (
                <b className="font-semibold text-white tabular-nums">{fix1(s.value)}</b>
              ) : (
                <b className={`font-semibold tabular-nums ${s.delta >= 0 ? 'text-neon' : 'text-rose-400'}`}>
                  {s.delta >= 0 ? '+' : '−'}
                  {fix1(Math.abs(s.delta))}
                </b>
              )}
            </div>
          ))}
          <div className="flex justify-between gap-2.5 bg-accent/10 px-2.5 py-1.75 text-[13px]">
            <span className="text-zinc-400">Projekcija poena</span>
            <b className="font-display text-[17px] font-semibold text-accent tabular-nums">{fix1(pts.value)}</b>
          </div>
        </div>

        {player.offered ? (
          <Verdict player={player} isAdmin={isAdmin} onSaveLine={onSaveLine} />
        ) : (
          <div className="flex flex-col gap-2 rounded-[10px] bg-surface px-3.5 py-3 ring-1 ring-white/12 ring-inset">
            <span>
              <NotOfferedTag />
            </span>
            <p className="text-[13px] leading-relaxed text-zinc-400">
              Maxbet je objavio granice za ovu utakmicu, a njega nema u ponudi. Ne može se dodati na tiket.
            </p>
            {isAdmin && <LineEditor key="nema" player={player} onSaveLine={onSaveLine} />}
            {isAdmin && (
              <p className="text-xs leading-relaxed text-zinc-500">
                Ako ga Maxbet doda kasnije, upiši granicu ili ponovi uvoz, pa se može birati. Polje vidi samo admin.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

// Granica, tip i šansa igrača koji je u ponudi (ili čeka Maxbet, sa procjenom).
function Verdict({ player, isAdmin, onSaveLine }) {
  const c = player.chance
  const last5 = player.last10.slice(0, 5)
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-surface px-3.5 py-3 ring-1 ring-white/12 ring-inset">
      <div className="flex items-center justify-between gap-2.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <SourceTag source={player.lineSrc} />
          <b className="font-display text-lg text-white tabular-nums">{player.line}</b> · tip <TipChip tip={c.tip} />
        </span>
        <b className={`font-display text-[30px] leading-none font-extrabold tabular-nums ${pctTone(c.pct)}`}>{c.pct}%</b>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
        <span className={`block h-full rounded-full ${meterTone(c.pct)}`} style={{ width: `${c.pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs text-zinc-400">
        <span className="rounded-[5px] bg-white/4 px-1.75 py-0.5">
          zadnjih 5: <b className="text-white">{(c.tip === '+' ? hitsOver : hitsUnder)(last5, player.line)}/{playedCount(last5)}</b>{' '}
          {c.tip === '+' ? 'preko' : 'ispod'}
        </span>
        <span className="rounded-[5px] bg-white/4 px-1.75 py-0.5">
          zadnjih {player.last10.length}:{' '}
          <b className="text-white">
            {(c.tip === '+' ? hitsOver : hitsUnder)(player.last10, player.line)}/{playedCount(player.last10)}
          </b>
        </span>
        <span className="rounded-[5px] bg-white/4 px-1.75 py-0.5">
          oscilacija ±<b className="text-white">{fix1(c.sd)}</b>
        </span>
      </div>
      {player.guard && (
        <p className="rounded-md bg-gold/8 px-2.5 py-2 text-xs leading-relaxed text-gold">
          Maxbet je granicu podigao iznad uobičajene (naša procjena {player.est}), a ne znamo zašto: povreda saigrača, nova
          uloga, odmor. Šansa je prepolovljena prema 50%. Ako znaš ko ne igra, označi ga u „Ko ne igra“.
        </p>
      )}
      {isAdmin && <LineEditor key={player.line} player={player} onSaveLine={onSaveLine} />}
      <p className="text-xs leading-relaxed text-zinc-500">
        {player.lineSrc === 'maxbet'
          ? 'Granica sa Maxbeta, upisao admin. Igrač je dobija i na tiketu.'
          : 'Procjena iz sezone i forme. Kad izađe Maxbet, admin upisuje pravu granicu.'}
        {isAdmin ? ' Polje vidi samo admin.' : ''}
      </p>
    </div>
  )
}

// Admin upisuje granicu sa Maxbeta; ista granica ide na tikete tog kola.
function LineEditor({ player, onSaveLine }) {
  const [value, setValue] = useState(String(player.line))
  const [state, setState] = useState({ busy: false, error: '' })
  const inputId = `forma-line-${player.id}`

  async function save(line) {
    setState({ busy: true, error: '' })
    try {
      await onSaveLine(player.id, line)
      setState({ busy: false, error: '' })
    } catch (error) {
      setState({ busy: false, error: error.message })
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          save(value.trim().replace(',', '.'))
        }}
      >
        <label htmlFor={inputId} className="text-xs text-zinc-400">
          Granica
        </label>
        <input
          id={inputId}
          type="number"
          step="0.5"
          min="0.5"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-8 w-19 rounded-[7px] border border-white/12 bg-ink px-2 font-display text-[15px] font-semibold text-white tabular-nums focus:outline-2 focus:outline-offset-1 focus:outline-accent"
        />
        <button
          type="submit"
          disabled={state.busy}
          className="h-8 rounded-[7px] bg-accent px-3 font-display text-[13px] font-bold tracking-[0.08em] text-ink uppercase disabled:opacity-60"
        >
          Sačuvaj
        </button>
        {player.lineSrc === 'maxbet' && (
          <button
            type="button"
            disabled={state.busy}
            onClick={() => save(null)}
            className="h-8 rounded-[7px] px-3 font-display text-[13px] font-bold tracking-[0.08em] text-zinc-400 uppercase ring-1 ring-white/12 ring-inset transition hover:text-white disabled:opacity-60"
          >
            {/* Utakmica sa uvezenim Maxbetom: bez granice igrač prelazi u "nije u ponudi". */}
            {player.offer === true ? 'Ukloni granicu' : `Vrati procjenu ${player.est}`}
          </button>
        )}
      </form>
      {state.error && (
        <p role="alert" className="text-xs text-rose-400">
          {state.error}
        </p>
      )}
    </div>
  )
}

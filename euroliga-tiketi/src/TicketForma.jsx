import { useEffect, useId, useRef, useState } from 'react'
import { fix1, hitsOver, hitsUnder, pctTone, playedCount, statProjection } from './forma.js'
import { absenceLabel } from './ticketForma.js'
import { parseTip, STAT_SHORT, TIP_GROUPS, tipName } from './tips.js'

// Forma na tiketu: prijedlozi dok se kuca, kartica izabranog igrača, izbor tipa i oznaka na redu tiketa.
// Forma je savjet; tip bira drugar.

const TIP_TONES = { '+': 'text-neon bg-neon/10 ring-neon/30', '−': 'text-sky bg-sky/10 ring-sky/30' }

function TipMark({ tip }) {
  return (
    <span className={`inline-grid h-4.5 min-w-4.5 place-items-center rounded-[5px] px-0.75 font-display text-[13px] font-extrabold ring-1 ring-inset ${TIP_TONES[tip]}`}>
      {tip}
    </span>
  )
}


// Desna strana prijedloga: granica, tip i šansa, ili zašto ga ne treba birati.
export function FormaMini({ player }) {
  if (!player) return null
  if (player.out) {
    return <span className="rounded bg-rose-500/10 px-1.5 py-px text-[11px] font-semibold text-rose-400">{player.absence?.weight >= 0.75 ? 'Ne igra' : 'Upitan'}</span>
  }
  const c = player.chance
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-zinc-400 tabular-nums">
      {player.guard && <span className="rounded bg-gold/10 px-1.5 py-px text-[10.5px] font-semibold text-gold">Maxbet zna nešto</span>}
      {player.lineSrc === 'maxbet' ? <b className="font-semibold text-white">{player.line}</b> : <span className="text-[11px] italic">proc. {player.line}</span>}
      <TipMark tip={c.tip} />
      <b className={`font-display text-[15px] font-extrabold ${pctTone(c.pct)}`}>{c.pct}%</b>
    </span>
  )
}

// Izbor tipa: krupni + i −, ostalo (manja / veća granica, PS / PA / PAS) u meniju. suggested = Formin tip.
export function TipPicker({ value, onChange, suggested }) {
  const menuId = useId()
  const wrapRef = useRef(null)
  const [open, setOpen] = useState(false)
  const parsed = parseTip(value)
  const other = value && !parsed.plain

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => !wrapRef.current?.contains(event.target) && setOpen(false)
    const onKey = (event) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const plainButton = (code, sign, tone) => {
    const on = value === code
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={code === '+' ? 'Plus, preko granice' : 'Minus, ispod granice'}
        onClick={() => onChange(code)}
        className={`relative rounded-[7px] px-3.5 font-display text-xl font-extrabold transition ${on ? tone : 'text-zinc-400 hover:text-white'}`}
      >
        {sign}
        {suggested === sign && (
          <span className="absolute -top-2 -right-1.5 rounded bg-accent px-1 font-sans text-[9px] leading-3.5 font-bold tracking-[0.04em] text-ink uppercase">
            Forma
          </span>
        )}
      </button>
    )
  }

  return (
    <div ref={wrapRef} className="relative">
      <div role="group" aria-label="Tip" className="inline-flex h-11 rounded-[9px] bg-surface-2 p-0.75 ring-1 ring-line ring-inset">
        {plainButton('+', '+', 'bg-neon/12 text-neon ring-1 ring-neon/35 ring-inset')}
        {plainButton('-', '−', 'bg-sky/12 text-sky ring-1 ring-sky/35 ring-inset')}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(!open)}
          className={`inline-flex items-center gap-1.5 rounded-[7px] px-2.5 font-display text-[13px] font-bold tracking-[0.08em] uppercase transition ${
            open || other ? 'bg-accent/12 text-accent ring-1 ring-accent/35 ring-inset' : 'text-zinc-300 hover:text-white'
          }`}
        >
          {other ? parsed.code.replace('-', '−') : 'Ostalo'}
          <svg aria-hidden="true" viewBox="0 0 12 12" className={`size-2.5 fill-none stroke-current stroke-[1.8] transition ${open ? 'rotate-180' : ''}`}>
            <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div
          id={menuId}
          className="absolute top-[calc(100%+6px)] right-0 z-40 grid w-[min(440px,calc(100vw-32px))] grid-cols-1 gap-3 rounded-xl bg-surface-2 p-2.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/12 min-[480px]:grid-cols-2 motion-safe:animate-[open-down_.14s_ease-out]"
        >
          {TIP_GROUPS.map((group) => (
            <div key={group.label} className="flex min-w-0 flex-col gap-1">
              <span className="px-1 pb-0.5 font-display text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">{group.label}</span>
              <div className="grid grid-cols-2 gap-1">
                {group.options.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    aria-pressed={value === option.code}
                    onClick={() => {
                      onChange(option.code)
                      setOpen(false)
                    }}
                    className={`flex flex-col items-start gap-px rounded-lg px-2 py-1.75 text-left transition ${
                      value === option.code ? 'bg-accent/10 ring-1 ring-accent/50 ring-inset' : 'bg-white/4 hover:bg-surface-hover'
                    }`}
                  >
                    <b className="font-display text-base font-extrabold text-white">{option.code.replace('-', '−')}</b>
                    <small className="text-[11.5px] text-zinc-400">{option.name}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="border-t border-line pt-2 text-xs text-zinc-500 min-[480px]:col-span-2">
            Za ove tipove granicu upisuje admin ručno. Ne dira je uvoz sa Maxbeta, niti ona mijenja granicu u Formi.
          </p>
        </div>
      )}
    </div>
  )
}

// Kartica izabranog igrača ispod polja: šansa, granica, projekcija, zadnjih 5 prema granici, protiv protivnika.
export function FormaPickCard({ player, game, tip }) {
  const parsed = parseTip(tip)
  const last5 = player.last10.slice(0, 5)
  const c = player.chance
  const hits = (c.tip === '+' ? hitsOver : hitsUnder)(last5, player.line)
  const h2h = player.h2h.length ? player.h2h.reduce((sum, g) => sum + g.pts, 0) / player.h2h.length : null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-white/12 ring-inset">
      <div className="min-w-0">
        <b className="block truncate font-semibold text-white">{player.name}</b>
        <small className="block text-[12.5px] text-zinc-400">
          {game ? `${game.home} – ${game.away} · ` : ''}
          {player.home ? 'kod kuće' : 'u gostima'}
        </small>
      </div>
      <div className="text-right">
        {player.out ? (
          <b className="font-display text-lg font-extrabold text-rose-400">{absenceLabel(player)}</b>
        ) : (
          <>
            <b className={`font-display text-[30px] leading-none font-extrabold tabular-nums ${pctTone(c.pct)}`}>
              {c.tip} {c.pct}%
            </b>
            <small className="block text-[11.5px] text-zinc-500">šansa po Formi</small>
          </>
        )}
      </div>
      <div className="col-span-2 flex flex-wrap gap-1.5 text-xs text-zinc-400 tabular-nums">
        <span className="rounded-md bg-white/4 px-2 py-0.75">
          {player.lineSrc === 'maxbet' ? 'Maxbet' : 'Procjena'} <b className="font-semibold text-white">{player.line}</b>
        </span>
        <span className="rounded-md bg-white/4 px-2 py-0.75">
          Projekcija <b className="font-semibold text-white">{fix1(player.proj.pts.value)}</b>
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-white/4 px-2 py-0.75">
          Zadnjih 5
          <span className="inline-flex gap-0.75">
            {last5
              .slice()
              .reverse()
              .map((g, i) => (
                <i
                  key={i}
                  className={`grid h-5 min-w-5.5 place-items-center rounded-[5px] px-0.5 font-display text-xs font-bold not-italic ${
                    g.dnp ? 'text-zinc-500 ring-1 ring-white/12 ring-inset' : g.pts > player.line ? 'bg-neon/10 text-neon' : 'bg-rose-500/10 text-rose-400'
                  }`}
                >
                  {g.dnp ? '–' : g.pts}
                </i>
              ))}
          </span>
          <b className="font-semibold text-white">
            {hits}/{playedCount(last5)}
          </b>
          {c.tip === '+' ? 'preko' : 'ispod'}
        </span>
        {h2h !== null && (
          <span className="rounded-md bg-white/4 px-2 py-0.75">
            Protiv {player.opp} <b className="font-semibold text-white">{fix1(h2h)}</b> ({player.h2h.length})
          </span>
        )}
        {!parsed.plain && tip && (
          <span className="rounded-md bg-violet-400/10 px-2 py-0.75 text-violet-300">
            {tipName(tip)}: Forma {parsed.stat === 'pts' ? fix1(player.proj.pts.value) : `${STAT_SHORT[parsed.stat]} ${fix1(statProjection(player, parsed.stat))}`}
          </span>
        )}
      </div>
      {player.lineSrc !== 'maxbet' && !player.out && (
        <p className="col-span-2 text-xs text-zinc-500">Maxbet još nije objavljen ili uvezen, pa je granica naša procjena i tip se ne predlaže sam.</p>
      )}
      {player.guard && (
        <p className="col-span-2 text-xs text-gold">Maxbet je granicu podigao iznad uobičajene (procjena {player.est}). Možda zna nešto što mi ne znamo.</p>
      )}
    </div>
  )
}


const CHIP_TONES = {
  agree: 'bg-neon/8 text-neon ring-neon/25',
  against: 'bg-gold/8 text-gold ring-gold/30',
  danger: 'bg-rose-500/8 text-rose-400 ring-rose-400/30',
  wait: 'bg-white/4 text-zinc-400 ring-white/12',
}

export function FormaChip({ chip }) {
  return (
    <span className={`mt-1.5 inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-[7px] px-2 py-0.75 text-xs font-semibold ring-1 ring-inset ${CHIP_TONES[chip.tone]}`}>
      {chip.tip && <TipMark tip={chip.tip} />}
      {chip.text}
      {chip.pct !== undefined && <b className="font-display text-sm font-extrabold tabular-nums">· {chip.pct}%</b>}
    </span>
  )
}

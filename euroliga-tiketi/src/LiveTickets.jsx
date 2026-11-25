import { gameStateLabel } from './live.js'

// Prikaz tiketa uživo: traka utakmica, red igrača (kratko na tvom tiketu, puno na zaključanom kolu)
// i broj na kockici igrača u Ekipi.

const STATUS_TEXT = { ok: 'text-neon', bad: 'text-rose-400', live: 'text-accent', risk: 'text-gold', wait: 'text-zinc-400' }
const STATUS_BAR = { ok: 'bg-neon', bad: 'bg-rose-400', live: 'bg-accent', risk: 'bg-gold', wait: 'bg-zinc-500' }
const STATUS_CHIP = {
  ok: 'bg-neon/15 text-neon ring-neon/40',
  bad: 'bg-rose-500/15 text-rose-300 ring-rose-400/40',
  live: 'bg-accent/15 text-accent ring-accent/40',
  risk: 'bg-gold/15 text-gold ring-gold/40',
  wait: 'bg-white/8 text-zinc-300 ring-white/16',
}

function LiveDot() {
  return (
    <span className="relative inline-flex size-1.75">
      <span className="absolute inset-0 rounded-full bg-accent motion-safe:animate-ping" />
      <span className="relative size-1.75 rounded-full bg-accent" />
    </span>
  )
}

// Traka utakmica dana sa našim igračima: rezultat i četvrtina.
export function LiveGames({ games }) {
  if (!games?.length) return null
  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5" aria-label="Utakmice uživo">
      {games.map((g) => {
        const homeLead = g.scoreHome >= g.scoreAway
        return (
          <div
            key={g.id}
            className={`flex min-w-42 shrink-0 flex-col gap-1 rounded-xl px-3.5 py-2.25 ring-1 ring-inset ${
              g.live ? 'bg-accent/7 ring-accent/45' : 'bg-surface ring-white/12'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2.5 font-display font-extrabold tabular-nums">
              <span className="text-[15px] tracking-[0.06em] text-white">{g.home}</span>
              <b className={`text-2xl ${homeLead ? 'text-white' : 'text-zinc-400'}`}>{g.scoreHome}</b>
              <b className={`text-2xl ${homeLead ? 'text-zinc-400' : 'text-white'}`}>{g.scoreAway}</b>
              <span className="text-[15px] tracking-[0.06em] text-white">{g.away}</span>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 font-display text-xs font-bold tracking-widest uppercase ${g.live ? 'text-accent' : 'text-zinc-400'}`}
            >
              {g.live && <LiveDot />}
              {gameStateLabel(g)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Igrač uživo. full = zaključano kolo (broj, traka, tempo, stanje); inače kratko u redu tvog tiketa.
export function LiveLine({ state, full = false }) {
  const { value, line, status } = state
  const width = line ? Math.min(100, (value / line) * 100) : 0
  const mark = line ? Math.min(100, (line / Math.max(line, value)) * 100) : null
  const tempoAt = state.tempo && line ? Math.min(100, (state.tempo / Math.max(line, value, state.tempo)) * 100) : null
  const extra = [
    state.parts,
    state.stats.min > 0 && `${Math.round(state.stats.min)} min`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`flex min-w-0 flex-col gap-1.25 ${full ? '' : 'mt-1.5'}`}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="font-display text-xl leading-none font-extrabold text-white tabular-nums">
          {state.stat && <span className="mr-1 text-sm text-violet-300">{state.stat}</span>}
          {value}
          {line !== null && <span className="text-sm text-zinc-500"> / {line}</span>}
        </span>
        <span className={`font-display text-[13px] font-extrabold tracking-[0.06em] uppercase ${STATUS_TEXT[status]}`}>{state.label}</span>
        <span className="text-xs text-zinc-500 tabular-nums">
          {[state.need ?? state.note, state.quarter].filter(Boolean).join(' · ')}
        </span>
      </div>
      {line !== null && (
        <div className="relative h-1.75 rounded-full bg-white/6">
          <i className={`absolute inset-y-0 left-0 rounded-full ${STATUS_BAR[status]}`} style={{ width: `${width}%` }} />
          {mark !== null && mark < 100 && <span className="absolute -inset-y-1 w-0.5 rounded bg-white/70" style={{ left: `${mark}%` }} />}
          {full && tempoAt !== null && <span className="absolute -inset-y-0.75 w-0.5 bg-accent" style={{ left: `${tempoAt}%` }} title={`tempo ${state.tempo}`} />}
        </div>
      )}
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px] text-zinc-500 tabular-nums">
        {extra && <span>{extra}</span>}
        {state.stats.onCourt ? (
          <span className="inline-flex items-center gap-1 font-semibold text-neon">
            <span className="size-1.5 rounded-full bg-neon" />
            na terenu
          </span>
        ) : (
          state.quarter !== 'kraj' && state.stats.min > 0 && <span>na klupi</span>
        )}
        {state.stats.fouls >= 4 && <span className="font-semibold text-gold">{state.stats.fouls} faula</span>}
        {full && state.tempo !== null && state.tempo !== undefined && <span className="text-accent">tempo {state.tempo}</span>}
      </div>
    </div>
  )
}

// Broj na kockici igrača u Ekipi: poeni (ili zbir) u boji stanja.
export function LiveBadge({ state }) {
  return (
    <span
      className={`pointer-events-none absolute -right-1.5 -bottom-2 min-w-5 rounded-md px-1 text-center font-display text-[11px] leading-4 font-extrabold tabular-nums ring-1 ring-inset ${STATUS_CHIP[state.status]}`}
    >
      {state.value}
    </span>
  )
}

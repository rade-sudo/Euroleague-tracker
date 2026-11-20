import { useState } from 'react'
import { buttonClass, dayTime, labelClass, lastName, mult, points, POS_TONE, sortByPosition } from './fantasy.js'

export function PosChip({ pos }) {
  return (
    <span className={`inline-grid h-5 min-w-5.5 place-items-center rounded-[5px] px-1.25 font-display text-xs font-extrabold tracking-[0.06em] ${POS_TONE[pos] ?? 'bg-white/5 text-zinc-400'}`}>
      {pos}
    </span>
  )
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-[14px] border-[1.5px] border-dashed border-white/16 px-5 py-6.5">
      <b className="font-display text-[22px] font-extrabold uppercase text-white">{title}</b>
      <p className="max-w-160 text-zinc-400">{children}</p>
      {action}
    </div>
  )
}

const ROLE_TONE = {
  captain: 'bg-gold text-ink',
  vice: 'bg-zinc-50 text-ink',
}
const ROLE_LETTER = { captain: 'K', vice: 'V' }

// Moja ekipa: petorka i klupa za sljedeće kolo, kapiten, vice i bodovi po kolima.
export default function FantasyTeam({ ctx, act, busy, goTo }) {
  const { data, players, me } = ctx
  const [selected, setSelected] = useState(null)

  if (me === null) {
    return <EmptyState title="Nalog nije vezan za drugara">Fantasy ekipu ima svaki drugar iz tabele. Admin u Mom nalogu veže nalog za drugara.</EmptyState>
  }
  const roster = data.rosters[me] ?? []
  if (data.draft.status !== 'done' || roster.length < 8) {
    return (
      <EmptyState
        title={['live', 'paused'].includes(data.draft.status) ? 'Draft je u toku' : 'Draft još nije održan'}
        action={
          <button type="button" onClick={() => goTo('draft')} className={buttonClass}>
            Na draft
          </button>
        }
      >
        Kad draft prođe, ovdje ćeš vidjeti svojih 8 igrača i birati petorku za svako kolo.
        {data.settings.draftAt && data.draft.status === 'waiting' ? ` Draft veče: ${dayTime(data.settings.draftAt)}.` : ''}
      </EmptyState>
    )
  }

  const starters = sortByPosition(roster.filter((x) => x.starter), players)
  const bench = sortByPosition(roster.filter((x) => !x.starter), players)
  const captain = roster.find((x) => x.role === 'captain')?.playerId
  const vice = roster.find((x) => x.role === 'vice')?.playerId
  const next = data.next

  function save(nextStarters, nextCaptain, nextVice, done) {
    return act('/fantasy/lineup', { method: 'PUT', body: { starters: nextStarters, captain: nextCaptain, vice: nextVice }, done })
  }

  // Dodir na igrača iz petorke pa na igrača sa klupe iste pozicije (ili obrnuto) ih mijenja.
  async function tap(entry) {
    if (busy) return
    if (selected === null || selected === entry.playerId) {
      setSelected(selected === entry.playerId ? null : entry.playerId)
      return
    }
    const first = roster.find((x) => x.playerId === selected)
    if (players.get(first.playerId).pos !== players.get(entry.playerId).pos || first.starter === entry.starter) {
      setSelected(entry.playerId)
      return
    }
    const out = first.starter ? first : entry
    const into = first.starter ? entry : first
    const nextStarters = starters.map((x) => (x.playerId === out.playerId ? into.playerId : x.playerId))
    const swapRole = (id) => (id === out.playerId ? into.playerId : id)
    setSelected(null)
    await save(nextStarters, swapRole(captain), swapRole(vice), `${lastName(players.get(into.playerId).name)} ulazi u petorku, ${lastName(players.get(out.playerId).name)} na klupu.`)
  }

  function setRole(playerId, role) {
    if (busy) return
    let nextCaptain = captain
    let nextVice = vice
    if (role === 'captain') {
      if (vice === playerId) nextVice = captain
      nextCaptain = playerId
    } else {
      if (captain === playerId) nextCaptain = vice
      nextVice = playerId
    }
    save(starters.map((x) => x.playerId), nextCaptain, nextVice)
  }

  const slot = (entry, isBench) => {
    const player = players.get(entry.playerId)
    const isSelected = selected === entry.playerId
    const other = selected !== null && selected !== entry.playerId ? roster.find((x) => x.playerId === selected) : null
    const target = other && players.get(other.playerId).pos === player.pos && other.starter !== entry.starter
    return (
      <div
        key={entry.playerId}
        role="button"
        tabIndex={0}
        onClick={() => tap(entry)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            tap(entry)
          }
        }}
        className={`relative flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-[11px] px-2.75 py-2.5 text-left ring-inset transition ${
          isBench ? 'bg-ink/60' : 'bg-ink'
        } ${
          isSelected
            ? '-translate-y-0.5 ring-[1.5px] ring-accent'
            : target
              ? 'bg-[linear-gradient(180deg,rgba(255,106,19,0.12),transparent)] ring-[1.5px] ring-accent/38'
              : 'ring-1 ring-line hover:ring-white/16'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <PosChip pos={player.pos} />
          <span className="text-xs font-semibold tracking-[0.06em] text-zinc-400">{player.clubCode}</span>
          {!isBench && (
            <span className="ml-auto flex gap-1">
              {['captain', 'vice'].map((role) => {
                const on = (role === 'captain' ? captain : vice) === entry.playerId
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={on}
                    title={role === 'captain' ? 'Kapiten ×2' : 'Vicekapiten ×1,5'}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (!on) setRole(entry.playerId, role)
                    }}
                    className={`grid h-5.5 w-6 place-items-center rounded-md font-display text-[13px] font-extrabold transition ${
                      on ? ROLE_TONE[role] : 'bg-surface-2 text-zinc-600 ring-1 ring-line ring-inset hover:text-white'
                    }`}
                  >
                    {ROLE_LETTER[role]}
                  </button>
                )
              })}
            </span>
          )}
        </div>
        <div className="font-display text-lg font-bold uppercase leading-[1.05] wrap-anywhere text-white">{player.name}</div>
        <div className="flex items-center justify-between gap-2 text-[12.5px] text-zinc-400">
          <span>
            prosjek <b className="font-semibold tabular-nums text-white">{points(player.avg)}</b>
          </span>
          {target && <span className="text-accent">zamijeni</span>}
        </div>
      </div>
    )
  }

  const tripleRound = data.triple[me] ?? null
  const tripleOn = next && tripleRound === next.round
  const tripleUsed = tripleRound !== null && !tripleOn

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2.5">
        <div>
          <h3 className="font-display text-[26px] font-extrabold uppercase leading-none text-white">
            {next ? `Postava za kolo ${next.round}` : 'Sezona je završena'}
          </h3>
          {next && (
            <p className="mt-1 text-sm text-zinc-400">
              Rok: {dayTime(next.deadline)}. Postava se pamti i za sljedeće kolo dok je ne promijeniš.
            </p>
          )}
        </div>
        {next && <span className="rounded-full bg-neon/10 px-2.5 py-1 text-[13px] font-semibold text-neon">otvoreno</span>}
      </div>

      <div className="grid grid-cols-1 gap-4.5 min-[940px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="relative flex flex-col gap-3 overflow-hidden rounded-[14px] bg-[radial-gradient(circle_at_50%_0%,transparent_0_88px,rgba(255,255,255,0.06)_89px_90px,transparent_91px),linear-gradient(180deg,rgba(255,106,19,0.07),transparent_60%)] bg-surface-2 p-4 ring-1 ring-line ring-inset">
          <span aria-hidden="true" className="pointer-events-none absolute top-0 left-1/2 h-30 w-37.5 -translate-x-1/2 border border-t-0 border-white/6" />
          <span className={`relative ${labelClass}`}>Petorka</span>
          <div className="relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2">{starters.map((x) => slot(x, false))}</div>
          <span className={`relative ${labelClass}`}>Klupa</span>
          <div className="relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2">{bench.map((x) => slot(x, true))}</div>
          <p className="relative m-0 text-[13px] text-zinc-400">
            Dodirni igrača iz petorke, pa igrača sa klupe iste pozicije, i zamijene se. K je kapiten, V vicekapiten.
          </p>
          {data.settings.triple && next && (
            <div className="relative flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <button
                type="button"
                aria-pressed={tripleOn}
                disabled={busy || tripleUsed}
                onClick={() => act('/fantasy/triple', { method: 'PUT', body: { on: !tripleOn }, done: tripleOn ? 'Trostruki kapiten isključen.' : `Kapiten nosi ×3 u kolu ${next.round}.` })}
                className="inline-flex items-center gap-2 rounded-full bg-ink py-1.5 pr-3 pl-1.5 text-[13px] text-zinc-300 ring-1 ring-white/16 ring-inset disabled:opacity-40"
              >
                <i className={`relative h-4 w-7 rounded-full transition ${tripleOn ? 'bg-gold' : 'bg-surface-hover'}`}>
                  <i className={`absolute top-0.5 left-0.5 size-3 rounded-full transition ${tripleOn ? 'translate-x-3 bg-ink' : 'bg-zinc-400'}`} />
                </i>
                Trostruki kapiten u ovom kolu
              </button>
              <span className="text-[13px] text-zinc-400">
                {tripleOn ? 'Kapiten nosi ×3. Poslije roka ti ne ostaje nijedan do kraja sezone.' : tripleUsed ? `Iskoristio si ga u kolu ${tripleRound}.` : 'Imaš ga jednom ove sezone.'}
              </span>
            </div>
          )}
        </div>

        <ScorePanel ctx={ctx} />
      </div>
    </div>
  )
}

// Bodovi po kolima (zaključane postave); prije prvog kola primjer na PIR-u posljednjih kola.
function ScorePanel({ ctx }) {
  const { data, players, me } = ctx
  const real = data.rounds.filter((round) => round.rows[me])
  const options = real.length
    ? real.map((round) => ({ round: round.round, rows: round.rows[me], total: round.points[me], live: round.live, final: round.final, preview: false }))
    : data.preview.map((round) => ({ ...round, preview: true }))
  const fallback = options.find((option) => option.live) ?? options.at(-1)
  const [chosen, setChosen] = useState(null)
  const current = options.find((option) => option.round === chosen) ?? fallback

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[14px] bg-surface-2 p-4 ring-1 ring-line ring-inset">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <h4 className="font-display text-lg font-bold uppercase tracking-[0.03em] text-white">
          {current?.preview || !current ? 'Kako bi se bodovalo' : 'Bodovi po kolima'}
        </h4>
        {options.length > 0 && (
          <div className="inline-flex max-w-full flex-wrap rounded-[9px] bg-ink p-0.75 ring-1 ring-line ring-inset">
            {options.map((option) => (
              <button
                key={option.round}
                type="button"
                aria-pressed={option.round === current.round}
                onClick={() => setChosen(option.round)}
                className={`rounded-[7px] px-2.5 py-1.25 text-[13px] font-medium ${
                  option.round === current.round ? 'bg-surface-hover text-white ring-1 ring-white/16 ring-inset' : 'text-zinc-400 hover:text-white'
                }`}
              >
                K{option.round}
                {option.live && <span className="ml-1 inline-block size-1.5 rounded-full bg-neon align-[2px]" />}
              </button>
            ))}
          </div>
        )}
      </div>
      {!current ? (
        <p className="m-0 text-[13px] text-zinc-400">Bodovi se pojave kad počne prvo kolo lige.</p>
      ) : (
        <>
          <p className="m-0 text-[13px] text-zinc-400">
            {current.preview
              ? `Primjer: ova postava na stvarnom PIR-u iz ${current.round}. kola.`
              : current.live
                ? `Kolo ${current.round} uživo: PIR se osvježava svakih par minuta.`
                : `Kolo ${current.round}: tvoja postava zaključana u rok.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr>
                  {['Igrač', 'PIR', '×', 'Bodovi'].map((title, index) => (
                    <th
                      key={title}
                      className={`border-b border-line px-2 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 ${index ? 'text-right' : 'text-left'}`}
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {current.rows.map((row) => (
                  <ScoreRow key={row.playerId} row={row} players={players} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="px-2 pt-3 font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                    Ukupno
                  </td>
                  <td className="px-2 pt-3 text-right font-display text-[22px] font-extrabold text-white">{points(current.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export function ScoreRow({ row, players }) {
  const player = players.get(row.playerId)
  const sub = row.sub === null ? null : players.get(row.sub)
  const pir = row.sub === null ? row.pir : row.subPir
  let note = null
  if (sub) {
    note = (
      <>
        <span className="block text-xs text-rose-400">nije igrao</span>
        <span className="block text-xs text-neon">ušao {sub.name} sa klupe</span>
      </>
    )
  } else if (row.state === 'dnp') {
    note = <span className="block text-xs text-rose-400">nije igrao, nema zamjene na klupi</span>
  } else if (row.role === 'vice' && row.mult === 2) {
    note = <span className="block text-xs text-zinc-400">kapiten nije igrao, vice nosi ×2</span>
  } else if (row.state === 'pending') {
    note = <span className="block text-xs text-zinc-500">čeka utakmicu</span>
  } else if (row.state === 'live') {
    note = <span className="block text-xs text-neon">uživo</span>
  }
  return (
    <tr>
      <td className="border-b border-line px-2 py-2">
        <span className="inline-flex items-center gap-1.5">
          <PosChip pos={row.pos} />
          <span className="text-white">{player ? lastName(player.name) : '—'}</span>
        </span>
        {note}
      </td>
      <td className={`border-b border-line px-2 py-2 text-right ${pir < 0 ? 'text-rose-400' : ''}`}>{pir ?? '–'}</td>
      <td className="border-b border-line px-2 py-2 text-right">
        <span className={`inline-block min-w-8.5 rounded-[5px] px-1.5 py-px text-center text-[12.5px] font-semibold ${ROLE_TONE[row.role] ?? 'bg-surface-hover text-zinc-400'}`}>
          {row.role ? `${ROLE_LETTER[row.role]} ` : ''}
          {mult(row.mult)}
        </span>
      </td>
      <td className={`border-b border-line px-2 py-2 text-right ${row.points < 0 ? 'text-rose-400' : 'text-white'}`}>{points(row.points)}</td>
    </tr>
  )
}

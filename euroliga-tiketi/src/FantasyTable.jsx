import { Fragment, useState } from 'react'
import { EmptyState, PosChip, ScoreRow } from './FantasyTeam.jsx'
import { labelClass, points, sortByPosition } from './fantasy.js'
import { TrophyIcon } from './icons.jsx'

const VISIBLE_ROUNDS = 6
const PLACES = ['1. mjesto', '2. mjesto', '3. mjesto']

// Tabela lige, nagradni fond i ekipe svih drugara.
export default function FantasyTable({ ctx }) {
  const { data, players, me, short } = ctx
  const [open, setOpen] = useState(null)

  if (data.draft.status !== 'done') {
    return <EmptyState title="Tabela čeka draft">Bodovi kreću od prvog kola lige. Do tada je ovdje prazno.</EmptyState>
  }

  const rounds = data.rounds.slice(-VISIBLE_ROUNDS)
  const best = Object.fromEntries(rounds.map((round) => [round.round, round.final ? Math.max(...Object.values(round.points)) : null]))
  const lastFinal = [...data.rounds].reverse().find((round) => round.final && round.winners.length)
  const { fund } = data
  const prizeBase = fund.projected

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2.5">
        <div>
          <h3 className="font-display text-[26px] font-extrabold uppercase leading-none text-white">Tabela</h3>
          <p className="mt-1 text-sm text-zinc-400">
            {data.rounds.length
              ? 'Zbir bodova svih kola lige. Dodirni drugara da vidiš njegovu postavu u posljednjem kolu.'
              : `Prvo kolo lige je kolo ${data.next?.round ?? data.settings.startRound}. Bodovi se pojave čim počne.`}
          </p>
        </div>
        {lastFinal && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/12 px-2.5 py-1 text-[13px] font-semibold text-gold">
            <TrophyIcon className="size-3.5" />
            pobjednik {lastFinal.round}. kola: {lastFinal.winners.map(short).join(', ')}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr>
              <th className="w-7" />
              <th className="border-b border-line px-2 py-1.5 text-left font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Drugar</th>
              {rounds.map((round) => (
                <th key={round.round} className="border-b border-line px-2 py-1.5 text-right font-display text-[11px] font-semibold uppercase tracking-[0.18em] whitespace-nowrap text-zinc-400">
                  K{round.round}
                  {round.live && <span className="ml-1 inline-block size-1.5 rounded-full bg-neon align-[2px]" title="uživo" />}
                </th>
              ))}
              <th className="border-b border-line px-2 py-1.5 text-right font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Ukupno</th>
              <th className="border-b border-line px-2 py-1.5 text-right font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Kola</th>
            </tr>
          </thead>
          <tbody>
            {data.standings.map((row, index) => {
              const latest = data.rounds.at(-1)
              const isOpen = open === row.friendId && latest?.rows[row.friendId]
              return (
                <Fragment key={row.friendId}>
                  <tr
                    onClick={() => setOpen(open === row.friendId ? null : row.friendId)}
                    className={`cursor-pointer transition hover:bg-white/3 ${row.friendId === me ? 'bg-accent/12 hover:bg-accent/16' : ''}`}
                  >
                    <td className={`border-b border-line px-2 py-2 font-display text-lg font-extrabold ${index === 0 && data.rounds.length ? 'text-gold' : 'text-zinc-600'}`}>
                      {index + 1}
                    </td>
                    <td className="border-b border-line px-2 py-2 font-semibold whitespace-nowrap text-white">{short(row.friendId)}</td>
                    {rounds.map((round) => {
                      const value = round.points[row.friendId]
                      const won = round.final && value === best[round.round]
                      return (
                        <td key={round.round} className={`border-b border-line px-2 py-2 text-right ${won ? 'font-bold text-gold' : 'text-zinc-300'}`}>
                          {value === undefined ? '–' : points(value)}
                        </td>
                      )
                    })}
                    <td className="border-b border-line px-2 py-2 text-right font-display text-xl font-extrabold text-white">{points(row.total)}</td>
                    <td className="border-b border-line px-2 py-2 text-right">
                      {row.wins ? (
                        <span className="inline-flex items-center gap-0.75 font-bold text-gold">
                          <TrophyIcon className="size-3.5" />
                          {row.wins}
                        </span>
                      ) : (
                        <span className="text-zinc-600">0</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={rounds.length + 4} className="border-b border-line bg-ink/60 px-2 py-2">
                        <span className={labelClass}>
                          {short(row.friendId)} · kolo {latest.round}
                          {latest.live ? ' · uživo' : ''}
                        </span>
                        <table className="mt-1 w-full max-w-120 border-collapse text-sm tabular-nums">
                          <tbody>
                            {latest.rows[row.friendId].map((scoreRow) => (
                              <ScoreRow key={scoreRow.playerId} row={scoreRow} players={players} />
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <span className={labelClass}>
        Nagrada na kraju sezone · {points(fund.perRound)} KM po kolu po drugaru
        {data.settings.mode === 'live' ? ` · u fondu ${points(fund.current)} KM (${fund.rounds} kola)` : ''}
      </span>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-2.5">
        {fund.split.map((percent, index) => (
          <div
            key={percent + index}
            className={`rounded-xl px-3.5 py-3 ring-1 ring-inset ${index === 0 ? 'bg-[linear-gradient(180deg,rgba(255,197,61,0.12),transparent_80%)] bg-surface-2 ring-gold/40' : 'bg-surface-2 ring-line'}`}
          >
            <span className={labelClass}>{PLACES[index]}</span>
            <b className={`block font-display text-[26px] font-extrabold tabular-nums ${index === 0 ? 'text-gold' : 'text-white'}`}>
              {points(Math.round(prizeBase * percent) / 100)} KM
            </b>
            <small className="text-zinc-400">{percent}% fonda od {points(prizeBase)} KM</small>
          </div>
        ))}
      </div>

      <span className={labelClass}>Ekipe</span>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-2.5">
        {data.friends.map((friend) => (
          <div key={friend.id} className={`rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ${friend.id === me ? 'ring-accent/38' : 'ring-line'}`}>
            <b className="font-display text-[17px] font-bold uppercase tracking-[0.04em] text-white">{short(friend.id)}</b>
            <ul className="mt-1.5 flex flex-col gap-1">
              {sortByPosition(data.rosters[friend.id] ?? [], players).map((entry) => {
                const player = players.get(entry.playerId)
                return (
                  <li key={entry.playerId} className="flex items-center gap-2 text-[13.5px]">
                    <PosChip pos={player?.pos} />
                    <span className={`min-w-0 flex-1 truncate ${entry.starter && friend.id === me ? 'text-white' : 'text-zinc-300'}`}>{player?.name}</span>
                    <span className="text-xs text-zinc-500">{player?.clubCode}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

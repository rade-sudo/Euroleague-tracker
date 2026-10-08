import { useEffect, useState } from 'react'
import { api } from './api.js'
import AppHeader from './AppHeader.jsx'
import FriendPicker from './FriendPicker.jsx'
import { XIcon } from './icons.jsx'
import { BALANCE_TONES, balanceState, km, moneyInput } from './money.js'
import { useSessionGuard } from './session.js'

const DAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']

const cardClass =
  'min-w-0 rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)]'
const labelClass = 'font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400'
const thClass = 'whitespace-nowrap bg-surface-2 px-3.5 py-2.75 text-right font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400 first:text-left'
const tdClass = 'whitespace-nowrap border-b border-line px-3.5 py-2.75 text-right tabular-nums first:text-left'

const STATUS = {
  won: { label: 'Prošao', tone: 'bg-neon/10 text-neon' },
  lost: { label: 'Pao', tone: 'bg-rose-500/10 text-rose-400' },
  pending: { label: 'U toku', tone: 'bg-[#7cc4ff]/10 text-[#7cc4ff]' },
}

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

// "2026-10-08" → "čet 8. 10."
function shortDate(value) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00`)
  return `${DAYS[date.getDay()]} ${date.getDate()}. ${date.getMonth() + 1}.`
}

// "2026-10-08T21:14" → "8. 10. u 21:14"
function shortTime(value) {
  const [date, time] = value.split('T')
  const [, month, day] = date.split('-').map(Number)
  return `${day}. ${month}. u ${time}`
}

// Kasa sezone: ulozi, dobici, uplate i stanje svakog drugara. Uplate upisuje admin.
export default function CashPage() {
  const [user, setUser] = useState(null)
  const [cash, setCash] = useState(null)
  const [load, setLoad] = useState({ status: 'loading', error: '' })

  useSessionGuard()

  useEffect(() => {
    let ignore = false
    Promise.all([api('/me'), api('/cash')]).then(
      ([me, data]) => {
        if (ignore) return
        setUser(me.user)
        setCash(data)
        setLoad({ status: 'ready', error: '' })
      },
      (loadError) => !ignore && loadError.status !== 401 && setLoad({ status: 'error', error: loadError.message }),
    )
    return () => {
      ignore = true
    }
  }, [])

  const isAdmin = user?.role === 'admin'

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-130 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(255,106,19,0.16),transparent)]"
      />
      <main className="relative mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <AppHeader user={user} active="kasa" />

        {load.status === 'loading' && <p className="py-16 text-center text-sm text-zinc-500">Učitavanje kase…</p>}
        {load.status === 'error' && (
          <p role="alert" className="rounded-xl px-5 py-10 text-center text-sm text-rose-400 ring-1 ring-line ring-inset">
            {load.error}
          </p>
        )}

        {load.status === 'ready' && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent">Sezona</span>
              <h2 className="font-display text-[clamp(38px,5.5vw,52px)] font-extrabold uppercase leading-[0.95] text-white">
                Kasa
              </h2>
              <p className="max-w-3xl text-zinc-400">
                Svako plaća {km(cash.stakePerPlayer, { whole: true })} po svom igraču. Isplatu tiketa koji je prošao dijele
                igrači sa tog tiketa, po igraču. Stanje: uplate plus dobici, minus ulozi. Crveno znači da drugar duguje kasi,
                a zeleno da kasa duguje njemu.
              </p>
            </div>

            <Tiles totals={cash.totals} stakePerPlayer={cash.stakePerPlayer} />
            <BalanceTable cash={cash} />

            <div className={`grid grid-cols-1 items-start gap-5 ${isAdmin ? 'min-[920px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]' : ''}`}>
              <Payments cash={cash} isAdmin={isAdmin} onChange={setCash} />
              <SeasonSlips slips={cash.slips} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function Tiles({ totals, stakePerPlayer }) {
  const diff = totals.won - totals.stake
  const tiles = [
    { label: 'Uloženo', value: km(totals.stake), note: `${totals.slips} ${totals.slips === 1 ? 'tiket' : 'tiketa'} · ${km(stakePerPlayer, { whole: true })} po igraču` },
    { label: 'Dobijeno', value: km(totals.won), note: totals.slipsWon === 1 ? '1 tiket prošao' : `${totals.slipsWon} tiketa prošlo` },
    { label: 'Razlika', value: `${diff >= 0 ? '+' : '−'}${km(Math.abs(diff))}`, note: 'dobijeno minus uloženo', tone: diff > 0 ? 'text-neon' : diff < 0 ? 'text-rose-400' : 'text-white' },
    { label: 'U kasi kod admina', value: km(totals.cash), note: 'uplate + dobici − ulozi' },
  ]
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex flex-col gap-1 rounded-xl bg-surface px-4 py-3.5 ring-1 ring-line ring-inset">
          <span className={labelClass}>{tile.label}</span>
          <b className={`font-display text-[32px] font-extrabold leading-none tabular-nums ${tile.tone ?? 'text-white'}`}>{tile.value}</b>
          <small className="text-[13px] text-zinc-400">{tile.note}</small>
        </div>
      ))}
    </div>
  )
}

function BalanceTable({ cash }) {
  const { friends, totals } = cash
  return (
    <div className="overflow-x-auto rounded-xl bg-surface ring-1 ring-line ring-inset">
      <table className="w-full min-w-160 border-collapse text-sm">
        <thead>
          <tr>
            <th className={thClass}>Drugar</th>
            <th className={thClass}>Igrača na tiketima</th>
            <th className={thClass}>Uložio</th>
            <th className={thClass}>Dobio</th>
            <th className={thClass}>Uplatio</th>
            <th className={thClass}>Stanje</th>
          </tr>
        </thead>
        <tbody>
          {friends.map((row) => {
            const state = balanceState(row.state)
            return (
              <tr key={row.friendId}>
                <td className={tdClass}>
                  <span className="flex items-center gap-2.5 font-semibold text-white">
                    <span className="grid size-7.5 shrink-0 place-items-center rounded-full bg-linear-to-br from-zinc-700 to-zinc-800 font-display text-xs font-bold ring-1 ring-white/10 ring-inset">
                      {initials(row.name)}
                    </span>
                    {row.name}
                  </span>
                </td>
                <td className={`${tdClass} text-zinc-300`}>{row.slots}</td>
                <td className={`${tdClass} text-zinc-300`}>{km(row.stake)}</td>
                <td className={`${tdClass} text-zinc-300`}>{km(row.won)}</td>
                <td className={`${tdClass} text-zinc-300`}>{km(row.paid)}</td>
                <td className={tdClass}>
                  <span className={`inline-block min-w-32 rounded-[7px] px-2.25 py-0.75 text-center font-display text-[15px] font-bold ring-1 ring-inset ${BALANCE_TONES[state.tone]}`}>
                    {state.text}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-surface-2 font-semibold text-white">
            <td className="px-3.5 py-2.75">Ukupno</td>
            <td className="px-3.5 py-2.75 text-right tabular-nums">{friends.reduce((sum, row) => sum + row.slots, 0)}</td>
            <td className="px-3.5 py-2.75 text-right tabular-nums">{km(totals.stake)}</td>
            <td className="px-3.5 py-2.75 text-right tabular-nums">{km(totals.won)}</td>
            <td className="px-3.5 py-2.75 text-right tabular-nums">{km(totals.paid)}</td>
            <td className="px-3.5 py-2.75 text-right tabular-nums">{km(totals.cash)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Payments({ cash, isAdmin, onChange }) {
  const [friendId, setFriendId] = useState(cash.friends[0]?.friendId ?? null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const friends = cash.friends.map((row) => ({ id: row.friendId, name: row.name }))
  const balances = Object.fromEntries(cash.friends.map((row) => [row.friendId, row.state]))
  const nameOf = (id) => friends.find((friend) => friend.id === id)?.name ?? ''

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      onChange(await action())
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy(false)
    }
  }

  function submit(event) {
    event.preventDefault()
    if (!amount.trim()) {
      setError('Upiši iznos.')
      return
    }
    run(async () => {
      const data = await api('/cash/payments', {
        method: 'POST',
        body: JSON.stringify({ friendId, amount: moneyInput(amount) }),
      })
      setAmount('')
      return data
    })
  }

  return (
    <section aria-labelledby="payments-title" className={cardClass}>
      <div className="border-b border-line px-4 py-3.25">
        <h3 id="payments-title" className="font-display text-xl font-bold uppercase tracking-[0.03em] text-white">
          Uplate u kasu
        </h3>
        <p className="mt-0.5 text-[13px] text-zinc-400">
          {isAdmin ? 'Upisuješ i svoj novac kojim si platio tikete.' : 'Upisuje admin, kad neko izmiri.'}
        </p>
      </div>
      {isAdmin && (
        <>
          <form onSubmit={submit} noValidate className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 pt-3 min-[521px]:grid-cols-[minmax(0,1fr)_118px_auto]">
            <div className="col-span-2 min-[521px]:col-span-1">
              <FriendPicker friends={friends} balances={balances} value={friendId} onChange={setFriendId} />
            </div>
            <label className="relative min-w-0">
              <input
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value)
                  if (error) setError('')
                }}
                inputMode="decimal"
                placeholder="0,00"
                aria-label="Iznos u KM"
                className="h-11.5 w-full rounded-[10px] border border-line bg-surface-2 pr-10 pl-3 text-right font-display text-xl font-bold tabular-nums text-white outline-none placeholder:text-zinc-600 focus:border-accent focus:ring-3 focus:ring-accent/12"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-display text-[13px] font-bold tracking-[0.08em] text-zinc-400">
                KM
              </span>
            </label>
            <button
              type="submit"
              disabled={busy}
              className="h-11.5 rounded-[10px] bg-accent px-4 font-display text-sm font-bold uppercase tracking-[0.1em] text-ink shadow-[0_12px_30px_-12px_rgba(255,106,19,0.7)] transition hover:brightness-110 disabled:opacity-50"
            >
              Upiši
            </button>
          </form>
          <p className="border-b border-line px-4 pt-2 pb-3 text-[12.5px] text-zinc-400">
            Podizanje novca iz kase upiše se sa minusom, npr. −20.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="px-4 pt-3 text-[13px] text-rose-400">
          {error}
        </p>
      )}
      {cash.payments.length ? (
        <ul>
          {cash.payments.map((payment) => (
            <li key={payment.id} className="flex items-center gap-3 border-b border-line px-4 py-2.25 text-sm last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="text-white">{nameOf(payment.friendId)}</span>
                <small className="ml-1.5 text-zinc-400">{shortTime(payment.createdAt)}</small>
              </span>
              <span className={`font-display text-base font-bold tabular-nums ${payment.amount < 0 ? 'text-rose-400' : 'text-neon'}`}>
                {payment.amount < 0 ? '−' : '+'}
                {km(Math.abs(payment.amount))}
              </span>
              {isAdmin && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Obrisati uplatu ${km(payment.amount)} (${nameOf(payment.friendId)})?`)) {
                      run(() => api(`/cash/payments/${payment.id}`, { method: 'DELETE' }))
                    }
                  }}
                  aria-label="Obriši uplatu"
                  className="grid size-7 place-items-center rounded-md text-zinc-600 transition hover:bg-rose-500/10 hover:text-rose-400"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-zinc-500">Još nema uplata.</p>
      )}
    </section>
  )
}

function SeasonSlips({ slips }) {
  return (
    <section aria-labelledby="slips-title" className={cardClass}>
      <div className="border-b border-line px-4 py-3.25">
        <h3 id="slips-title" className="font-display text-xl font-bold uppercase tracking-[0.03em] text-white">
          Tiketi sezone
        </h3>
        <p className="mt-0.5 text-[13px] text-zinc-400">Uplaćeni tiketi, sa kvotom koju je upisao admin.</p>
      </div>
      {slips.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-130 border-collapse text-sm">
            <thead>
              <tr>
                <th className={thClass}>Kolo</th>
                <th className={thClass}>Tiket</th>
                <th className={thClass}>Igrača</th>
                <th className={thClass}>Ulog</th>
                <th className={thClass}>Kvota</th>
                <th className={thClass}>Stanje</th>
                <th className={thClass}>Dobitak</th>
              </tr>
            </thead>
            <tbody>
              {[...slips].reverse().map((slip) => (
                <tr key={slip.id}>
                  <td className={`${tdClass} text-white`}>
                    {slip.round} <small className="text-zinc-400">· {shortDate(slip.day)}</small>
                  </td>
                  <td className={`${tdClass} text-zinc-300`}>{slip.number}</td>
                  <td className={`${tdClass} text-zinc-300`}>{slip.players}</td>
                  <td className={`${tdClass} text-zinc-300`}>{km(slip.stake, { whole: true })}</td>
                  <td className={`${tdClass} text-zinc-300`}>{slip.odds.toFixed(2).replace('.', ',')}</td>
                  <td className={tdClass}>
                    <span className={`rounded-full px-2.25 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.14em] ${STATUS[slip.status].tone}`}>
                      {STATUS[slip.status].label}
                    </span>
                  </td>
                  <td className={`${tdClass} ${slip.status === 'won' ? 'font-semibold text-neon' : 'text-zinc-500'}`}>
                    {slip.status === 'won' ? km(slip.value) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-zinc-500">Još nema uplaćenih tiketa. Pojaviće se kad admin upiše kvotu.</p>
      )}
    </section>
  )
}

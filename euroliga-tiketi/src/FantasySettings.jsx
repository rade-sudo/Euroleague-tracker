import { useEffect, useRef, useState } from 'react'
import DateTimePicker from './DateTimePicker.jsx'
import { dayTime, ghostButtonClass, labelClass, points } from './fantasy.js'

const SPLITS = [
  { id: '100', label: 'Sve prvom' },
  { id: '70/30', label: '70 / 30' },
  { id: '60/30/10', label: '60 / 30 / 10' },
]
const SHUFFLE_MS = 90
const SHUFFLE_STEPS = 11

function Seg({ options, value, onChange, disabled }) {
  return (
    <div className="inline-flex flex-wrap rounded-[9px] bg-ink p-0.75 ring-1 ring-line ring-inset">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.id}
          onClick={() => value !== option.id && onChange(option.id)}
          className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-default ${
            value === option.id ? 'bg-surface-hover text-white ring-1 ring-white/16 ring-inset' : 'text-zinc-400 hover:text-white'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Setting({ label, children, note }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.75">
      <span className={labelClass}>{label}</span>
      {children}
      {note && <small className="text-[13px] text-zinc-400">{note}</small>}
    </div>
  )
}

// Podešavanja lige, vidi samo admin. Svaka promjena se odmah čuva.
export default function FantasySettings({ ctx, act, busy }) {
  const { data, short } = ctx
  const { settings, draft, fund } = data
  const [open, setOpen] = useState(draft.status === 'waiting')
  const [fundInput, setFundInput] = useState(String(settings.fundPerRound).replace('.', ','))
  const [shuffled, setShuffled] = useState(null)
  const shuffleRef = useRef(null)
  const started = draft.status !== 'waiting'

  useEffect(() => () => clearInterval(shuffleRef.current), [])

  const save = (body, done) => act('/fantasy/settings', { method: 'PUT', body, done })

  // Bubanj: imena se kratko miješaju, pa staje na redoslijedu sa servera.
  async function drawOrder() {
    let step = 0
    clearInterval(shuffleRef.current)
    shuffleRef.current = setInterval(() => {
      step++
      setShuffled([...draft.order].sort(() => Math.random() - 0.5))
      if (step >= SHUFFLE_STEPS) clearInterval(shuffleRef.current)
    }, SHUFFLE_MS)
    const ok = await act('/fantasy/order/draw')
    setTimeout(() => {
      clearInterval(shuffleRef.current)
      setShuffled(null)
    }, ok ? SHUFFLE_MS * SHUFFLE_STEPS : 0)
  }

  const order = shuffled ?? draft.order
  const startDeadline = settings.startDeadlines?.[settings.startRound]

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group rounded-xl border border-dashed border-white/16"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <h3 className="font-display text-[17px] font-bold uppercase tracking-[0.04em] text-white">Podešavanja lige</h3>
        <span className="rounded px-1.5 py-px text-[11px] font-semibold text-zinc-400 ring-1 ring-white/10 ring-inset">vidiš samo ti</span>
        <span aria-hidden="true" className="ml-auto text-zinc-400 transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-x-7 gap-y-4 px-4 pt-1 pb-4.5">
        <Setting label="Početak lige" note={startDeadline ? `Prvi rok: ${dayTime(startDeadline)}.` : null}>
          <Seg
            options={[6, 7].map((round) => ({ id: round, label: `Kolo ${round}` }))}
            value={settings.startRound}
            disabled={busy}
            onChange={(round) => save({ startRound: round }, `Liga počinje od ${round}. kola.`)}
          />
        </Setting>

        <Setting label="Režim" note="U probnom radu sve se računa normalno, ali se prije starta briše.">
          <Seg
            options={[
              { id: 'trial', label: 'Probni rad' },
              { id: 'live', label: 'Prava liga' },
            ]}
            value={settings.mode}
            disabled={busy}
            onChange={(mode) => save({ mode }, mode === 'live' ? 'Prava liga: bodovi se od sada broje.' : 'Probni rad uključen.')}
          />
        </Setting>

        <Setting label="Draft veče" note="Svi dobiju obavještenje dan ranije i 15 minuta prije.">
          <DateTimePicker
            value={settings.draftAt}
            disabled={busy}
            ariaLabel="Draft veče"
            onSave={(at) => save({ draftAt: at }, at ? 'Termin drafta sačuvan.' : 'Termin drafta uklonjen.')}
          />
        </Setting>

        <Setting label="Vrijeme za jedan izbor" note="Kad istekne, aplikacija bira najboljeg slobodnog igrača pozicije koja fali.">
          <Seg
            options={[
              { id: 60, label: '60 s' },
              { id: 90, label: '90 s' },
              { id: 120, label: '2 min' },
            ]}
            value={settings.pickSeconds}
            disabled={busy || draft.status === 'live'}
            onChange={(seconds) => save({ pickSeconds: seconds })}
          />
        </Setting>

        <Setting label="Redoslijed drafta" note="Zmija: 1. krug 1→6, 2. krug 6→1 i tako 8 krugova.">
          <div className="flex flex-wrap gap-1.5">
            {order.map((friendId, index) => (
              <span
                key={friendId}
                className={`inline-flex items-center gap-1.5 rounded-full bg-ink py-0.75 pr-2.25 pl-1 text-[13px] text-white ring-1 ring-line ring-inset ${
                  shuffled ? 'animate-[shake_0.16s_linear_infinite]' : ''
                }`}
              >
                <i className="grid size-4.75 place-items-center rounded-full bg-accent font-display text-xs font-extrabold not-italic text-ink">
                  {index + 1}
                </i>
                {short(friendId)}
              </span>
            ))}
          </div>
          <button type="button" disabled={busy || started} onClick={drawOrder} className={`${ghostButtonClass} w-fit`}>
            Izvuci bubnjem
          </button>
        </Setting>

        <Setting
          label="Nagradni fond"
          note={`Na kraju sezone (${fund.projectedRounds} kola, ${fund.friends} drugara): ${points(fund.projected)} KM.`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={fundInput}
              onChange={(event) => setFundInput(event.target.value)}
              onBlur={() => {
                const value = Number(fundInput.replace(',', '.'))
                if (Number.isFinite(value) && value !== settings.fundPerRound) save({ fundPerRound: value }, 'Uplata po kolu sačuvana.')
              }}
              inputMode="decimal"
              aria-label="Uplata po kolu u KM"
              className="h-9 w-21 rounded-lg bg-ink px-2.5 text-right text-sm tabular-nums text-white ring-1 ring-white/16 ring-inset focus:outline-none focus:ring-accent"
            />
            <span className="text-sm text-zinc-300">KM po kolu po drugaru</span>
          </div>
          <Seg options={SPLITS} value={settings.split} disabled={busy} onChange={(split) => save({ split })} />
        </Setting>

        <Setting label="Dodatna pravila">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={settings.triple}
              disabled={busy}
              onChange={(event) => save({ triple: event.target.checked })}
              className="mt-0.75 accent-accent"
            />
            Trostruki kapiten, jednom u sezoni
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={settings.trades}
              disabled={busy}
              onChange={(event) => save({ trades: event.target.checked })}
              className="mt-0.75 accent-accent"
            />
            Razmjene između drugara
          </label>
        </Setting>

        <Setting label="Tokom drafta">
          <small className="text-[13px] text-zinc-400">
            Pauza, poništi posljednji izbor i biranje umjesto drugara koji nije tu su na tabli drafta. Pozicije igrača
            (G/F/C) ispravljaš klikom na poziciju u spisku slobodnih igrača.
          </small>
        </Setting>
      </div>
    </details>
  )
}

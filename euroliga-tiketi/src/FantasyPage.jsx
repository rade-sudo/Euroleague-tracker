import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { api } from './api.js'
import AppHeader from './AppHeader.jsx'
import FantasyDraft from './FantasyDraft.jsx'
import FantasyMoves from './FantasyMoves.jsx'
import FantasySettings from './FantasySettings.jsx'
import FantasyTable from './FantasyTable.jsx'
import FantasyTeam from './FantasyTeam.jsx'
import { byId, dayTime, friendShortName, ghostButtonClass, points } from './fantasy.js'
import { useSessionGuard } from './session.js'

const TABS = [
  { id: 'ekipa', label: 'Moja ekipa' },
  { id: 'tabela', label: 'Tabela' },
  { id: 'draft', label: 'Draft' },
  { id: 'izmjene', label: 'Izmjene' },
  { id: 'pravila', label: 'Pravila' },
]
// Dok draft traje svi gledaju istu tablu, pa se osvježava često; inače zbog PIR-a uživo.
const DRAFT_REFRESH_MS = 2500
const REFRESH_MS = 60_000

function tabFromHash() {
  const hash = window.location.hash.slice(1)
  return TABS.some((tab) => tab.id === hash) ? hash : null
}

// Fantasy liga: draft za sezonu, petorka po kolu, PIR, izmjene i razmjene.
export default function FantasyPage() {
  const [user, setUser] = useState(null)
  const [data, setData] = useState(null)
  const [offset, setOffset] = useState(0)
  const [load, setLoad] = useState({ status: 'loading', error: '' })
  const [tab, setTab] = useState(() => tabFromHash() ?? 'ekipa')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  useSessionGuard()

  function apply(next) {
    setData(next)
    // Sat drafta ide po serveru, ne po satu telefona.
    setOffset(next.serverNow - Date.now())
  }

  useEffect(() => {
    let ignore = false
    Promise.all([api('/me'), api('/fantasy')]).then(
      ([me, fantasy]) => {
        if (ignore) return
        setUser(me.user)
        apply(fantasy)
        // Dok draft traje, stranica se otvara na tabli drafta.
        if (!tabFromHash() && ['live', 'paused'].includes(fantasy.draft.status)) setTab('draft')
        setLoad({ status: 'ready', error: '' })
      },
      (loadError) => !ignore && loadError.status !== 401 && setLoad({ status: 'error', error: loadError.message }),
    )
    return () => {
      ignore = true
    }
  }, [])

  const refresh = useEffectEvent(async () => {
    if (document.visibilityState !== 'visible' || busy) return
    try {
      apply(await api('/fantasy'))
    } catch {
      // Sljedeći pokušaj za koju sekundu.
    }
  })

  const draftStatus = data?.draft.status
  useEffect(() => {
    if (!draftStatus) return undefined
    const every = ['live', 'paused'].includes(draftStatus) ? DRAFT_REFRESH_MS : REFRESH_MS
    const timer = setInterval(refresh, every)
    function handleVisible() {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [draftStatus])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), toast.error ? 5000 : 2800)
    return () => clearTimeout(timer)
  }, [toast])

  // Sve izmjene idu kroz ovo: server vraća novo stanje, a greška ide u poruku na dnu.
  async function act(path, { method = 'POST', body = {}, done } = {}) {
    setBusy(true)
    try {
      apply(await api(path, { method, body: JSON.stringify(body) }))
      if (done) setToast({ text: done })
      return true
    } catch (actionError) {
      setToast({ text: actionError.message, error: true })
      return false
    } finally {
      setBusy(false)
    }
  }

  function chooseTab(id) {
    setTab(id)
    window.history.replaceState(null, '', `#${id}`)
  }

  const ctx = useMemo(() => {
    if (!data) return null
    return {
      data,
      players: byId(data.players),
      me: data.meFriendId,
      isAdmin: data.isAdmin,
      short: (id) => friendShortName(data.friends.find((f) => f.id === id), data.friends),
      offset,
    }
  }, [data, offset])

  const myTurn = ctx && data.draft.status === 'live' && data.draft.current?.friendId === ctx.me

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-130 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(255,106,19,0.16),transparent)]"
      />
      <main className="relative mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <AppHeader user={user} active="fantasy" />

        {load.status === 'loading' && <p className="py-16 text-center text-sm text-zinc-500">Učitavanje fantasy lige…</p>}
        {load.status === 'error' && (
          <p role="alert" className="rounded-xl px-5 py-10 text-center text-sm text-rose-400 ring-1 ring-line ring-inset">
            {load.error}
          </p>
        )}

        {load.status === 'ready' && ctx && (
          <>
            <Intro data={data} />

            <div className="flex flex-col gap-4.5 rounded-2xl bg-surface p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-30px_rgba(0,0,0,0.8)] sm:p-5.5">
              {data.settings.mode === 'trial' && <TrialBar isAdmin={ctx.isAdmin} busy={busy} act={act} />}
              {ctx.isAdmin && <FantasySettings ctx={ctx} act={act} busy={busy} />}

              <div role="tablist" className="flex gap-0.5 overflow-x-auto rounded-[11px] bg-ink p-0.75 ring-1 ring-line ring-inset [scrollbar-width:none]">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    onClick={() => chooseTab(item.id)}
                    className={`flex-[1_0_auto] whitespace-nowrap rounded-lg px-3.5 py-2 font-display text-[15px] font-bold uppercase tracking-[0.06em] transition ${
                      tab === item.id ? 'bg-surface-hover text-white ring-1 ring-white/16 ring-inset' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {item.label}
                    {item.id === 'draft' && myTurn && (
                      <span className="ml-1.5 inline-block size-1.75 rounded-full bg-neon align-[2px]" aria-label="ti si na redu" />
                    )}
                  </button>
                ))}
              </div>

              {tab === 'ekipa' && <FantasyTeam ctx={ctx} act={act} busy={busy} goTo={chooseTab} />}
              {tab === 'tabela' && <FantasyTable ctx={ctx} />}
              {tab === 'draft' && <FantasyDraft ctx={ctx} act={act} busy={busy} />}
              {tab === 'izmjene' && <FantasyMoves ctx={ctx} act={act} busy={busy} />}
              {tab === 'pravila' && <Rules settings={data.settings} />}
            </div>
          </>
        )}
      </main>

      {toast && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={`fixed bottom-[calc(18px+env(safe-area-inset-bottom,0px))] left-1/2 z-30 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-[10px] px-4 py-2.5 text-sm font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.5)] ${
            toast.error ? 'bg-rose-500 text-white' : 'bg-zinc-50 text-ink'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

function Intro({ data }) {
  const { settings, next } = data
  const facts = [
    ['8 igrača', 'po ekipi: 3 G, 3 F, 2 C'],
    ['Petorka', '2 G + 2 F + 1 C'],
    ['Kapiten ×2', 'vicekapiten ×1,5'],
    ['1 izmjena', 'po kolu'],
    ['Igrač pripada', 'samo jednom drugaru'],
  ]
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent">
        Liga od {settings.startRound}. kola
        {next ? ` · rok kola ${next.round}: ${dayTime(next.deadline)}` : ''}
      </span>
      <h2 className="font-display text-[clamp(38px,5.5vw,52px)] font-extrabold uppercase leading-[0.95] text-white">
        Fantasy <span className="text-accent">liga</span>
      </h2>
      <p className="max-w-3xl text-zinc-400">
        Draft na početku, ekipa za cijelu sezonu. Svako kolo biraš petorku od svojih osam igrača, sabira se PIR sa
        Euroleague sajta, a ko na kraju sezone ima najviše bodova nosi nagradu. Fantasy nema veze sa tiketima: isti
        igrač može biti na tiketu i u nečijoj ekipi.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {facts.map(([bold, rest]) => (
          <span key={bold} className="rounded-full bg-surface px-2.75 py-1.25 text-[13px] text-zinc-300 ring-1 ring-line ring-inset">
            <b className="font-semibold text-white">{bold}</b> {rest}
          </span>
        ))}
      </div>
    </div>
  )
}

// Probni rad: sve radi normalno, ali se prije starta lige briše (samo admin).
function TrialBar({ isAdmin, busy, act }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[10px] border border-dashed border-accent/38 bg-accent/12 px-3.5 py-2.25 text-sm text-accent">
      <b className="font-display text-sm font-extrabold uppercase tracking-[0.16em]">Probni rad</b>
      <span className="min-w-48 flex-1 text-zinc-300">Draft, ekipe i bodovi su probni i brišu se prije starta lige.</span>
      {isAdmin &&
        (confirm ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-300">Briše draft, ekipe i bodove.</span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await act('/fantasy/wipe', { done: 'Proba je obrisana. Liga čeka draft.' })) setConfirm(false)
              }}
              className="inline-flex h-8 items-center rounded-lg bg-rose-500 px-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              Obriši
            </button>
            <button type="button" onClick={() => setConfirm(false)} className={`${ghostButtonClass} h-8`}>
              Odustani
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-rose-400 ring-1 ring-rose-500/40 ring-inset transition hover:bg-rose-500/10"
          >
            Obriši probu
          </button>
        ))}
    </div>
  )
}

function Rules({ settings }) {
  const split = settings.split === '100' ? 'sve prvom' : settings.split.replaceAll('/', ' / ')
  const rules = [
    ['Ekipa', ['8 igrača: 3 beka (G), 3 krila (F), 2 centra (C).', 'Pozicije su sa Euroleague sajta; admin može ispraviti pogrešnu.', 'Jednog igrača ima samo jedan drugar.', 'Tiketi i fantasy su odvojeni: isti igrač može biti i na tiketu.']],
    ['Draft', ['Jedno veče, svi sa telefona.', 'Redoslijed izvlači bubanj, ide „zmija“: 1→6, pa 6→1.', `8 krugova, ${settings.pickSeconds} sekundi po izboru.`, 'Kad vrijeme istekne ili drugar nije tu, aplikacija bira najboljeg slobodnog igrača pozicije koja mu fali.']],
    ['Postava i rok', ['Svako kolo petorka 2 G + 2 F + 1 C, ostala trojica na klupi.', 'Postava se pamti iz kola u kolo.', 'Rok je 30 minuta prije prve utakmice kola, kao za tikete.', 'Dvostruko kolo: svako kolo ima svoju postavu i svoj rok.']],
    ['Bodovi', ['Bodovi su PIR sa Euroleague sajta, i minus se računa.', 'Kapiten ×2, vicekapiten ×1,5. Ako kapiten ne igra, vice dobija ×2.', 'Ne igra neko iz petorke: ulazi igrač sa klupe iste pozicije, sa ×1.', settings.triple ? 'Trostruki kapiten (×3) jednom u sezoni.' : 'Bez trostrukog kapitena.']],
    ['Izmjene', ['Jedna po kolu: pustiš svog, uzmeš slobodnog iste pozicije.', 'Zahtjevi do 3 sata prije roka, obrada po redu prednosti (posljednji na tabeli prvi).', 'Posle obrade slobodni igrači idu „ko prvi“ do roka.', settings.trades ? 'Razmjene 1 za 1 između drugara ne troše izmjenu.' : 'Bez razmjena između drugara.']],
    ['Tabela i nagrada', ['Pobjednik kola: najviše bodova u kolu.', 'Tabela je zbir svih kola.', `Liga traje do kraja regularnog dijela (kolo ${settings.lastRound}).`, `Uplata ${points(settings.fundPerRound)} KM po kolu po drugaru, podjela ${split}.`]],
  ]
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3">
      {rules.map(([title, items]) => (
        <div key={title} className="flex flex-col gap-1.5 rounded-xl bg-surface-2 px-4 py-3.5 ring-1 ring-line ring-inset">
          <h4 className="font-display text-[17px] font-bold uppercase tracking-[0.04em] text-white">{title}</h4>
          <ul className="flex list-disc flex-col gap-1 pl-4.5 text-sm text-zinc-300 marker:text-accent">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

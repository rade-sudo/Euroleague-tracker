import { useEffect, useState } from 'react'
import { api } from './api.js'
import AppHeader from './AppHeader.jsx'
import { XIcon } from './icons.jsx'
import PlayerInput from './PlayerInput.jsx'
import { buildPlayerIndex } from './players.js'
import { useSessionGuard } from './session.js'

const cardClass = 'rounded-xl border border-line bg-surface shadow-lg shadow-black/30'
const headingClass = 'font-display text-[22px] font-bold uppercase tracking-[0.03em] text-white'
const inputClass =
  'h-10 w-full min-w-0 rounded-[9px] border border-line bg-surface-2 px-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-accent focus:ring-3 focus:ring-accent/12'
const buttonClass =
  'h-10 shrink-0 rounded-[9px] bg-accent px-4 font-display text-sm font-bold uppercase tracking-[0.1em] text-ink transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40'

// "2026-10-06T22:13" -> "6. 10. u 22:13"
function formatTime(value) {
  if (!value) return 'nikad'
  const [date, time] = value.split('T')
  const [, month, day] = date.split('-').map(Number)
  return `${day}. ${month}. u ${time}`
}

const seasonLabel = (code) => {
  const year = Number(code.slice(1))
  return `${year}/${String(year + 1).slice(2)}`
}

export default function PlayersPage() {
  const [user, setUser] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [load, setLoad] = useState({ status: 'loading', error: '' })
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  useSessionGuard()

  useEffect(() => {
    let ignore = false
    Promise.all([api('/me'), api('/players')]).then(
      ([me, data]) => {
        if (ignore) return
        setUser(me.user)
        setCatalog(data)
        setLoad({ status: 'ready', error: '' })
      },
      (loadError) => !ignore && loadError.status !== 401 && setLoad({ status: 'error', error: loadError.message }),
    )
    return () => {
      ignore = true
    }
  }, [])

  async function run(action) {
    setBusy(true)
    setNotice(null)
    try {
      await action()
    } catch (actionError) {
      setNotice({ tone: 'error', text: actionError.message })
    } finally {
      setBusy(false)
    }
  }

  const refresh = () =>
    run(async () => {
      const { result, catalog: next } = await api('/players/refresh', { method: 'POST' })
      setCatalog(next)
      setNotice({
        tone: 'ok',
        text: `Spisak je osvježen: ${result.count} igrača.${result.linked ? ` Povezano upisanih igrača: ${result.linked}.` : ''}`,
      })
    })

  const addAlias = (alias, player) =>
    run(async () => {
      const { linked, catalog: next } = await api('/players/aliases', {
        method: 'POST',
        body: JSON.stringify({ alias, playerId: player.id }),
      })
      setCatalog(next)
      setNotice({
        tone: 'ok',
        text: `„${alias}“ sada vodi na igrača ${player.name}.${linked ? ` Povezano upisanih igrača: ${linked}.` : ''}`,
      })
    })

  const removeAlias = (alias) =>
    run(async () => {
      const { catalog: next } = await api(`/players/aliases/${alias.id}`, { method: 'DELETE' })
      setCatalog(next)
    })

  const isAdmin = user?.role === 'admin'
  const index = catalog ? buildPlayerIndex(catalog) : null
  const activeCount = catalog ? catalog.players.filter((p) => p.active).length : 0
  const byId = new Map((catalog?.players ?? []).map((p) => [p.id, p]))

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-130 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(255,106,19,0.16),transparent)]"
      />
      <main className="relative mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <AppHeader user={user} active="igraci" />

        {load.status === 'loading' && <p className="py-16 text-center text-sm text-zinc-500">Učitavanje spiska…</p>}
        {load.status === 'error' && (
          <p role="alert" className="rounded-xl px-5 py-10 text-center text-sm text-rose-400 ring-1 ring-line ring-inset">
            {load.error}
          </p>
        )}
        {load.status === 'ready' && !isAdmin && (
          <p className={`${cardClass} px-5 py-12 text-center text-sm text-zinc-400`}>Ovu stranicu koristi samo admin.</p>
        )}

        {load.status === 'ready' && isAdmin && (
          <>
            <section className={`${cardClass} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between`}>
              <div className="flex flex-col gap-1">
                <span className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent">
                  Euroliga {seasonLabel(catalog.season)}
                </span>
                <h2 className={headingClass}>Spisak igrača</h2>
                <p className="text-sm text-zinc-400">
                  {activeCount} igrača u sezoni · osvježeno {formatTime(catalog.updatedAt)}. Osvježi na početku sezone i
                  kad neko pređe u drugi klub.
                </p>
              </div>
              <button type="button" onClick={refresh} disabled={busy} className={buttonClass}>
                {busy ? 'Osvježavam…' : 'Osvježi sa Euroleague sajta'}
              </button>
            </section>

            {notice && (
              <p
                role={notice.tone === 'error' ? 'alert' : 'status'}
                className={`rounded-[10px] px-4 py-3 text-sm ring-1 ring-inset ${
                  notice.tone === 'error' ? 'bg-rose-500/10 text-rose-300 ring-rose-500/35' : 'bg-neon/10 text-zinc-200 ring-neon/35'
                }`}
              >
                {notice.text}
              </p>
            )}

            <div className="grid grid-cols-1 gap-6 min-[880px]:grid-cols-2">
              <section className={`${cardClass} flex min-w-0 flex-col`}>
                <div className="border-b border-line px-5 py-4">
                  <h2 className={headingClass}>Nepovezana imena</h2>
                  <p className="text-sm text-zinc-400">
                    Upisani igrači koje aplikacija nije prepoznala. Izaberi pravog igrača i ime se pamti kao skraćenica.
                  </p>
                </div>
                {catalog.unlinked.length ? (
                  catalog.unlinked.map((group) => (
                    <LinkRow key={group.text} group={group} index={index} busy={busy} onLink={addAlias} />
                  ))
                ) : (
                  <p className="px-5 py-6 text-sm text-zinc-500">Svi upisani igrači su povezani sa spiskom.</p>
                )}
              </section>

              <section className={`${cardClass} flex min-w-0 flex-col`}>
                <div className="border-b border-line px-5 py-4">
                  <h2 className={headingClass}>Skraćenice</h2>
                  <p className="text-sm text-zinc-400">
                    Kako neko od vas piše igrača. Kvačice i velika slova se ne gledaju, pa „Šengelija“ važi i za „sengelija“.
                  </p>
                </div>
                <AddAliasForm index={index} busy={busy} onAdd={addAlias} />
                {catalog.aliases.length ? (
                  catalog.aliases.map((alias) => {
                    const player = byId.get(alias.playerId)
                    return (
                      <div key={alias.id} className="flex items-center gap-3 border-t border-line px-5 py-2.75">
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="font-semibold text-white">{alias.alias}</span>
                          <span className="text-zinc-500"> → </span>
                          <span className="text-zinc-300">{player?.name ?? 'nepoznat igrač'}</span>
                          {player?.club && <span className="text-zinc-500"> · {player.club}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAlias(alias)}
                          disabled={busy}
                          aria-label={`Obriši skraćenicu ${alias.alias}`}
                          className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-600 transition hover:bg-rose-500/10 hover:text-rose-400"
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      </div>
                    )
                  })
                ) : (
                  <p className="border-t border-line px-5 py-6 text-sm text-zinc-500">Još nema skraćenica.</p>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function LinkRow({ group, index, busy, onLink }) {
  const [text, setText] = useState('')
  const [player, setPlayer] = useState(null)
  return (
    <div className="flex flex-col gap-2.5 border-b border-line px-5 py-3.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-white">„{group.text}“</span>
        <span className="text-xs text-zinc-500">upisano {group.count}×</span>
      </div>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <PlayerInput
            index={index}
            value={text}
            selected={player}
            onChange={setText}
            onSelect={setPlayer}
            placeholder="Koji je to igrač?"
            ariaLabel={`Igrač za „${group.text}“`}
            className={inputClass}
          />
        </div>
        <button type="button" disabled={busy || !player} onClick={() => onLink(group.text, player)} className={buttonClass}>
          Poveži
        </button>
      </div>
    </div>
  )
}

function AddAliasForm({ index, busy, onAdd }) {
  const [alias, setAlias] = useState('')
  const [text, setText] = useState('')
  const [player, setPlayer] = useState(null)

  function submit(event) {
    event.preventDefault()
    if (!alias.trim() || !player) return
    onAdd(alias.trim(), player)
    setAlias('')
    setText('')
    setPlayer(null)
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 px-5 py-4 min-[560px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
      <input
        value={alias}
        onChange={(event) => setAlias(event.target.value)}
        maxLength={60}
        placeholder="Skraćenica, npr. Šengelija"
        aria-label="Skraćenica"
        autoComplete="off"
        className={inputClass}
      />
      <PlayerInput
        index={index}
        value={text}
        selected={player}
        onChange={setText}
        onSelect={setPlayer}
        placeholder="Igrač sa spiska"
        ariaLabel="Igrač sa spiska"
        className={inputClass}
      />
      <button type="submit" disabled={busy || !alias.trim() || !player} className={buttonClass}>
        Dodaj
      </button>
    </form>
  )
}

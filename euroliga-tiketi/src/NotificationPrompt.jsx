import { useEffect, useState } from 'react'
import { api } from './api.js'
import { BellIcon } from './icons.jsx'
import { enablePush, isIos, isStandalone, pushSupported, readStored, refreshPushSubscription, writeStored } from './pwa.js'

const STORAGE_KEY = 'tiketi:obavjestenja-pitano'

// Pita jednom; poslije se obavještenja uključuju na stranici Moj nalog.
// Na iPhone-u obavještenja rade samo kad su Tiketi dodati na početni ekran.
function shouldAsk() {
  return (
    pushSupported() &&
    Notification.permission === 'default' &&
    !readStored(STORAGE_KEY) &&
    (!isIos() || isStandalone())
  )
}

export default function NotificationPrompt() {
  const [visible, setVisible] = useState(shouldAsk)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Uređaj koji već prima obavještenja ostaje vezan za nalog koji je sada prijavljen.
  useEffect(() => {
    refreshPushSubscription().catch(() => {})
  }, [])

  if (!visible) return null

  function later() {
    writeStored(STORAGE_KEY, '1')
    setVisible(false)
  }

  async function enable() {
    setBusy(true)
    setError('')
    try {
      const { publicKey } = await api('/notifications')
      await enablePush(publicKey)
      writeStored(STORAGE_KEY, '1')
      setVisible(false)
    } catch (enableError) {
      setError(enableError.message)
      if (Notification.permission === 'denied') writeStored(STORAGE_KEY, '1')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Obavještenja"
      className="flex flex-wrap items-center gap-x-4.5 gap-y-3 rounded-xl bg-accent/12 px-4 py-3.5 ring-1 ring-accent/35 ring-inset"
    >
      <span className="grid size-9.5 shrink-0 place-items-center rounded-[10px] bg-accent text-ink">
        <BellIcon className="size-5" />
      </span>
      <div className="min-w-55 flex-1">
        <p className="font-display text-base font-bold uppercase tracking-[0.06em] text-accent">Uključi obavještenja</p>
        <p className="text-sm text-zinc-300">
          Javiće ti kad se otvori kolo, sat prije roka i kad tvoj igrač dobije ocjenu. Šta primaš biraš na stranici Moj nalog.
        </p>
        {error && (
          <p role="alert" className="mt-1 text-[13px] text-rose-400">
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={later}
          className="h-9.5 rounded-[9px] px-3 text-[13px] text-zinc-400 transition hover:bg-white/5 hover:text-white"
        >
          Kasnije
        </button>
        <button
          type="button"
          onClick={enable}
          disabled={busy}
          className="inline-flex h-9.5 items-center rounded-[10px] bg-accent px-3.5 font-display text-sm font-bold uppercase tracking-[0.1em] text-ink shadow-[0_12px_30px_-12px_rgba(255,106,19,0.7)] transition hover:brightness-110 disabled:opacity-50"
        >
          Uključi
        </button>
      </div>
    </section>
  )
}

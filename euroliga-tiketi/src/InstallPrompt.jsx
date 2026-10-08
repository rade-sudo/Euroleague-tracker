import { useEffect, useState } from 'react'
import { ShareIcon, XIcon } from './icons.jsx'
import {
  canPromptInstall,
  isIos,
  isMobile,
  isStandalone,
  onInstallChange,
  promptInstall,
  readStored,
  writeStored,
} from './pwa.js'

const STORAGE_KEY = 'tiketi:instalacija-zatvoreno'
// Zatvorena kartica se ne pojavljuje ponovo dvije sedmice.
const HIDE_MS = 14 * 24 * 60 * 60 * 1000

function recentlyDismissed() {
  const at = Number(readStored(STORAGE_KEY))
  return Number.isFinite(at) && Date.now() - at < HIDE_MS
}

// Poziv da se Tiketi dodaju na početni ekran: samo na telefonu i samo dok nisu instalirani.
export default function InstallPrompt() {
  const [hidden, setHidden] = useState(() => !isMobile() || isStandalone() || recentlyDismissed())
  const [canInstall, setCanInstall] = useState(canPromptInstall)

  useEffect(() => onInstallChange(() => setCanInstall(canPromptInstall())), [])

  if (hidden) return null

  function dismiss() {
    writeStored(STORAGE_KEY, String(Date.now()))
    setHidden(true)
  }

  async function install() {
    if (await promptInstall()) setHidden(true)
  }

  return (
    <aside
      aria-label="Dodaj Tikete na telefon"
      className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom,0px))] z-40 mx-auto flex max-w-md flex-col gap-2.5 rounded-xl bg-surface-2 p-3.5 shadow-[inset_0_0_0_1px_rgba(255,106,19,0.35),0_16px_30px_-10px_rgba(0,0,0,0.8)]"
    >
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" className="size-10 shrink-0 rounded-[22.5%]" />
        <div className="min-w-0 flex-1">
          <b className="block font-display text-lg font-bold uppercase leading-tight text-white">Dodaj Tikete na telefon</b>
          <small className="text-[13px] text-zinc-400">Otvara se kao prava aplikacija</small>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Zatvori"
          className="grid size-8 shrink-0 place-items-center self-start rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-white"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      {isIos() ? (
        <p className="text-sm text-zinc-300">
          U Safariju dodirni <ShareIcon className="inline size-4 -translate-y-px text-[#4b8dff]" />{' '}
          <b className="font-semibold text-white">Podijeli</b>, pa <b className="font-semibold text-white">Dodaj na početni ekran</b>.
        </p>
      ) : canInstall ? (
        <button
          type="button"
          onClick={install}
          className="h-10 rounded-[9px] bg-accent font-display text-[15px] font-bold uppercase tracking-[0.1em] text-ink shadow-[0_12px_30px_-12px_rgba(255,106,19,0.7)] transition hover:brightness-110"
        >
          Instaliraj
        </button>
      ) : (
        <p className="text-sm text-zinc-300">
          Otvori meni pregledača <b className="font-semibold text-white">⋮</b>, pa{' '}
          <b className="font-semibold text-white">Instaliraj aplikaciju</b> ili{' '}
          <b className="font-semibold text-white">Dodaj na početni ekran</b>.
        </p>
      )}
    </aside>
  )
}

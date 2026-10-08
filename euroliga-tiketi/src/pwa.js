// Aplikacija na telefonu: service worker, instalacija i obavještenja (Web Push).
import { api } from './api.js'

let installEvent = null
const installListeners = new Set()

function notifyInstallListeners() {
  installListeners.forEach((listener) => listener())
}

export function setupPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
  // Android/Chrome: sistemski prozor za instalaciju čuvamo za dugme „Instaliraj“.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installEvent = event
    notifyInstallListeners()
  })
  window.addEventListener('appinstalled', () => {
    installEvent = null
    notifyInstallListeners()
  })
}

export function onInstallChange(listener) {
  installListeners.add(listener)
  return () => installListeners.delete(listener)
}

export const canPromptInstall = () => installEvent !== null

export async function promptInstall() {
  const event = installEvent
  if (!event) return false
  installEvent = null
  notifyInstallListeners()
  await event.prompt()
  return (await event.userChoice).outcome === 'accepted'
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

// iPad se predstavlja kao Mac, pa ga prepoznajemo po ekranu na dodir.
export const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

export const isMobile = () => isIos() || /Android/i.test(navigator.userAgent)

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export function readStored(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Bez localStorage-a poruka se opet pojavi pri sljedećem otvaranju.
  }
}

function keyBytes(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

function sameKey(subscription, publicKey) {
  const current = subscription.options?.applicationServerKey
  if (!current) return true
  const a = new Uint8Array(current)
  const b = keyBytes(publicKey)
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

// serviceWorker.ready čeka zauvijek ako registracija nije uspjela, pa ne čekamo duže od par sekundi.
function serviceWorkerReady() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker nije spreman. Osvježi stranicu.')), 4000)),
  ])
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const registration = await serviceWorkerReady()
  return registration.pushManager.getSubscription()
}

// Traži dozvolu i prijavljuje ovaj uređaj na server. Poziva se samo iz dodira ili klika.
export async function enablePush(publicKey) {
  const permission = await Notification.requestPermission()
  if (permission === 'denied') {
    throw new Error('Obavještenja su blokirana. Uključi ih za Tikete u podešavanjima telefona ili pregledača.')
  }
  if (permission !== 'granted') throw new Error('Obavještenja nisu dozvoljena.')
  const registration = await serviceWorkerReady()
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameKey(subscription, publicKey)) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  })
  return api('/push/subscribe', { method: 'POST', body: JSON.stringify(subscription.toJSON()) })
}

export async function disablePush() {
  const subscription = await currentSubscription()
  if (!subscription) return null
  const settings = await api('/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  })
  await subscription.unsubscribe()
  return settings
}

// Kad je dozvola već data, server se podsjeti na ovaj uređaj (npr. posle prijave na drugi nalog).
export async function refreshPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const subscription = await currentSubscription()
  if (subscription) await api('/push/subscribe', { method: 'POST', body: JSON.stringify(subscription.toJSON()) })
}

// Pri odjavi: server zaboravi uređaj, a dozvola na telefonu ostaje.
export async function forgetPushDevice() {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const subscription = await currentSubscription()
  if (subscription) {
    await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) })
  }
}

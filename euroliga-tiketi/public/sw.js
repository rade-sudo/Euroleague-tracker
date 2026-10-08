// Service worker za Tikete: stranica „Nema interneta“ i obavještenja.
// Aplikacija se ne kešira: svako otvaranje uzima najnoviju verziju sa servera.
const CACHE = 'tiketi-offline-v1'
const OFFLINE_URL = '/offline.html'
const OFFLINE_FILES = [OFFLINE_URL, '/icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_FILES)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// Samo otvaranje stranica: ako server nije dostupan, pokaže se „Nema interneta“.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)))
})

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    message = { body: event.data?.text() ?? '' }
  }
  event.waitUntil(
    self.registration.showNotification(message.title ?? 'Tiketi', {
      body: message.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: message.tag,
      data: { url: message.url ?? '/' },
    }),
  )
})

// Dodir na obavještenje otvara aplikaciju (ili je vrati u prvi plan).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin))
      if (open) return open.navigate(url).then((client) => (client ?? open).focus())
      return self.clients.openWindow(url)
    }),
  )
})

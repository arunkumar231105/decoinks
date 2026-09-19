/* Printshop service worker — makes the app installable and quick to open.
 *
 * Deliberately small, because Printshop is live data:
 *   - /api/*, /storage/* and other hosts are never touched: always the network.
 *   - Built files under /assets/ have content hashes in their names, so a copy
 *     kept here can never be stale: served from the cache, fetched once.
 *   - Pages (navigations) always go to the network, so a deploy shows at once;
 *     only when there is no network at all is the last app shell shown, with an
 *     offline note from the app itself.
 * It also shows Printshop's notifications on the phone (Web Push, migration
 * 154) and opens the right screen when one is tapped.
 * Bump VERSION to drop everything kept by an older worker.
 */
const VERSION = 'printshop-v2'
const SHELL = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.add(new Request(SHELL, { cache: 'reload', credentials: 'include' }))).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/storage/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        // Keep the newest shell for offline use — only a real page, never a
        // sign-in redirect.
        if (res.ok && res.type === 'basic' && (res.headers.get('content-type') || '').includes('text/html')) {
          const copy = res.clone()
          caches.open(VERSION).then((cache) => cache.put(SHELL, copy)).catch(() => {})
        }
        return res
      }).catch(() => caches.match(SHELL).then((hit) => hit || Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {}) }
        return res
      })),
    )
  }
})

// ── Notifications ────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  const title = data.title || 'Printshop'
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/pwa/icon-192.png',
      badge: '/pwa/badge-96.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/dashboard' },
      vibrate: [120, 60, 120],
    })
    // An open Printshop refreshes its bell and plays its sound.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    open.forEach((c) => c.postMessage({ type: 'printshop:notification', payload: data }))
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/dashboard', self.location.origin).href
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of open) {
      if (new URL(c.url).origin !== self.location.origin) continue
      await c.focus()
      if ('navigate' in c) { try { await c.navigate(url) } catch { /* same page */ } }
      return
    }
    await self.clients.openWindow(url)
  })())
})

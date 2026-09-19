/* Printshop service worker — makes the app installable and quick to open.
 *
 * Deliberately small, because Printshop is live data:
 *   - /api/*, /storage/* and other hosts are never touched: always the network.
 *   - Built files under /assets/ have content hashes in their names, so a copy
 *     kept here can never be stale: served from the cache, fetched once.
 *   - Pages (navigations) always go to the network, so a deploy shows at once;
 *     only when there is no network at all is the last app shell shown, with an
 *     offline note from the app itself.
 * Bump VERSION to drop everything kept by an older worker.
 */
const VERSION = 'printshop-v1'
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

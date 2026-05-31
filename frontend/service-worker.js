// Amodei PWA — service worker.
//
// Strategy:
//   - App shell (HTML/CSS/JS/icons): cache-first, fall back to network. Pre-cached at install.
//   - Cross-origin (API calls to Railway): network-first, no cache fallback (data must be fresh).
//     If the network fails, the client-side fetch sees a failure and renders its own offline UI.
//   - Cache versioning: bump CACHE_VERSION on every deploy so old assets are evicted.
//   - skipWaiting() + clients.claim() are NOT auto-fired anymore: a new worker waits to be
//     activated explicitly by the page (postMessage SKIP_WAITING). The page shows a toast
//     "nuova versione, aggiorna" → user clicks → worker activates and the page reloads.

const CACHE_VERSION = 'amodei-v0.6.6';
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/public/icons/icon-72.png',
  '/public/icons/icon-96.png',
  '/public/icons/icon-128.png',
  '/public/icons/icon-144.png',
  '/public/icons/icon-152.png',
  '/public/icons/icon-192.png',
  '/public/icons/icon-384.png',
  '/public/icons/icon-512.png',
  '/public/icons/icon-512-maskable.png',
  '/src/css/tokens.css',
  '/src/css/base.css',
  '/src/css/layout.css',
  '/src/css/components.css',
  '/src/js/api.js',
  '/src/js/app.js',
  '/src/js/components.js',
  '/src/js/icons.js',
  '/src/js/router.js',
];

self.addEventListener('install', (event) => {
  // Pre-cache l'app shell, poi attiva subito senza aspettare che la pagina
  // mandi SKIP_WAITING. Storicamente aspettavamo l'azione utente (toast
  // "nuova versione disponibile") ma su iOS PWA spesso il toast viene
  // mancato → l'utente resta con SW vecchio + JS cached → bug subdoli
  // (es. fetch senza cache:'no-store' che ritorna risposte stale dopo
  // PATCH). Adesso il SW si auto-promuove; il controllerchange listener
  // in src/js/app.js fa reload della pagina così l'app prende il nuovo
  // shell immediatamente.
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch((err) => console.warn('SW precache miss', url, err))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Evict caches from previous versions, then take control of all clients
  // (so freshly-loaded pages start hitting the new SW immediately).
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  // The page sends {type: 'SKIP_WAITING'} when the user accepts the
  // "nuova versione disponibile" prompt.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- Web Push -----------------------------------------------------------
//
// Il backend invia un JSON {title, body, url, tag}. Su iOS PWA installata
// (iOS 16.4+) la notifica viene mostrata anche con app chiusa.

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* keep empty */ }
  const title = data.title || 'Amodei';
  const options = {
    body: data.body || '',
    icon: '/public/icons/icon-192.png',
    badge: '/public/icons/icon-96.png',
    tag: data.tag || 'amodei-default',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Se c'è già una finestra dell'app aperta, fa focus + navigate
    for (const client of all) {
      if ('focus' in client && new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) {
          try { await client.navigate(targetUrl); } catch { /* ignore */ }
        }
        return;
      }
    }
    // Altrimenti apre una nuova finestra
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Cross-origin (API on Railway, fonts, etc.): always network. Let the
  // app-level fetch in api.js handle the offline error UI on failure.
  if (url.origin !== self.location.origin) return;

  // Same-origin GET: cache-first for the app shell. We additionally refresh
  // the cache in the background so the next load gets the latest version.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchAndCache = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);   // offline: fall back to whatever is cached
      return cached || fetchAndCache;
    })
  );
});

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

const CACHE_VERSION = 'amodei-v0.4.0';
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
  // Pre-cache the app shell. We do NOT call skipWaiting() here: a fresh worker
  // sits in "waiting" until the page explicitly tells it to activate.
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

// Amodei PWA — service worker.
// Strategy:
//   - Pre-cache the app shell at install
//   - Cache-first for same-origin GETs (avoids hitting the network on every navigation)
//   - Bypass cache entirely for cross-origin requests (API calls to Railway)

const CACHE_VERSION = 'amodei-v0.2.0';
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
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
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        // Use individual adds so one missing asset doesn't fail the whole install.
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
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Bypass cache for cross-origin (i.e. Railway backend) — always go to network.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

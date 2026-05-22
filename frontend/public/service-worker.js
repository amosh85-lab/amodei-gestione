// Amodei PWA — service worker.
// Strategy:
//   - Pre-cache the app shell on install (cache-first afterwards).
//   - Never cache API responses; always go to the network.

const CACHE_VERSION = 'amodei-v0.1.0';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/tokens.css',
  './css/base.css',
  './js/app.js',
  './js/api.js',
  './js/router.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
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

  // Bypass cache for backend calls — identified by absolute URL pointing at
  // a different origin than the SW scope.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

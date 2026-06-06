const CACHE_NAME = 'fifto-v1';
const ASSETS = [
  '/',
  '/css/style.css',
  '/js/notify.js',
  '/images/fifto-logo-192.png',
  '/images/fifto-logo-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});

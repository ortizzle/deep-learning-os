// sw.js — cache-first shell for offline PWA use. Bump CACHE on shell changes.
// Never caches api.anthropic.com or api.github.com (always network).

const CACHE = 'dlos-shell-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './modules/store.js',
  './modules/ai.js',
  './modules/lessons.js',
  './modules/quiz.js',
  './modules/coach.js',
  './modules/dashboard.js',
  './modules/gamification.js',
  './modules/suggestedTopics.js',
  './modules/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept API traffic.
  if (url.hostname.endsWith('anthropic.com') || url.hostname.endsWith('github.com') || url.hostname.endsWith('githubusercontent.com')) {
    return;
  }
  if (e.request.method !== 'GET') return;

  // Cache-first for shell assets, falling back to network + runtime cache.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});

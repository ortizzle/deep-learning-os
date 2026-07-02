// sw.js — network-first shell with cache fallback. Online loads always get
// current code (prevents stale-code-vs-upgraded-DB crashes); offline still
// works from the last cached shell. Never touches api.* traffic.

const CACHE = 'dlos-shell-v15';
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
  './modules/saved.js',
  './modules/suggestedTopics.js',
  './modules/today.js',
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

  // Network-first: fresh code whenever online, cached shell when offline.
  // cache:'no-cache' forces ETag revalidation past GitHub Pages' max-age=600,
  // so updates land immediately instead of up to 10 minutes late.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

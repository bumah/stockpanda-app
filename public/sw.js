// StockPanda service worker
// Bump VERSION on each deploy to invalidate old caches.
const VERSION = '2026-04-26-i';
const SHELL_CACHE = `sp-shell-${VERSION}`;
const DATA_CACHE  = `sp-data-${VERSION}`;
const IMG_CACHE   = `sp-img-${VERSION}`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/finder.html',
  '/quiz.html',
  '/stocks.html',
  '/stock.html',
  '/watchlist.html',
  '/summary.html',
  '/handbook.html',
  '/manifesto.html',
  '/etfs.html',
  '/etf.html',
  '/about.html',
  '/assets/css/styles.css',
  '/assets/js/mood.js',
  '/assets/js/finder-engine.js',
  '/manifest.webmanifest',
  '/assets/img/panda-calm.png',
  '/assets/img/panda-vcalm.png',
  '/assets/img/panda-unsettled.png',
  '/assets/img/panda-stressed.png',
  '/assets/img/panda-danger.png',
  '/assets/img/icon-192.png',
  '/assets/img/icon-512.png',
];

// ── Install: pre-cache the app shell ───────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS).catch(err => {
      console.warn('[sw] shell pre-cache partial failure', err);
    })).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => ![SHELL_CACHE, DATA_CACHE, IMG_CACHE].includes(k)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ── Fetch strategies ───────────────────────────────────────
function isHTMLRequest(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last-ditch: fall back to the home page shell
    const home = await cache.match('/index.html');
    if (home) return home;
    throw e;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip cross-origin requests — let them go straight to network
  if (url.origin !== self.location.origin) return;

  // Never cache the service worker itself
  if (url.pathname === '/sw.js') return;

  // /data/*.json → stale-while-revalidate (fast render, refresh in bg)
  if (url.pathname.startsWith('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(req, DATA_CACHE));
    return;
  }

  // Images → cache-first
  if (/\.(png|jpg|jpeg|svg|webp|gif|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }

  // HTML pages → network-first (always try fresh first, fall back offline)
  if (isHTMLRequest(req)) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // CSS / JS / manifest → cache-first (shell)
  if (/\.(css|js|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
});

// ── Allow pages to request an update ───────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

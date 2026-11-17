// Service worker: offline app shell + notification click handling.
// VERSION and ASSETS are rewritten by tools/build.mjs for the production build.
const VERSION = 'dev-1';
const ASSETS = ['./', 'index.html', 'manifest.webmanifest', 'src/app.css', 'src/app.js', 'src/prayer.js', 'src/i18n.js',
  'src/cities.js', 'src/store.js', 'src/scheduler.js', 'src/sound.js', 'src/author.js', 'src/config.js', 'src/push.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png', 'icons/apple-touch-icon.png'];
const CACHE = 'mawaqit-' + VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mawaqit-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (VERSION.startsWith('dev')) { // development: network first so edits show immediately
      try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
      catch { return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && cache.match('index.html')) || new Response('', { status: 504 }); }
    }
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});

// Alerts sent by the push relay — shown even when the app is closed.
self.addEventListener('push', e => {
  let d;
  try { d = e.data.json(); } catch { d = { title: 'مواقيت', body: e.data ? e.data.text() : '' }; }
  const rtl = /[؀-ۿ]/.test(d.title || '');
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'مواقيت', {
      body: d.body || '', tag: d.tag || undefined, timestamp: d.at || Date.now(), silent: !!d.silent,
      dir: rtl ? 'rtl' : 'ltr', lang: rtl ? 'ar' : 'en',
      icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './' },
    });
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'mq-push', title: d.title, tag: d.tag });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  })());
});

'use strict';

const CACHE = 'trainu-shell-v3';
const PRECACHE = [
  '/css/base.css',
  '/css/app.css',
  '/css/pair.css',
  '/js/app.js',
  '/js/player.js',
  '/js/pair.js',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/icon-180.png',
  '/vendor/qrcode.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch {
        // The app still works if an optional asset is missing.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trainu is offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#000;color:#fff;font-family:"Helvetica Neue",Roboto,Arial,sans-serif;text-align:center}
div{max-width:34ch}h1{font-size:1.5rem;font-weight:800;letter-spacing:-.03em;margin:0 0 10px}p{color:#b3b3b3;line-height:1.5;margin:0}</style></head>
<body><div><h1>Can't reach the laptop</h1><p>Reconnect the USB cable or Wi-Fi, make sure Trainu is running on the laptop, then reload this page.</p></div></body></html>`;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // Cache only the library shell. Pairing and the laptop panel must never
        // become the offline "/" page.
        if (response.ok && !response.redirected && url.pathname === '/') {
          const cache = await caches.open(CACHE);
          await cache.put('/', response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match('/');
        if (cached) return cached;
        return new Response(OFFLINE_HTML, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/pair') || url.pathname.startsWith('/desktop')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

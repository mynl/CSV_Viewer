/* csv-viewer service worker: precache the app shell (incl. CDN assets) and
 * serve it cache-first so the installed PWA works offline. Data requests —
 * notably ?src= CSV fetches — always pass straight through to the network. */

'use strict';

const CACHE = 'csv-viewer-v3.7.0';   // bump with VERSION to invalidate

const SHELL = [
    './',
    'index.html',
    'src/grid/core.js',
    'src/grid/util.js',
    'src/grid/grid.js',
    'src/grid/worker.js',
    'src/grid/grid.css',
    'src/app/app.js',
    'src/app/app.css',
    'favicon.svg',
    'manifest.webmanifest',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim()));
});

/* Cache-first for the shell and CDN assets (incl. the icon fonts the CDN
 * css pulls in); network for everything else. */
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    const isShell = url.origin === location.origin
        ? /\/(index\.html|favicon\.svg|manifest\.webmanifest)$|\/src\/[\w.\/-]+\.(?:js|css)$|\/$/.test(url.pathname)
        : url.hostname === 'cdn.jsdelivr.net';
    if (!isShell) return;
    e.respondWith(
        caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
            if (resp.ok) {
                const copy = resp.clone();
                caches.open(CACHE).then(c => c.put(e.request, copy));
            }
            return resp;
        })));
});

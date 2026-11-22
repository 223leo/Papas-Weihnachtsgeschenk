// Offline-Unterstützung: App-Dateien werden zwischengespeichert, damit du auch ohne Netz üben kannst.
const CACHE = 'lernpfad-v1';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/store.js',
  'js/srs.js',
  'js/gamification.js',
  'js/extract.js',
  'js/ai.js',
  'js/demo.js',
  'manifest.webmanifest',
  'icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.anthropic.com') return; // KI-Anfragen nie cachen
  // Erst Netz (damit Updates ankommen), bei Offline aus dem Cache
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (url.origin === location.origin || /cdnjs|jsdelivr|fonts\.(googleapis|gstatic)/.test(url.hostname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined))),
  );
});

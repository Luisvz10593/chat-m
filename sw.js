// Service worker: permite instalar la app y abrirla aunque falle la red.
// Usa "red primero" para que siempre cargue la versión más reciente.
const CACHE = 'chatm-v28';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'nav.js', 'stream.js', 'tools.js', 'emotes.js', 'moderation.js', 'dashboard.js', 'chatplus.js', 'content.js', 'settings.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // "no-cache" pregunta siempre al servidor si hay versión nueva (GitHub Pages
    // pide guardar los archivos 10 min y si no las actualizaciones tardan en llegar)
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

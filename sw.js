// Service worker de Fulbito: solo cachea el "shell" estático (HTML/CSS/manifest/ícono).
// A propósito NO cachea las llamadas a /api/* del backend, porque esos datos
// (partidos, stats, tabla de posiciones) cambian todo el tiempo y mostrar una
// version vieja en cache seria peor que no tener nada.

const CACHE_NAME = 'fulbito-shell-v2';
const ARCHIVOS_SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './app-model.js',
  './app-ui.js',
  './app-ui-menu.js',
  './menu-toggle.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ARCHIVOS_SHELL))
      .catch(() => {/* Si algún archivo falla, instalamos igual */})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(
        claves
          .filter((clave) => clave !== CACHE_NAME)
          .map((clave) => caches.delete(clave))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Nunca interceptar llamadas a la API del backend: siempre ir a la red.
  if (url.pathname.startsWith('/api/') || url.hostname.includes('onrender.com')) {
    return;
  }

  // Estrategia "stale-while-revalidate" para el shell:
  // devolvemos caché instantáneamente y actualizamos en segundo plano.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const respuestaCache = await cache.match(event.request);
      const promesaRed = fetch(event.request).then((respuestaRed) => {
        if (respuestaRed && respuestaRed.ok) {
          cache.put(event.request, respuestaRed.clone());
        }
        return respuestaRed;
      }).catch(() => respuestaCache);
      return respuestaCache || promesaRed;
    })
  );
});
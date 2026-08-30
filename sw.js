// Service worker de Fulbito: solo cachea el "shell" estático (HTML/CSS/manifest/ícono).
// A propósito NO cachea las llamadas a /api/* del backend, porque esos datos
// (partidos, stats, tabla de posiciones) cambian todo el tiempo y mostrar una
// version vieja en cache seria peor que no tener nada.

const CACHE_NAME = 'fulbito-shell-v1';
const ARCHIVOS_SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_SHELL))
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
  const url = new URL(event.request.url);

  // Nunca interceptar llamadas a la API del backend: siempre ir a la red.
  if (url.pathname.startsWith('/api/') || url.hostname.includes('onrender.com')) {
    return;
  }

  // Para el shell estático: cache primero, con fallback a la red.
  event.respondWith(
    caches.match(event.request).then((respuestaCache) => {
      return respuestaCache || fetch(event.request);
    })
  );
});
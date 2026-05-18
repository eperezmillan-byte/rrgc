// service-worker.js
// PWA shell mínimo. Cachea los assets estáticos y deja pasar las llamadas a /api/*
// para que siempre traigan datos frescos. Si no hay conexión, intenta servir
// la última versión cacheada.

const VERSION = 'gaceta-rrg-v1';
const SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/data.js',
  '/js/rrg.js',
  '/js/projection.js',
  '/js/analysis.js',
  '/js/chart.js',
  '/js/app.js',
  '/js/install.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      cache.addAll(SHELL).catch(() => {
        // Si alguno falla (asset opcional) no rompemos la instalación
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Sólo manejamos GET del propio origen
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API: siempre red primero, sin cache (datos vivos)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
    return; // dejar pasar
  }

  // Assets: cache first, con fallback a red
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          // Cachear oportunísticamente
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html')); // último recurso offline
    })
  );
});

const CACHE_NAME = "episode-roulette-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/tmdb.js",
  "./js/catalog.js",
  "./js/storage.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // don't cache TMDB API calls
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

const CACHE_NAME = "episode-roulette-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
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

// Network-first: always serve the latest app/data when online, fall back to
// cache only when offline. Avoids stale-version confusion after updates.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    // cache: "no-cache" forces revalidation with the server so the browser's
    // heuristic HTTP cache can't serve stale app files.
    fetch(event.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

const CACHE_NAME = "jarvis-pwa-v3";
const BASE_URL = new URL(self.registration.scope);
const START_URL = new URL("./", BASE_URL).toString();
const ASSETS = ["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest", "./app-icon.svg"].map(
  (asset) => new URL(asset, BASE_URL).toString(),
);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.includes("/api/") || url.pathname.includes("/ws/")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }

        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) {
            return cached;
          }

          return caches.match(START_URL);
        }),
      ),
  );
});

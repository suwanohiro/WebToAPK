const CACHE_NAME = "webtoapk-shell-v3";
const APP_ROOT = self.registration.scope;
const APP_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
].map((path) => new URL(path, APP_ROOT).href);
const APP_URL_SET = new Set(APP_URLS);
const START_URL = APP_URLS[0];
const INDEX_URL = APP_URLS[1];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith("webtoapk-shell-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () =>
        (await caches.match(request)) ||
        (await caches.match(START_URL)) ||
        (await caches.match(INDEX_URL))
      )
    );
    return;
  }

  if (APP_URL_SET.has(requestUrl.href)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (!response.ok) return response;
          return caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, response.clone()))
            .then(() => response);
        })
      )
    );
  }
});

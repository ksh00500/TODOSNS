const CACHE = "mungsil-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/mungsil-icon-192.png", "/mungsil-icon-512.png"];
const STATIC_PREFIXES = ["/_next/static/", "/demo/"];
const STATIC_PATHS = new Set(SHELL.filter((path) => path !== "/"));

function isCacheableStatic(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search) return false;
  if (["/start", "/forgot-password", "/reset-password", "/verify-email"].includes(url.pathname)) return false;
  return STATIC_PATHS.has(url.pathname) || STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("mungsil-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(async () => (await caches.match("/")) || Response.error()),
    );
    return;
  }
  if (!isCacheableStatic(request, url)) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })),
  );
});

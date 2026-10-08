/*
 * Service worker of Bills Management, registered by src/app/service-worker.tsx.
 *
 * - Build assets (/_next/static, hashed and immutable): cache first.
 * - Icons and the manifest: served from the cache, refreshed in the background.
 * - Page navigations: always from the network; when it is unreachable, the
 *   offline page (public/offline.html) cached at install.
 * - Everything else (API routes, auth, server actions, page data) is left to
 *   the browser. Pages and API responses hold private data and are never cached.
 *
 * Bump VERSION when this file changes how things are cached: the old caches
 * are deleted when the new worker activates.
 */
const VERSION = "v1";
const CACHE_PREFIX = "bills-";
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];
/** Build assets of old deployments pile up; keep the newest ones only. */
const MAX_STATIC_ENTRIES = 200;

/** How a request is answered: "static", "refresh", "page" or null (browser default). */
function strategyFor(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  if (request.mode === "navigate") return "page";
  if (url.pathname.startsWith("/_next/static/")) return "static";
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    return "refresh";
  }
  return null;
}

function cacheable(response) {
  return response.ok && response.type === "basic";
}

async function trim(cache) {
  const keys = await cache.keys();
  // Cache.keys() lists entries in insertion order, oldest first.
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES))) {
    await cache.delete(key);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (cacheable(response)) await cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}

async function networkWithOfflinePage(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== STATIC_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const strategy = strategyFor(event.request);
  if (strategy === "static") event.respondWith(cacheFirst(event.request));
  else if (strategy === "refresh") event.respondWith(staleWhileRevalidate(event.request, event));
  else if (strategy === "page") event.respondWith(networkWithOfflinePage(event.request));
});

const CACHE_NAME = "bms-next-shell-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.png",
  "/icon-192.png",
  "/icon-512.png",
];

// Install: Cache static shell assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("[SW] Static asset pre-cache warning:", err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: Clean old caches and claim clients
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Secure caching strategy
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Strictly skip caching for non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Strictly bypass CacheStorage for Firebase RTDB, Auth, Firestore, and external APIs
  // Private business data is stored authoritatively in Dexie IndexedDB cache, NEVER in browser HTTP CacheStorage
  if (
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("identitytoolkit") ||
    url.hostname.includes("securetoken") ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // HTML Navigation: Network-first with cache fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match("/");
          return fallback || new Response("Offline — Please reconnect to internet", { status: 503, headers: { "Content-Type": "text/plain" } });
        })
    );
    return;
  }

  // Static Assets (scripts, styles, fonts, images): Stale-while-revalidate
  if (
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "image" ||
    request.destination === "font" ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".woff2")
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Default: Network fetch with offline cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// Handle safe background update message
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

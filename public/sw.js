const CACHE_NAME = 'harmies-cache-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Network-First for index.html or document requests to ensure users always get the latest hashes
  const isDoc = event.request.mode === 'navigate' || event.request.url.endsWith('/') || event.request.url.endsWith('index.html');
  
  if (isDoc) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Fetch fresh version in background
      const networkFetch = fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || event.request.method !== 'GET') {
          return response;
        }

        // Avoid caching SPA fallback html redirect for missing assets
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          return response;
        }

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
        });
        return response;
      }).catch(() => null);

      return cachedResponse || networkFetch;
    })
  );
});

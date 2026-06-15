const CACHE_NAME = 'harmies-cache-v4';
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
    }).catch((err) => {
      console.warn('Failed to open cache or add initial assets during install:', err);
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
    }).catch((err) => {
      console.warn('Failed to clean up old caches during activate:', err);
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Network-First for document/navigation requests
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            try {
              const clone = response.clone();
              caches.open(CACHE_NAME)
                .then((c) => {
                  c.put(event.request, clone).catch((err) => {
                    console.warn('Cache put failed for navigation request:', err);
                  });
                })
                .catch((err) => {
                  console.warn('Cache open failed for navigation request:', err);
                });
            } catch (e) {
              console.warn('Failed to clone navigation response:', e);
            }
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-First for all other assets (JS, CSS, images, fonts)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Only cache successful, same-origin (basic) responses
          // Never cache HTML fallbacks for missing hashed assets
          if (response.ok && response.type === 'basic') {
            const ct = response.headers.get('content-type') || '';
            if (!ct.includes('text/html')) {
              try {
                const clone = response.clone();
                caches.open(CACHE_NAME)
                  .then((c) => {
                    c.put(event.request, clone).catch((err) => {
                      console.warn('Cache put failed for asset:', err);
                    });
                  })
                  .catch((err) => {
                    console.warn('Cache open failed for asset:', err);
                  });
              } catch (e) {
                console.warn('Failed to clone asset response:', e);
              }
            }
          }
          return response;
        })
        .catch((err) => {
          console.warn('Network fetch failed for asset:', event.request.url, err);
          return caches.match(event.request);
        });
    })
  );
});

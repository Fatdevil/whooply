const CACHE_NAME = 'whooply-v15';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/dice-gold.png',
  '/coin-head.jpg',
  '/slots-machine.png',
  '/tab-roulette-card.png',
  '/wheel-fortune.png',
  '/stopwatch-gold.png',
  '/space-invaders.png',
  '/malta-jackpot.png',
  '/mafia-gold.png',
  '/golf-gimme.png',
  '/hockey-gold.png',
  '/bjorkloven-gold.png',
  '/loven-game.png'
];

// Install — cache static assets safely
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of STATIC_ASSETS) {
        try {
          await cache.add(asset);
        } catch (e) {
          console.warn(`[SW] Failed to cache asset ${asset}:`, e);
        }
      }
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip API and WebSocket requests
  if (url.pathname.startsWith('/api') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful GET responses
        // Never store an HTML page under a script/style URL (e.g. a fallback from an old deploy)
        const isHtml = (response.headers.get('content-type') || '').includes('text/html');
        if (response.ok && event.request.method === 'GET' && (!isHtml || event.request.mode === 'navigate')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache: only serve root HTML on navigation requests
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Not found offline', { status: 404, statusText: 'Not Found' });
        });
      })
  );
});

// ── Push Notifications (Web Push API) ─────────────────
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Whooply 🇲🇹', body: event.data.text() };
    }
  }

  const title = data.title || 'Whooply 🇲🇹';
  const options = {
    body: data.body || 'Ett nytt BlixtBet har startats!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    // Always make a sound, also when a newer notification replaces an older one
    silent: false,
    tag: data.tag || `mb-${Date.now()}`,
    renotify: true,
    timestamp: Date.now(),
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windowClients.find(c => c.url.startsWith(self.location.origin));
    if (client) {
      // Let the open app navigate itself. WindowClient.navigate() is unreliable on
      // iPhone and can leave the app hanging on its loading screen.
      client.postMessage({ type: 'open-url', url: targetUrl });
      try { await client.focus(); } catch {}
      return;
    }
    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});

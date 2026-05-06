const CACHE_NAME = 'stitch-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/wasm-files/web-demuxer.wasm'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const videos = formData.getAll('videos');
          const cache = await caches.open('share-target');
          await cache.put('/shared-videos', new Response(JSON.stringify({
            names: videos.map(v => (v instanceof File ? v.name : 'video')),
            count: videos.length
          })));
        } catch (e) {
          console.error('[SW] Share failed:', e);
        }
        return Response.redirect('/', 303);
      })()
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

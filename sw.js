// A town built in the browser lives in the Cache API under ./worlds/<slug>/ (factory.js). The game asks for those
// files with ordinary fetches; this worker answers them from the cache so the game never knows the town was built
// on the phone a minute ago. Everything else goes straight to the network — no offline caching of the site itself,
// so a push to Pages is always what a reload gets.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || !/\/worlds\/[a-z0-9-]+\//.test(u.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open('factory-worlds');
    const hit = await cache.match(u.origin + u.pathname);
    if (hit) return hit;
    try { return await fetch(e.request); } catch (_) { return new Response('', {status: 404}); }
  })());
});

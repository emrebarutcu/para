importScripts('/version.js');
const CACHE = 'cashfollow-' + self.APP_VERSION;
const ASSETS = ['/', '/index.html', '/version.js', '/styles.css', '/app.js', '/taksit.js', '/eposta.js', '/tablo.js', '/varlik.js', '/sync.js', '/config.js', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first for Supabase API, cache-first for local assets
  // MCP sunucusu, OAuth izin sayfası (her istek ayrı authorization_id taşır) ve kurlar önbelleğe alınmaz
  const path = new URL(e.request.url).pathname;
  if (path === '/mcp' || path.startsWith('/oauth/') || path.startsWith('/.well-known/') || path.startsWith('/api/')) return;
  if (e.request.url.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});

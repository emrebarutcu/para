// Sürüm 6.1.0 — scripts/surum.sh yazar: dosyanın kendisi her sürümde değişir, tarayıcılar (Safari dahil) yeni service
// worker'ı yalnızca içe aktarılan version.js'e bakmadan da hemen fark eder
importScripts('/version.js');
const CACHE = 'cashfollow-' + self.APP_VERSION;
// /index.html önbelleğe alınmaz: Cloudflare onu /'a yönlendirir (307), sayfa / adresinden gelir
const ASSETS = ['/', '/version.js', '/styles.css', '/app.js', '/tekrar.js', '/taksit.js', '/eposta.js', '/tablo.js', '/varlik.js', '/borc.js', '/sync.js', '/kategori.js', '/icgoru.js', '/yz.js', '/yz-worker.js', '/config.js', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Ana sürüm (MAJOR) değiştiyse veri biçimi de değişmiştir: aynı cihazda açık kalan eski sürüm sekmeleri yeniden yüklenir,
// eski kod yeni verinin üstüne yazmasın (ör. 4.x sekmesi borçları ve kart takibini bilmez)
const major = v => String(v).replace('cashfollow-', '').split('.')[0];

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      // Yalnızca uygulamanın eski sürüm önbellekleri; yapay zekâ modeli ve vektörleri (yz.js) sürümden bağımsız kalır
      const old = keys.filter(k => k.startsWith('cashfollow-') && k !== CACHE);
      return Promise.all(old.map(k => caches.delete(k))).then(() => old);
    }).then(old => self.clients.claim().then(() => {
      if (!old.some(k => major(k) !== major(self.APP_VERSION))) return;
      return self.clients.matchAll({ type: 'window' })
        .then(cs => Promise.all(cs.map(c => c.navigate(c.url).catch(() => {}))));
    }))
  );
});

self.addEventListener('fetch', e => {
  // Network-first for Supabase API, cache-first for local assets
  // MCP sunucusu, OAuth izin sayfası (her istek ayrı authorization_id taşır) ve kurlar önbelleğe alınmaz
  const path = new URL(e.request.url).pathname;
  if (path === '/mcp' || path.startsWith('/oauth/') || path.startsWith('/.well-known/') || path.startsWith('/api/')) return;
  // Cihazdaki yapay zekâ: model (yüzlerce MB), kütüphane ve ONNX Runtime'ı transformers.js kendi önbelleğinde tutar;
  // sürüme bağlı bu önbelleğe girip her güncellemede yeniden inmesinler
  if (/(^|\.)(huggingface\.co|hf\.co)$/.test(new URL(e.request.url).hostname) || /\/(onnxruntime-web|@huggingface\/transformers)@/.test(path)) return;
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

// ---------- Cihazdaki yapay zekâ: harcama kategorisi ----------
// Kullanıcı Ayarlar → Yapay zekâ'dan açar; model (çok dilli metin gömme, ~135 MB) bir kez indirilir (tarayıcı
// önbelleği), sonra çevrimdışı çalışır. Ücretsizdir ve veri cihazdan çıkmaz. Model yz-worker.js'te yalnızca gerektiğinde
// yüklenir; bir süre kullanılmazsa worker kapatılıp bellek bırakılır. Kategori kelimelerinin ve kullanıcı örneklerinin
// vektörleri cihazda saklanır (Cache Storage), her açılışta yeniden hesaplanmaz. Sıralama kategori.js'te.
(function (root) {
  const K = root.Kategori;
  const MODEL = "Xenova/multilingual-e5-small";
  const DTYPE = "q8";
  const SIZE_MB = 135;                          // indirilecek model + tokenizer (yaklaşık)
  const PREF = "para.ai";                       // "on": kullanıcı açtı
  const CACHE = "transformers-cache";           // transformers.js'in Cache Storage adı
  const STORE = "yz-vektor";                    // saklanan vektörler (service worker'ın sürüm önbelleği değil)
  const STORE_KEY = "/__yz/vektorler.json";
  const IDLE = 5 * 60_000;                      // bu kadar kullanılmazsa worker kapanır
  const VECTORS = 1000;                         // saklanan en fazla vektör

  let worker = null, ready = null, idleTimer = 0, seq = 0;
  const pending = new Map();
  const listeners = new Set();
  const vectors = new Map();                    // metin → Float32Array
  let info = { status: readPref() === "on" ? "idle" : "off", loaded: 0, total: 0, error: null };

  function readPref() { try { return localStorage.getItem(PREF); } catch { return null; } }
  function writePref(v) { try { v ? localStorage.setItem(PREF, v) : localStorage.removeItem(PREF); } catch {} }

  function set(patch) {
    info = { ...info, ...patch };
    for (const fn of listeners) fn(info);
  }

  // Module worker, WebAssembly ve Cache Storage gerekir
  function supported() {
    if (typeof Worker === "undefined" || typeof WebAssembly !== "object" || !("caches" in root)) return false;
    let ok = false;
    try { new Worker("data:text/javascript,", { get type() { ok = true; return "module"; } }).terminate(); } catch {}
    return ok;
  }

  function stop() {
    clearTimeout(idleTimer);
    worker?.terminate();
    worker = null;
    ready = null;
    for (const { reject } of pending.values()) reject(new Error("durduruldu"));
    pending.clear();
  }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!pending.size) { stop(); if (info.status === "ready") set({ status: "idle" }); } }, IDLE);
  }

  // Worker'ı açar ve modeli yükler (önbellekte yoksa indirir)
  function start() {
    if (ready) return ready;
    worker = new Worker("/yz-worker.js", { type: "module" });
    set({ status: "loading", error: null });
    ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") set({ loaded: data.loaded, total: data.total });
        else if (data.type === "ready") { set({ status: "ready" }); resolve(); touch(); }
        else if (data.type === "vectors") {
          pending.get(data.id)?.resolve(data.vectors);
          pending.delete(data.id);
          touch();
        } else if (data.type === "error") {
          if (data.id != null) { pending.get(data.id)?.reject(new Error(data.message)); pending.delete(data.id); return; }
          stop();
          set({ status: "error", error: data.message });
          reject(new Error(data.message));
        }
      };
      worker.onerror = e => {
        stop();
        set({ status: "error", error: e.message || "Worker açılamadı" });
        reject(new Error(e.message || "worker"));
      };
    });
    worker.postMessage({ type: "load", model: MODEL, dtype: DTYPE });
    return ready;
  }

  // Float32Array ↔ base64
  const encode = a => { let s = ""; for (const b of new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) s += String.fromCharCode(b); return btoa(s); };
  const decode = s => new Float32Array(Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer);

  let restored = null, saveTimer = 0;
  function restore() {
    restored ??= (async () => {
      try {
        const res = await (await caches.open(STORE)).match(STORE_KEY);
        const saved = res && await res.json();
        if (saved?.model !== MODEL) return;
        for (const [t, b64] of Object.entries(saved.v)) if (!vectors.has(t)) vectors.set(t, decode(b64));
      } catch {}
    })();
    return restored;
  }
  // Çok vektör birden geldiyse (kategori kelimeleri) hemen, tek tük gelenler biraz bekleyip toplu yazılır
  function persist(now) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const v = {};
        for (const [t, a] of vectors) v[t] = encode(a);
        await (await caches.open(STORE)).put(STORE_KEY, new Response(JSON.stringify({ model: MODEL, v })));
      } catch {}
    }, now ? 0 : 1000);
  }

  // Metinlerin vektörleri; saklanmayanlar worker'da hesaplanır
  async function embed(texts) {
    await restore();
    const missing = [...new Set(texts.filter(t => !vectors.has(t)))];
    if (missing.length) {
      await start();
      const id = ++seq;
      clearTimeout(idleTimer);
      const list = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: "embed", id, texts: missing.map(t => K.PREFIX + t) });
      });
      if (vectors.size + missing.length > VECTORS) {
        const words = new Set(K.words().map(w => w.text));   // kategori kelimeleri kalır, eski örnekler gider
        for (const t of vectors.keys()) if (!words.has(t)) vectors.delete(t);
      }
      missing.forEach((t, i) => vectors.set(t, list[i]));
      persist(missing.length > 10);
    }
    return texts.map(t => vectors.get(t));
  }

  const api = {
    MODEL,
    SIZE_MB,
    get info() { return info; },
    get enabled() { return readPref() === "on"; },
    supported,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Açar: modeli indirir, yükler ve kategori kelimelerini hazırlar
    async enable() {
      writePref("on");
      try { await start(); await embed(K.words().map(w => w.text)); return true; } catch { return false; }
    },

    // Kapatır ve indirilen modeli siler
    async disable() {
      writePref(null);
      stop();
      vectors.clear();
      restored = null;
      set({ status: "off", loaded: 0, total: 0, error: null });
      try { await caches.delete(CACHE); await caches.delete(STORE); } catch {}
    },

    // Model açıksa önceden yükler (form açılınca: ilk öneri beklemesin)
    warm() {
      if (api.enabled && info.status !== "error") start().catch(() => {});
    },

    // desc için kategori önerisi: { category, confidence }; kapalıysa ya da model açılamadıysa null
    // (açılamadıysa her harcamada yeniden denenmez; kullanıcı kapatıp açınca denenir)
    async suggest(desc, memory) {
      const text = String(desc ?? "").trim().slice(0, 200);
      if (!api.enabled || info.status === "error" || !text) return null;
      const words = K.words(), users = K.examples(memory);
      const all = await embed([text, ...words.map(w => w.text), ...users.map(u => u.text)]);
      const protos = words.map((w, i) => ({ id: w.id, v: all[1 + i] }));
      const mine = users.map((u, i) => ({ id: u.id, v: all[1 + words.length + i] }));
      const r = K.rank(all[0], protos, mine);
      return { category: r.category, confidence: r.confidence };
    },
  };
  root.YZ = api;
})(this);

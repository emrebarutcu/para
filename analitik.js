// Ürün analitiği ve A/B denemeleri (PostHog, HTTP API; kütüphane yok) — iPhone'daki Analitik.swift ile aynı olaylar ve
// kimlik: girişten sonra hesabın kimliği, böylece web ve iPhone'daki olaylar aynı kişide birleşir. Anahtar config.js'te
// (POSTHOG_KEY); boşsa ya da Ayarlar'da kapatıldıysa hiçbir şey gönderilmez. Olaylar tutar, ad ya da açıklama içermez;
// PostHog IP adresinden konum çıkarmaz ($geoip_disable).
(function (root) {
  const KEY = () => root.POSTHOG_KEY || "";
  const HOST = () => (root.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  let queue = [];
  let flags = {};
  const called = new Set();
  let timer = 0;

  const enabled = () => !!KEY() && store.get("para.analitik.kapali") !== "1" && !navigator.webdriver;
  function anonId() {
    let id = store.get("para.analitik.kimlik");
    if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); store.set("para.analitik.kimlik", id); }
    return id;
  }
  const who = () => store.get("para.analitik.hesap") || anonId();
  const common = () => ({
    $app_version: root.APP_VERSION || "", $lib: "cashfollow-web", platform: "web", $geoip_disable: true,
    lang: (document.documentElement.lang || "tr").slice(0, 2), $current_url: location.origin + location.pathname,
  });

  function flush(beacon = false) {
    if (!enabled() || !queue.length) return;
    const body = JSON.stringify({ api_key: KEY(), batch: queue });
    queue = [];
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(`${HOST()}/batch/`, new Blob([body], { type: "application/json" })); return; }
    fetch(`${HOST()}/batch/`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }

  function event(name, props = {}) {
    if (!enabled()) return;
    queue.push({ event: name, properties: { ...common(), ...props, distinct_id: who() }, timestamp: new Date().toISOString() });
    clearTimeout(timer);
    timer = setTimeout(flush, 2000);
  }

  function identify(userId) {
    if (!userId || store.get("para.analitik.hesap") === userId) return;
    const prev = who();
    store.set("para.analitik.hesap", userId);
    if (!enabled()) return;
    queue.push({ event: "$identify", properties: { distinct_id: userId, $anon_distinct_id: prev }, timestamp: new Date().toISOString() });
    flush();
    loadFlags();
  }
  function reset() { store.set("para.analitik.hesap", null); loadFlags(); }

  // A/B: özellik bayrakları
  async function loadFlags() {
    if (!enabled()) return;
    try {
      const r = await fetch(`${HOST()}/flags/?v=2`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: KEY(), distinct_id: who(), person_properties: { platform: "web" } }) });
      const j = await r.json();
      const out = {};
      for (const [k, f] of Object.entries(j.flags || {})) if (f?.enabled) out[k] = f.variant ?? true;
      flags = out;
    } catch {}
  }
  function flag(name) {
    const v = name in flags ? (typeof flags[name] === "string" ? flags[name] : "true") : null;
    if (enabled() && !called.has(name)) { called.add(name); event("$feature_flag_called", { $feature_flag: name, $feature_flag_response: v ?? false }); }
    return v;
  }

  function setEnabled(on) { store.set("para.analitik.kapali", on ? null : "1"); if (!on) queue = []; }

  addEventListener("pagehide", () => flush(true));
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });

  root.Analitik = { event, identify, reset, flag, loadFlags, setEnabled, get enabled() { return store.get("para.analitik.kapali") !== "1"; } };
})(this);

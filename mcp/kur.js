// ---------- Güncel kurlar: para birimleri (para.js) ve gram altın, TL karşılıklarıyla ----------
// Başka ana para birimi olan hesaplar bunlardan kendi kurlarını hesaplar (para.js homeRates).
// Uygulama /api/kur'dan, asistan araçları doğrudan buradan alır. Kaynak Truncgil (Türkiye piyasası, satış fiyatı);
// erişilemezse dolar / euro open.er-api.com'dan, altın gold-api.com'un ons fiyatından hesaplanır. Truncgil'in diğer
// para birimleri open.er-api ile karşılaştırılır: yarısından az ya da iki katından fazlaysa (Truncgil Japon yenini 100'de
// bir verir) open.er-api'ninki kullanılır.
// Sonuç 10 dakika saklanır (Worker örneğinin belleğinde ve Cloudflare önbelleğinde).
const TTL = 10 * 60_000;
const TIMEOUT = 5000;
const OUNCE = 31.1034768;   // gram / troy ons

const PRIMARY = "https://finans.truncgil.com/v4/today.json";
const FX = "https://open.er-api.com/v6/latest/USD";
const GOLD = "https://api.gold-api.com/price/XAU";

import P from "../para.js";

const CODES = P.CURRENCIES.map(c => c.code).filter(c => c !== "TRY");
const valid = r => [r.USD, r.EUR, r.GAU].every(v => Number.isFinite(v) && v > 0);

async function getJson(f, url) {
  const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function fromTruncgil(f) {
  const d = await getJson(f, PRIMARY);
  const rates = { TRY: 1, USD: Number(d.USD?.Selling), EUR: Number(d.EUR?.Selling), GAU: Number(d.GRA?.Selling) };
  if (!valid(rates)) throw new Error("truncgil: eksik kur");
  for (const c of CODES) {
    const v = Number(d[c]?.Selling);
    if (Number.isFinite(v) && v > 0) rates[c] = v;
  }
  // "2026-10-19 13:36:02" Türkiye saati
  const at = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d.Update_Date) ? `${d.Update_Date.replace(" ", "T")}+03:00` : null;
  return { rates, updatedAt: at ? new Date(at).toISOString() : new Date().toISOString(), source: "truncgil" };
}

// open.er-api'nin kurları TL karşılığıyla ({ GBP: 67.1, … }); alınamazsa null
async function fxTry(f) {
  try {
    const fx = await getJson(f, FX);
    const usd = Number(fx.rates?.TRY);
    if (!(Number.isFinite(usd) && usd > 0)) return null;
    const out = {};
    for (const c of CODES) {
      const v = usd / Number(fx.rates?.[c]);
      if (Number.isFinite(v) && v > 0) out[c] = Number(v.toPrecision(6));
    }
    return out;
  } catch (err) {
    console.warn("kur karşılaştırması:", err.message);
    return null;
  }
}

// Truncgil'in tuttuğu kurlar (TL, dolar, euro, altın) olduğu gibi kalır; diğerleri karşılaştırmadan geçer
function checked(value, fx) {
  if (!fx) return value;
  const rates = { ...value.rates };
  for (const c of CODES) {
    if (c === "USD" || c === "EUR" || !(c in rates) || !(c in fx)) continue;
    const ratio = rates[c] / fx[c];
    if (ratio < 0.5 || ratio > 2) rates[c] = fx[c];
  }
  return { ...value, rates };
}

async function fromFallback(f) {
  const [fx, gold] = await Promise.all([getJson(f, FX), getJson(f, GOLD)]);
  const usd = Number(fx.rates?.TRY);
  const rates = { TRY: 1, USD: usd, EUR: usd / Number(fx.rates?.EUR), GAU: (Number(gold.price) * usd) / OUNCE };
  if (!valid(rates)) throw new Error("yedek kaynak: eksik kur");
  for (const c of CODES) {
    const v = usd / Number(fx.rates?.[c]);
    if (!(c in rates) && Number.isFinite(v) && v > 0) rates[c] = v;
  }
  for (const k of Object.keys(rates)) if (k !== "TRY") rates[k] = Number(rates[k].toPrecision(6));
  return { rates, updatedAt: gold.updatedAt || new Date().toISOString(), source: "open.er-api + gold-api" };
}

let memo = null;   // { at, value }

// { rates: { TRY: 1, USD, EUR, GAU, GBP, … }, updatedAt, source }: bir biriminin TL karşılığı
export async function getRates({ fetch: f = fetch, now = Date.now } = {}) {
  if (memo && now() - memo.at < TTL) return memo.value;
  let value;
  try {
    const [t, fx] = await Promise.all([fromTruncgil(f), fxTry(f)]);
    value = checked(t, fx);
  } catch (err) {
    console.warn("kur:", err.message);
    value = await fromFallback(f);
  }
  memo = { at: now(), value };
  return value;
}

export function clearRates() { memo = null; }

// GET /api/kur
export async function handleRates(request, ctx) {
  const cache = globalThis.caches?.default;
  const key = new Request(new URL("/api/kur", request.url));
  const hit = await cache?.match(key);
  if (hit) return hit;
  try {
    const res = new Response(JSON.stringify(await getRates()), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${TTL / 1000}` },
    });
    if (cache) ctx?.waitUntil?.(cache.put(key, res.clone()));
    return res;
  } catch (err) {
    console.error("kur:", err);
    return new Response(JSON.stringify({ error: "Kurlar şu an alınamıyor." }), {
      status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}

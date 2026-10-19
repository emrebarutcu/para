// ---------- Güncel kurlar: dolar, euro, gram altın (TL) ----------
// Uygulama /api/kur'dan, asistan araçları doğrudan buradan alır. Kaynak Truncgil (Türkiye piyasası, satış fiyatı);
// erişilemezse dolar / euro open.er-api.com'dan, altın gold-api.com'un ons fiyatından hesaplanır.
// Sonuç 10 dakika saklanır (Worker örneğinin belleğinde ve Cloudflare önbelleğinde).
const TTL = 10 * 60_000;
const TIMEOUT = 5000;
const OUNCE = 31.1034768;   // gram / troy ons

const PRIMARY = "https://finans.truncgil.com/v4/today.json";
const FX = "https://open.er-api.com/v6/latest/USD";
const GOLD = "https://api.gold-api.com/price/XAU";

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
  // "2026-10-19 13:36:02" Türkiye saati
  const at = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d.Update_Date) ? `${d.Update_Date.replace(" ", "T")}+03:00` : null;
  return { rates, updatedAt: at ? new Date(at).toISOString() : new Date().toISOString(), source: "truncgil" };
}

async function fromFallback(f) {
  const [fx, gold] = await Promise.all([getJson(f, FX), getJson(f, GOLD)]);
  const usd = Number(fx.rates?.TRY);
  const rates = { TRY: 1, USD: usd, EUR: usd / Number(fx.rates?.EUR), GAU: (Number(gold.price) * usd) / OUNCE };
  if (!valid(rates)) throw new Error("yedek kaynak: eksik kur");
  for (const k of ["USD", "EUR", "GAU"]) rates[k] = Math.round(rates[k] * 10000) / 10000;
  return { rates, updatedAt: gold.updatedAt || new Date().toISOString(), source: "open.er-api + gold-api" };
}

let memo = null;   // { at, value }

// { rates: { TRY: 1, USD, EUR, GAU }, updatedAt, source }
export async function getRates({ fetch: f = fetch, now = Date.now } = {}) {
  if (memo && now() - memo.at < TTL) return memo.value;
  let value;
  try {
    value = await fromTruncgil(f);
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

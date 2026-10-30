// ---------- Fon ve hisse fiyatları (TL): TEFAS fonları, Borsa İstanbul hisseleri ----------
// Uygulama /api/fiyat ve /api/fonlar'dan, asistan araçları doğrudan buradan alır. Kaynaklar ücretsiz ve anahtarsızdır:
// - Fonlar: TEFAS'ın sitesinin kullandığı fon bilgisi uç noktası (fonGnlBlgSiraliGetir). Yatırım (YAT), emeklilik (EMK) ve
//   borsa yatırım fonlarının (BYF) son fiyat günündeki pay fiyatları; fiyat günde bir kez açıklanır. Bugünden (Türkiye
//   saati) geriye, hafta sonları atlanarak fiyatı olan ilk gün aranır. Liste 1 saat saklanır.
// - Hisseler: İş Yatırım'ın piyasa verisi (Data.aspx/OneEndeks), yaklaşık 15 dakika gecikmeli son fiyat ve seansın baz
//   fiyatı (önceki kapanış). 2 dakika saklanır.
// Varlık kodları varlik.js'teki gibidir: "FON:AFT", "BIST:THYAO". Sonuçlar Worker örneğinin belleğinde, uygulamanın
// istekleri ayrıca Cloudflare önbelleğinde tutulur.
import V from "../varlik.js";

const FUND_TTL = 60 * 60_000;
const FUND_RETRY = 5 * 60_000;     // fon türlerinden biri alınamadıysa liste bu kadar sonra yeniden denenir
const STOCK_TTL = 2 * 60_000;
const TIMEOUT = 8000;
const LOOKBACK = 10;               // fiyatı olan gün en fazla bu kadar geriye aranır (bayram tatilleri)
const BATCH = 40;                  // bir istekte en fazla hisse
const MAX_CODES = 100;             // /api/fiyat'ta en fazla kod

const FUND_URL = "https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir";
const STOCK_URL = "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/OneEndeks";
const KINDS = ["YAT", "EMK", "BYF"];

// Türkiye saatiyle gün ("YYYY-MM-DD")
const dayOf = ms => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const weekend = day => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

// Tek fon türünün bir gündeki fiyatları; o gün fiyat yoksa (tatil, henüz açıklanmadı) boş liste
async function fundsOn(f, kind, day) {
  const ymd = day.replaceAll("-", "");
  const res = await f(FUND_URL, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ fonTipi: kind, fonKodu: null, basTarih: ymd, bitTarih: ymd, basSira: 1, bitSira: 100000, dil: "TR" }),
  });
  if (!res.ok) throw new Error(`tefas ${kind} ${day}: ${res.status}`);
  const d = await res.json();
  const list = Array.isArray(d?.resultList) ? d.resultList : [];
  // Fiyatsız günde TEFAS hata metni döndürür ("Index 0 out of bounds…", "veri bulunamadı")
  if (!list.length && d?.errorMessage && !/out of bounds|bulunamad/i.test(d.errorMessage)) throw new Error(`tefas ${kind}: ${d.errorMessage}`);
  return list;
}

// Türün from gününden geriye fiyatı olan ilk gündeki listesi
async function latestFunds(f, kind, from) {
  for (let i = 0; i < LOOKBACK; i++) {
    const day = addDays(from, -i);
    if (weekend(day)) continue;
    const list = await fundsOn(f, kind, day);
    if (list.length) return { day, list };
  }
  return { day: null, list: [] };
}

function fundOf(r, kind) {
  const code = String(r?.fonKodu ?? "").trim().toUpperCase();
  const price = Number(r?.fiyat);
  if (!V.market(`FON:${code}`) || !(price > 0)) return null;
  return { code, name: String(r.fonUnvan ?? "").trim(), kind, price, date: String(r.tarih ?? "").slice(0, 10) };
}

let funds = null;        // { at, ttl, value: { date, funds: Map(kod → fon) } }
let fundsLoading = null;

// Bütün fonlar: { date, funds: Map("AFT" → { code, name, kind, price, date }) }. Yatırım fonu listesi alınamazsa hata;
// önceden alınmış liste varsa o döner.
export async function getFunds({ fetch: f = fetch, now = Date.now } = {}) {
  if (funds && now() - funds.at < funds.ttl) return funds.value;
  fundsLoading ??= (async () => {
    try {
      const today = dayOf(now());
      const yat = await latestFunds(f, "YAT", today);
      if (!yat.day) throw new Error("tefas: fiyat bulunamadı");
      const rest = await Promise.allSettled(KINDS.slice(1).map(kind => latestFunds(f, kind, yat.day)));
      const map = new Map();
      for (const r of yat.list) { const x = fundOf(r, "YAT"); if (x) map.set(x.code, x); }
      rest.forEach((res, i) => {
        if (res.status === "rejected") { console.warn("fon:", res.reason?.message); return; }
        for (const r of res.value.list) { const x = fundOf(r, KINDS[i + 1]); if (x && !map.has(x.code)) map.set(x.code, x); }
      });
      const value = { date: yat.day, funds: map };
      funds = { at: now(), ttl: rest.some(r => r.status === "rejected") ? FUND_RETRY : FUND_TTL, value };
      return value;
    } catch (err) {
      if (funds) { console.warn("fon:", err.message); return funds.value; }
      throw err;
    } finally {
      fundsLoading = null;
    }
  })();
  return fundsLoading;
}

// "2026-10-30T12:51:06.000+03" → ISO
function isoOf(s) {
  const d = new Date(String(s ?? "").replace(/([+-]\d{2})$/, "$1:00"));
  return isNaN(d) ? null : d.toISOString();
}

const stocks = new Map();   // işlem kodu → { at, value: { price, prev, at } | null (bulunamadı) }

// Hisselerin son fiyatları: Map("THYAO" → { price, prev, at }); bulunamayan kod sonuçta yok
export async function getStocks(tickers, { fetch: f = fetch, now = Date.now } = {}) {
  const want = [...new Set(tickers)].filter(t => V.market(`BIST:${t}`));
  const stale = want.filter(t => !(now() - (stocks.get(t)?.at ?? -Infinity) < STOCK_TTL));
  for (let i = 0; i < stale.length; i += BATCH) {
    const part = stale.slice(i, i + BATCH);
    const res = await f(`${STOCK_URL}?endeks=${part.join(",")}`, { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`hisse: ${res.status}`);
    const d = await res.json();
    // Bilinmeyen kodlar cevapta yer almaz; hiçbiri bilinmiyorsa cevap { error } olur
    if (!Array.isArray(d) && !d?.error) throw new Error("hisse: beklenmeyen cevap");
    const found = new Map();
    for (const q of Array.isArray(d) ? d : []) {
      const prev = Number(q?.basePrice) > 0 ? Number(q.basePrice) : Number(q?.dayClose);
      const price = Number(q?.last) > 0 ? Number(q.last) : prev;
      if (typeof q?.symbol === "string" && price > 0) found.set(q.symbol.toUpperCase(), { price, prev: prev > 0 ? prev : null, at: isoOf(q.updateDate) });
    }
    for (const t of part) stocks.set(t, { at: now(), value: found.get(t) ?? null });
  }
  return new Map(want.filter(t => stocks.get(t)?.value).map(t => [t, stocks.get(t).value]));
}

export function clearMarket() { funds = null; fundsLoading = null; stocks.clear(); }

// Kodların fiyatları: { prices: { "FON:AFT": { price, date, name, kind }, "BIST:THYAO": { price, prev, at, date } },
// missing: [bulunamayan kodlar], failed: [kaynağı alınamayan pazarlar: "FON", "BIST"], updatedAt }. İki kaynak da
// alınamazsa hata.
export async function getPrices(codes, opts = {}) {
  const now = opts.now ?? Date.now;
  const list = [...new Set(codes)].filter(c => V.market(c));
  const fundCodes = list.filter(c => V.market(c).market === "FON"), stockCodes = list.filter(c => V.market(c).market === "BIST");
  const [fl, sq] = await Promise.allSettled([
    fundCodes.length ? getFunds(opts) : null,
    stockCodes.length ? getStocks(stockCodes.map(c => V.market(c).ticker), opts) : null,
  ]);
  const failed = [];
  if (fl.status === "rejected") { console.warn("fon:", fl.reason?.message); failed.push("FON"); }
  if (sq.status === "rejected") { console.warn("hisse:", sq.reason?.message); failed.push("BIST"); }
  if (failed.length && failed.length === [fundCodes, stockCodes].filter(x => x.length).length) throw new Error("Fiyatlar şu an alınamıyor.");
  const prices = {}, missing = [];
  for (const c of fundCodes) {
    if (fl.status !== "fulfilled") continue;
    const x = fl.value.funds.get(V.market(c).ticker);
    if (x) prices[c] = { price: x.price, date: x.date, name: x.name, kind: x.kind }; else missing.push(c);
  }
  for (const c of stockCodes) {
    if (sq.status !== "fulfilled") continue;
    const x = sq.value.get(V.market(c).ticker);
    if (x) prices[c] = { price: x.price, prev: x.prev, at: x.at, date: x.at ? dayOf(Date.parse(x.at)) : null }; else missing.push(c);
  }
  return { prices, missing, failed, updatedAt: new Date(now()).toISOString() };
}

// Fon araması (varlik.js matchFunds) → [{ code: "FON:AFT", name, kind, price, date }]
export async function searchFunds(q, { limit = 20, ...opts } = {}) {
  const { funds: all } = await getFunds(opts);
  return V.matchFunds([...all.values()], q, limit).map(x => ({ ...x, code: `FON:${x.code}` }));
}

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": cache ? `public, max-age=${cache}` : "no-store" },
});

async function cached(request, ctx, key, make) {
  const cache = globalThis.caches?.default;
  const hit = await cache?.match(key);
  if (hit) return hit;
  const res = await make();
  if (cache && res.status === 200 && /max-age/.test(res.headers.get("Cache-Control") || "")) ctx?.waitUntil?.(cache.put(key, res.clone()));
  return res;
}

// GET /api/fiyat?kod=FON:AFT,BIST:THYAO → getPrices
export async function handlePrices(request, ctx) {
  const url = new URL(request.url);
  const codes = [...new Set((url.searchParams.get("kod") || "").split(",").map(c => c.trim().toUpperCase()).filter(Boolean))].sort();
  if (!codes.length || codes.length > MAX_CODES || codes.some(c => !V.market(c))) {
    return json({ error: `kod: en fazla ${MAX_CODES} tane, virgülle ayrılmış FON:XXX ya da BIST:XXXX` }, 400);
  }
  const key = new Request(new URL(`/api/fiyat?kod=${codes.join(",")}`, request.url));
  return cached(request, ctx, key, async () => {
    try {
      const out = await getPrices(codes);
      return json(out, 200, out.failed.length ? 0 : STOCK_TTL / 1000);
    } catch (err) {
      console.error("fiyat:", err);
      return json({ error: "Fiyatlar şu an alınamıyor." }, 503);
    }
  });
}

// GET /api/fonlar → { date, funds: [{ code: "AFT", name, kind, price, date }] } (aramada kullanılır)
export async function handleFunds(request, ctx) {
  const key = new Request(new URL("/api/fonlar", request.url));
  return cached(request, ctx, key, async () => {
    try {
      const { date, funds: all } = await getFunds();
      return json({ date, funds: [...all.values()] }, 200, FUND_TTL / 1000);
    } catch (err) {
      console.error("fonlar:", err);
      return json({ error: "Fon listesi şu an alınamıyor." }, 503);
    }
  });
}

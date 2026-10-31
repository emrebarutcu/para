// ---------- Fon ve hisse fiyatları (TL): TEFAS fonları, Borsa İstanbul hisseleri ----------
// Uygulama /api/fiyat ve /api/fonlar'dan, asistan araçları doğrudan buradan alır. Kaynaklar ücretsiz ve anahtarsızdır:
// - Fonlar: TEFAS'ın sitesinin kullandığı fon bilgisi uç noktası (fonGnlBlgSiraliGetir). Yatırım (YAT), emeklilik (EMK) ve
//   borsa yatırım fonlarının (BYF) son fiyat günündeki pay fiyatları; fiyat günde bir kez açıklanır. Bugünden (Türkiye
//   saati) geriye, hafta sonları atlanarak fiyatı olan ilk gün aranır. Liste 1 saat saklanır.
// - Hisseler: İş Yatırım'ın piyasa verisi (Data.aspx/OneEndeks), yaklaşık 15 dakika gecikmeli son fiyat ve seansın baz
//   fiyatı (önceki kapanış). 2 dakika saklanır.
// - Geçmiş (Varlıklar'daki varlık grafiği): günlük kapanışlar. Dolar, euro, gram altın ve hisseler İş Yatırım'ın grafik
//   verisinden (ChartData.aspx/IndexHistoricalAll: USDTRY, EURTRY, GLDGR, işlem kodu), fonlar TEFAS'ın fiyat geçmişinden
//   (fonFiyatBilgiGetir; 1, 3, 6, 12, 36, 60 aylık dönemler). En fazla 5 yıl; 6 saat saklanır.
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

const HIST_TTL = 6 * 3600_000;
const MAX_DAYS = 1830;             // geçmişte en fazla gün (TEFAS'ın en uzun dönemi 5 yıl)
const MAX_HIST_CODES = 40;         // /api/gecmis'te en fazla kod

const FUND_URL = "https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir";
const FUND_HISTORY_URL = "https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir";
const CHART_URL = "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/ChartData.aspx/IndexHistoricalAll";
const CHART_SYMBOL = { USD: "USDTRY", EUR: "EURTRY", GAU: "GLDGR" };   // İş Yatırım'da TL karşılıkları
// TEFAS fiyat geçmişinin dönemleri: en çok kaç gün → periyod kodu (ay)
const FUND_PERIODS = [[31, 1], [95, 3], [190, 6], [380, 12], [1100, 36], [MAX_DAYS, 60]];
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

export function clearMarket() { funds = null; fundsLoading = null; stocks.clear(); histories.clear(); }

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

// ---------- Geçmiş ----------
// Geçmişi olan kod: USD, EUR, GAU ya da fon / hisse
const historyCode = c => !!CHART_SYMBOL[c] || !!V.market(c);

let chartChain = Promise.resolve();
function chartQueue(task) {
  const run = chartChain.then(task, task);
  chartChain = run.catch(() => {});
  return run;
}

// Kodun [from, to] günlük kapanışları: [["YYYY-MM-DD", fiyat], …] (tarihe göre; işlem olmayan günler yok)
async function historyOf(f, code, from, to) {
  const m = V.market(code);
  if (m?.market === "FON") {
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
    const periyod = FUND_PERIODS.find(([d]) => days <= d)[1];
    const res = await f(FUND_HISTORY_URL, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fonKodu: m.ticker, dil: "TR", periyod }),
    });
    if (!res.ok) throw new Error(`tefas geçmiş ${m.ticker}: ${res.status}`);
    const d = await res.json();
    if (!Array.isArray(d?.resultList) && d?.errorMessage) throw new Error(`tefas geçmiş ${m.ticker}: ${d.errorMessage}`);
    return (d?.resultList || []).map(r => [String(r?.tarih ?? "").slice(0, 10), Number(r?.fiyat)])
      .filter(([day, v]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && v > 0 && day >= from && day <= to).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  const ymd = day => day.replaceAll("-", "");
  const symbol = CHART_SYMBOL[code] ?? m.ticker;
  const url = `${CHART_URL}?endeks=${symbol}&period=1440&from=${ymd(from)}000000&to=${ymd(to)}235959`;
  // İş Yatırım aynı anda gelen istekleri 503 ile geri çevirir: istekler sırayla, meşgulse bir kez daha
  const res = await chartQueue(async () => {
    for (let i = 0; ; i++) {
      const r = await f(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json" } });
      if (r.ok || i || ![429, 503].includes(r.status)) return r;
      await new Promise(done => setTimeout(done, 600));
    }
  });
  if (!res.ok) throw new Error(`geçmiş ${symbol}: ${res.status}`);
  const text = await res.text();   // bilinmeyen kodda boş cevap
  const d = text.trim() ? JSON.parse(text) : null;
  // Zaman damgası Türkiye gününün başı
  return (Array.isArray(d?.data) ? d.data : []).map(x => [dayOf(Number(x?.[0])), Number(x?.[1])])
    .filter(([day, v]) => v > 0 && day >= from && day <= to).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const histories = new Map();   // "kod|gün|bugün" → { at, value }

// Kodların son days günlük geçmişi: { from, to, series: { USD: [["2026-10-20", 49.57], …] }, failed: [alınamayanlar] }.
// Bulunamayan kodun dizisi boştur.
export async function getHistory(codes, days, { fetch: f = fetch, now = Date.now } = {}) {
  const span = Math.min(MAX_DAYS, Math.max(7, Math.round(Number(days)) || 30));
  const to = dayOf(now()), from = addDays(to, -span);
  const want = [...new Set(codes)].filter(historyCode);
  const results = await Promise.allSettled(want.map(async code => {
    const key = `${code}|${span}|${to}`;
    const hit = histories.get(key);
    if (hit && now() - hit.at < HIST_TTL) return hit.value;
    const value = await historyOf(f, code, from, to);
    if (histories.size > 500) histories.clear();
    histories.set(key, { at: now(), value });
    return value;
  }));
  const series = {}, failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") series[want[i]] = r.value;
    else { console.warn("geçmiş:", r.reason?.message); failed.push(want[i]); }
  });
  return { from, to, series, failed };
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

// GET /api/gecmis?kod=USD,GAU,FON:AFT,BIST:THYAO&gun=365 → getHistory
export async function handleHistory(request, ctx) {
  const url = new URL(request.url);
  const codes = [...new Set((url.searchParams.get("kod") || "").split(",").map(c => c.trim().toUpperCase()).filter(Boolean))].sort();
  const days = Math.min(MAX_DAYS, Math.max(7, Math.round(Number(url.searchParams.get("gun"))) || 0));
  if (!codes.length || codes.length > MAX_HIST_CODES || codes.some(c => !historyCode(c)) || !(Number(url.searchParams.get("gun")) > 0)) {
    return json({ error: `kod: en fazla ${MAX_HIST_CODES} tane, virgülle ayrılmış USD, EUR, GAU, FON:XXX ya da BIST:XXXX; gun: gün sayısı` }, 400);
  }
  const key = new Request(new URL(`/api/gecmis?kod=${codes.join(",")}&gun=${days}`, request.url));
  return cached(request, ctx, key, async () => {
    try {
      const out = await getHistory(codes, days);
      if (out.failed.length === codes.length) return json({ error: "Geçmiş fiyatlar şu an alınamıyor." }, 503);
      return json(out, 200, out.failed.length ? 0 : 3600);
    } catch (err) {
      console.error("geçmiş:", err);
      return json({ error: "Geçmiş fiyatlar şu an alınamıyor." }, 503);
    }
  });
}

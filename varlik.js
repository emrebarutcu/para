// ---------- Varlıklar: TL, dolar, euro, gram altın, fon ve hisse (DOM'dan bağımsız) ----------
// Hareket: { id, personId, asset, amount, desc, date: "YYYY-MM-DD", repeat?, price?, settle? }. amount varlığın kendi
// biriminde, girişte artı, çıkışta eksidir; bakiye hareketlerin toplamıdır. TL karşılığı güncel kurla hesaplanır
// (kurlar: /api/kur; fon ve hisse fiyatları: /api/fiyat, rates'te koduyla).
// repeat / every / unit: hareket date'ten başlayıp her N gün / hafta / ayda bir yinelenir (tekrar.js). N kez ya da
// süresiz; yoksa tek seferliktir. Bakiyeye yalnızca tarihi gelmiş hareketler (tekrarlayanda tekrarlar) girer.
// Fon ve hisse (piyasa varlığı): asset "FON:AFT" (TEFAS fon kodu) ya da "BIST:THYAO" (Borsa İstanbul işlem kodu), amount
// adet; girişi alış, çıkışı satıştır, tekrarlamaz. price o günkü birim fiyat (TL; isteğe bağlı, maliyet ve kâr için),
// settle: true ise adet × price TL bakiyesinden düşer (alış) ya da ona eklenir (satış). Dolar, euro ve altında da tek
// seferlik hareket kurla TL'den alınabilir ya da TL'ye bozdurulabilir (price kur, settle). TL bakiyesine işlenen alış /
// satış (aktarım) gelir ya da gider değildir.
(function (root) {
  const ASSETS = [
    { code: "TRY", name: "Türk lirası", short: "TL", symbol: "₺", digits: 2 },
    { code: "USD", name: "Dolar", short: "Dolar", symbol: "$", digits: 2 },
    { code: "EUR", name: "Euro", short: "Euro", symbol: "€", digits: 2 },
    { code: "GAU", name: "Gram altın", short: "Altın", symbol: "gr", digits: 3 },
  ];
  const BY_CODE = new Map(ASSETS.map(a => [a.code, a]));

  // Piyasa varlıkları: kod "PAZAR:İŞLEM KODU"
  const MARKETS = {
    FON: { name: "Fon", re: /^[A-Z0-9]{3}$/ },             // TEFAS: yatırım, emeklilik, borsa yatırım fonu
    BIST: { name: "Hisse", re: /^[A-Z][A-Z0-9]{2,5}$/ },   // Borsa İstanbul
  };
  const UNIT_DIGITS = 4;   // adet kesirli olabilir (fon payı)

  // "FON:AFT" → { market: "FON", ticker: "AFT" }; değilse null
  function market(code) {
    const m = typeof code === "string" ? /^([A-Z]+):([A-Z0-9]+)$/.exec(code) : null;
    return m && MARKETS[m[1]]?.re.test(m[2]) ? { market: m[1], ticker: m[2] } : null;
  }

  // Pazar ve işlem kodundan varlık kodu ("bist", " thyao " → "BIST:THYAO"); geçersizse null
  function marketCode(kind, ticker) {
    const code = `${String(kind ?? "").trim().toUpperCase()}:${String(ticker ?? "").trim().toLocaleUpperCase("en-US")}`;
    return market(code) ? code : null;
  }

  function asset(code) {
    const fixed = BY_CODE.get(code);
    if (fixed) return fixed;
    const m = market(code);
    return m ? { code, market: m.market, ticker: m.ticker, name: m.ticker, short: m.ticker, symbol: m.ticker, digits: UNIT_DIGITS } : null;
  }

  // Kayan nokta artığı olmasın: birimin hane sayısına yuvarlanır
  function round(amount, code) {
    const f = 10 ** (asset(code)?.digits ?? 2);
    return Math.round(amount * f) / f;
  }

  const R = typeof module === "object" && module.exports ? require("./tekrar.js") : root.Tekrar;
  const MAX_REPEAT = R.MAX_REPEAT;

  // Geçerli repeat değeri: 0 (süresiz) ya da 2…MAX_REPEAT; tek seferlik için null
  function repeatOf(e) { return R.count(e); }

  // k. tekrarın tarihi (0 tabanlı)
  function occurrenceDate(e, k) { return R.dateAt(e, k); }

  // Hareketin ay sırası idx olan aya düşen tekrarlarının tarihleri (gün / hafta aralığında birden çok olabilir)
  function occurrencesIn(e, idx) {
    const y = Math.floor(idx / 12), m = idx % 12 + 1, mm = String(m).padStart(2, "0");
    return R.between(e, `${y}-${mm}-01`, `${y}-${mm}-${new Date(y, m, 0).getDate()}`).map(x => x.date);
  }

  // Son tekrarın tarihi; süresizse null
  function lastDate(e) { return R.lastDate(e); }

  // today'e kadar (dahil) gerçekleşen tekrar sayısı; tek seferlikte tarihi geldiyse 1
  function processedCount(e, today) {
    return repeatOf(e) == null ? (e.date <= today ? 1 : 0) : R.countUntil(e, today);
  }

  // today'den sonraki ilk tekrarın tarihi; kalmadıysa (ya da tek seferlikse) null
  function nextDate(e, today) { return R.nextDate(e, today); }

  // TL'yle alınıp satılabilen: fon, hisse, döviz ve altın
  const tradable = code => !!market(code) || (BY_CODE.has(code) && code !== "TRY");

  // Alış ya da satışın TL tutarı (miktar × birim fiyat; alışta artı, satışta eksi); fiyatı yoksa null
  function tradeValue(e) {
    return tradable(e?.asset) && e.price > 0 && Number.isFinite(e.amount) ? round(e.amount * e.price, "TRY") : null;
  }

  // TL bakiyesine işlenen alış / satış tutarı (settle); işlenmiyorsa 0
  function settled(e) {
    return e?.settle === true ? tradeValue(e) ?? 0 : 0;
  }

  // Varlık → bakiye (yalnızca hareketi olan varlıklar). today verilmezse tekrarlayan hareketlerin yalnızca ilki sayılır.
  // spent: kartsız harcamaların ödenen kısmı varlık başına (taksit.js cashSpent); bakiyeden düşer.
  // TL bakiyesine işlenen fon / hisse alışı TL'den düşer, satışı TL'ye eklenir.
  function balances(entries, today, spent = {}) {
    const out = {};
    for (const e of entries) {
      if (!asset(e.asset) || !Number.isFinite(e.amount)) continue;
      const k = today ? processedCount(e, today) : 1;
      if (!k) { if (!(e.asset in out)) out[e.asset] = 0; continue; }
      out[e.asset] = round((out[e.asset] || 0) + e.amount * k, e.asset);
      const cash = settled(e);
      if (cash) out.TRY = round((out.TRY || 0) - cash * k, "TRY");
    }
    for (const [code, amount] of Object.entries(spent)) {
      if (asset(code) && Number.isFinite(amount) && amount) out[code] = round((out[code] || 0) - amount, code);
    }
    return out;
  }

  // Varlığın TL karşılığı; kuru bilinmiyorsa null
  function toTry(amount, code, rates) {
    const rate = code === "TRY" ? 1 : rates?.[code];
    return Number.isFinite(rate) && rate > 0 ? amount * rate : null;
  }

  // Bakiyelerin TL toplamı; kuru eksik varlık varsa missing'de
  function totalTry(bals, rates) {
    let total = 0;
    const missing = [];
    for (const [code, amount] of Object.entries(bals)) {
      const v = toTry(amount, code, rates);
      if (v == null) missing.push(code); else total += v;
    }
    return { total, missing };
  }

  // Fon / hisse pozisyonları, ortalama maliyetle: kod → { units, cost, realized }. Hareketler tarih sırasıyla; alış adet ×
  // fiyatı maliyete ekler, satış ortalama maliyetle düşer ve aradaki fark gerçekleşen kâra (realized) girer. Fiyatı
  // girilmemiş alış varsa ya da elde olandan fazlası satıldıysa maliyet bilinmez (cost null); pozisyon kapanınca
  // (adet 0) yeniden başlar. Tek seferlik hareketler gibi tarihi gelmemiş alış / satış da sayılır (balances).
  function positions(entries) {
    const out = {};
    const list = entries.filter(e => market(e.asset) && Number.isFinite(e.amount) && e.amount)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const e of list) {
      const p = out[e.asset] ??= { units: 0, cost: 0, realized: 0 };
      if (Math.abs(p.units) < 1e-9 && p.cost == null) p.cost = 0;   // kapanan pozisyon yeniden başlar
      if (e.amount > 0) {
        p.cost = p.cost != null && e.price > 0 ? p.cost + e.amount * e.price : null;
      } else {
        const sold = -e.amount;
        if (p.cost == null || sold > p.units + 1e-9) p.cost = p.realized = null;
        else {
          const avg = p.units > 0 ? p.cost / p.units : 0;
          if (e.price > 0 && p.realized != null) p.realized += sold * (e.price - avg);
          else p.realized = null;
          p.cost -= sold * avg;
        }
      }
      p.units = round(p.units + e.amount, e.asset);
    }
    for (const p of Object.values(out)) {
      if (p.cost != null) p.cost = Math.abs(p.units) < 1e-9 ? 0 : round(p.cost, "TRY");
      if (p.realized != null) p.realized = round(p.realized, "TRY");
    }
    return out;
  }

  // Arama için: küçük harf, Türkçe harfler ve aksanlar sade ("İŞ PORTFÖY" → "is portfoy")
  const fold = s => String(s ?? "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");

  // Fon araması (uygulama ve asistan): q'nun her kelimesi fonun kodunun ya da adındaki bir kelimenin başı olmalı. Kodu
  // tutan önce, sonra adında tam geçen kelimesi çok olan. list: [{ code: "AFT", name, … }] → aynı nesnelerden en fazla limit
  function matchFunds(list, q, limit = 20) {
    const words = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const x of list) {
      const code = fold(x.code), name = fold(x.name).split(/[^a-z0-9]+/);
      let exact = 0, ok = true;
      for (const w of words) {
        if (code === w || name.includes(w)) exact++;
        else if (!code.startsWith(w) && !name.some(n => n.startsWith(w))) { ok = false; break; }
      }
      if (ok) out.push({ x, rank: (code === words[0] ? 100 : 0) + exact });
    }
    return out.sort((a, b) => b.rank - a.rank || (a.x.code < b.x.code ? -1 : 1)).slice(0, limit).map(o => o.x);
  }

  // ---------- Nakit ----------
  // Nakit tanımı (Özet'teki Nakit grafiği): nakit sayılan varlıkların listesi. Varlık kodları ("TRY", "USD", "FON:ALE",
  // "BIST:THYAO") ve "MMF": ana para biriminin (TL) bütün para piyasası fonları. Varsayılan TL ve para piyasası fonları.
  const MMF = "MMF";
  const CASH_DEFAULT = ["TRY", MMF];

  // Para piyasası fonu: TEFAS'ta adında "para piyasası" geçen yatırım fonu (aynı gün nakde döner, T+0). Hepsi TL'dir;
  // emeklilik fonları (BES) nakit sayılmaz. fund: { name, kind } (fiyatla gelir: /api/fiyat, /api/fonlar)
  function moneyMarket(fund) {
    return fund?.kind === "YAT" && /(^|[^a-z])para piyasasi([^a-z]|$)/.test(fold(fund.name));
  }

  // Kayıtlı tanım → geçerli liste (geçersiz ögeler atılır); liste değilse varsayılan
  function cashDef(list) {
    if (!Array.isArray(list)) return [...CASH_DEFAULT];
    return [...new Set(list.filter(c => c === MMF || BY_CODE.has(c) || market(c)))];
  }

  // Varlık nakit mi; fund fonun TEFAS bilgisi (para piyasası fonu mu diye)
  function isCash(code, def = CASH_DEFAULT, fund = null) {
    return def.includes(code) || (def.includes(MMF) && market(code)?.market === "FON" && moneyMarket(fund));
  }

  const api = {
    ASSETS, MARKETS, MAX_REPEAT, asset, market, marketCode, tradable, round, repeatOf, occurrenceDate, occurrencesIn, lastDate,
    processedCount, nextDate, tradeValue, settled, balances, positions, toTry, totalTry, matchFunds,
    MMF, CASH_DEFAULT, moneyMarket, cashDef, isCash,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Varlik = api;
})(this);

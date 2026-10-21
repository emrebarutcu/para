// ---------- Varlıklar: TL, dolar, euro, gram altın (DOM'dan bağımsız) ----------
// Hareket: { id, personId, asset, amount, desc, date: "YYYY-MM-DD", repeat? }. amount varlığın kendi biriminde, girişte
// artı, çıkışta eksidir; bakiye hareketlerin toplamıdır. TL karşılığı güncel kurla hesaplanır (kurlar: /api/kur).
// repeat / every / unit: hareket date'ten başlayıp her N gün / hafta / ayda bir yinelenir (tekrar.js). N kez ya da
// süresiz; yoksa tek seferliktir. Tekrarlayan hareketin yalnızca tarihi gelmiş tekrarları bakiyeye girer.
(function (root) {
  const ASSETS = [
    { code: "TRY", name: "Türk lirası", short: "TL", symbol: "₺", digits: 2 },
    { code: "USD", name: "Dolar", short: "Dolar", symbol: "$", digits: 2 },
    { code: "EUR", name: "Euro", short: "Euro", symbol: "€", digits: 2 },
    { code: "GAU", name: "Gram altın", short: "Altın", symbol: "gr", digits: 3 },
  ];
  const BY_CODE = new Map(ASSETS.map(a => [a.code, a]));

  function asset(code) { return BY_CODE.get(code) ?? null; }

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

  // today'e kadar (dahil) gerçekleşen tekrar sayısı. Tek seferlik hareket tarihinden bağımsız sayılır.
  function processedCount(e, today) {
    return repeatOf(e) == null ? 1 : R.countUntil(e, today);
  }

  // today'den sonraki ilk tekrarın tarihi; kalmadıysa (ya da tek seferlikse) null
  function nextDate(e, today) { return R.nextDate(e, today); }

  // Varlık → bakiye (yalnızca hareketi olan varlıklar). today verilmezse tekrarlayan hareketlerin yalnızca ilki sayılır.
  // spent: kartsız harcamaların ödenen kısmı varlık başına (taksit.js cashSpent); bakiyeden düşer.
  function balances(entries, today, spent = {}) {
    const out = {};
    for (const e of entries) {
      if (!asset(e.asset) || !Number.isFinite(e.amount)) continue;
      const k = today ? processedCount(e, today) : 1;
      if (!k) { if (!(e.asset in out)) out[e.asset] = 0; continue; }
      out[e.asset] = round((out[e.asset] || 0) + e.amount * k, e.asset);
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

  const api = { ASSETS, MAX_REPEAT, asset, round, repeatOf, occurrenceDate, occurrencesIn, lastDate, processedCount, nextDate, balances, toTry, totalTry };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Varlik = api;
})(this);

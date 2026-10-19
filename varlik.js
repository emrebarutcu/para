// ---------- Varlıklar: TL, dolar, euro, gram altın (DOM'dan bağımsız) ----------
// Hareket: { id, personId, asset, amount, desc, date: "YYYY-MM-DD", repeat? }. amount varlığın kendi biriminde, girişte
// artı, çıkışta eksidir; bakiye hareketlerin toplamıdır. TL karşılığı güncel kurla hesaplanır (kurlar: /api/kur).
// repeat: hareket date'ten başlayıp her ay aynı gün yinelenir (ay kısaysa son güne çekilir). N ≥ 2: N kez, 0: süresiz.
// Yoksa (ya da 1) tek seferliktir. Tekrarlayan hareketin yalnızca tarihi gelmiş tekrarları bakiyeye girer.
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

  const MAX_REPEAT = 600;   // en fazla tekrar (50 yıl)

  // Geçerli repeat değeri: 0 (süresiz) ya da 2…MAX_REPEAT; tek seferlik için null
  function repeatOf(e) {
    const n = e?.repeat;
    return Number.isInteger(n) && (n === 0 || (n >= 2 && n <= MAX_REPEAT)) ? n : null;
  }

  // "YYYY-MM-DD" ↔ ay sırası (yıl × 12 + ay) ve gün
  function parse(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ""));
    return m ? { idx: Number(m[1]) * 12 + Number(m[2]) - 1, day: Number(m[3]) } : null;
  }
  function dateAt(idx, day) {
    const y = Math.floor(idx / 12), m = idx % 12;
    const d = Math.min(day, new Date(y, m + 1, 0).getDate());
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // k. tekrarın tarihi (0 tabanlı)
  function occurrenceDate(e, k) {
    const d = parse(e.date);
    return d ? dateAt(d.idx + k, d.day) : e.date;
  }

  // Son tekrarın tarihi; süresizse null
  function lastDate(e) {
    const n = repeatOf(e);
    return n === 0 ? null : occurrenceDate(e, (n ?? 1) - 1);
  }

  // today'e kadar (dahil) gerçekleşen tekrar sayısı. Tek seferlik hareket tarihinden bağımsız sayılır.
  function processedCount(e, today) {
    const n = repeatOf(e);
    if (n == null) return 1;
    const d = parse(e.date), t = parse(today);
    if (!d || !t) return 0;
    const k = Math.max(t.idx - d.idx + (today >= dateAt(t.idx, d.day) ? 1 : 0), 0);   // bu ayınki geldiyse +1
    return n === 0 ? k : Math.min(k, n);
  }

  // today'den sonraki ilk tekrarın tarihi; kalmadıysa (ya da tek seferlikse) null
  function nextDate(e, today) {
    const n = repeatOf(e);
    if (n == null) return null;
    const k = processedCount(e, today);
    return n === 0 || k < n ? occurrenceDate(e, k) : null;
  }

  // Varlık → bakiye (yalnızca hareketi olan varlıklar). today verilmezse tekrarlayan hareketlerin yalnızca ilki sayılır.
  function balances(entries, today) {
    const out = {};
    for (const e of entries) {
      if (!asset(e.asset) || !Number.isFinite(e.amount)) continue;
      const k = today ? processedCount(e, today) : 1;
      if (!k) { if (!(e.asset in out)) out[e.asset] = 0; continue; }
      out[e.asset] = round((out[e.asset] || 0) + e.amount * k, e.asset);
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

  const api = { ASSETS, MAX_REPEAT, asset, round, repeatOf, occurrenceDate, lastDate, processedCount, nextDate, balances, toTry, totalTry };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Varlik = api;
})(this);

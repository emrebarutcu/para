// ---------- Varlıklar: TL, dolar, euro, gram altın (DOM'dan bağımsız) ----------
// Hareket: { id, personId, asset, amount, desc, date: "YYYY-MM-DD" }. amount varlığın kendi biriminde, girişte artı,
// çıkışta eksidir; bakiye hareketlerin toplamıdır. TL karşılığı güncel kurla hesaplanır (kurlar: /api/kur).
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

  // Varlık → bakiye (yalnızca hareketi olan varlıklar)
  function balances(entries) {
    const out = {};
    for (const e of entries) {
      if (!asset(e.asset) || !Number.isFinite(e.amount)) continue;
      out[e.asset] = round((out[e.asset] || 0) + e.amount, e.asset);
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

  const api = { ASSETS, asset, round, balances, toTry, totalTry };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Varlik = api;
})(this);

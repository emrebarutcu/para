// ---------- Tekrar: her N gün / hafta / ayda bir (DOM'dan bağımsız) ----------
// Varlık hareketi (varlik.js) ve harcama (taksit.js) aynı alanlarla tekrarlar: { date: "YYYY-MM-DD", repeat?, every?, unit? }
//   repeat: N ≥ 2 → N kez, 0 → süresiz; yoksa (ya da 1) tek seferlik
//   every:  kaç birimde bir (varsayılan 1), unit: "day" | "week" | "month" (varsayılan "month")
// Aylık tekrar date'in gününde yinelenir; ay kısaysa son güne çekilir (31 → 28 Şubat), sonraki ay yine 31'idir.
(function (root) {
  const MAX_REPEAT = 600;   // en fazla tekrar
  const MAX_EVERY = 99;     // en fazla "99 günde / haftada / ayda bir"
  const UNITS = ["day", "week", "month"];
  const UNIT_NAMES = { day: "gün", week: "hafta", month: "ay" };
  const UNIT_IN = { day: "günde", week: "haftada", month: "ayda" };   // "2 haftada bir"

  // Geçerli repeat değeri: 0 (süresiz) ya da 2…MAX_REPEAT; tek seferlik için null
  function count(x) {
    const n = x?.repeat;
    return Number.isInteger(n) && (n === 0 || (n >= 2 && n <= MAX_REPEAT)) ? n : null;
  }
  function every(x) {
    const n = x?.every;
    return Number.isInteger(n) && n >= 1 && n <= MAX_EVERY ? n : 1;
  }
  function unit(x) { return UNITS.includes(x?.unit) ? x.unit : "month"; }

  // Tekrar kuralı: { n (0 süresiz / N kez), every, unit }; tek seferlikse null
  function rule(x) {
    const n = count(x);
    return n == null ? null : { n, every: every(x), unit: unit(x) };
  }

  // Kayda yazılacak alanlar: varsayılanlar (1, "month") yazılmaz; tek seferlikte hiçbiri
  function fields(r) {
    const n = count(r);
    if (n == null) return {};
    const out = { repeat: n };
    if (every(r) !== 1) out.every = every(r);
    if (unit(r) !== "month") out.unit = unit(r);
    return out;
  }

  // "YYYY-MM-DD" → { y, m (0 tabanlı), d }; gün sırası (UTC, yaz saatinden bağımsız) ve geri
  function parse(key) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(key ?? ""));
    return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
  }
  const pad = n => String(n).padStart(2, "0");
  function dayNum(key) {
    const p = parse(key);
    return p ? Math.round(Date.UTC(p.y, p.m, p.d) / 864e5) : null;
  }
  function fromDayNum(n) {
    const d = new Date(n * 864e5);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  // Ay sırası (yıl × 12 + ay) ve gün → tarih; ay kısaysa son güne çekilir
  function monthDate(idx, day) {
    const y = Math.floor(idx / 12), m = idx % 12;
    return `${y}-${pad(m + 1)}-${pad(Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()))}`;
  }
  const stepDays = r => (r.unit === "week" ? 7 : 1) * r.every;

  // k. tekrarın tarihi (0 tabanlı); tek seferlikte k = 0 kaydın tarihidir
  function dateAt(x, k) {
    const r = rule(x) ?? { every: 1, unit: "month" };
    const p = parse(x.date);
    if (!p) return x.date;
    if (r.unit === "month") return monthDate(p.y * 12 + p.m + k * r.every, p.d);
    return fromDayNum(dayNum(x.date) + k * stepDays(r));
  }

  // day'e kadar (dahil) gelen tekrar sayısı (N kezde en çok N). Tek seferlikte tarihi geldiyse 1.
  function countUntil(x, day) {
    const p = parse(x.date), t = parse(day);
    if (!p || !t) return 0;
    const r = rule(x);
    if (!r) return x.date <= day ? 1 : 0;
    if (day < x.date) return 0;
    let k;
    if (r.unit === "month") {
      const months = (t.y * 12 + t.m) - (p.y * 12 + p.m);
      k = Math.floor(months / r.every);
      if (dateAt(x, k) <= day) k++;   // o ayınki geldiyse
    } else {
      k = Math.floor((dayNum(day) - dayNum(x.date)) / stepDays(r)) + 1;
    }
    return r.n ? Math.min(k, r.n) : k;
  }

  // from…to (dahil) arasındaki tekrarlar: [{ k, date }]
  function between(x, from, to) {
    const r = rule(x), out = [];
    if (!parse(x.date) || from > to) return out;
    if (!r) return x.date >= from && x.date <= to ? [{ k: 0, date: x.date }] : out;
    const start = from > x.date ? countUntil(x, fromDayNum(dayNum(from) - 1)) : 0;
    for (let k = start; !r.n || k < r.n; k++) {
      const date = dateAt(x, k);
      if (date > to) break;
      if (date >= from) out.push({ k, date });
    }
    return out;
  }

  // Son tekrarın tarihi; süresizse null
  function lastDate(x) {
    const r = rule(x);
    if (r && r.n === 0) return null;
    return dateAt(x, (r?.n ?? 1) - 1);
  }

  // today'den sonraki ilk tekrarın tarihi; kalmadıysa (ya da tek seferlikse) null
  function nextDate(x, today) {
    const r = rule(x);
    if (!r) return null;
    const k = countUntil(x, today);
    return r.n === 0 || k < r.n ? dateAt(x, k) : null;
  }

  // Ayda ortalama kaç kez (ör. haftada bir ≈ 4,35); aylık karşılık için
  function perMonth(x) {
    const r = rule(x);
    if (!r) return 0;
    return r.unit === "month" ? 1 / r.every : 30.4375 / stepDays(r);
  }

  // "Ayda bir", "Haftada bir", "Günde bir", "2 ayda bir", "3 haftada bir"; tek seferlikse ""
  function label(x) {
    const r = rule(x);
    if (!r) return "";
    const s = `${r.every === 1 ? "" : r.every + " "}${UNIT_IN[r.unit]} bir`;
    return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
  }

  // Tekrarın kısa birimi: "/ay", "/hafta", "/gün" (her N'de birse "/2 ay")
  function per(x) {
    const r = rule(x);
    return r ? `/${r.every === 1 ? "" : r.every + " "}${UNIT_NAMES[r.unit]}` : "";
  }

  const api = { MAX_REPEAT, MAX_EVERY, UNITS, UNIT_NAMES, UNIT_IN, count, every, unit, rule, fields, dateAt, countUntil, between, lastDate, nextDate, perMonth, label, per };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Tekrar = api;
})(this);

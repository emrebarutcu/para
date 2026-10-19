// ---------- Taksit / nakit akışı hesapları (DOM'dan bağımsız) ----------
// Kartlı harcama: harcama tarihi kartın kesim gününe göre bir ekstreye girer, ekstre
// kartın son ödeme gününde ödenir; taksitler sonraki ekstrelere birer ay kayarak düşer.
// Nakit harcama: harcama gününde ödenir (taksitliyse sonraki aylarda aynı gün).
(function (root) {
  const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const CASH = "nakit";   // kartsız harcamaların seri / grup anahtarı

  // Ay aritmetiği tek bir tamsayı üzerinden: "2026-09" ↔ 2026 * 12 + 8
  function monthIndex(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    return y * 12 + m - 1;
  }
  function monthKey(idx) {
    return `${Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, "0")}`;
  }
  function monthName(idx) { return MONTHS[idx % 12]; }
  function monthShort(idx) { return MONTHS_SHORT[idx % 12]; }
  function yearOf(idx) { return Math.floor(idx / 12); }
  function daysInMonth(idx) { return new Date(yearOf(idx), idx % 12 + 1, 0).getDate(); }

  // Ayın verilen günü; ay kısaysa son güne çekilir (31 → 28 Şubat)
  function dayOf(idx, day) { return Math.min(day, daysInMonth(idx)); }

  function dateKey(idx, day) {
    return `${monthKey(idx)}-${String(dayOf(idx, day)).padStart(2, "0")}`;
  }

  // "YYYY-MM-DD" → { idx, day }
  function parseDate(s) {
    const m = String(s ?? "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    return { idx: Number(m[1]) * 12 + Number(m[2]) - 1, day: Number(m[3]) };
  }

  function toDate(key) {
    const d = parseDate(key);
    return new Date(yearOf(d.idx), d.idx % 12, d.day);
  }

  function todayKey(now = new Date()) {
    return dateKey(now.getFullYear() * 12 + now.getMonth(), now.getDate());
  }

  // ---------- Kart ----------
  // { id, name, limit, cutoffDay, dueDay, color }

  // Harcamanın girdiği ekstrenin kesim ayı (kesim günü dahil)
  function statementIndex(card, date) {
    const d = parseDate(date);
    return d.day <= dayOf(d.idx, card.cutoffDay) ? d.idx : d.idx + 1;
  }

  // Kesim ayındaki ekstrenin ödendiği ay: son ödeme günü kesimden sonraysa aynı ay
  function dueIndex(card, statementIdx) {
    return statementIdx + (card.dueDay > card.cutoffDay ? 0 : 1);
  }

  // ---------- Harcama ----------
  // { id, personId, cardId, desc, total, count, date?: "YYYY-MM-DD", firstDue?: "YYYY-MM", planCount? }
  // date: harcama tarihi. Tarihi bilinmeyen (Excel'den gelen) kayıtlarda firstDue kalan ilk taksitin
  // ödendiği ay, count/total kalan taksitler, planCount alışverişin asıl taksit sayısıdır.
  function perInstallment(p) { return p.total / p.count; }
  function planLength(p)     { return Math.max(p.planCount || 0, p.count); }
  function originalTotal(p)  { return perInstallment(p) * planLength(p); }

  // Ödemeler: [{ idx (ödeme ayı), key ("YYYY-MM-DD"), no (1 tabanlı), amount }]
  function payments(p, card) {
    const amount = perInstallment(p);
    const d = parseDate(p.date);
    let first, day;
    if (card) {
      first = d ? dueIndex(card, statementIndex(card, p.date)) : monthIndex(p.firstDue);
      day = card.dueDay;
    } else {
      first = d ? d.idx : monthIndex(p.firstDue);
      day = d ? d.day : 1;
    }
    const paid = planLength(p) - p.count;
    const out = [];
    for (let k = 0; k < p.count; k++) {
      out.push({ idx: first + k, key: dateKey(first + k, day), no: paid + k + 1, amount });
    }
    return out;
  }

  // fromIdx ayı ve sonrasında ödenecek taksit sayısı
  function remainingFrom(list, fromIdx) {
    return list.filter(x => x.idx >= fromIdx).length;
  }

  // Bugün ve sonrasında ödenecek tutar — kart limitinden düşen kısım
  function outstanding(list, today) {
    return list.filter(x => x.key >= today).reduce((s, x) => s + x.amount, 0);
  }

  // Ay ay nakit akışı: her ay kişi / kart toplamları ve tarih + kart bazında ödemeler
  function buildCashflow(people, cards, purchases, fromIdx, toIdx) {
    const known = new Set(people.map(p => p.id));
    const cardById = new Map(cards.map(c => [c.id, c]));
    const cardOrder = new Map(cards.map((c, i) => [c.id, i]));
    const months = new Map();
    for (let idx = fromIdx; idx <= toIdx; idx++) {
      months.set(idx, { idx, total: 0, byPerson: {}, byCard: {}, events: new Map() });
    }

    for (const p of purchases) {
      if (!known.has(p.personId)) continue;
      const card = cardById.get(p.cardId);
      const cardKey = card ? card.id : CASH;
      for (const pay of payments(p, card)) {
        const m = months.get(pay.idx);
        if (!m) continue;
        const key = `${pay.key}|${cardKey}`;
        let ev = m.events.get(key);
        if (!ev) {
          ev = { key, date: pay.key, cardId: card ? card.id : null, total: 0, byPerson: {}, items: [] };
          m.events.set(key, ev);
        }
        ev.total += pay.amount;
        ev.byPerson[p.personId] = (ev.byPerson[p.personId] || 0) + pay.amount;
        ev.items.push({ purchase: p, no: pay.no, amount: pay.amount });
        m.total += pay.amount;
        m.byPerson[p.personId] = (m.byPerson[p.personId] || 0) + pay.amount;
        m.byCard[cardKey] = (m.byCard[cardKey] || 0) + pay.amount;
      }
    }

    const rank = id => (id == null ? Infinity : cardOrder.get(id));
    return [...months.values()].map(m => ({
      ...m,
      events: [...m.events.values()].sort((a, b) => a.date.localeCompare(b.date) || rank(a.cardId) - rank(b.cardId)),
    }));
  }

  // ---------- Kayıtlı veri ----------
  // { people: [{ id, name, color }], cards: [kart], installments: [harcama], entries: [varlık hareketi (varlik.js)] }
  const SERIES_COUNT = 8;   // styles.css'teki --s1…--s8

  function defaultState() {
    return {
      people: [{ id: "ben", name: "Ben", color: 0 }],
      cards: [],              // { id, name, limit, cutoffDay, dueDay, color, last4? }
      installments: [],       // harcamalar
      entries: [],            // TL / döviz / altın giriş ve çıkışları
    };
  }

  function validDay(v) {
    const d = Math.round(Number(v));
    return d >= 1 && d <= 31 ? d : null;
  }

  // Son ödeme günü bilinen ama kesimi bilinmeyen kart: kesim, yasal 10 günlük aralıkla tahmin edilir
  function defaultCard(dueDay, id, color) {
    const due = validDay(dueDay) || 22;
    return { id, name: "Kredi kartı", limit: 0, cutoffDay: ((due - 11 + 31) % 31) + 1, dueDay: due, color };
  }

  // Renk kişiye / karta bağlıdır, sırasına değil: yeni kayıt boştaki ilk rengi alır
  function nextColor(list) {
    const used = new Set(list.map(x => x.color));
    for (let c = 0; c < SERIES_COUNT; c++) if (!used.has(c)) return c;
    return list.length % SERIES_COUNT;
  }

  // Eski sürümlerden gelen veriyi bugünkü biçime taşır. Nakit akışı sürümünden kalan alanlar
  // (entriesByDate, recurring…) olduğu gibi kalır; buluta yazılmazlar (cashflow_data'da dururlar).
  function hydrate(data) {
    const s = { ...defaultState(), ...data };
    if (!Array.isArray(s.people)) s.people = defaultState().people;
    if (!Array.isArray(s.cards)) s.cards = [];
    if (!Array.isArray(s.installments)) s.installments = [];
    if (!Array.isArray(s.entries)) s.entries = [];

    // İlk taksit sürümü: tek kart (dueDay) ve "Ekstre" ayı → varsayılan kart + ilk ödeme ayı
    if (s.installments.some(i => i.statement)) {
      let card = s.cards[0];
      if (!card) { card = defaultCard(s.dueDay, "kart", 0); s.cards = [card]; }
      s.installments = s.installments.map(i => {
        if (!i.statement) return i;
        const { statement, planCount, ...rest } = i;
        return { ...rest, cardId: i.cardId || card.id, ...fromStatement({ statement, count: i.count, total: i.total, planCount }) };
      });
    }
    delete s.dueDay;
    return s;
  }

  // ---------- Excel içe aktarma ----------
  function normalize(s) {
    return String(s ?? "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
  }

  function titleCase(s) {
    return String(s).trim().split(/\s+/)
      .map(w => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1)).join(" ");
  }

  // Sayı ya da "4.821,12" / "4821.12" gibi metin
  function toNumber(v) {
    if (typeof v === "number") return v;
    const s = String(v ?? "").trim().replace(/[₺\s]/g, "");
    if (!s) return NaN;
    return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  }

  function monthFromName(s) {
    return MONTHS_SHORT.findIndex(n => s.startsWith(normalize(n)));
  }

  // "Eylül", "Eylül 2026", "2026-09" ya da Date → "YYYY-MM".
  // Yılsız ay adı içinde bulunulan yıla oturtulur; bir sonraki aydan ilerideyse geçen yıla.
  function parseStatement(value, today = new Date()) {
    if (value instanceof Date && !isNaN(value)) return monthKey(value.getFullYear() * 12 + value.getMonth());
    const s = normalize(value);
    const iso = s.match(/^(\d{4})-(\d{1,2})/);
    if (iso) return monthKey(Number(iso[1]) * 12 + Number(iso[2]) - 1);
    const mi = monthFromName(s);
    if (mi < 0) return null;
    const y = s.match(/\d{4}/);
    let year = y ? Number(y[0]) : today.getFullYear();
    if (!y && mi > today.getMonth() + 1) year -= 1;
    return monthKey(year * 12 + mi);
  }

  // Excel'deki satır: "Ekstre" ayından itibaren kalan "Taksit" sayısı; ekstre bir sonraki ay ödenir.
  // Önceden ödenmiş taksitlerin tarihi bilinmediği için yalnızca planCount olarak saklanır.
  function fromStatement({ statement, count, total, planCount }) {
    const item = { firstDue: monthKey(monthIndex(statement) + 1), count, total };
    if (planCount > count) item.planCount = planCount;
    return item;
  }

  // Bir sayfanın satırları → harcamalar. Başlığında "Ürün" olmayan sayfa (ör. özet) null döner.
  function parseSheetRows(rows, today) {
    const hi = rows.findIndex(r => Array.isArray(r) && r.some(c => normalize(c) === "ürün"));
    if (hi < 0) return null;
    const col = {};
    rows[hi].forEach((c, i) => { const k = normalize(c); if (k && !(k in col)) col[k] = i; });
    const cell = (r, name) => (name in col ? r[col[name]] : undefined);

    const items = [];
    let skipped = 0;
    for (const r of rows.slice(hi + 1)) {
      if (!Array.isArray(r)) continue;
      const desc = String(cell(r, "ürün") ?? "").trim();
      if (!desc) continue;
      const count = Math.round(toNumber(cell(r, "taksit")));
      const statement = parseStatement(cell(r, "ekstre"), today);
      const per = toNumber(cell(r, "taksit tutarı"));
      let total = toNumber(cell(r, "toplam"));
      if (!(total > 0) && per > 0) total = per * count;
      if (!statement || !(count > 0) || !(total > 0)) { skipped++; continue; }
      const original = toNumber(cell(r, "orijinal tutar"));
      const planCount = original > 0 ? Math.round(original / (total / count)) : 0;
      items.push({ desc, ...fromStatement({ statement, count, total, planCount }) });
    }
    return { items, skipped };
  }

  // Sayfalar → kişiler. Özet sayfasındaki "22 Ekim" gibi başlıklardan son ödeme günü okunur.
  function parseWorkbook(sheets, today = new Date()) {
    const people = [];
    let dueDay = null, skipped = 0;
    for (const { name, rows } of sheets) {
      const parsed = parseSheetRows(rows, today);
      if (parsed) {
        people.push({ name: titleCase(name), installments: parsed.items });
        skipped += parsed.skipped;
        continue;
      }
      for (const r of rows) {
        for (const c of Array.isArray(r) ? r : []) {
          const m = normalize(c).match(/^(\d{1,2}) (\S+)$/);
          if (dueDay == null && m && monthFromName(m[2]) >= 0 && Number(m[1]) <= 31) dueDay = Number(m[1]);
        }
      }
    }
    return { people, dueDay, skipped };
  }

  const api = {
    MONTHS, MONTHS_SHORT, CASH, SERIES_COUNT,
    monthIndex, monthKey, monthName, monthShort, yearOf, daysInMonth, dayOf, dateKey, parseDate, toDate, todayKey,
    statementIndex, dueIndex,
    perInstallment, planLength, originalTotal, payments, remainingFrom, outstanding, buildCashflow,
    defaultState, validDay, defaultCard, nextColor, hydrate,
    normalize, titleCase, parseStatement, fromStatement, parseSheetRows, parseWorkbook,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Taksit = api;
})(this);

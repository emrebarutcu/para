// ---------- Taksit / nakit akışı hesapları (DOM'dan bağımsız) ----------
// Kartlı harcama: harcama tarihi kartın kesim gününe göre bir ekstreye girer, ekstre
// kartın son ödeme gününde ödenir; taksitler sonraki ekstrelere birer ay kayarak düşer.
// Nakit harcama: harcama gününde ödenir (taksitliyse sonraki aylarda aynı gün).
(function (root) {
  const R = typeof module === "object" && module.exports ? require("./tekrar.js") : root.Tekrar;
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

  function addDays(key, n) {
    const d = toDate(key);
    d.setDate(d.getDate() + n);
    return dateKey(d.getFullYear() * 12 + d.getMonth(), d.getDate());
  }

  // ---------- Kart ----------
  // { id, name, limit, cutoffDay, dueDay, color, last4?, history?, trackSince?, trackOff? }
  // trackSince / trackOff: ekstre takibi (borc.js) — trackSince'tan sonra ödenen ekstreler ilk kişinin TL varlığından düşer.
  // history: kesim / son ödeme günü değişmeden önceki günler, [{ until: "YYYY-MM-DD", cutoffDay, dueDay }] until'e göre
  // sıralı. Kesimi until'e kadar olan ekstreler o günlerle kesilmiştir; sonrakiler bir sonraki günlerle (en son kartın).

  // Tek bir gün düzeninde harcamanın girdiği ekstrenin kesim ayı (kesim günü dahil)
  function statementIndex(terms, date) {
    const d = parseDate(date);
    return d.day <= dayOf(d.idx, terms.cutoffDay) ? d.idx : d.idx + 1;
  }

  // Kesim ayındaki ekstrenin ödendiği ay: son ödeme günü kesimden sonraysa aynı ay
  function dueIndex(terms, statementIdx) {
    return statementIdx + (terms.dueDay > terms.cutoffDay ? 0 : 1);
  }

  // Kartın dönemleri: her gün düzeninin ilk ekstresinin kesim ayı (from) ve son kesim sınırı (until; bugünkünde null)
  function periods(card) {
    let prev = null;
    return [...(card.history || []), { cutoffDay: card.cutoffDay, dueDay: card.dueDay, until: null }].map(t => {
      const from = prev == null ? -Infinity : firstAfter(t, prev);
      prev = t.until;
      return { cutoffDay: t.cutoffDay, dueDay: t.dueDay, until: t.until, from };
    });
  }

  // Kesimi until gününden sonra olan ilk ekstrenin kesim ayı
  function firstAfter(terms, until) {
    const u = parseDate(until);
    return dateKey(u.idx, terms.cutoffDay) > until ? u.idx : u.idx + 1;
  }

  const inPeriod = (t, idx) => t.until == null || dateKey(idx, t.cutoffDay) <= t.until;

  function statementAt(ps, period, idx) {
    const t = ps[period], due = dueIndex(t, idx);
    return { idx, period, cut: dateKey(idx, t.cutoffDay), dueIdx: due, due: dateKey(due, t.dueDay) };
  }

  // Harcamanın girdiği ekstre: { idx (kesim ayı), period, cut, dueIdx (ödeme ayı), due } — cut / due "YYYY-MM-DD"
  function statementOf(card, date, ps = periods(card)) {
    for (let i = 0; i < ps.length; i++) {
      const idx = Math.max(statementIndex(ps[i], date), ps[i].from);
      if (inPeriod(ps[i], idx)) return statementAt(ps, i, idx);
    }
  }

  // Bir sonraki ekstre; dönem bitince sonraki dönemin ilk ekstresi (hiç ekstresi olmayan dönem atlanır)
  function nextStatement(ps, s) {
    if (inPeriod(ps[s.period], s.idx + 1)) return statementAt(ps, s.period, s.idx + 1);
    for (let i = s.period + 1; ; i++) {
      if (inPeriod(ps[i], ps[i].from)) return statementAt(ps, i, ps[i].from);
    }
  }

  const sameTerms = (a, b) => a.cutoffDay === b.cutoffDay && a.dueDay === b.dueDay;

  // Art arda aynı günler tek dönemdir (ekstreler aylık sürer); boş history yazılmaz
  function withHistory(card, list) {
    const history = [];
    for (const h of list) {
      if (history.length && sameTerms(history[history.length - 1], h)) history[history.length - 1] = h;
      else history.push(h);
    }
    if (history.length && sameTerms(history[history.length - 1], card)) history.pop();
    const { history: _, ...rest } = card;
    return history.length ? { ...rest, history } : rest;
  }

  // Kesimi until'e kadar olan ekstreler bugünkü düzende kalır, sonrakiler yeni günlerle kesilir
  function retermCard(card, terms, until) {
    const history = [];
    for (const t of periods(card)) {
      const end = t.until == null || t.until > until ? until : t.until;
      history.push({ until: end, cutoffDay: t.cutoffDay, dueDay: t.dueDay });
      if (end === until) break;
    }
    return withHistory({ ...card, ...terms }, history);
  }

  // Kesim / son ödeme günü değişirken arada kalan harcamalar için seçenekler:
  //   old: açık ekstre (bugünkü harcamanın girdiği) eski günlerle kesilir, sonrakiler yeni günlerle
  //   new: kesilmiş ekstreler kalır, yeni günler bugünden başlar; açık ekstredekiler yeni günlere göre bir ekstreye girer
  //   fix: günler yanlış girilmişti; geçmiş ekstreler dahil bütün ödemeler yeni günlerle hesaplanır
  // cards: her seçenekte kart. choices: bu karttaki harcamalarda farklı sonuç veren seçenekler; birden azsa sormaya gerek
  // yoktur, card kullanılır. open: açık ekstre ve ona düşen ödemeler, next: "new" seçilirse bugünkü harcamanın girdiği ekstre.
  function termChoices(card, terms, purchases, today) {
    const fix = withHistory({ ...card, ...terms }, card.history || []);
    if (sameTerms(card, terms)) return { choices: [], card: fix };
    const open = statementOf(card, today);
    const cards = {
      old: retermCard(card, terms, open.cut),
      new: retermCard(card, terms, addDays(today, -1)),
      fix,
    };
    const mine = purchases.filter(p => p.cardId === card.id && parseDate(p.date));   // tarihsizler ödeme ayında kalır
    const plan = c => JSON.stringify(mine.map(p => payments(p, c).map(x => x.key)));
    const plans = { old: plan(cards.old), new: plan(cards.new), fix: plan(fix) };
    const choices = ["old", "new", "fix"].filter(k => k === "new" || plans[k] !== plans.new);
    if (choices.length < 2) return { choices: [], card: fix, cards };

    const due = mine.flatMap(p => payments(p, card)).filter(x => x.idx === open.dueIdx && x.key === open.due);
    return {
      choices, cards,
      open: { cut: open.cut, due: open.due, count: due.length, total: due.reduce((s, x) => s + x.amount, 0) },
      next: statementOf(cards.new, today),
    };
  }

  // ---------- Harcama ----------
  // { id, personId, cardId, desc, total, count, date?: "YYYY-MM-DD", firstDue?: "YYYY-MM", planCount?, asset?,
  //   repeat?, every?, unit? }
  // date: harcama tarihi. Tarihi bilinmeyen (Excel'den gelen) kayıtlarda firstDue kalan ilk taksitin
  // ödendiği ay, count/total kalan taksitler, planCount alışverişin asıl taksit sayısıdır.
  // asset: harcamanın varlığı (USD, EUR, GAU); yoksa TL. Döviz ve altın harcaması kartsız, peşindir; TL nakit akışına
  // girmez, yalnızca o varlığın bakiyesinden düşer. Kartsız (nakit) harcamalar ödendikçe varlığın bakiyesinden düşer.
  // repeat / every / unit: harcama date'ten başlayıp her N gün / hafta / ayda bir yinelenir (tekrar.js); her tekrar
  // kendi tarihiyle aynı karta, aynı taksitle ayrı bir alışveriştir.
  const FOREIGN = ["USD", "EUR", "GAU"];
  function assetOf(p) { return FOREIGN.includes(p?.asset) ? p.asset : "TRY"; }

  function perInstallment(p) { return p.total / p.count; }
  function planLength(p)     { return Math.max(p.planCount || 0, p.count); }
  function originalTotal(p)  { return perInstallment(p) * planLength(p); }

  // Tekrarlayan harcama (tarihi olan)
  function repeats(p) { return R.rule(p) != null && !!parseDate(p.date); }

  // Ödemeler: [{ idx (ödeme ayı), key ("YYYY-MM-DD"), no (1 tabanlı), amount }], tarihe göre sıralı.
  // Tekrarlayan harcamada her tekrarın ödemeleri; at: tekrarın tarihi, occ: kaçıncı tekrar (0 tabanlı). N kez
  // tekrarlayanın bütün tekrarları, süresizin until gününe (varsayılan bugün) kadar gelenleri.
  function payments(p, card, until) {
    if (!repeats(p)) return paymentsOnce(p, card);
    const end = R.rule(p).n ? R.lastDate(p) : until ?? todayKey();
    const out = [];
    for (const { k, date } of R.between(p, p.date, end)) {
      for (const x of paymentsOnce({ ...p, date }, card)) out.push({ ...x, at: date, occ: k });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.occ - b.occ));
  }

  function paymentsOnce(p, card) {
    const amount = perInstallment(p);
    const d = parseDate(p.date);
    const paid = planLength(p) - p.count;
    const out = [];
    if (card && d) {
      // Her taksit bir sonraki ekstreye düşer; kart günleri değiştiyse ekstre kendi günleriyle kesilip ödenir
      const ps = periods(card);
      for (let k = 0, s = statementOf(card, p.date, ps); k < p.count; k++, s = nextStatement(ps, s)) {
        out.push({ idx: s.dueIdx, key: s.due, no: paid + k + 1, amount });
      }
      return out;
    }
    let first, day;
    if (card) {
      first = monthIndex(p.firstDue);
      day = card.dueDay;
    } else {
      first = d ? d.idx : monthIndex(p.firstDue);
      day = d ? d.day : 1;
    }
    for (let k = 0; k < p.count; k++) {
      out.push({ idx: first + k, key: dateKey(first + k, day), no: paid + k + 1, amount });
    }
    return out;
  }

  // Süresiz tekrarlayan harcama: ödemeleri bitmez (akış ve özet ileriye bakarken hesaba katılır)
  function endless(p) { return repeats(p) && R.rule(p).n === 0; }

  // fromIdx ayı ve sonrasında ödenecek taksit sayısı
  function remainingFrom(list, fromIdx) {
    return list.filter(x => x.idx >= fromIdx).length;
  }

  // Bugün ve sonrasında ödenecek tutar — kart limitinden düşen kısım. Tekrarlayan harcamanın tarihi gelmemiş
  // tekrarları henüz karttan çekilmemiştir, sayılmaz.
  function outstanding(list, today) {
    return list.filter(x => x.key >= today && !(x.at > today)).reduce((s, x) => s + x.amount, 0);
  }

  // Kartsız (nakit) harcamaların today'e kadar (dahil) ödenen kısmı, varlık başına: { TRY: 1250, USD: 40 }.
  // Varlık bakiyesinden düşer (varlik.js balances). Kartı silinmiş harcama da nakit sayılır (buildCashflow gibi).
  function cashSpent(purchases, cards, today) {
    const ids = new Set(cards.map(c => c.id));
    const out = {};
    for (const p of purchases) {
      if (ids.has(p.cardId)) continue;
      const paid = payments(p, null, today).filter(x => x.key <= today).reduce((s, x) => s + x.amount, 0);
      if (paid) out[assetOf(p)] = (out[assetOf(p)] || 0) + paid;
    }
    return out;
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

    const until = dateKey(toIdx, 31);
    for (const p of purchases) {
      if (!known.has(p.personId) || assetOf(p) !== "TRY") continue;   // döviz / altın harcaması TL akışına girmez
      const card = cardById.get(p.cardId);
      const cardKey = card ? card.id : CASH;
      for (const pay of payments(p, card, until)) {
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
        ev.items.push({ purchase: p, no: pay.no, amount: pay.amount, at: pay.at });
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
  // { people: [{ id, name, color }], cards: [kart], installments: [harcama], entries: [varlık hareketi (varlik.js)],
  //   debts: [borç / alacak / kredi / ödeme (borc.js)] }
  const SERIES_COUNT = 8;   // styles.css'teki --s1…--s8

  function defaultState() {
    return {
      people: [{ id: "ben", name: "Ben", color: 0 }],
      cards: [],              // { id, name, limit, cutoffDay, dueDay, color, last4?, history?, trackSince?, trackOff? }
      installments: [],       // harcamalar
      entries: [],            // TL / döviz / altın giriş ve çıkışları
      debts: [],              // borçlar, alacaklar, krediler ve ödemeleri
    };
  }

  function validDay(v) {
    const d = Math.round(Number(v));
    return d >= 1 && d <= 31 ? d : null;
  }

  // Kartın eski günleri: geçersiz kayıtlar atılır, until'e göre sıralanır; boşsa null
  function validHistory(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const h of list) {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(h?.until ?? ""));
      const cutoffDay = validDay(h?.cutoffDay), dueDay = validDay(h?.dueDay);
      if (!m || m[2] < 1 || m[2] > 12 || m[3] < 1 || m[3] > 31 || !cutoffDay || !dueDay) continue;
      out.push({ until: dateKey(Number(m[1]) * 12 + Number(m[2]) - 1, Number(m[3])), cutoffDay, dueDay });
    }
    out.sort((a, b) => a.until.localeCompare(b.until));
    return out.length ? out : null;
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
    if (!Array.isArray(s.debts)) s.debts = [];
    s.cards = s.cards.map(c => {
      if (!c || typeof c !== "object" || !("history" in c)) return c;
      const { history, ...rest } = c;
      const h = validHistory(history);
      return h ? { ...rest, history: h } : rest;
    });

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
    addDays, statementIndex, dueIndex, periods, statementOf, nextStatement, retermCard, termChoices,
    FOREIGN, assetOf, perInstallment, planLength, originalTotal, repeats, payments, endless, remainingFrom, outstanding, cashSpent,
    buildCashflow,
    defaultState, validDay, validHistory, defaultCard, nextColor, hydrate,
    normalize, titleCase, parseStatement, fromStatement, parseSheetRows, parseWorkbook,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Taksit = api;
})(this);

// ---------- Nakit ve varlığın seyri (DOM'dan bağımsız) ----------
// Özet'teki Nakit grafiği (gün gün nakit bakiyesi ve hareketleri) ve Varlıklar'daki Varlığın seyri (her gün o güne
// kadarki kayıtlarla ve o günün kur / fiyatlarıyla Varlık). Web (app.js) ve iOS uygulaması (ios/js/kopru.js) aynı
// hesabı kullanır. Veri (state) uygulamanın biçimindedir (taksit.js hydrate); kurlar ve hangi varlığın nakit sayıldığı
// dışarıdan verilir (web'de Ayarlar → Nakit ve /api/kur, /api/fiyat).
(function (root) {
  const node = typeof module === "object" && module.exports;
  const T = node ? require("./taksit.js") : root.Taksit;
  const V = node ? require("./varlik.js") : root.Varlik;
  const R = node ? require("./tekrar.js") : root.Tekrar;
  const B = node ? require("./borc.js") : root.Borc;
  const P = node ? require("./para.js") : root.Para;   // ana para birimi (state.home); aşağıda "TL" odur
  const L = (node ? require("./dil.js") : root.Dil).t;   // görünen metinler

  const EPS = 0.005;   // kuruştan küçük fark yok sayılır (borc.js ile aynı)

  const known = state => new Set(state.people.map(p => p.id));
  function knownEntries(state) { const k = known(state); return state.entries.filter(e => k.has(e.personId)); }
  function knownPurchases(state) { const k = known(state); return state.installments.filter(p => k.has(p.personId)); }
  const cardById = (state, id) => state.cards.find(c => c.id === id);
  const cardName = (state, id) => cardById(state, id)?.name ?? "Nakit";
  const personName = (state, id) => state.people.find(p => p.id === id)?.name ?? "?";

  // Hareketin başlığı: açıklama; yoksa fon / hisse alışı ya da satışı, TL ile döviz / altın alışı ya da bozdurma
  function entryTitle(e) {
    const m = V.market(e.asset);
    if (e.desc) return e.desc;
    if (m) return e.amount > 0 ? L("{0} alışı", m.ticker) : L("{0} satışı", m.ticker);
    return V.settled(e) ? (e.amount > 0 ? L("{0} alışı", L(V.asset(e.asset).name)) : L("{0} bozdurma", L(V.asset(e.asset).name))) : "";
  }

  // Borç akışının başlığı
  function flowLabel(state, f) {
    return f.type === "share" ? L("{0} · sana ödedi", personName(state, f.payment.personId)) : B.flowText(f, state);
  }

  // Elle ödenen kart (ekstresini kullanıcı Ödendi ile kapatır) bugün elle modda mı
  function manualCard(c, today) {
    if (!c || !B.tracked(c) || !B.manual(c)) return false;
    const since = B.since(c, today);
    return (c.manualSince > since ? c.manualSince : since) <= today;
  }

  // Ay ay ödemeler (taksit.js buildCashflow); hesaba katılmayan kartın (borc.js tracked değil) ekstreleri toplamlara
  // girmez: ay, kişi ve kart toplamları onlarsız yeniden toplanır, olay ignored ile kalır
  function cashflow(state, fromIdx, toIdx) {
    const months = T.buildCashflow(state.people, state.cards, state.installments, fromIdx, toIdx, P.homeOf(state));
    const off = new Set(state.cards.filter(c => !B.tracked(c)).map(c => c.id));
    if (!off.size) return months;
    // Etkilenen ayda toplamlar sayılan olaylardan yeniden toplanır (çıkarma yuvarlama kaydırırdı)
    return months.map(m => {
      if (!m.events.some(ev => off.has(ev.cardId))) return m;
      const out = { ...m, total: 0, byPerson: {}, byCard: { ...m.byCard } };
      out.events = m.events.map(ev => {
        if (off.has(ev.cardId)) { delete out.byCard[ev.cardId]; return { ...ev, ignored: true }; }
        out.total += ev.total;
        for (const [pid, v] of Object.entries(ev.byPerson)) out.byPerson[pid] = (out.byPerson[pid] || 0) + v;
        return ev;
      });
      return out;
    });
  }

  // ── Nakit ──────────────────────────────────────────────────────────────────

  // Dönem: start "today" ise bugünden bir ay, gün ise ayın o gününden; shift dönem kaydırır
  function cashPeriod(today, start, shift) {
    const t = T.parseDate(today);
    let idx = t.idx, day = t.day;
    if (start !== "today") {
      day = Number(start);
      if (t.day < T.dayOf(idx, day)) idx--;
    }
    idx += shift;
    return { from: T.dateKey(idx, day), to: T.addDays(T.dateKey(idx + 1, day), -1) };
  }

  // Nakit sayılan varlıkların (opts.isCash; varsayılan TL ve para piyasası fonları) [from, to] günlerindeki gün sonu
  // bakiyesi ve hareketleri, TL. opts.rates: { TRY: 1, USD, …, "FON:AFT": fiyat }.
  // → { days: [{ date, balance, net, moves: [{ desc, value }] }], before, inSum, outSum, any, missing }
  function cashSeries(state, from, to, today, { rates, isCash }) {
    const lo = from < today ? from : today, hi = to > today ? to : today;
    const loIdx = T.parseDate(lo).idx, hiIdx = T.parseDate(hi).idx;
    const moves = new Map();   // tarih → [{ desc, value }]
    const add = (date, m) => {
      if (!moves.has(date)) moves.set(date, []);
      moves.get(date).push(m);
    };

    const r = rates;
    const home = P.homeOf(state);
    const missing = new Set();
    const toTry = (amount, code) => {
      const v = V.toTry(amount, code, r, home);
      if (v == null) missing.add(code);
      return v;
    };
    // Yalnızca nakit sayılan varlıklar; kart ekstreleri ve nakit taksitler TL'dir
    const cash = code => isCash(code);
    const lira = cash(home);
    let anchor = 0, any = false;   // anchor: bugüne kadarki nakit, TL (bugünkü hareketler dahil)
    for (const e of knownEntries(state)) {
      if (!V.asset(e.asset) || !Number.isFinite(e.amount)) continue;
      // TL bakiyesine işlenen fon / hisse alışı ya da satışı TL hareketidir. Fon da nakitse (para piyasası fonu) ikisi tek
      // harekettir: TL'den nakit fona geçiş nakdi yalnızca bugünkü fiyatla alış fiyatı arasındaki fark kadar değiştirir.
      const settled = lira ? -V.settled(e, home) : 0;
      const own = cash(e.asset);
      if (!own && !settled) continue;
      any = true;
      const value = own ? toTry(e.amount, e.asset) : 0;
      if (value == null && !settled) continue;
      const v = (value ?? 0) + settled;
      // Nakitten nakde alış / satışta kalan bugünkü değerle işlem tutarı arasındaki farktır
      const desc = settled && own ? L("{0} (fiyat farkı)", entryTitle(e)) : entryTitle(e);
      if (V.repeatOf(e) == null) {
        if (e.date <= today) anchor += v;
        if (e.date >= lo && e.date <= hi && Math.abs(v) > EPS) add(e.date, { desc, value: v });
        continue;
      }
      anchor += v * V.processedCount(e, today);
      for (const { date } of R.between(e, lo, hi)) add(date, { desc: e.desc, value: v });
    }
    // Kartsız harcamalar ödendikçe varlıktan düşmüştür (bugünkü dahil); kart ödemesi bugün henüz ödenmedi sayılır
    for (const [code, amount] of Object.entries(T.cashSpent(knownPurchases(state), state.cards, today, home))) if (cash(code)) anchor -= toTry(amount, code) ?? 0;
    // Borç etkileri de düşmüştür (takipteki kartların ödenen ekstreleri dahil: aşağıdaki kart hareketleri o günlerin
    // hareketidir, ikinci kez düşülmez)
    for (const [code, amount] of Object.entries(B.debtSpent(state, today))) if (cash(code)) anchor -= toTry(amount, code) ?? 0;
    const since = new Map(state.cards.filter(B.tracked).map(c => [c.id, B.since(c, today)]));
    for (const m of lira ? cashflow(state, loIdx, hiIdx) : []) {
      for (const ev of m.events) {
        // Hesaba katılmayan kartın ekstresi TL bakiyesinden düşmez
        if (ev.ignored || ev.date < lo || ev.date > hi || (since.has(ev.cardId) && ev.date >= since.get(ev.cardId))) continue;
        if (ev.date === today && ev.cardId) anchor -= ev.total;
        add(ev.date, { desc: ev.cardId ? L("{0} ekstresi", cardName(state, ev.cardId)) : L("Nakit ödemeler"), value: -ev.total });
      }
    }
    // Bugünkü planlı kart hareketi (bugün ödenecek ya da ödenmemiş ekstre) henüz düşmedi: gün sonunda düşer
    for (const mv of lira ? B.cardMoves(state, today, lo, hi, hi) : []) {
      const c = cardById(state, mv.cardId);
      if (mv.planned && mv.date === today) anchor += mv.amount;
      const desc = mv.type === "payment" ? L("{0} · kart ödemen", c.name) : mv.type === "prepay" ? L("{0} · erken ödeme", c.name)
        : mv.type === "unpaid" && manualCard(c, today)
          ? L("{0} · ödenmemiş ekstre", c.name) + (B.cardDebt(state, c, today).overdue > EPS ? " " + L("(gecikti)") : "") : L("{0} ekstresi", c.name);
      add(mv.date, { desc, value: mv.amount });
    }
    // Borç akışları kendi günlerinde; bugünkü kredi taksiti ve beklenen ödemeler kart ekstresi gibi gün sonunda düşer
    for (const f of B.allFlows(state, today, lo, hi)) {
      if (!cash(f.asset)) continue;
      any = true;
      if (f.type === "plan" && !f.paid && f.date === today && f.amount > 0) continue;   // gecikmiş / bugünkü tahsilat henüz yok
      const value = toTry(f.amount, f.asset);
      if (value == null) continue;
      if (f.date === today && !f.paid) anchor += value;
      add(f.date, { desc: flowLabel(state, f), value });
    }
    // Döviz / altın harcamaları TL akışında yok: kendi varlıklarından düşer
    for (const p of knownPurchases(state)) {
      const code = T.assetOf(p, home);
      if (code === home || !cash(code)) continue;
      for (const x of T.payments(p, cardById(state, p.cardId), hi)) {
        if (x.key < lo || x.key > hi) continue;
        const value = toTry(-x.amount, code);
        if (value != null) add(x.key, { desc: p.desc, value });
      }
    }

    const sum = date => (moves.get(date) || []).reduce((s, m) => s + m.value, 0);
    const r2 = v => Math.round(v * 100) / 100;
    const end = new Map([[today, anchor]]);   // gün sonu bakiyeleri
    for (let d = T.addDays(today, 1), v = anchor; d <= hi; d = T.addDays(d, 1)) end.set(d, v += sum(d));
    for (let d = today, v = anchor; d > lo; d = T.addDays(d, -1)) end.set(T.addDays(d, -1), v -= sum(d));

    const days = [];
    let net = 0, inSum = 0, outSum = 0;
    for (let d = from; d <= to; d = T.addDays(d, 1)) {
      const list = moves.get(d) || [];
      for (const m of list) {
        net += m.value;
        if (m.value > 0) inSum += m.value; else outSum -= m.value;
      }
      days.push({ date: d, balance: r2(end.get(d)), net: r2(net), moves: list });
    }
    const before = r2(end.get(from) - sum(from));   // dönem başlamadan önceki bakiye
    return { days, before, inSum: r2(inSum), outSum: r2(outSum), any: any || inSum > 0 || outSum > 0, missing: [...missing] };
  }

  // ── Varlığın seyri ─────────────────────────────────────────────────────────
  // Varlık (eldeki + alacak, borc.js totals) gün gün: her gün o güne kadarki kayıtlarla ve o günün kur ve fiyatlarıyla
  // (/api/gecmis: günlük kapanışlar; kapanışı olmayan gün öncekiyle). Bugün güncel kur ve fiyatla, Varlıklar'daki
  // toplamla aynıdır. Geçmişi alınamayan varlık bugünkü fiyatla sayılır (approx). Uzun dönemde birkaç günde bir nokta.
  const ASSET_RANGES = { "1m": 30, "3m": 91, "6m": 182, "1y": 365, all: null };
  const MAX_HISTORY_DAYS = 1830;   // en uzun dönem (5 yıl, /api/gecmis'in sınırı)
  const ASSET_POINTS = 180;

  // Elde tutulan (ana para birimi dışındaki) varlıklar: kayıtlarda geçen döviz, altın, fon ve hisseler
  function heldCodes(state) {
    const home = P.homeOf(state);
    const codes = new Set();
    for (const e of knownEntries(state)) if (e.asset !== home && V.asset(e.asset)) codes.add(e.asset);
    for (const p of knownPurchases(state)) if (T.assetOf(p, home) !== home) codes.add(T.assetOf(p, home));
    for (const d of state.debts) if (d.asset && d.asset !== home && V.asset(d.asset)) codes.add(d.asset);
    return [...codes].sort();
  }

  // Geçmişi istenen kodlar (/api/gecmis kapanışları TL'dir): elde tutulanlar (TL hariç) ve TL dışındaki ana para birimi
  function historyCodes(state) {
    const home = P.homeOf(state);
    const codes = heldCodes(state).filter(c => c !== "TRY");
    if (home !== "TRY" && !codes.includes(home)) codes.push(home);
    return codes.sort();
  }

  // Günün (ya da öncesinin son) kapanışı; dönem başından önceyse ilk kapanış; dizi boşsa null
  function priceAt(list, day) {
    if (!list?.length) return null;
    if (day < list[0][0]) return list[0][1];
    let lo = 0, hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid][0] <= day) lo = mid; else hi = mid - 1;
    }
    return list[lo][1];
  }

  // Verinin day günü sonundaki hali: o güne kadarki hareketler, harcamalar ve borç kayıtları (tarihsiz harcama ilk ödeme
  // ayından)
  function stateAt(state, day) {
    const month = day.slice(0, 7);
    return {
      ...state,
      entries: state.entries.filter(e => e.date <= day),
      installments: state.installments.filter(p => (p.date ? p.date <= day : !p.firstDue || p.firstDue <= month)),
      debts: state.debts.filter(d => d.date <= day),
    };
  }

  function firstRecordDate(state) {
    const dates = [...knownEntries(state).map(e => e.date), ...knownPurchases(state).map(p => p.date), ...state.debts.map(d => d.date)]
      .filter(d => T.parseDate(d));
    return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  }

  // Dönemin gün sayısı (range: 1m, 3m, 6m, 1y, all); kayıt yoksa null
  function assetSpan(state, range, today) {
    const first = firstRecordDate(state);
    if (!first) return null;
    const all = Math.round((T.toDate(today) - T.toDate(first)) / 864e5);
    return ASSET_RANGES[range] ?? Math.min(MAX_HISTORY_DAYS, Math.max(7, all));
  }

  // → { points: [{ date, value, parts: { lira, fx, market, receivable } }], approx: [bugünkü fiyatla sayılanlar], missing }
  // cur: bugünkü kurlar ve fiyatlar; series: kod → [["YYYY-MM-DD", kapanış], …]; pid: kişi (yoksa hepsi)
  function assetPoints(state, { today, span, codes, cur, series, pid }) {
    const home = P.homeOf(state);
    const held = heldCodes(state);
    const step = Math.max(1, Math.ceil(span / ASSET_POINTS));
    const days = [];
    for (let i = span; i > 0; i -= step) days.push(T.addDays(today, -i));
    days.push(today);
    const approx = new Set();
    let missing = [];
    const points = days.map(day => {
      // Kapanışlar TL'dir: ana para birimine o günün ana para birimi kapanışıyla çevrilir
      const r = { [home]: 1 };
      const base = day === today ? null : home === "TRY" ? 1 : priceAt(series[home], day);
      for (const c of held) {
        const lira = day === today ? null : c === "TRY" ? 1 : priceAt(series[c], day);
        const past = lira != null && base > 0 ? lira / base : null;
        if (day !== today && past == null && cur[c] != null) approx.add(c);
        const v = past ?? cur[c];
        if (v != null) r[c] = v;
      }
      const t = B.totals(stateAt(state, day), day, r, pid);
      if (day === today) missing = t.missing;
      const parts = { lira: 0, fx: 0, market: 0, receivable: t.receivable.total };
      for (const [c, amount] of Object.entries(t.balances)) {
        const v = V.toTry(amount, c, r, home);
        if (v == null) continue;
        if (c === home) parts.lira += v; else if (V.market(c)) parts.market += v; else parts.fx += v;
      }
      return { date: day, value: t.assets, parts };
    });
    return { points, approx: [...approx], missing };
  }

  const api = {
    knownEntries, knownPurchases, entryTitle, flowLabel, manualCard, cashflow, cashPeriod, cashSeries,
    ASSET_RANGES, MAX_HISTORY_DAYS, ASSET_POINTS, heldCodes, historyCodes, priceAt, stateAt, firstRecordDate, assetSpan, assetPoints,
  };
  if (node) module.exports = api;
  else root.Nakit = api;
})(this);

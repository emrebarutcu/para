// ---------- İçgörüler (DOM'dan bağımsız) ----------
// Kayıtlı veriden kurallarla hesaplanır (model gerekmez): ayın serbest nakdi, taksit yükünün gelire oranı, borcun
// biteceği ay, dolmak üzere olan limitler, yaklaşan ödeme sıçraması, bugün hangi kartla alışveriş yapılırsa ilk
// ödemenin en geç geleceği, düzenli ödemeler (abonelik), kategoride olağandışı artış, diğer kişilerin payı.
// Gelir ve sabit giderler varlık hareketlerinden gelir (tekrarlayan giriş / çıkış); döviz ve altın güncel kurla TL'dir.
// app.js (Özet) ve MCP (get_insights) kullanır.
(function (root) {
  const node = typeof module === "object" && module.exports;
  const T = node ? require("./taksit.js") : root.Taksit;
  const V = node ? require("./varlik.js") : root.Varlik;
  const K = node ? require("./kategori.js") : root.Kategori;

  const HORIZON = 6;          // serbest nakit ve taksit yükü için bakılan ay (bu ay dahil)
  const PEAK_MONTHS = 12;     // ödeme sıçraması için bakılan ay
  const PEAK_RATIO = 1.3;     // sonraki aylardan biri bu ayın ve ortalamanın bu katıysa sıçrama
  const LIMIT_WARN = 0.8;     // limitin bu kadarı dolduysa uyarı
  const CARD_GAP = 10;        // kartlar arasında ilk ödeme farkı en az bu kadar gün olunca öneri
  const TREND_RATIO = 1.3;    // kategoride bu ayın, önceki 3 ayın ortalamasına oranı
  const TREND_MIN = 500;      // ve en az bu kadar TL fark
  const SUB_MONTHS = 3;       // aynı işyerine en az bu kadar farklı ayda peşin ödeme → düzenli
  const SUB_SPREAD = 1.25;    // düzenli ödemenin tutarları arasında en fazla bu oran
  const UNCATEGORIZED = 3;    // son 3 ayda bu kadar kategorisiz harcama varsa öneri

  const money = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
  const fmt = n => money.format(Math.round(n || 0));
  const pct = r => `%${Math.round(r * 100)}`;
  const monthLong = idx => `${T.monthName(idx)} ${T.yearOf(idx)}`;
  const round = n => Math.round((n || 0) * 100) / 100;
  const days = (from, to) => Math.round((T.toDate(to) - T.toDate(from)) / 864e5);

  function known(state) {
    const ids = new Set(state.people.map(p => p.id));
    return {
      purchases: state.installments.filter(p => ids.has(p.personId)),
      entries: state.entries.filter(e => ids.has(e.personId) && V.asset(e.asset)),
    };
  }

  // Ayın girdi / çıktıları (TL): varlık girişleri gelir, çıkışları gider; kart / nakit ödemeleri ayrı.
  // Kuru bilinmeyen hareket sayılmaz (missing).
  function monthFlows(state, idx, rates, months) {
    const { entries } = known(state);
    let income = 0, outflow = 0, missing = false;
    for (const e of entries) {
      if (!V.occurrenceIn(e, idx)) continue;
      const v = V.toTry(e.amount, e.asset, rates);
      if (v == null) { missing = true; continue; }
      if (v > 0) income += v; else outflow -= v;
    }
    const payments = months.find(m => m.idx === idx)?.total || 0;
    return { idx, income, outflow, payments, net: income - outflow - payments, missing };
  }

  // Harcama tarihine göre ay ay kategori toplamları (taksitli alışveriş tamamıyla alındığı aya): idx → { kategori → TL }.
  // Kategorisiz harcama "" altında.
  function spendingByMonth(state, fromIdx, toIdx) {
    const out = new Map();
    for (let i = fromIdx; i <= toIdx; i++) out.set(i, {});
    for (const p of known(state).purchases) {
      const d = T.parseDate(p.date);
      if (!d || !out.has(d.idx)) continue;
      const key = K.valid(p.category) ? p.category : "";
      const m = out.get(d.idx);
      m[key] = (m[key] || 0) + T.originalTotal(p);
    }
    return out;
  }

  // Bir ayın kategori dağılımı ve önceki 3 ayın ortalamasıyla karşılaştırma (yalnızca o aylarda harcaması olan
  // kategoriler ortalamaya girer; hiç harcama olmayan ay ortalamayı düşürmez)
  function categoryBreakdown(state, idx) {
    const months = spendingByMonth(state, idx - 3, idx);
    const cur = months.get(idx);
    const prev = [idx - 3, idx - 2, idx - 1].map(i => months.get(i)).filter(m => Object.keys(m).length);
    const total = Object.values(cur).reduce((s, v) => s + v, 0);
    const rows = Object.entries(cur).map(([id, value]) => {
      const avg = prev.length ? prev.reduce((s, m) => s + (m[id] || 0), 0) / prev.length : null;
      return { id, name: K.category(id)?.name ?? "Kategorisiz", value, share: total ? value / total : 0, average: avg };
    }).sort((a, b) => b.value - a.value);
    return { idx, total, rows, compared: prev.length };
  }

  // Aynı işyerine her ay peşin ödenen (abonelik gibi) harcamalar ve tekrarlayan varlık çıkışları (kira, aidat)
  function recurring(state, today, rates) {
    const t = T.parseDate(today).idx;
    const groups = new Map();
    for (const p of known(state).purchases) {
      const d = T.parseDate(p.date);
      if (!d || T.planLength(p) !== 1 || d.idx < t - 5 || d.idx > t) continue;
      const key = K.keyOf(p.desc);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const out = [];
    for (const list of groups.values()) {
      const months = new Set(list.map(p => T.parseDate(p.date).idx));
      const amounts = list.map(p => p.total);
      if (months.size < SUB_MONTHS || Math.max(...amounts) > Math.min(...amounts) * SUB_SPREAD) continue;
      const last = list.reduce((a, b) => (a.date >= b.date ? a : b));
      out.push({ name: last.desc, monthly: last.total, kind: "purchase", category: last.category ?? null });
    }
    for (const e of known(state).entries) {
      if (e.amount >= 0 || V.repeatOf(e) == null || !V.nextDate(e, today)) continue;
      const v = V.toTry(-e.amount, e.asset, rates);
      if (v != null) out.push({ name: e.desc, monthly: v, kind: "entry", category: null });
    }
    return out.sort((a, b) => b.monthly - a.monthly);
  }

  // Bugün yapılacak alışverişin her kartta ilk ödemesi; ilk ödemesi en geç olan önce. Limiti dolu kart sonda.
  function cardTiming(state, today) {
    const { purchases } = known(state);
    return state.cards.map(c => {
      const s = T.statementOf(c, today);
      const used = T.outstanding(purchases.filter(p => p.cardId === c.id).flatMap(p => T.payments(p, c)), today);
      const available = c.limit > 0 ? c.limit - used : null;
      return { card: c, due: s.due, cut: s.cut, days: days(today, s.due), used, available, full: available != null && available <= 0 };
    }).sort((a, b) => a.full - b.full || b.days - a.days || (b.available ?? Infinity) - (a.available ?? Infinity));
  }

  // İçgörüler: [{ id, tone: "warn" | "info" | "good", title, text, action?, data }] önem sırasıyla
  function insights(state, { today, rates = null } = {}) {
    const t = T.parseDate(today).idx;
    const { purchases, entries } = known(state);
    const cashflow = T.buildCashflow(state.people, state.cards, state.installments, t, t + Math.max(HORIZON, PEAK_MONTHS));
    const out = [];
    const add = x => out.push(x);

    // Gelir: tekrarlayan bir giriş (maaş) ya da son iki ayda giriş varsa serbest nakit hesaplanır
    const hasIncome = entries.some(e => e.amount > 0 && (V.repeatOf(e) != null || (T.parseDate(e.date)?.idx ?? -1) >= t - 1));
    const flows = Array.from({ length: HORIZON }, (_, i) => monthFlows(state, t + i, rates, cashflow));
    if (hasIncome) {
      const short = flows.find(f => f.net < 0);
      if (short) {
        add({
          id: "acik", tone: "warn",
          title: short.idx === t ? "Bu ay açık veriyorsun" : `${T.monthName(short.idx)} ayında açık var`,
          text: `${monthLong(short.idx)}: girdi ${fmt(short.income)}, ödemeler ve giderler ${fmt(short.payments + short.outflow)} — ${fmt(-short.net)} eksik.`,
          data: { month: T.monthKey(short.idx), income: round(short.income), payments: round(short.payments), outflow: round(short.outflow), net: round(short.net) },
        });
      } else {
        const f = flows[0];
        add({
          id: "serbest", tone: "good", title: "Bu ay serbest nakit",
          text: `Girdi ${fmt(f.income)}, taksit ve giderler ${fmt(f.payments + f.outflow)}: ay sonunda ${fmt(f.net)} kalıyor.`,
          data: { month: T.monthKey(t), income: round(f.income), payments: round(f.payments), outflow: round(f.outflow), net: round(f.net) },
        });
      }
      const income = flows.reduce((s, f) => s + f.income, 0), paying = flows.reduce((s, f) => s + f.payments, 0);
      if (income > 0 && paying > 0) {
        const r = paying / income;
        add({
          id: "yuk", tone: r >= 0.5 ? "warn" : "info", title: `Taksit / gelir oranı ${pct(r)}`,
          text: `Önümüzdeki ${HORIZON} ayın ${fmt(income)} girdisinin ${fmt(paying)} kadarı şimdiden kart ve taksit ödemelerine ayrılmış.`
            + (r >= 0.5 ? " Yeni taksite girmeden önce bu oranın düşmesini beklemek iyi olabilir." : ""),
          data: { months: HORIZON, income: round(income), payments: round(paying), ratio: Math.round(r * 1000) / 1000 },
        });
      }
    } else if (purchases.length) {
      add({
        id: "gelir", tone: "info", title: "Gelirini ekle",
        text: "Maaşını Varlıklar'da her ay tekrarlayan giriş olarak eklersen ay sonunda ne kalacağını ve taksit yükünü hesaplarım.",
        action: { kind: "entry", label: "Gelir ekle" },
      });
    }

    // Limit
    for (const x of cardTiming(state, today)) {
      const c = x.card;
      if (!(c.limit > 0) || x.used / c.limit < LIMIT_WARN) continue;
      add({
        id: `limit-${c.id}`, tone: "warn", title: x.full ? `${c.name} limiti doldu` : `${c.name} limiti ${pct(x.used / c.limit)} dolu`,
        text: x.full ? `Bekleyen taksitler ${fmt(x.used)}, limit ${fmt(c.limit)}.` : `Kullanılabilir ${fmt(x.available)} kaldı.`,
        data: { card: c.name, used: round(x.used), limit: round(c.limit) },
      });
    }

    // Yaklaşan ödeme sıçraması
    const ahead = cashflow.filter(m => m.idx > t && m.idx <= t + PEAK_MONTHS);
    const current = cashflow.find(m => m.idx === t)?.total || 0;
    const avg = ahead.length ? ahead.reduce((s, m) => s + m.total, 0) / ahead.length : 0;
    const peak = ahead.reduce((a, m) => (!a || m.total > a.total ? m : a), null);
    if (peak && peak.total >= PEAK_RATIO * Math.max(current, avg) && peak.total - current >= 1000) {
      const count = peak.events.reduce((s, ev) => s + ev.items.length, 0);
      add({
        id: "sicrama", tone: "warn", title: `${T.monthName(peak.idx)} ayında ödemeler artıyor`,
        text: `${monthLong(peak.idx)}: ${fmt(peak.total)} (${count} taksit) — bu ay ${fmt(current)}. Önceden hazırlıklı ol.`,
        data: { month: T.monthKey(peak.idx), total: round(peak.total), current: round(current), installments: count },
      });
    }

    // Kategoride olağandışı artış (bu ay şimdiye kadar, önceki 3 ayın ortalamasına göre)
    const cats = categoryBreakdown(state, t);
    if (cats.compared >= 2) {
      const jump = cats.rows
        .filter(r => r.id && r.average != null && r.value >= TREND_RATIO * r.average && r.value - r.average >= TREND_MIN)
        .sort((a, b) => (b.value - b.average) - (a.value - a.average))[0];
      if (jump) {
        add({
          id: `kategori-${jump.id}`, tone: "warn", title: `${jump.name} harcaman arttı`,
          text: jump.average > 0
            ? `Bu ay şimdiden ${fmt(jump.value)}; önceki 3 ayın ortalaması ${fmt(jump.average)} (${pct(jump.value / jump.average - 1)} fazla).`
            : `Bu ay ${fmt(jump.value)}; önceki 3 ayda bu kategoride harcama yoktu.`,
          data: { category: jump.id, month: round(jump.value), average: round(jump.average) },
        });
      }
    }

    // Kart seçimi
    const timing = cardTiming(state, today).filter(x => !x.full);
    if (timing.length >= 2 && timing[0].days - timing[timing.length - 1].days >= CARD_GAP) {
      const best = timing[0], worst = timing[timing.length - 1];
      add({
        id: "kart", tone: "info", title: `Bugün ${best.card.name} ile öde`,
        text: `Bugünkü alışverişin ilk ödemesi ${best.card.name} ile ${best.days} gün sonra (${T.parseDate(best.due).day} ${T.monthShort(T.parseDate(best.due).idx)}), ${worst.card.name} ile ${worst.days} gün sonra.`,
        data: timing.map(x => ({ card: x.card.name, firstPayment: x.due, days: x.days, available: x.available == null ? null : round(x.available) })),
      });
    }

    // Düzenli ödemeler
    const subs = recurring(state, today, rates);
    if (subs.length) {
      const total = subs.reduce((s, x) => s + x.monthly, 0);
      const names = subs.slice(0, 3).map(x => x.name).join(", ") + (subs.length > 3 ? ` +${subs.length - 3}` : "");
      add({
        id: "duzenli", tone: "info", title: `Düzenli ödemeler: aylık ${fmt(total)}`,
        text: `${names}. Kullanmadığın abonelik varsa iptal etmek her ay bu kadar kazandırır.`,
        data: subs.map(x => ({ name: x.name, monthly: round(x.monthly), kind: x.kind })),
      });
    }

    // Diğer kişilerin bu ayki payı (aile üyeleri ya da kartını kullananlar)
    const month = cashflow.find(m => m.idx === t);
    const others = state.people.slice(1).filter(p => month?.byPerson[p.id] > 0);
    if (others.length) {
      const total = others.reduce((s, p) => s + month.byPerson[p.id], 0);
      add({
        id: "paylar", tone: "info", title: `Bu ay diğerlerinin payı ${fmt(total)}`,
        text: others.map(p => `${p.name} ${fmt(month.byPerson[p.id])}`).join(", ") + ". Kişiler listesinden her birine ödeme özetini gönderebilirsin.",
        action: { kind: "share", label: "Özet gönder" },
        data: others.map(p => ({ person: p.name, personId: p.id, amount: round(month.byPerson[p.id]) })),
      });
    }

    // Borcun biteceği ay
    const lastIdx = purchases.reduce((m, p) => {
      const pays = T.payments(p, state.cards.find(c => c.id === p.cardId));
      return pays.length ? Math.max(m, pays[pays.length - 1].idx) : m;
    }, -Infinity);
    if (lastIdx >= t) {
      const rest = T.buildCashflow(state.people, state.cards, state.installments, t, lastIdx).reduce((s, m) => s + m.total, 0);
      add({
        id: "bitis", tone: "good", title: `Son taksit: ${monthLong(lastIdx)}`,
        text: `Yeni taksit eklemezsen bu ay dahil ödenecek ${fmt(rest)} kaldı, sonra kart borcun biter.`,
        data: { lastMonth: T.monthKey(lastIdx), remaining: round(rest) },
      });
    }

    // Kategorisiz harcamalar
    const loose = purchases.filter(p => !K.valid(p.category) && (T.parseDate(p.date)?.idx ?? -Infinity) >= t - 2).length;
    if (loose >= UNCATEGORIZED) {
      add({
        id: "kategorisiz", tone: "info", title: `${loose} harcamanın kategorisi yok`,
        text: "Yapay zekâ harcamalarını kategorilere ayırabilir; elle seçtiklerinden de öğrenir.",
        action: { kind: "ai", label: "Kategorilere ayır" },
      });
    }

    const rank = { warn: 0, info: 1, good: 2 };
    return out.map((x, i) => ({ ...x, i })).sort((a, b) => rank[a.tone] - rank[b.tone] || a.i - b.i).map(({ i, ...x }) => x);
  }

  const api = { insights, monthFlows, categoryBreakdown, spendingByMonth, recurring, cardTiming, HORIZON };
  if (node) module.exports = api;
  else root.Icgoru = api;
})(this);

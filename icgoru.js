// ---------- İçgörüler (DOM'dan bağımsız) ----------
// Kayıtlı veriden kurallarla hesaplanır (model gerekmez): ayın serbest nakdi, taksit yükünün gelire oranı, borcun
// biteceği ay, dolmak üzere olan limitler, yaklaşan ödeme sıçraması, bugün hangi kartla alışveriş yapılırsa ilk
// ödemenin en geç geleceği, düzenli ödemeler (abonelik), kategoride olağandışı artış, geciken ya da yaklaşan borç
// ödemeleri (elle ödenen kartların geciken ekstreleri dahil), ödemesi gelen alacaklar (kart payları ve kişiler), diğer
// kişilerin payı (takipte kart yoksa).
// Gelir varlık girişlerinden, sabit giderler tekrarlayan harcamalardan ve çıkışlardan gelir; borç ve kredi taksitleri
// ödemelere girer, borç alınan para gelir sayılmaz (borc.js). Döviz ve altın güncel kurla TL'dir.
// app.js (Özet) ve MCP (get_insights) kullanır.
(function (root) {
  const node = typeof module === "object" && module.exports;
  const T = node ? require("./taksit.js") : root.Taksit;
  const V = node ? require("./varlik.js") : root.Varlik;
  const K = node ? require("./kategori.js") : root.Kategori;
  const R = node ? require("./tekrar.js") : root.Tekrar;
  const B = node ? require("./borc.js") : root.Borc;

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
  const DUE_SOON = 7;         // borç ödemesi bu kadar gün içindeyse uyarı
  const EPS = 0.005;

  const money = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
  const fmt = n => money.format(Math.round(n || 0));
  const pct = r => `%${Math.round(r * 100)}`;
  const monthLong = idx => `${T.monthName(idx)} ${T.yearOf(idx)}`;
  const round = n => Math.round((n || 0) * 100) / 100;
  const days = (from, to) => Math.round((T.toDate(to) - T.toDate(from)) / 864e5);
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  // Varlığın kendi biriminde: TL fmt ile, döviz "$100", altın "12,5 gr"
  function amountText(n, code) {
    if (code === "TRY") return fmt(n);
    const a = V.asset(code);
    const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: a.digits }).format(n);
    return code === "GAU" ? `${s} gr` : `${a.symbol}${s}`;
  }

  // "3 gün gecikti", "bugün", "yarın", "10 Ara, 3 gün sonra"
  function dueText(date, today, overdue) {
    if (overdue) return `${days(date, today)} gün gecikti`;
    const n = days(today, date);
    if (n <= 0) return "bugün";
    if (n === 1) return "yarın";
    const d = T.parseDate(date);
    return `${d.day} ${T.monthShort(d.idx)}, ${n} gün sonra`;
  }

  // Borcun karşı tarafı (isimlere ek getirilmez)
  function who(d) {
    return d.party || d.desc || (d.kind === "loan" ? "Kredi" : B.side(d) === "debt" ? "Borç" : "Alacak");
  }

  // Ödeme akışına giren harcamalar: hesaba katılmayan kartın (borc.js tracked değil; ör. eşinin kartı) harcamaları girmez
  function paying(state, list = state.installments) {
    const off = new Set(state.cards.filter(c => !B.tracked(c)).map(c => c.id));
    return off.size ? list.filter(p => !off.has(p.cardId)) : list;
  }

  function known(state) {
    const ids = new Set(state.people.map(p => p.id));
    return {
      purchases: state.installments.filter(p => ids.has(p.personId)),
      entries: state.entries.filter(e => ids.has(e.personId) && V.asset(e.asset)),
    };
  }

  // Ayın girdi / çıktıları (TL): varlık girişleri gelir; çıkışları, döviz / altın harcamaları ve borç verilen para gider;
  // kart / nakit ödemeleri ile borç ve kredi ödemeleri ayrı (payments). inflow borç alınan para, tahsilatlar ve kart payı
  // ödemeleridir: yalnızca bilgi içindir, net'e girmez (borç serbest nakit değildir). Kuru bilinmeyen hareket sayılmaz
  // (missing). today borçların bugünkü durumu içindir (geciken beklenen ödeme bugüne düşer).
  function monthFlows(state, idx, rates, months, today = T.todayKey()) {
    const { entries, purchases } = known(state);
    let income = 0, outflow = 0, inflow = 0, debtPaid = 0, missing = false;
    for (const e of entries) {
      const n = V.occurrencesIn(e, idx).length;
      if (!n) continue;
      const v = V.toTry(e.amount * n, e.asset, rates);
      if (v == null) { missing = true; continue; }
      if (v > 0) income += v; else outflow -= v;
    }
    for (const p of purchases) {
      if (T.assetOf(p) === "TRY") continue;
      const paid = T.payments(p, null, T.dateKey(idx, 31)).filter(x => x.idx === idx).reduce((s, x) => s + x.amount, 0);
      if (!paid) continue;
      const v = V.toTry(paid, p.asset, rates);
      if (v == null) missing = true; else outflow += v;
    }
    // Borç akışları: gelen para inflow; borç tarafında ödenen (ödeme, taksit, beklenen ödeme) payments; verilen borç gider
    for (const f of B.allFlows(state, today, T.dateKey(idx, 1), T.dateKey(idx, 31))) {
      const v = V.toTry(f.amount, f.asset, rates);
      if (v == null) { missing = true; continue; }
      if (v > 0) inflow += v;
      else if (B.side(f.debt) === "debt") debtPaid -= v;
      else outflow -= v;
    }
    const payments = (months.find(m => m.idx === idx)?.total || 0) + debtPaid;
    return { idx, income, outflow, inflow, payments, net: income - outflow - payments, missing };
  }

  // Harcama tarihine göre ay ay kategori toplamları (taksitli alışveriş tamamıyla alındığı aya, tekrarlayanın her
  // tekrarı kendi ayına): idx → { kategori → TL }. Kategorisiz harcama "" altında. Döviz / altın harcaması güncel
  // kurla TL'dir; kuru bilinmiyorsa sayılmaz.
  function spendingByMonth(state, fromIdx, toIdx, rates = null) {
    const out = new Map();
    for (let i = fromIdx; i <= toIdx; i++) out.set(i, {});
    const from = T.dateKey(fromIdx, 1), to = T.dateKey(toIdx, 31);
    for (const p of known(state).purchases) {
      if (!T.parseDate(p.date)) continue;
      const value = V.toTry(T.originalTotal(p), T.assetOf(p), rates);
      if (value == null) continue;
      const key = K.valid(p.category) ? p.category : "";
      for (const { date } of R.between(p, from, to)) {
        const m = out.get(T.parseDate(date).idx);
        m[key] = (m[key] || 0) + value;
      }
    }
    return out;
  }

  // Bir ayın kategori dağılımı ve önceki 3 ayın ortalamasıyla karşılaştırma (yalnızca o aylarda harcaması olan
  // kategoriler ortalamaya girer; hiç harcama olmayan ay ortalamayı düşürmez)
  function categoryBreakdown(state, idx, rates = null) {
    const months = spendingByMonth(state, idx - 3, idx, rates);
    const cur = months.get(idx);
    const prev = [idx - 3, idx - 2, idx - 1].map(i => months.get(i)).filter(m => Object.keys(m).length);
    const total = Object.values(cur).reduce((s, v) => s + v, 0);
    const rows = Object.entries(cur).map(([id, value]) => {
      const avg = prev.length ? prev.reduce((s, m) => s + (m[id] || 0), 0) / prev.length : null;
      return { id, name: K.category(id)?.name ?? "Kategorisiz", value, share: total ? value / total : 0, average: avg };
    }).sort((a, b) => b.value - a.value);
    return { idx, total, rows, compared: prev.length };
  }

  // Tekrarlayan harcamalar, aynı işyerine her ay peşin ödenen (abonelik gibi) harcamalar ve tekrarlayan varlık
  // çıkışları (kira, aidat); monthly aylık karşılıktır (haftada bir ≈ 4,35 kez)
  function recurring(state, today, rates) {
    const t = T.parseDate(today).idx;
    const groups = new Map(), out = [];
    for (const p of known(state).purchases) {
      if (!T.repeats(p) || !R.nextDate(p, today)) continue;
      const v = V.toTry(T.originalTotal(p) * R.perMonth(p), T.assetOf(p), rates);
      if (v != null) out.push({ name: p.desc, monthly: v, kind: "purchase", category: p.category ?? null });
    }
    for (const p of known(state).purchases) {
      const d = T.parseDate(p.date);
      if (!d || T.repeats(p) || T.assetOf(p) !== "TRY" || T.planLength(p) !== 1 || d.idx < t - 5 || d.idx > t) continue;
      const key = K.keyOf(p.desc);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    for (const list of groups.values()) {
      const months = new Set(list.map(p => T.parseDate(p.date).idx));
      const amounts = list.map(p => p.total);
      if (months.size < SUB_MONTHS || Math.max(...amounts) > Math.min(...amounts) * SUB_SPREAD) continue;
      const last = list.reduce((a, b) => (a.date >= b.date ? a : b));
      out.push({ name: last.desc, monthly: last.total, kind: "purchase", category: last.category ?? null });
    }
    for (const e of known(state).entries) {
      if (e.amount >= 0 || V.repeatOf(e) == null || !V.nextDate(e, today)) continue;
      const v = V.toTry(-e.amount * R.perMonth(e), e.asset, rates);
      if (v != null) out.push({ name: e.desc, monthly: v, kind: "entry", category: null });
    }
    return out.sort((a, b) => b.monthly - a.monthly);
  }

  // date günü yapılacak alışverişin her kartta ilk ödemesi; ilk ödemesi en geç olan önce. Limiti dolu kart sonda. Limit
  // kullanımı alışveriş gününe değil bugüne göredir (borc.js cardUsed: elle ödenen kartta ödenmemiş geçmiş ekstreler dahil)
  function cardTiming(state, date, today = T.todayKey()) {
    return state.cards.map(c => {
      const s = T.statementOf(c, date);
      const used = B.cardUsed(state, c, today);
      const available = c.limit > 0 ? c.limit - used : null;
      return { card: c, due: s.due, cut: s.cut, days: days(date, s.due), used, available, full: available != null && available <= 0 };
    }).sort((a, b) => a.full - b.full || b.days - a.days || (b.available ?? Infinity) - (a.available ?? Infinity));
  }

  // İçgörüler: [{ id, tone: "warn" | "info" | "good", title, text, action?, data }] önem sırasıyla
  function insights(state, { today, rates = null } = {}) {
    const t = T.parseDate(today).idx;
    const { purchases, entries } = known(state);
    const cashflow = T.buildCashflow(state.people, state.cards, paying(state), t, t + Math.max(HORIZON, PEAK_MONTHS));
    const out = [];
    const add = x => out.push(x);

    // Gelir: tekrarlayan bir giriş (maaş) ya da son iki ayda giriş varsa serbest nakit hesaplanır (borç alınan para
    // varlık girişi değildir, gelir sayılmaz)
    const hasIncome = entries.some(e => e.amount > 0 && (V.repeatOf(e) != null || (T.parseDate(e.date)?.idx ?? -1) >= t - 1));
    const flows = Array.from({ length: HORIZON }, (_, i) => monthFlows(state, t + i, rates, cashflow, today));
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
          text: `Önümüzdeki ${HORIZON} ayın ${fmt(income)} girdisinin ${fmt(paying)} kadarı şimdiden kart, kredi ve taksit ödemelerine ayrılmış.`
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

    // Borç ödemeleri (kişilere borç ve krediler; elle ödenende gecikebilir): geciken ya da DUE_SOON gün içinde gelen.
    // Elle ödenen kartların son ödeme günü geçmiş ödenmemiş ekstreleri de (yaklaşan ekstre kart ödemelerindedir)
    const debts = B.known(state);
    const active = debts.items.map(d => ({ d, st: B.status(d, debts.pays.get(d.id), today) })).filter(x => x.st.started && !x.st.done);
    const due = [];
    const item = (d, amount, date, overdue) => ({ ref: { debtId: d.id }, name: who(d), asset: d.asset, amount, date, overdue });
    for (const { d, st } of active) {
      if (B.side(d) !== "debt") continue;
      if (st.overdue > EPS) due.push(item(d, st.overdue, st.overdueSince, true));
      else if (st.next && days(today, st.next.date) <= DUE_SOON) due.push(item(d, st.next.amount, st.next.date, false));
    }
    for (const c of state.cards) {
      if (!B.tracked(c) || !B.manual(c)) continue;
      const cd = B.cardDebt(state, c, today, debts.cardPays.get(c.id) || []);
      if (cd.overdue > EPS) {
        due.push({ ref: { cardId: c.id }, name: `${c.name} ekstresi`, party: c.name, asset: "TRY", amount: cd.overdue, date: cd.overdueSince, overdue: true });
      }
    }
    if (due.length) {
      due.sort((a, b) => b.overdue - a.overdue || byDate(a, b));
      const late = due.filter(x => x.overdue).length;
      add({
        id: "borc-vade", tone: "warn",
        // Tek gecikmiş kart ekstresiyse başlıkta adı (kart ekstresi "borç" başlığıyla birine borç sanılmasın)
        title: late ? (late > 1 ? `${late} ödemen gecikti` : due[0].ref.cardId ? `${due[0].name} gecikti` : "Borç ödemen gecikti")
          : due.length > 1 ? `${due.length} borç ödemesi yaklaşıyor` : "Borç ödemesi yaklaşıyor",
        text: due.map(x => `${x.name} ${amountText(x.amount, x.asset)} (${dueText(x.date, today, x.overdue)})`).join(", ") + "."
          + (late ? " Ödediysen Borçlar'da satırındaki “Ödendi”ye dokun." : ""),
        action: { kind: "debt", label: "Borçlar" },
        data: due.map(x => ({ ...x.ref, party: x.party ?? x.name, amount: V.round(x.amount, x.asset), asset: x.asset, date: x.date, overdue: x.overdue })),
      });
    }

    // Limit
    for (const x of cardTiming(state, today, today)) {
      const c = x.card;
      if (!(c.limit > 0) || x.used / c.limit < LIMIT_WARN) continue;
      add({
        id: `limit-${c.id}`, tone: "warn", title: x.full ? `${c.name} limiti doldu` : `${c.name} limiti ${pct(x.used / c.limit)} dolu`,
        text: x.full ? `Kart borcu ${fmt(x.used)}, limit ${fmt(c.limit)}.` : `Kullanılabilir ${fmt(x.available)} kaldı.`,
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
    const cats = categoryBreakdown(state, t, rates);
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
    const timing = cardTiming(state, today, today).filter(x => !x.full);
    if (timing.length >= 2 && timing[0].days - timing[timing.length - 1].days >= CARD_GAP) {
      const best = timing[0], worst = timing[timing.length - 1];
      add({
        id: "kart", tone: "info", title: `Bugünkü alışverişi ${best.card.name} ile yap`,
        text: `Bugün ${best.card.name} ile harcarsan son ödeme günü ${best.days} gün sonra (${T.parseDate(best.due).day} ${T.monthShort(T.parseDate(best.due).idx)}); ${worst.card.name} ile harcarsan ${worst.days} gün sonra.`,
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

    // Alacaklar: takipteki kartlarda ödemesi gelmiş kart payları ve geciken alacaklar (kendiliğinden ödenen gecikmez)
    const shares = B.shares(state, today);
    const owed = state.people.map(p => shares.get(p.id)).filter(s => s?.dueNow > EPS)
      .map(s => ({ personId: s.person.id, name: s.person.name, amount: s.dueNow, asset: "TRY" }));
    const sharesDue = owed.reduce((sum, x) => sum + x.amount, 0);
    for (const { d, st } of active) {
      if (B.side(d) === "receivable" && st.overdue > EPS) {
        owed.push({ debtId: d.id, name: who(d), amount: st.overdue, asset: d.asset, date: st.overdueSince, overdue: true });
      }
    }
    if (owed.length) {
      const late = owed.filter(x => x.overdue).length;
      add({
        id: "alacak", tone: late ? "warn" : "info",
        title: late ? (late > 1 ? `${late} alacağın gecikti` : "Alacağın gecikti") : `Günü gelen alacağın ${fmt(sharesDue)}`,
        text: owed.map(x => `${x.name} ${amountText(x.amount, x.asset)} (${x.overdue ? dueText(x.date, today, true) : "kartındaki harcamaları"})`).join(", ")
          + ". Sana ödediyse Borçlar > Alacaklarım'da “Ödendi”ye dokun" + (sharesDue > 0 ? "; oradan hatırlatma da gönderebilirsin." : "."),
        action: { kind: "debt", label: "Alacaklar" },
        data: owed.map(x => ({ ...x, amount: V.round(x.amount, x.asset) })),
      });
    }

    // Diğer kişilerin bu ayki payı (aile üyeleri ya da kartını kullananlar); takipte kart varsa yerine alacak çıkar
    const month = cashflow.find(m => m.idx === t);
    const others = state.cards.some(B.tracked) ? [] : state.people.slice(1).filter(p => month?.byPerson[p.id] > 0);
    if (others.length) {
      const total = others.reduce((s, p) => s + month.byPerson[p.id], 0);
      add({
        id: "paylar", tone: "info", title: `Bu ay diğerlerinin payı ${fmt(total)}`,
        text: others.map(p => `${p.name} ${fmt(month.byPerson[p.id])}`).join(", ") + ". Kişiler listesinden her birine ödeme özetini gönderebilirsin.",
        action: { kind: "share", label: "Özet gönder" },
        data: others.map(p => ({ person: p.name, personId: p.id, amount: round(month.byPerson[p.id]) })),
      });
    }

    // Borcun biteceği ay (süresiz tekrarlayan TL harcaması varsa borç bitmez; hesaba katılmayan kart sayılmaz)
    const own = paying(state, purchases);
    const endless = own.some(p => T.assetOf(p) === "TRY" && T.endless(p));
    const lastIdx = endless ? -Infinity : own.reduce((m, p) => {
      if (T.assetOf(p) !== "TRY") return m;
      const pays = T.payments(p, state.cards.find(c => c.id === p.cardId));
      return pays.length ? Math.max(m, pays[pays.length - 1].idx) : m;
    }, -Infinity);
    if (lastIdx >= t) {
      const rest = T.buildCashflow(state.people, state.cards, paying(state), t, lastIdx).reduce((s, m) => s + m.total, 0);
      add({
        id: "bitis", tone: "good", title: `Son taksit: ${monthLong(lastIdx)}`,
        text: `Bu aydan son taksite kadar kart ve taksit ödemelerinin toplamı ${fmt(rest)}. Yeni harcama eklemezsen sonrasında kart ve taksit ödemen kalmaz.`,
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

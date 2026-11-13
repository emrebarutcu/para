// ---------- İçgörüler (DOM'dan bağımsız) ----------
// Kayıtlı veriden kurallarla hesaplanır (model gerekmez): ayın serbest nakdi, taksit yükünün gelire oranı, borcun
// biteceği ay, dolmak üzere olan limitler, yaklaşan ödeme sıçraması, bugün hangi kartla alışveriş yapılırsa ilk
// ödemenin en geç geleceği, düzenli ödemeler (abonelik), kategoride olağandışı artış, geciken ya da yaklaşan borç
// ödemeleri (elle ödenen kartların geciken ekstreleri dahil), ödemesi gelen alacaklar (kart payları ve kişiler), diğer
// kişilerin payı (takipte kart yoksa), yaklaşan bonus ödemesi (Japonya).
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
  const P = node ? require("./para.js") : root.Para;
  const D = node ? require("./dil.js") : root.Dil;   // görünen metinler (iPhone İngilizcede çevirir)
  const L = D.t;

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
  const BONUS_SOON = 92;      // bonus ödemesi (Japonya) bu kadar gün içindeyse hatırlatma
  const EPS = 0.005;

  // Ana para birimi (para.js): her dışa açık işlev verinin birimini burada tutar (işlevler eşzamanlı, karışmaz)
  let home = "TRY";
  const moneys = new Map();
  const money = () => {
    const k = home + "|" + D.locale();
    if (!moneys.has(k)) moneys.set(k, new Intl.NumberFormat(D.locale(), { style: "currency", currency: home, maximumFractionDigits: 0 }));
    return moneys.get(k);
  };
  const fmt = n => money().format(Math.round(n || 0));
  const pct = r => D.pct(Math.round(r * 100));
  const monthLong = idx => `${T.monthName(idx)} ${T.yearOf(idx)}`;
  const round = n => Math.round((n || 0) * 100) / 100;
  const days = (from, to) => Math.round((T.toDate(to) - T.toDate(from)) / 864e5);
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  // Varlığın kendi biriminde: TL fmt ile, döviz "$100", altın "12,5 gr"
  function amountText(n, code) {
    if (code === home) return fmt(n);
    const a = V.asset(code);
    const s = new Intl.NumberFormat(D.locale(), { maximumFractionDigits: a.digits }).format(n);
    return code === "GAU" ? `${s} ${L("gr")}` : `${a.symbol}${s}`;
  }

  // "3 gün gecikti", "bugün", "yarın", "10 Ara, 3 gün sonra"
  function dueText(date, today, overdue) {
    if (overdue) return L("{0} gün gecikti", days(date, today));
    const n = days(today, date);
    if (n <= 0) return L("bugün");
    if (n === 1) return L("yarın");
    const d = T.parseDate(date);
    return L("{0} {1}, {2} gün sonra", d.day, T.monthShort(d.idx), n);
  }

  // Borcun karşı tarafı (isimlere ek getirilmez)
  function who(d) {
    return d.party || d.desc || (d.kind === "loan" ? L("Kredi") : B.side(d) === "debt" ? L("Borç") : L("Alacak"));
  }

  // Ödeme akışına giren harcamalar: hesaba katılmayan kartın (borc.js tracked değil; ör. eşinin kartı) harcamaları girmez
  function paying(state, list = state.installments) {
    const off = new Set(state.cards.filter(c => !B.tracked(c)).map(c => c.id));
    return off.size ? list.filter(p => !off.has(p.cardId)) : list;
  }

  function known(state) {
    home = P.homeOf(state);
    const ids = new Set(state.people.map(p => p.id));
    const all = state.entries.filter(e => ids.has(e.personId) && V.asset(e.asset));
    return {
      purchases: state.installments.filter(p => ids.has(p.personId)),
      // TL bakiyesine işlenen alış / satış (aktarım: fon, hisse, döviz, altın) gelir ya da gider değildir, ayrıdır
      // (trades); TL'ye işlenmeyen fon / hisse hareketi hiç sayılmaz (yalnızca varlık değişimi)
      entries: all.filter(e => !V.market(e.asset) && !V.settled(e, home)),
      trades: all.filter(e => V.settled(e, home)),
      // TL'ye işlenmeyen fon / hisse hareketi (önceden elde olan, dışarıda alınan): gelir değildir; fon nakitse (para
      // piyasası fonu) nakde girer / nakitten çıkar
      holdings: all.filter(e => V.market(e.asset) && !V.settled(e, home)),
    };
  }

  // Ayın girdi / çıktıları (TL): varlık girişleri gelir; çıkışları, döviz / altın harcamaları ve borç verilen para gider;
  // kart / nakit ödemeleri ile borç ve kredi ödemeleri ayrı (payments). inflow borç alınan para, tahsilatlar ve kart payı
  // ödemeleridir: yalnızca bilgi içindir, net'e girmez (borç serbest nakit değildir). TL bakiyesine işlenen alış / satış
  // (aktarım) gelir ya da gider değildir. Bunlar bütün varlıklarda (income, outflow, payments: taksit / gelir oranı).
  // Serbest nakit (net) yalnızca nakdin (cash: varlık nakit mi; uygulamanın nakit tanımı, verilmezse yalnızca TL):
  // cashIn − cashOut − cashPayments − invest. cashIn gelirlerle birlikte gerçekleşen tahsilatları ve kart payı
  // ödemelerini (verilen paranın dönüşü; verilen borç cashOut'tadır) içerir; borç alınan para (borrowed) serbest değildir,
  // beklenen tahsilat (pending; henüz gelmedi) ihtiyaten sayılmaz, beklenen ödeme sayılır. invest alış / satışlarda
  // nakitten çıkan (fona, hisseye, dövize giden) eksi nakde giren, nakitten nakde aktarım (TL → para piyasası fonu) 0.
  // revalue: nakit sayılan varlığın (döviz, altın, para piyasası fonu) alış / satışında bugünkü değeriyle işlem tutarı
  // arasındaki fark (Nakit grafiği nakdi bugünkü kur ve fiyatla gösterir). net + borrowed + pending Nakit grafiğinin
  // dönem net'idir. Kuru bilinmeyen hareket sayılmaz (missing). today borçların
  // bugünkü durumu içindir (geciken beklenen ödeme bugüne düşer).
  function monthFlows(state, idx, rates, months, today = T.todayKey(), cash = null) {
    home = P.homeOf(state);
    cash ??= code => code === home;
    const { entries, trades, holdings, purchases } = known(state);
    let income = 0, outflow = 0, inflow = 0, debtPaid = 0, missing = false;
    let cashIn = 0, cashOut = 0, cashPaid = 0, invest = 0, borrowed = 0, pending = 0, revalue = 0;
    for (const e of trades) {
      if (!V.occurrencesIn(e, idx).length) continue;
      const v = V.tradeValue(e, home);
      invest += (cash(home) ? v : 0) - (cash(e.asset) ? v : 0);
      if (!cash(e.asset)) continue;
      const now = V.toTry(e.amount, e.asset, rates, home);
      if (now == null) missing = true; else revalue += now - v;
    }
    for (const e of holdings) {
      if (!cash(e.asset) || !V.occurrencesIn(e, idx).length) continue;
      const v = V.toTry(e.amount, e.asset, rates, home);
      if (v == null) missing = true; else if (v > 0) cashIn += v; else cashOut -= v;
    }
    for (const e of entries) {
      const n = V.occurrencesIn(e, idx).length;
      if (!n) continue;
      const v = V.toTry(e.amount * n, e.asset, rates, home);
      if (v == null) { missing = true; continue; }
      if (v > 0) income += v; else outflow -= v;
      if (!cash(e.asset)) continue;
      if (v > 0) cashIn += v; else cashOut -= v;
    }
    for (const p of purchases) {
      if (T.assetOf(p, home) === home) continue;
      const paid = T.payments(p, null, T.dateKey(idx, 31)).filter(x => x.idx === idx).reduce((s, x) => s + x.amount, 0);
      if (!paid) continue;
      const v = V.toTry(paid, p.asset, rates, home);
      if (v == null) { missing = true; continue; }
      outflow += v;
      if (cash(p.asset)) cashOut += v;
    }
    // Borç akışları: gelen para inflow; borç tarafında ödenen (ödeme, taksit, beklenen ödeme) payments; verilen borç gider
    for (const f of B.allFlows(state, today, T.dateKey(idx, 1), T.dateKey(idx, 31))) {
      const v = V.toTry(f.amount, f.asset, rates, home);
      if (v == null) { missing = true; continue; }
      if (v > 0) {
        inflow += v;
        if (!cash(f.asset)) continue;
        if (f.debt && B.side(f.debt) === "debt") borrowed += v;   // borç alındı
        else if (f.type === "plan") pending += v;                  // beklenen tahsilat
        else cashIn += v;                                          // tahsilat, kart payı ödemesi
        continue;
      }
      if (B.side(f.debt) === "debt") debtPaid -= v; else outflow -= v;
      if (!cash(f.asset)) continue;
      if (B.side(f.debt) === "debt") cashPaid -= v; else cashOut -= v;
    }
    const cards = months.find(m => m.idx === idx)?.total || 0;   // kart ve nakit taksitler (TL)
    const payments = cards + debtPaid, cashPayments = (cash(home) ? cards : 0) + cashPaid;
    return {
      idx, income, outflow, inflow, payments, cashIn, cashOut, cashPayments, invest, borrowed, pending, revalue,
      net: cashIn - cashOut - cashPayments - invest + revalue, missing,
    };
  }

  // Harcama tarihine göre ay ay kategori toplamları (taksitli alışveriş tamamıyla alındığı aya, tekrarlayanın her
  // tekrarı kendi ayına): idx → { kategori → TL }. Kategorisiz harcama "" altında. Döviz / altın harcaması güncel
  // kurla TL'dir; kuru bilinmiyorsa sayılmaz.
  function spendingByMonth(state, fromIdx, toIdx, rates = null) {
    home = P.homeOf(state);
    const out = new Map();
    for (let i = fromIdx; i <= toIdx; i++) out.set(i, {});
    const from = T.dateKey(fromIdx, 1), to = T.dateKey(toIdx, 31);
    for (const p of known(state).purchases) {
      if (!T.parseDate(p.date)) continue;
      const value = V.toTry(T.originalTotal(p), T.assetOf(p, home), rates, home);
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
    home = P.homeOf(state);
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
    home = P.homeOf(state);
    const t = T.parseDate(today).idx;
    const groups = new Map(), out = [];
    const own = paying(state, known(state).purchases);   // hesaba katılmayan kartın abonelikleri sayılmaz
    for (const p of own) {
      if (!T.repeats(p) || !R.nextDate(p, today)) continue;
      const v = V.toTry(T.originalTotal(p) * R.perMonth(p), T.assetOf(p, home), rates, home);
      if (v != null) out.push({ name: p.desc, monthly: v, kind: "purchase", category: p.category ?? null });
    }
    for (const p of own) {
      const d = T.parseDate(p.date);
      if (!d || T.repeats(p) || T.bonus(p) || T.assetOf(p, home) !== home || T.planLength(p) !== 1 || d.idx < t - 5 || d.idx > t) continue;
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
      const v = V.toTry(-e.amount * R.perMonth(e), e.asset, rates, home);
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
  // Alış / satışların nakde etkisi metinle: ", yatırıma ₺25.000" ya da ", satışlardan +₺9.000"
  function investText(f) {
    return (f.invest > 0.5 ? L(", yatırıma {0}", fmt(f.invest)) : f.invest < -0.5 ? L(", satışlardan +{0}", fmt(-f.invest)) : "")
      + (Math.abs(f.revalue) > 0.5 ? L(", kur / fiyat farkı {0}", (f.revalue > 0 ? "+" : "−") + fmt(Math.abs(f.revalue))) : "");
  }
  // Borç alınan para serbest nakde girmez: " (₺50.000 borç alınan para hariç)"
  function borrowedText(f) {
    return f.borrowed > 0.5 ? L(" ({0} borç alınan para hariç)", fmt(f.borrowed)) : "";
  }

  // cash: varlık nakit mi (serbest nakitte yatırım için; monthFlows)
  function insights(state, { today, rates = null, cash } = {}) {
    home = P.homeOf(state);
    const t = T.parseDate(today).idx;
    const { purchases, entries } = known(state);
    const cashflow = B.cashflow(state, t, t + Math.max(HORIZON, PEAK_MONTHS), today);   // hesaba katılmayan kart toplamlarda yok
    const out = [];
    const add = x => out.push(x);

    // Gelir: tekrarlayan bir giriş (maaş) ya da son iki ayda giriş varsa serbest nakit hesaplanır (borç alınan para
    // varlık girişi değildir, gelir sayılmaz)
    const hasIncome = entries.some(e => e.amount > 0 && (V.repeatOf(e) != null || (T.parseDate(e.date)?.idx ?? -1) >= t - 1));
    const flows = Array.from({ length: HORIZON }, (_, i) => monthFlows(state, t + i, rates, cashflow, today, cash));
    if (hasIncome) {
      // Açık: gider ve ödemeler nakde gireni aşıyor. Yatırım (alış) birikimden de yapılabilir, tek başına açık sayılmaz.
      const short = flows.find(f => f.net + f.invest - f.revalue < 0);
      if (short) {
        add({
          id: "acik", tone: "warn",
          title: short.idx === t ? L("Bu ay açık veriyorsun") : L("{0} ayında açık var", T.monthName(short.idx)),
          text: L("{0}: nakde giren {1}, ödemeler ve giderler {2}{3} — {4} eksik{5}.", monthLong(short.idx), fmt(short.cashIn),
            fmt(short.cashPayments + short.cashOut), investText(short), fmt(-short.net), borrowedText(short)),
          data: { month: T.monthKey(short.idx), income: round(short.cashIn), payments: round(short.cashPayments), outflow: round(short.cashOut), invest: round(short.invest), borrowed: round(short.borrowed), net: round(short.net) },
        });
      } else {
        const f = flows[0];
        add({
          id: "serbest", tone: f.net >= 0 ? "good" : "info", title: L("Bu ay serbest nakit"),
          text: L("Nakde giren {0}, taksit ve giderler {1}{2}: ", fmt(f.cashIn), fmt(f.cashPayments + f.cashOut), investText(f))
            + (f.net >= 0 ? L("ay sonunda {0} kalıyor", fmt(f.net)) : L("nakdin bu ay {0} azalıyor", fmt(-f.net))) + `${borrowedText(f)}.`,
          data: { month: T.monthKey(t), income: round(f.cashIn), payments: round(f.cashPayments), outflow: round(f.cashOut), invest: round(f.invest), borrowed: round(f.borrowed), net: round(f.net) },
        });
      }
      const income = flows.reduce((s, f) => s + f.income, 0), paying = flows.reduce((s, f) => s + f.payments, 0);
      if (income > 0 && paying > 0) {
        const r = paying / income;
        add({
          id: "yuk", tone: r >= 0.5 ? "warn" : "info", title: L("Taksit / gelir oranı {0}", pct(r)),
          text: L("Önümüzdeki {0} ayın {1} girdisinin {2} kadarı şimdiden kart, kredi ve taksit ödemelerine ayrılmış.", HORIZON, fmt(income), fmt(paying))
            + (r >= 0.5 ? " " + L("Yeni taksite girmeden önce bu oranın düşmesini beklemek iyi olabilir.") : ""),
          data: { months: HORIZON, income: round(income), payments: round(paying), ratio: Math.round(r * 1000) / 1000 },
        });
      }
    } else if (purchases.length) {
      add({
        id: "gelir", tone: "info", title: L("Gelirini ekle"),
        text: L("Maaşını Varlıklar'da her ay tekrarlayan giriş olarak eklersen ay sonunda ne kalacağını ve taksit yükünü hesaplarım."),
        action: { kind: "entry", label: L("Gelir ekle") },
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
        due.push({ ref: { cardId: c.id }, name: L("{0} ekstresi", c.name), party: c.name, asset: home, amount: cd.overdue, date: cd.overdueSince, overdue: true });
      }
    }
    if (due.length) {
      due.sort((a, b) => b.overdue - a.overdue || byDate(a, b));
      const late = due.filter(x => x.overdue).length;
      add({
        id: "borc-vade", tone: "warn",
        // Tek gecikmiş kart ekstresiyse başlıkta adı (kart ekstresi "borç" başlığıyla birine borç sanılmasın)
        title: late ? (late > 1 ? L("{0} ödemen gecikti", late) : due[0].ref.cardId ? L("{0} gecikti", due[0].name) : L("Borç ödemen gecikti"))
          : due.length > 1 ? L("{0} borç ödemesi yaklaşıyor", due.length) : L("Borç ödemesi yaklaşıyor"),
        text: due.map(x => `${x.name} ${amountText(x.amount, x.asset)} (${dueText(x.date, today, x.overdue)})`).join(", ") + "."
          + (late ? " " + L("Ödediysen Borçlar'da satırındaki “Ödendi”ye dokun.") : ""),
        action: { kind: "debt", label: L("Borçlar") },
        data: due.map(x => ({ ...x.ref, party: x.party ?? x.name, amount: V.round(x.amount, x.asset), asset: x.asset, date: x.date, overdue: x.overdue })),
      });
    }

    // Limit
    for (const x of cardTiming(state, today, today)) {
      const c = x.card;
      if (!B.tracked(c) || !(c.limit > 0) || x.used / c.limit < LIMIT_WARN) continue;   // hesaba katılmayan kart uyarılmaz
      add({
        id: `limit-${c.id}`, tone: "warn", title: x.full ? L("{0} limiti doldu", c.name) : L("{0} limiti {1} dolu", c.name, pct(x.used / c.limit)),
        text: x.full ? L("Kart borcu {0}, limit {1}.", fmt(x.used), fmt(c.limit)) : L("Kullanılabilir {0} kaldı.", fmt(x.available)),
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
        id: "sicrama", tone: "warn", title: L("{0} ayında ödemeler artıyor", T.monthName(peak.idx)),
        text: L("{0}: {1} ({2} taksit) — bu ay {3}. Önceden hazırlıklı ol.", monthLong(peak.idx), fmt(peak.total), count, fmt(current)),
        data: { month: T.monthKey(peak.idx), total: round(peak.total), current: round(current), installments: count },
      });
    }

    // Yaklaşan bonus ödemesi (Japonya, ボーナス払い; taksit.js bonus): sıradaki bonus gününe düşen tutar
    const bonusPays = [];
    for (const p of paying(state, purchases)) {
      if (!T.bonus(p) || T.assetOf(p, home) !== home) continue;
      const card = state.cards.find(c => c.id === p.cardId);
      if (!card) continue;
      for (const x of T.payments(p, card)) if (x.key >= today && days(today, x.key) <= BONUS_SOON) bonusPays.push({ ...x, card, p });
    }
    if (bonusPays.length) {
      const first = bonusPays.reduce((a, x) => (x.key < a.key ? x : a)).key;
      const due = bonusPays.filter(x => x.key === first), total = due.reduce((s, x) => s + x.amount, 0);
      const d = T.parseDate(first);
      add({
        id: "bonus", tone: "info",
        title: L("{0} {1} bonus ödemesi {2}", d.day, T.monthShort(d.idx), fmt(total)),
        text: L("Bonus ödemeli {0} harcama o gün kartından çekilecek. Bonusunun bir kısmını buna ayır.", due.length),
        data: { date: first, total: round(total), purchases: due.map(x => ({ purchase: x.p.desc, card: x.card.name, amount: round(x.amount), season: x.bonus })) },
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
          id: `kategori-${jump.id}`, tone: "warn", title: L("{0} harcaman arttı", jump.name),
          text: jump.average > 0
            ? L("Bu ay şimdiden {0}; önceki 3 ayın ortalaması {1} ({2} fazla).", fmt(jump.value), fmt(jump.average), pct(jump.value / jump.average - 1))
            : L("Bu ay {0}; önceki 3 ayda bu kategoride harcama yoktu.", fmt(jump.value)),
          data: { category: jump.id, month: round(jump.value), average: round(jump.average) },
        });
      }
    }

    // Kart seçimi
    const timing = cardTiming(state, today, today).filter(x => !x.full && B.tracked(x.card));   // eşin kartı önerilmez
    if (timing.length >= 2 && timing[0].days - timing[timing.length - 1].days >= CARD_GAP) {
      const best = timing[0], worst = timing[timing.length - 1];
      add({
        id: "kart", tone: "info", title: L("Bugünkü alışverişi {0} ile yap", best.card.name),
        text: L("Bugün {0} ile harcarsan son ödeme günü {1} gün sonra ({2} {3}); {4} ile harcarsan {5} gün sonra.", best.card.name, best.days,
          T.parseDate(best.due).day, T.monthShort(T.parseDate(best.due).idx), worst.card.name, worst.days),
        data: timing.map(x => ({ card: x.card.name, firstPayment: x.due, days: x.days, available: x.available == null ? null : round(x.available) })),
      });
    }

    // Düzenli ödemeler
    const subs = recurring(state, today, rates);
    if (subs.length) {
      const total = subs.reduce((s, x) => s + x.monthly, 0);
      const names = subs.slice(0, 3).map(x => x.name).join(", ") + (subs.length > 3 ? ` +${subs.length - 3}` : "");
      add({
        id: "duzenli", tone: "info", title: L("Düzenli ödemeler: aylık {0}", fmt(total)),
        text: L("{0}. Kullanmadığın abonelik varsa iptal etmek her ay bu kadar kazandırır.", names),
        data: subs.map(x => ({ name: x.name, monthly: round(x.monthly), kind: x.kind })),
      });
    }

    // Alacaklar: takipteki kartlarda ödemesi gelmiş kart payları ve geciken alacaklar (kendiliğinden ödenen gecikmez)
    const shares = B.shares(state, today);
    const owed = state.people.map(p => shares.get(p.id)).filter(s => s?.dueNow > EPS)
      .map(s => ({ personId: s.person.id, name: s.person.name, amount: s.dueNow, asset: home }));
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
        title: late ? (late > 1 ? L("{0} alacağın gecikti", late) : L("Alacağın gecikti")) : L("Günü gelen alacağın {0}", fmt(sharesDue)),
        text: owed.map(x => `${x.name} ${amountText(x.amount, x.asset)} (${x.overdue ? dueText(x.date, today, true) : L("kartındaki harcamaları")})`).join(", ")
          + L(". Sana ödediyse Borçlar > Alacaklarım'da “Ödendi”ye dokun") + (sharesDue > 0 ? L("; oradan hatırlatma da gönderebilirsin.") : "."),
        action: { kind: "debt", label: L("Alacaklar") },
        data: owed.map(x => ({ ...x, amount: V.round(x.amount, x.asset) })),
      });
    }

    // Diğer kişilerin bu ayki payı (aile üyeleri ya da kartını kullananlar); takipte kart varsa yerine alacak çıkar
    const month = cashflow.find(m => m.idx === t);
    const others = state.cards.some(B.tracked) ? [] : state.people.slice(1).filter(p => month?.byPerson[p.id] > 0);
    if (others.length) {
      const total = others.reduce((s, p) => s + month.byPerson[p.id], 0);
      add({
        id: "paylar", tone: "info", title: L("Bu ay diğerlerinin payı {0}", fmt(total)),
        text: others.map(p => `${p.name} ${fmt(month.byPerson[p.id])}`).join(", ") + ". " + L("Kişiler listesinden her birine ödeme özetini gönderebilirsin."),
        action: { kind: "share", label: L("Özet gönder") },
        data: others.map(p => ({ person: p.name, personId: p.id, amount: round(month.byPerson[p.id]) })),
      });
    }

    // Borcun biteceği ay (süresiz tekrarlayan TL harcaması varsa borç bitmez; hesaba katılmayan kart sayılmaz)
    const own = paying(state, purchases);
    const endless = own.some(p => T.assetOf(p, home) === home && T.endless(p));
    const lastIdx = endless ? -Infinity : own.reduce((m, p) => {
      if (T.assetOf(p, home) !== home) return m;
      const pays = T.payments(p, state.cards.find(c => c.id === p.cardId));
      return pays.length ? Math.max(m, pays[pays.length - 1].idx) : m;
    }, -Infinity);
    if (lastIdx >= t) {
      const rest = B.cashflow(state, t, lastIdx, today).reduce((s, m) => s + m.total, 0);
      add({
        id: "bitis", tone: "good", title: L("Son taksit: {0}", monthLong(lastIdx)),
        text: L("Bu aydan son taksite kadar kart ve taksit ödemelerinin toplamı {0}. Yeni harcama eklemezsen sonrasında kart ve taksit ödemen kalmaz.", fmt(rest)),
        data: { lastMonth: T.monthKey(lastIdx), remaining: round(rest) },
      });
    }

    // Kategorisiz harcamalar
    const loose = purchases.filter(p => !K.valid(p.category) && (T.parseDate(p.date)?.idx ?? -Infinity) >= t - 2).length;
    if (loose >= UNCATEGORIZED) {
      add({
        id: "kategorisiz", tone: "info", title: L("{0} harcamanın kategorisi yok", loose),
        text: L("Yapay zekâ harcamalarını kategorilere ayırabilir; elle seçtiklerinden de öğrenir."),
        action: { kind: "ai", label: L("Kategorilere ayır") },
      });
    }

    const rank = { warn: 0, info: 1, good: 2 };
    return out.map((x, i) => ({ ...x, i })).sort((a, b) => rank[a.tone] - rank[b.tone] || a.i - b.i).map(({ i, ...x }) => x);
  }

  // ---------- Özet'in tepesi, kutlama, işyeri önerileri, ay kapanışı (web, iPhone ve asistan aynı hesabı kullanır) ----------
  const cardOf = (state, p) => state.cards.find(c => c.id === p.cardId) ?? null;

  // Ayın ilerlemesi: bugünün ayında ödenecek kart ve nakit ödemelerinden ödenenler ve kalan. Günü gelmemiş ödemeler
  // (bugünkü dahil; Sıradaki ödemeler'le aynı) ve elle ödenen kartların o aydaki kapanmamış ekstreleri kalandır
  // (borc.js cardState); gerisi ödenmiş sayılır. { idx, total, paid, left, next: kalanların ilk günü | null }
  function progress(state, today = T.todayKey()) {
    home = P.homeOf(state);
    const t = T.parseDate(today).idx;
    const month = B.cashflow(state, t, t, today)[0];
    const total = month?.total || 0;
    const manual = new Map();
    for (const c of state.cards) {
      if (!B.tracked(c) || !B.manual(c)) continue;
      const cs = B.cardState(state, c, today, undefined, T.dateKey(t, 31));
      if (cs.manualFrom <= today) manual.set(c.id, cs);   // elle mod yarın başlıyorsa bugün otomatik gibi
    }
    const open = [];
    for (const ev of month?.events ?? []) {
      if (ev.ignored) continue;
      const cs = manual.get(ev.cardId);
      if (cs && ev.date >= cs.manualFrom) continue;        // elle ödenen kart: ekstrelerinden (aşağıda)
      if (ev.date >= today) open.push({ date: ev.date, amount: ev.total });
    }
    for (const cs of manual.values()) {
      for (const x of cs.statements) {
        if (x.auto || T.parseDate(x.key)?.idx !== t || x.amount - x.covered <= EPS) continue;
        open.push({ date: x.key, amount: x.amount - x.covered });
      }
    }
    const left = Math.max(0, Math.min(total, open.reduce((s, x) => s + x.amount, 0)));
    const next = open.map(x => x.date).filter(d => d >= today).sort()[0] ?? null;
    return { idx: t, total: round(total), paid: round(total - left), left: round(left), next };
  }

  // Son taksit ayı ("YYYY-MM"): sonu belli harcamaların son ödemesinin ayı; kalan ödeme yoksa null. Süresiz
  // tekrarlananlar (kira, abonelik) sayılmaz: onlar bitmez, taksitlerin bittiği ay yine de bellidir.
  function lastInstallment(state, today = T.todayKey()) {
    home = P.homeOf(state);
    const t = T.parseDate(today).idx;
    let last = -Infinity;
    for (const p of paying(state, known(state).purchases)) {
      if (T.assetOf(p, home) !== home || T.endless(p)) continue;
      const pays = T.payments(p, cardOf(state, p));
      if (pays.length) last = Math.max(last, pays[pays.length - 1].idx);
    }
    return last >= t ? T.monthKey(last) : null;
  }

  // Biten taksitler: son ödemesi from–to arasında olan taksitli harcamalar (en az 2 ödeme; tekrarlayan, şimdi al sonra
  // öde ve bonus ödemesi değil; ana para biriminde). Kutlama kartı, bildirimi ve ay kapanışı için.
  // [{ id, desc, date (son ödeme günü), monthly (boşalan aylık tutar), count, freeFrom: boşalan ilk ay "YYYY-MM" }]
  function finishing(state, from, to) {
    home = P.homeOf(state);
    const out = [];
    for (const p of paying(state, known(state).purchases)) {
      if (T.repeats(p) || T.bnpl(p) || T.bonus(p) || T.assetOf(p, home) !== home || T.planLength(p) < 2) continue;
      const last = T.payments(p, cardOf(state, p)).at(-1);
      if (!last || last.key < from || last.key > to) continue;
      out.push({ id: p.id, desc: p.desc, date: last.key, monthly: round(T.perInstallment(p)), count: T.planLength(p), freeFrom: T.monthKey(last.idx + 1) });
    }
    return out.sort(byDate);
  }

  // İşyeri önerileri (harcama formu): önceki harcamaların adları, aynı işyeri (kategori.js keyOf) bir kez, en son
  // kullanılan kart, taksit sayısı ve kategorisiyle; en yeni önce. q yazılıyorsa adı onunla başlayanlar, sonra içerenler.
  // [{ desc, cardId (null: nakit), count, category (null: yok), personId, total (son tutar), uses }]
  function merchants(state, q = "", limit = 6) {
    home = P.homeOf(state);
    const cards = new Set(state.cards.map(c => c.id));
    const seen = new Map();
    const list = known(state).purchases.filter(p => String(p.desc ?? "").trim())
      .map((p, i) => ({ p, i })).sort((a, b) => (a.p.date === b.p.date ? b.i - a.i : (a.p.date ?? "") < (b.p.date ?? "") ? 1 : -1));
    for (const { p } of list) {
      const desc = p.desc.trim(), key = K.keyOf(desc) || desc.toLocaleLowerCase(D.locale());
      const old = seen.get(key);
      if (old) { old.uses++; continue; }
      seen.set(key, {
        key, desc, cardId: cards.has(p.cardId) ? p.cardId : null, count: T.bnpl(p) || T.bonus(p) ? 1 : T.planLength(p),
        category: K.valid(p.category) ? p.category : null, personId: p.personId, total: round(p.total), uses: 1,
      });
    }
    const needle = K.keyOf(q) || String(q ?? "").trim().toLocaleLowerCase(D.locale());
    const all = [...seen.values()];
    const hits = !needle ? all
      : [...all.filter(m => m.key.startsWith(needle)), ...all.filter(m => !m.key.startsWith(needle) && m.key.includes(needle))]
        .filter(m => m.key !== needle || m.desc !== String(q).trim());   // yazılan zaten oysa önerilmez
    return hits.slice(0, limit).map(({ key, ...m }) => m);
  }

  // Ay kapanışı: bir ayın özeti (idx: ay; bugünün ayından önceki aylar için anlamlıdır).
  // { month, paid (ayın kart ve nakit ödemeleri), previous (önceki ayın ödemeleri), next: { month, total } (sonraki ay),
  //   finished (o ay biten taksitler; finishing), freed (bitenlerin aylık toplamı), spent (o ay yapılan harcama),
  //   added (o ay eklenen harcama sayısı), top: en büyük kategori, rising: 3 ay ortalamasına göre en çok artan kategori
  //   ({ id, name, value, average }; yoksa null) }
  function monthSummary(state, idx, today = T.todayKey(), rates = null) {
    home = P.homeOf(state);
    const months = B.cashflow(state, idx - 1, idx + 1, today);
    const at = i => months.find(m => m.idx === i)?.total || 0;
    const finished = finishing(state, T.dateKey(idx, 1), T.dateKey(idx, 31));
    const cats = categoryBreakdown(state, idx, rates);
    const row = r => (r ? { id: r.id, name: r.name, value: round(r.value), average: r.average == null ? null : round(r.average) } : null);
    const rising = cats.rows.filter(r => r.id && r.average != null && r.average > EPS && r.value > r.average)
      .sort((a, b) => (b.value - b.average) - (a.value - a.average))[0];
    const from = T.dateKey(idx, 1), to = T.dateKey(idx, 31);
    return {
      month: T.monthKey(idx), paid: round(at(idx)), previous: round(at(idx - 1)),
      next: { month: T.monthKey(idx + 1), total: round(at(idx + 1)) },
      finished, freed: round(finished.reduce((s, f) => s + f.monthly, 0)),
      spent: round(cats.total), added: known(state).purchases.reduce((n, p) => n + R.between(p, from, to).length, 0),
      top: row(cats.rows.find(r => r.id)), rising: row(rising),
    };
  }

  const api = {
    insights, monthFlows, categoryBreakdown, spendingByMonth, recurring, cardTiming, HORIZON,
    progress, lastInstallment, finishing, merchants, monthSummary,
  };
  if (node) module.exports = api;
  else root.Icgoru = api;
})(this);

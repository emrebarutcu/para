// ---------- Borçlar ve alacaklar (DOM'dan bağımsız) ----------
// Kayıt (state.debts, tablo debts):
//   { id, kind: "person", side: "debt" | "receivable", personId, party, desc?, asset, amount, principal?, date,
//     due?, count?, autoPay?, closed? }   biriyle borç ya da alacak; party karşı taraf (serbest metin)
//   { id, kind: "loan", personId, party?, desc?, asset, amount, principal?, date, due, count, autoPay?, closed? }   kredi
//   { id, kind: "payment", personId, debtId?, cardId?, amount, date, desc? }   ödeme / tahsilat; cardId'liyse kart ekstresi
//     ödemesi (ilk kişinin TL varlığından), ikisi de yoksa personId'nin kart payı ödemesi
// personId kaydın sahibidir (varlığı etkilenen kişi). amount ödenecek toplam (kredide taksit × sayı), principal date günü
// varlığa giren (borçta) ya da çıkan (alacakta) para; yoksa para hareketi olmamıştır (eski borç). due vade ya da ilk
// taksit, count taksit sayısı: taksitler due'dan başlayıp ayda bir düşer (ay kısaysa ayın son günü).
// Ödeme modu (autoPay): kredide varsayılan otomatik (autoPay false elle), kişisel borçta varsayılan elle (autoPay true
// otomatik). Otomatikte taksit tarihinin ertesi günü ödenmiş sayılır (kart ekstresi gibi; tarihinde "bugün ödenecek"),
// erken ödeme sondaki taksitlerden düşer. Elle modda yalnızca kaydedilen ödemelerle kapanır (ilk taksitten başlayarak);
// günü geçip kapanmayan taksit gecikmiştir. Kredide date'ten önceki taksitler takipten önce ödenmiştir, varlığa etkisi yoktur.
//
// Kart borcu kaydedilmez, harcamalardan gelir. Takipteki kartın (card.trackSince; trackOff değilse) trackSince'tan
// sonraki ekstreleri ilk kişinin TL varlığından düşer (D, cardState): otomatikte son ödeme gününün ertesi günü, elle
// modda (card.manualSince'tan sonraki ekstreler) Ödendi ile kaydedilen kart ödemeleriyle. Kart borcu = trackSince'tan
// sonraki taksitler − D. Kartta diğer kişilerin trackSince'tan sonraki taksitleri onlardan alacaktır, kart payı ödemeleri
// ilk kişinin TL varlığına girer. Böylece Varlık (eldeki + alacak) = Özvarlık + Borç her gün tutar.
(function (root) {
  const node = typeof module === "object" && module.exports;
  const T = node ? require("./taksit.js") : root.Taksit;
  const V = node ? require("./varlik.js") : root.Varlik;

  const KINDS = ["person", "loan", "payment"];
  const SIDES = ["debt", "receivable"];
  const EPS = 0.005;

  const valid = d => !!T.parseDate(d);
  const sum = (list, f = x => x.amount) => list.reduce((s, x) => s + f(x), 0);
  const add = (map, key, v) => { if (v) map[key] = (map[key] || 0) + v; };
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  // ---------- Kart takibi ----------
  function tracked(card) { return !!card && card.trackOff !== true; }
  // Ekstreler elle ödenir (Ödendi): manualSince'tan sonraki ekstreler kaydedilen ödemelerle kapanır
  function manual(card) { return valid(card?.manualSince); }
  // Takibin başladığı gün; henüz doldurulmadıysa bugün (bugünden takipte gibi: düşülen yok, alacak bugünden)
  function since(card, today) { return valid(card?.trackSince) ? card.trackSince : today; }

  // trackSince'ı boş, takip dışı olmayan kartlar bugünden takibe girer. Değişen kart yoksa null, varsa yeni kart listesi.
  function ensureTracking(state, today) {
    let changed = false;
    const cards = (state.cards || []).map(c => {
      if (!c || c.trackOff === true || valid(c.trackSince)) return c;
      changed = true;
      return { ...c, trackSince: today };
    });
    return changed ? cards : null;
  }

  // ---------- Kayıtlar ----------
  function side(d) { return d.kind === "loan" ? "debt" : d.side; }
  function sign(d) { return side(d) === "debt" ? 1 : -1; }   // borçta para gelir (+), alacakta çıkar (−)
  function auto(d) { return valid(d.due) && (d.kind === "loan" ? d.autoPay !== false : d.autoPay === true); }
  function started(d, today) { return d.date <= today; }

  function validHead(d) {
    if (d.kind !== "person" && d.kind !== "loan") return false;
    if (!V.asset(d.asset) || !(Number.isFinite(d.amount) && d.amount > 0) || !valid(d.date)) return false;
    if (d.kind === "person" && !SIDES.includes(d.side)) return false;
    if (d.kind === "loan" && (!valid(d.due) || !(d.count >= 1))) return false;
    return true;
  }

  // Sahibi bilinen geçerli kayıtlar: items (borç / alacak / kredi), pays (debtId → ödemeler, tarihe göre), cardPays
  // (cardId → kart ekstresi ödemeleri), settlements (kart payı ödemeleri), payer (ilk kişi: kartları ödeyen)
  function known(state) {
    const people = new Set((state.people || []).map(p => p.id));
    const cards = new Set((state.cards || []).map(c => c.id));
    const payer = state.people?.[0]?.id ?? null;
    const items = [], pays = new Map(), cardPays = new Map(), settlements = [];
    for (const d of state.debts || []) {
      if (d && people.has(d.personId) && validHead(d)) { items.push(d); pays.set(d.id, []); }
    }
    for (const x of state.debts || []) {
      if (!x || x.kind !== "payment" || !(Number.isFinite(x.amount) && x.amount > 0) || !valid(x.date)) continue;
      if (x.debtId) pays.get(x.debtId)?.push(x);
      else if (x.cardId) {
        if (!cards.has(x.cardId) || !people.has(x.personId)) continue;   // kartı / kişisi silinmiş
        if (!cardPays.has(x.cardId)) cardPays.set(x.cardId, []);
        cardPays.get(x.cardId).push(x);
      } else if (people.has(x.personId) && x.personId !== payer) settlements.push(x);
    }
    for (const list of pays.values()) list.sort(byDate);
    for (const list of cardPays.values()) list.sort(byDate);
    settlements.sort(byDate);
    return { items, pays, cardPays, settlements, payer };
  }

  // ---------- Plan ve durum ----------
  // Planlı taksitler: [{ no, key, amount }]; vadesizse boş
  function schedule(d) {
    if (!valid(d.due)) return [];
    const count = Number.isInteger(d.count) && d.count > 0 ? d.count : 1;
    return T.payments({ total: d.amount, count, date: d.due }, null).map(x => ({ no: x.no, key: x.key, amount: x.amount }));
  }

  // Kendiliğinden ödenen (kredi, autoPay) borcun taksitleri, erken ödemeler sondan düşülmüş (ödeme gününden sonrakilerden,
  // o günkü dahil) ve kapandıktan sonrakiler atılmış: [{ no, key, amount, before (date'ten önce: takipten önce ödenmiş) }]
  function plan(d, pays = []) {
    const items = schedule(d).map(x => ({ ...x, before: x.key < d.date }));
    for (const p of pays) {
      let rest = p.amount;
      for (let i = items.length - 1; i >= 0 && rest > EPS; i--) {
        const x = items[i];
        if (x.key < p.date || x.before) break;   // ödeme günündeki taksit henüz ödenmemiştir, kapatılabilir
        const cut = Math.min(rest, x.amount);
        x.amount -= cut;
        rest -= cut;
      }
    }
    return items.filter(x => x.amount > EPS && !(d.closed && x.key >= d.closed));
  }

  // Borcun bugünkü durumu. remaining: ödenecek (borçta) ya da alınacak (alacakta) kalan, varlığın biriminde.
  // items: taksitler { no, key, amount, covered, state: "paid" | "due" | "late" | "open" | "closed" }; covered kendiliğinden
  // ödenende true / false, elle ödenende kapanan tutar
  function status(d, pays = [], today) {
    const isStarted = started(d, today);
    const closed = !!d.closed && d.closed <= today;
    const paidIn = sum(pays.filter(p => p.date <= today));
    const cost = d.principal > 0 ? d.amount - d.principal : 0;
    const out = { started: isStarted, closed, cost, paid: 0, remaining: 0, overdue: 0, overdueSince: null, next: null,
      paidCount: 0, count: 0, items: [], done: false, auto: auto(d) };

    if (auto(d)) {
      const all = schedule(d);
      const items = plan(d, pays.filter(p => p.date <= today));   // varlığa işlenmemiş (ileri tarihli) ödeme kalanı düşürmez
      const left = items.filter(x => x.key >= today);
      out.count = all.length;
      out.paidCount = all.length - left.length;
      out.items = all.map(x => {
        const cur = items.find(y => y.no === x.no);
        const dropped = !cur && !!d.closed && x.key >= d.closed && x.key >= today;   // kapanınca atıldı, ödenmedi
        const st = dropped ? "closed" : !cur ? "paid" : x.key < today ? "paid" : x.key === today ? "due" : "open";
        return { no: x.no, key: x.key, amount: cur ? cur.amount : x.amount, covered: !dropped && (!cur || x.key < today), state: st };
      });
      out.remaining = isStarted ? sum(left) : 0;
      out.paid = sum(items.filter(x => !x.before && x.key < today)) + paidIn;
      const n = left[0];
      out.next = n ? { date: n.key, amount: sum(left.filter(x => x.key === n.key)), no: n.no } : null;
    } else {
      // Kredide kayıt tarihinden önceki taksitler takipten önce ödenmiştir (kişisel borçta gecikmiş kalır)
      const items = schedule(d);
      const before = x => d.kind === "loan" && x.key < d.date;
      const pre = sum(items.filter(before));
      out.paid = paidIn;
      out.remaining = isStarted && !closed ? Math.max(0, d.amount - pre - paidIn) : 0;
      let pool = paidIn;
      out.count = items.length;
      out.items = items.map(x => {
        if (before(x)) { out.paidCount++; return { no: x.no, key: x.key, amount: x.amount, covered: x.amount, state: "paid" }; }
        const covered = Math.min(pool, x.amount);
        pool -= covered;
        const open = x.amount - covered;
        const st = open <= EPS || closed ? "paid" : x.key < today ? "late" : x.key === today ? "due" : "open";
        if (st === "paid") out.paidCount++;
        if (st === "late") {
          out.overdue += open;
          out.overdueSince ??= x.key;
        }
        if (!out.next && (st === "due" || st === "open")) out.next = { date: x.key, amount: open, no: x.no };
        return { no: x.no, key: x.key, amount: x.amount, covered, state: st };
      });
      if (!isStarted) { out.overdue = 0; out.overdueSince = null; }
    }
    out.done = closed || (isStarted && out.remaining <= EPS);
    return out;
  }

  // Ödeme modu (otomatik / elle) değiştirilebilir mi: geçmişte (takipten sonra, bugünden önce) taksiti olan borçta
  // değiştirmek geçmiş taksitleri yeniden yorumlar (ödenmiş sayılan gecikmiş olur ya da kaydedilen ödemeler ikinci kez
  // düşer); o zaman kilitlidir
  function modeLocked(d, today) {
    return schedule(d).some(x => x.key < today && !(d.kind === "loan" && x.key < d.date));
  }

  // Varlığa akışlar (sahibinin, borcun varlığında; amount işaretli): [{ date, amount, asset, type, paid, debt, no?, of?,
  // payment? }]. type: open (borç alındı / verildi), pay (ödeme / tahsilat), inst (kendiliğinden ödenen taksit), plan
  // (beklenen ödeme; gecikmişse bugün). paid: bugüne kadar varlığa işlendi (V.balances'e girer).
  function flows(d, pays = [], today, from = "0000-01-01", to = "9999-12-31") {
    const s = sign(d), out = [];
    const push = f => { if (f.date >= from && f.date <= to && Math.abs(f.amount) > EPS) out.push({ asset: d.asset, debt: d, ...f }); };
    if (d.principal > 0) push({ date: d.date, amount: s * d.principal, type: "open", paid: d.date <= today });
    for (const p of pays) push({ date: p.date, amount: -s * p.amount, type: "pay", paid: p.date <= today, payment: p });
    if (auto(d)) {
      const of = schedule(d).length;
      for (const x of plan(d, pays)) {
        if (x.before) continue;
        push({ date: x.key, amount: -s * x.amount, type: "inst", paid: x.key < today, no: x.no, of });
      }
    } else {
      const st = status(d, pays, today);
      if (!st.closed) {
        for (const x of st.items) {
          const open = x.amount - x.covered;
          if (open <= EPS) continue;
          const late = x.key < today;
          push({ date: late ? today : x.key, amount: -s * open, type: "plan", paid: false, late, no: x.no, of: st.count });
        }
      }
    }
    return out.sort(byDate);
  }

  // ---------- Kartlar ----------
  // Kartın taksitleri (kişisi bilinen harcamalar; cardStats'taki gibi): [{ ...ödeme, personId, purchase }]. Süresiz
  // tekrarlayan harcamanın tekrarları today'e kadar (MCP'de sunucunun saati değil kullanıcının günü)
  function cardLines(state, card, today) {
    const people = new Set((state.people || []).map(p => p.id));
    const out = [];
    for (const p of state.installments || []) {
      if (p.cardId !== card.id || !people.has(p.personId)) continue;
      for (const x of T.payments(p, card, today)) out.push({ ...x, personId: p.personId, purchase: p });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  // Kartın ekstreleri (son ödeme gününe göre toplanmış taksitler): [{ key, amount, lines }]
  function statements(lines) {
    const out = [];
    for (const x of lines) {
      const last = out[out.length - 1];
      if (last && last.key === x.key) { last.amount += x.amount; last.lines.push(x); }
      else out.push({ key: x.key, amount: x.amount, lines: [x] });
    }
    return out;
  }

  // Takipteki kartın ekstre durumu. S = trackSince, E = elle modun başladığı gün (max(manualSince, S); otomatikte yok).
  // A: E'den (otomatikte bugünden) önceki ekstreler, Pb / Pa: E'den önce / sonra kart ödemeleri (S ≤ tarih ≤ bugün).
  // D = max(A, Pb) + Pa varlıktan düşen; borç = S'den sonraki taksitler − D (eksiyse kartta artı bakiye, credit).
  // Ödemeler (D − A) E'den sonraki ekstreleri sırayla kapatır: kapanmamış ekstre günü geçmişse late, bugünse due,
  // sonraysa open. Otomatikte bugünden önceki ekstreler ödenmiş sayılır, ödemeler ancak sonrakileri önceden kapatır.
  // until: ekstre listesi için ufuk (süresiz tekrarların ileriki tekrarları da ileriki ekstrelere girer); borç, D ve
  // kapanma bugüne kadar alınanlarla hesaplanır.
  function cardState(state, card, today, pays, until) {
    pays ??= known(state).cardPays.get(card.id) || [];
    const S = since(card, today);
    const E = manual(card) ? (card.manualSince > S ? card.manualSince : S) : null;
    const cut = E && E < today ? E : today;
    const all = cardLines(state, card, until && until > today ? until : today).filter(x => x.key >= S);
    const lines = all.filter(x => !(x.at > today));
    const P = pays.filter(p => p.date >= S && p.date <= today);
    const A = sum(lines.filter(x => x.key < cut));
    const Pb = sum(P.filter(p => !E || p.date < E)), Pa = E ? sum(P.filter(p => p.date >= E)) : 0;
    const D = Math.max(A, Pb) + Pa;
    let pool = D - A;
    const list = statements(until ? all : lines).map(st => {
      if (st.key < cut) return { ...st, covered: st.amount, state: "paid", auto: true };
      const covered = Math.min(pool, st.amount);
      pool -= covered;
      const open = st.amount - covered;
      const state = open <= EPS ? "paid" : st.key < today ? "late" : st.key === today ? "due" : "open";
      return { ...st, covered, state, auto: false };
    });
    const late = list.filter(x => x.state === "late");
    const unpaid = list.filter(x => x.state === "late" || x.state === "due");
    const debt = sum(lines) - D;
    return {
      since: S, manualFrom: E, deduction: D, debt: Math.abs(debt) <= EPS ? 0 : debt, credit: Math.max(0, -debt),
      statements: list, prepaid: Math.max(0, pool), lines,
      unpaid: sum(unpaid, x => x.amount - x.covered), overdue: sum(late, x => x.amount - x.covered),
      overdueSince: late[0]?.key ?? null,
    };
  }

  // Elle moddaki kart otomatiğe dönerse (manualSince silinince) varlıktan düşenin azalacağı tutar: ön ödeme, elle modun
  // başından önce ödenmiş sayılan ekstrelerde erir. Sıfırdan büyükse otomatiğe dönülmez (para kaybolmasın).
  function cardPrepaid(state, card, today) {
    if (!tracked(card) || !manual(card)) return 0;
    const { manualSince, ...auto } = card;
    const lost = cardState(state, card, today).deduction - cardState(state, auto, today).deduction;
    return lost > EPS ? lost : 0;
  }

  // Kartta bugün ya da sonra tarihli ödeme var mı: otomatikten elle moda bugün geçilirse bu ödemeler (o güne kadar
  // ödenmiş sayılan ekstrelerde erimişken) ikinci kez düşerdi; o gün geçilmez
  function cardPaidToday(state, card, today) {
    return (known(state).cardPays.get(card.id) || []).some(p => p.date >= today);
  }

  // Kartın borcu: total (takipteki kartta S'den sonraki taksitler − ödenen; takip dışında T.outstanding), kişi başına
  // (bugünden sonraki taksitler), sıradaki ekstre (kapanmamış kısmı; cut: kesilmiş, ödeme bekliyor), elle modda ödenmemiş
  // (unpaid: günü gelmiş) ve gecikmiş (overdue) tutar
  function cardDebt(state, card, today, pays) {
    const isTracked = tracked(card);
    const cs = isTracked ? cardState(state, card, today, pays) : null;
    const lines = cs ? cs.lines : cardLines(state, card, today);
    const byPerson = {};
    if (cs) {
      // Kapanmamış ekstrelerin kişi payları (kısmen ödenmişte orantılı): kart borcuyla toplanır
      for (const st of cs.statements) {
        const ratio = st.amount > EPS ? (st.amount - st.covered) / st.amount : 0;
        if (ratio > EPS) for (const x of st.lines) add(byPerson, x.personId, x.amount * ratio);
      }
    } else {
      for (const x of lines) if (x.key >= today && !(x.at > today)) add(byPerson, x.personId, x.amount);
    }
    const open = T.statementOf(card, today);
    let next = null;
    const st = cs
      ? cs.statements.find(x => x.key >= today && x.amount - x.covered > EPS)
      : statements(lines.filter(x => x.key >= today && !(x.at > today)))[0];
    if (st) {
      const nb = {};
      for (const x of st.lines) add(nb, x.personId, x.amount);
      next = { date: st.key, amount: st.amount - (st.covered || 0), byPerson: nb, cut: st.key < open.due };
    }
    return {
      card, total: cs ? cs.debt : T.outstanding(lines, today), byPerson, next, open: { cut: open.cut, due: open.due },
      tracked: isTracked, since: isTracked ? cs.since : null, manual: isTracked && manual(card), manualFrom: cs?.manualFrom ?? null,
      unpaid: cs?.unpaid ?? 0, overdue: cs?.overdue ?? 0, overdueSince: cs?.overdueSince ?? null, credit: cs?.credit ?? 0,
      statements: cs?.statements ?? [],
    };
  }

  // Limitten kullanılan: takipteki kartta borç (elle modda ödenmemiş geçmiş ekstreler dahil, ön ödeme düşülmüş); takip
  // bugünden sonra başlıyorsa aradaki taksitler de; takip dışında bugün ve sonra ödenecekler (T.outstanding)
  function cardUsed(state, card, today) {
    if (!tracked(card)) return T.outstanding(cardLines(state, card, today), today);
    const cs = cardState(state, card, today);
    const gap = cs.since > today ? sum(cardLines(state, card, today).filter(x => x.key >= today && x.key < cs.since && !(x.at > today))) : 0;
    return Math.max(0, cs.debt) + gap;
  }

  // Takipteki kartların varlıktan düşeni (TL, ilk kişiden): Σ D
  function cardPaid(state, today) {
    const k = known(state);
    let total = 0;
    for (const c of state.cards || []) if (tracked(c)) total += cardState(state, c, today, k.cardPays.get(c.id) || []).deduction;
    return total;
  }

  // Nakit grafiği için takipteki kartların hareketleri (TL, eksi), from…to: { date, amount, cardId, type, planned }.
  // type: statement (otomatik ödenen ya da ileride ödenecek ekstre, kapanmamış kısmı), payment (kart ödemesi), prepay
  // (otomatikte ekstreleri aşan ön ödeme), unpaid (günü gelmiş ödenmemiş ekstreler, bugünde). Bugüne kadarki hareketlerin
  // toplamı D'dir (geriye doğru bakiye tutarlı). trackSince'tan önceki ekstreler burada yok (takip dışı gibi).
  // until: ileriki ekstreler için süresiz tekrarların son günü.
  function cardMoves(state, today, from, to, until = to) {
    const k = known(state);
    const out = [];
    const push = m => { if (m.date >= from && m.date <= to && m.amount < -EPS) out.push(m); };
    for (const c of state.cards || []) {
      if (!tracked(c)) continue;
      const pays = k.cardPays.get(c.id) || [];
      const cs = cardState(state, c, today, pays);
      const E = cs.manualFrom, cut = E && E < today ? E : today;
      const P = pays.filter(p => p.date >= cs.since && p.date <= today);
      const A = sum(cs.statements.filter(x => x.key < cut));
      const Pb = P.filter(p => !E || p.date < E);
      for (const x of cs.statements) {
        if (x.key < cut) push({ date: x.key, amount: -x.amount, cardId: c.id, type: "statement", planned: false });
      }
      // E'den önceki ödemeler A'yı aştıysa fazlası son ödemenin gününde (ön ödeme)
      const extra = sum(Pb) - A;
      if (extra > EPS) push({ date: Pb[Pb.length - 1].date, amount: -extra, cardId: c.id, type: "prepay", planned: false });
      if (E) for (const p of P) if (p.date >= E) push({ date: p.date, amount: -p.amount, cardId: c.id, type: "payment", planned: false, payment: p });
      const unpaid = sum(cs.statements.filter(x => x.key >= cut && x.key <= today), x => x.amount - x.covered);
      if (unpaid > EPS) push({ date: today, amount: -unpaid, cardId: c.id, type: "unpaid", planned: true });
      // İleriki ekstreler: süresiz tekrarların ileriki tekrarları da (until'e kadar), kapanmış kısmı düşülerek
      const covered = new Map(cs.statements.filter(x => x.key > today).map(x => [x.key, x.covered]));
      const future = statements(cardLines(state, c, until).filter(x => x.key > today && x.key >= cs.since));
      for (const x of future) push({ date: x.key, amount: -(x.amount - (covered.get(x.key) || 0)), cardId: c.id, type: "statement", planned: true });
    }
    return out.sort(byDate);
  }

  // Diğer kişilerin takipteki kartlardaki payları: pid → { person, charged, settled, remaining (eksiyse fazla ödedi),
  // dueNow (ödemesi gelmiş, ödenmemiş), next { date, amount }, byCard, lines }
  function shares(state, today) {
    const { settlements, payer } = known(state);
    const out = new Map();
    const get = pid => {
      if (!out.has(pid)) {
        out.set(pid, { person: state.people.find(p => p.id === pid), charged: 0, settled: 0, remaining: 0, dueNow: 0,
          next: null, byCard: {}, lines: [] });
      }
      return out.get(pid);
    };
    for (const c of state.cards || []) {
      if (!tracked(c)) continue;
      const from = since(c, today);
      for (const x of cardLines(state, c, today)) {
        if (x.personId === payer || x.key < from || x.at > today) continue;
        const s = get(x.personId);
        s.charged += x.amount;
        add(s.byCard, c.id, x.amount);
        s.lines.push({ ...x, cardId: c.id });
      }
    }
    for (const x of settlements) {
      if (x.date > today) continue;
      get(x.personId).settled += x.amount;
    }
    for (const s of out.values()) {
      s.lines.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      s.remaining = s.charged - s.settled;
      s.dueNow = Math.max(0, sum(s.lines.filter(x => x.key <= today)) - s.settled);
      const n = s.lines.find(x => x.key > today);
      s.next = n ? { date: n.key, amount: sum(s.lines.filter(x => x.key === n.key)) } : null;
      if (Math.abs(s.remaining) <= EPS) s.remaining = 0;
    }
    return out;
  }

  // Kişinin taksitleri, ödemeleri ilk taksitten başlayarak kapatır: [{ key, amount, covered, purchase, no, cardId }]
  function shareItems(state, pid, today) {
    const s = shares(state, today).get(pid);
    if (!s) return [];
    let pool = s.settled;
    return s.lines.map(x => {
      const covered = Math.min(pool, x.amount);
      pool -= covered;
      return { key: x.key, amount: x.amount, covered, purchase: x.purchase, no: x.no, cardId: x.cardId };
    });
  }

  // Kartsız harcamaların kalan taksitleri, varlık başına (taksit tarihi bugünden sonra; bugünküler ödendi sayılır)
  function cashDebt(state, today, pid) {
    const cards = new Set((state.cards || []).map(c => c.id));
    const people = new Set((state.people || []).map(p => p.id));
    const out = {};
    for (const p of state.installments || []) {
      if (cards.has(p.cardId) || !people.has(p.personId) || (pid && p.personId !== pid)) continue;
      if (valid(p.date) && p.date > today && !T.repeats(p)) continue;   // henüz alınmadı
      for (const x of T.payments(p, null, today)) {
        if (x.key > today && !(x.at > today)) add(out, T.assetOf(p), x.amount);
      }
    }
    return out;
  }

  // ---------- Varlığa etkileri ----------
  const inScope = (pid, owner) => !pid || pid === "all" || pid === owner;

  // Bütün akışlar (kişi süzülebilir): borç kayıtlarının akışları ve kart payı ödemeleri (type "share", TL, ilk kişiye)
  function allFlows(state, today, from, to, pid) {
    const k = known(state);
    const out = [];
    for (const d of k.items) {
      if (inScope(pid, d.personId)) out.push(...flows(d, k.pays.get(d.id), today, from, to));
    }
    if (inScope(pid, k.payer)) {
      for (const x of k.settlements) {
        if (x.date >= from && x.date <= to) out.push({ date: x.date, amount: x.amount, asset: "TRY", type: "share", paid: x.date <= today, payment: x });
      }
    }
    return out.sort(byDate);
  }

  // Varlıktan düşülecekler (V.balances'in spent'i gibi; eksi değer ekler): borç akışlarının işlenmişleri, takipteki
  // kartların ödenen ekstreleri (ilk kişiden) ve kart payı ödemeleri (ilk kişiye)
  function debtSpent(state, today, pid) {
    const k = known(state);
    const out = {};
    for (const d of k.items) {
      if (!inScope(pid, d.personId)) continue;
      for (const f of flows(d, k.pays.get(d.id), today, "0000-01-01", today)) if (f.paid) add(out, f.asset, -f.amount);
    }
    if (inScope(pid, k.payer)) {
      add(out, "TRY", cardPaid(state, today));
      add(out, "TRY", -sum(k.settlements.filter(x => x.date <= today)));
    }
    return out;
  }

  function addSpent(...maps) {
    const out = {};
    for (const m of maps) for (const [code, v] of Object.entries(m || {})) add(out, code, v);
    return out;
  }

  // Kişinin (ya da herkesin) varlık bakiyesinden düşülecekler: nakit harcamalar + borç etkileri
  function spent(state, today, pid) {
    const ids = new Set((state.cards || []).map(c => c.id));
    const people = new Set((state.people || []).map(p => p.id));
    const cash = (state.installments || []).filter(p => people.has(p.personId) && !ids.has(p.cardId) && inScope(pid, p.personId));
    return addSpent(T.cashSpent(cash, state.cards || [], today), debtSpent(state, today, pid));
  }

  // Kullanıcının borç ödemeleri (borç tarafı: kredi / borç taksitleri, kaydedilen ve beklenen ödemeler), from…to: Özet,
  // Akış, içgörüler. Yapılmışlar da gelir (paid); sıradakiler için !paid süzülür.
  function paymentsDue(state, today, from, to, pid) {
    return allFlows(state, today, from, to, pid).filter(f => f.debt && side(f.debt) === "debt" && f.amount < 0);
  }

  // ---------- Toplamlar ----------
  // Varlık = eldeki (varlık bakiyeleri) + alacak; Özvarlık = Varlık − Borç. Döviz / altın güncel kurla TL; kuru olmayan
  // varlık iki tarafta da sayılmaz (missing).
  function totals(state, today, rates, pid) {
    const k = known(state);
    const people = new Set((state.people || []).map(p => p.id));
    const entries = (state.entries || []).filter(e => people.has(e.personId) && inScope(pid, e.personId));
    const balances = V.balances(entries, today, spent(state, today, pid));
    const cash = V.totalTry(balances, rates);
    const missing = new Set(cash.missing);
    const tl = (amount, code) => {
      const v = V.toTry(amount, code, rates);
      if (v == null) missing.add(code);
      return v ?? 0;
    };

    const receivable = { people: 0, cards: 0, cardCredit: 0, total: 0 };
    const debt = { cards: 0, cash: 0, loans: 0, people: 0, overpaid: 0, total: 0 };
    const list = [];
    for (const d of k.items) {
      if (!inScope(pid, d.personId)) continue;
      const st = status(d, k.pays.get(d.id), today);
      list.push({ debt: d, status: st, pays: k.pays.get(d.id) });
      if (!st.started || st.remaining <= EPS) continue;
      const v = tl(st.remaining, d.asset);
      if (side(d) === "receivable") receivable.people += v;
      else if (d.kind === "loan") debt.loans += v;
      else debt.people += v;
    }
    const withPayer = inScope(pid, k.payer);
    const cardList = (state.cards || []).map(c => cardDebt(state, c, today, k.cardPays.get(c.id) || []));
    let untracked = 0;
    if (withPayer) {
      for (const c of cardList) {
        if (!c.tracked) untracked += c.total;
        else if (c.total > 0) debt.cards += c.total;
        else receivable.cardCredit -= c.total;   // fazla ödenmiş kart: kartta artı bakiye
      }
      for (const s of shares(state, today).values()) {
        if (s.remaining > 0) receivable.cards += s.remaining;
        else debt.overpaid -= s.remaining;
      }
    }
    for (const [code, v] of Object.entries(cashDebt(state, today, pid === "all" ? undefined : pid))) debt.cash += tl(v, code);
    receivable.total = receivable.people + receivable.cards + receivable.cardCredit;
    debt.total = debt.cards + debt.cash + debt.loans + debt.people + debt.overpaid;
    const assets = cash.total + receivable.total;
    return {
      balances, cash: cash.total, receivable, debt, untracked, assets, equity: assets - debt.total,
      cards: withPayer ? cardList : [], list, missing: [...missing],
    };
  }

  // ---------- Metin ----------
  // "Mehmet · ödeme", "Garanti · taksit 2/24", "Annem · kart payı" (isimlere ek getirilmez)
  function flowText(f, state) {
    if (f.type === "share") {
      const p = state?.people?.find(x => x.id === f.payment.personId);
      return `${p?.name ?? "?"} · kart payı`;
    }
    const d = f.debt;
    const who = d.party || d.desc || (d.kind === "loan" ? "Kredi" : "Borç");
    const debt = side(d) === "debt";
    switch (f.type) {
      case "open": return `${who} · ${d.kind === "loan" ? "kredi çekildi" : debt ? "borç alındı" : "borç verildi"}`;
      case "pay": return `${who} · ${debt ? "ödeme" : "tahsilat"}`;
      case "inst": return `${who} · taksit ${f.no}/${f.of}`;
      case "plan": return `${who} · ${debt ? "beklenen ödeme" : "beklenen tahsilat"}${f.late ? " (gecikti)" : ""}`;
      default: return who;
    }
  }

  // Kredinin aylık faizi (önizleme): principal = taksit × (1 − (1 + r)^−n) / r; bulunamazsa null
  function loanRate(d) {
    const n = d.count, per = d.amount / (d.count || 1);
    if (!(d.principal > 0) || !(n > 1) || !(d.amount > d.principal)) return null;
    const pv = r => per * (1 - (1 + r) ** -n) / r;
    let lo = 1e-9, hi = 1;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (pv(mid) > d.principal) lo = mid; else hi = mid;
    }
    const r = (lo + hi) / 2;
    return r > 1e-6 && r < 0.999 ? r : null;
  }

  // Borç akışlarının son ayı (akışta gösterilecek); yoksa null
  function lastIndex(state, today) {
    const k = known(state);
    let last = null;
    for (const d of k.items) {
      for (const f of flows(d, k.pays.get(d.id), today)) {
        const idx = T.parseDate(f.date).idx;
        if (last == null || idx > last) last = idx;
      }
    }
    return last;
  }

  const api = {
    KINDS, SIDES, tracked, manual, since, ensureTracking, side, sign, auto, started, known, schedule, plan, status, modeLocked,
    flows, cardLines, cardState, cardPrepaid, cardPaidToday, cardDebt, cardUsed, cardPaid, cardMoves, shares, shareItems, cashDebt, allFlows,
    debtSpent, addSpent, spent, paymentsDue, totals, flowText, loanRate, lastIndex,
  };
  if (node) module.exports = api;
  else root.Borc = api;
})(this);

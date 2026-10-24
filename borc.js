// ---------- Borçlar ve alacaklar (DOM'dan bağımsız) ----------
// Kayıt (state.debts, tablo debts):
//   { id, kind: "person", side: "debt" | "receivable", personId, party, desc?, asset, amount, principal?, date,
//     due?, count?, autoPay?, closed? }   biriyle borç ya da alacak; party karşı taraf (serbest metin)
//   { id, kind: "loan", personId, party?, desc?, asset, amount, principal?, date, due, count, closed? }   banka kredisi
//   { id, kind: "payment", personId, debtId?, amount, date, desc? }   ödeme / tahsilat; debtId yoksa kart payı ödemesi
// personId kaydın sahibidir (varlığı etkilenen kişi). amount ödenecek toplam (kredide taksit × sayı), principal date günü
// varlığa giren (borçta) ya da çıkan (alacakta) para; yoksa para hareketi olmamıştır (eski borç). due vade ya da ilk
// taksit, count taksit sayısı: taksitler due'dan başlayıp ayda bir düşer (ay kısaysa ayın son günü).
// Kredi ve autoPay'li kişisel borçta taksit, tarihinin ertesi günü ödenmiş sayılır (kart ekstresi gibi; tarihinde "bugün
// ödenecek"); date'ten önceki taksitler takipten önce ödenmiştir, varlığa etkisi yoktur. Erken ödeme sondaki
// taksitlerden düşer. autoPay'siz kişisel borç yalnızca kaydedilen ödemelerle kapanır; taksitler beklentidir (gecikme).
//
// Kart borcu kaydedilmez, harcamalardan gelir: kartın ödenmemiş taksitleri (T.outstanding). Takipteki kartın
// (card.trackSince; trackOff değilse) trackSince'tan sonra son ödeme günü geçen ekstreleri ilk kişinin TL varlığından düşer;
// kartta diğer kişilerin trackSince'tan sonraki taksitleri onlardan alacaktır, kart payı ödemeleri (debtId'siz payment)
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
  function auto(d) { return d.kind === "loan" || (d.autoPay === true && valid(d.due)); }
  function started(d, today) { return d.date <= today; }

  function validHead(d) {
    if (d.kind !== "person" && d.kind !== "loan") return false;
    if (!V.asset(d.asset) || !(Number.isFinite(d.amount) && d.amount > 0) || !valid(d.date)) return false;
    if (d.kind === "person" && !SIDES.includes(d.side)) return false;
    if (d.kind === "loan" && (!valid(d.due) || !(d.count >= 1))) return false;
    return true;
  }

  // Sahibi bilinen geçerli kayıtlar: items (borç / alacak / kredi), pays (debtId → ödemeler, tarihe göre), settlements
  // (kart payı ödemeleri), payer (ilk kişi: kartları ödeyen)
  function known(state) {
    const people = new Set((state.people || []).map(p => p.id));
    const payer = state.people?.[0]?.id ?? null;
    const items = [], pays = new Map(), settlements = [];
    for (const d of state.debts || []) {
      if (d && people.has(d.personId) && validHead(d)) { items.push(d); pays.set(d.id, []); }
    }
    for (const x of state.debts || []) {
      if (!x || x.kind !== "payment" || !(Number.isFinite(x.amount) && x.amount > 0) || !valid(x.date)) continue;
      if (x.debtId) pays.get(x.debtId)?.push(x);
      else if (people.has(x.personId) && x.personId !== payer) settlements.push(x);
    }
    for (const list of pays.values()) list.sort(byDate);
    settlements.sort(byDate);
    return { items, pays, settlements, payer };
  }

  // ---------- Plan ve durum ----------
  // Planlı taksitler: [{ no, key, amount }]; vadesizse boş
  function schedule(d) {
    if (!valid(d.due)) return [];
    const count = Number.isInteger(d.count) && d.count > 0 ? d.count : 1;
    return T.payments({ total: d.amount, count, date: d.due }, null).map(x => ({ no: x.no, key: x.key, amount: x.amount }));
  }

  // Kendiliğinden ödenen (kredi, autoPay) borcun taksitleri, erken ödemeler sondan düşülmüş ve kapandıktan sonrakiler
  // atılmış: [{ no, key, amount, before (date'ten önce: takipten önce ödenmiş) }]
  function plan(d, pays = []) {
    const items = schedule(d).map(x => ({ ...x, before: x.key < d.date }));
    for (const p of pays) {
      let rest = p.amount;
      for (let i = items.length - 1; i >= 0 && rest > EPS; i--) {
        const x = items[i];
        if (x.key <= p.date || x.before) break;
        const cut = Math.min(rest, x.amount);
        x.amount -= cut;
        rest -= cut;
      }
    }
    return items.filter(x => x.amount > EPS && !(d.closed && x.key >= d.closed));
  }

  // Borcun bugünkü durumu. remaining: ödenecek (borçta) ya da alınacak (alacakta) kalan, varlığın biriminde.
  // items: taksitler { no, key, amount, covered, state: "paid" | "due" | "late" | "open" }
  function status(d, pays = [], today) {
    const isStarted = started(d, today);
    const closed = !!d.closed && d.closed <= today;
    const paidIn = sum(pays.filter(p => p.date <= today));
    const cost = d.principal > 0 ? d.amount - d.principal : 0;
    const out = { started: isStarted, closed, cost, paid: 0, remaining: 0, overdue: 0, overdueSince: null, next: null,
      paidCount: 0, count: 0, items: [], done: false, auto: auto(d) };

    if (auto(d)) {
      const all = schedule(d);
      const items = plan(d, pays);
      const left = items.filter(x => x.key >= today);
      out.count = all.length;
      out.paidCount = all.length - left.length;
      out.items = all.map(x => {
        const cur = items.find(y => y.no === x.no);
        const st = !cur ? "paid" : x.key < today ? "paid" : x.key === today ? "due" : "open";
        return { no: x.no, key: x.key, amount: cur ? cur.amount : x.amount, covered: !cur || x.key < today, state: st };
      });
      out.remaining = isStarted ? sum(left) : 0;
      out.paid = sum(items.filter(x => !x.before && x.key < today)) + paidIn;
      const n = left[0];
      out.next = n ? { date: n.key, amount: sum(left.filter(x => x.key === n.key)), no: n.no } : null;
    } else {
      out.paid = paidIn;
      out.remaining = isStarted && !closed ? Math.max(0, d.amount - paidIn) : 0;
      let pool = paidIn;
      const items = schedule(d);
      out.count = items.length;
      out.items = items.map(x => {
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
  // Kartın taksitleri (kişisi bilinen harcamalar; cardStats'taki gibi): [{ ...ödeme, personId, purchase }]
  function cardLines(state, card) {
    const people = new Set((state.people || []).map(p => p.id));
    const out = [];
    for (const p of state.installments || []) {
      if (p.cardId !== card.id || !people.has(p.personId)) continue;
      for (const x of T.payments(p, card)) out.push({ ...x, personId: p.personId, purchase: p });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  // Kartın borcu: total (= cardStats.used, T.outstanding), kişi başına, sıradaki ekstre (cut: kesilmiş, ödeme bekliyor)
  function cardDebt(state, card, today) {
    const lines = cardLines(state, card);
    const owed = lines.filter(x => x.key >= today && !(x.at > today));
    const byPerson = {};
    for (const x of owed) add(byPerson, x.personId, x.amount);
    const open = T.statementOf(card, today);
    const first = owed[0];
    let next = null;
    if (first) {
      const same = owed.filter(x => x.key === first.key);
      const nb = {};
      for (const x of same) add(nb, x.personId, x.amount);
      next = { date: first.key, amount: sum(same), byPerson: nb, cut: first.key < open.due };
    }
    return { card, total: T.outstanding(lines, today), byPerson, next, open: { cut: open.cut, due: open.due },
      tracked: tracked(card), since: tracked(card) ? since(card, today) : null };
  }

  // Takipteki kartlarda since ≤ son ödeme < today ekstreler (TL): ilk kişinin varlığından düşer
  function cardPaid(state, today) {
    let total = 0;
    for (const c of state.cards || []) {
      if (!tracked(c)) continue;
      const from = since(c, today);
      total += sum(cardLines(state, c).filter(x => x.key >= from && x.key < today && !(x.at > today)));
    }
    return total;
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
      for (const x of cardLines(state, c)) {
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

  // Kullanıcının ödeyecekleri (borç tarafı: kredi / borç taksitleri ve beklenen ödemeler), from…to: Özet, Akış, içgörüler
  function paymentsDue(state, today, from, to, pid) {
    return allFlows(state, today, from, to, pid)
      .filter(f => f.debt && side(f.debt) === "debt" && (f.type === "inst" || f.type === "plan"));
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

    const receivable = { people: 0, cards: 0, total: 0 };
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
    const cardList = (state.cards || []).map(c => cardDebt(state, c, today));
    let untracked = 0;
    if (withPayer) {
      for (const c of cardList) {
        if (c.tracked) debt.cards += c.total; else untracked += c.total;
      }
      for (const s of shares(state, today).values()) {
        if (s.remaining > 0) receivable.cards += s.remaining;
        else debt.overpaid -= s.remaining;
      }
    }
    for (const [code, v] of Object.entries(cashDebt(state, today, pid === "all" ? undefined : pid))) debt.cash += tl(v, code);
    receivable.total = receivable.people + receivable.cards;
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
    KINDS, SIDES, tracked, since, ensureTracking, side, sign, auto, started, known, schedule, plan, status, flows,
    cardLines, cardDebt, cardPaid, shares, shareItems, cashDebt, allFlows, debtSpent, addSpent, spent, paymentsDue, totals,
    flowText, loanRate, lastIndex,
  };
  if (node) module.exports = api;
  else root.Borc = api;
})(this);

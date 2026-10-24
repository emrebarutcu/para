import test from "node:test";
import assert from "node:assert/strict";
import B from "../../borc.js";
import T from "../../taksit.js";

const RATES = { TRY: 1, USD: 40, EUR: 45, GAU: 4000 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg ?? ""} ${a} ≠ ${b}`);

// Örnek: Ben ₺50.000; Bonus (kesim 12, son ödeme 22) 1 Kas'tan beri takipte; Ben'in TV'si 3 × 2.000 (5 Eki → 22 Eki, Kas,
// Ara); Annem'in telefonu 3 × 1.000 (20 Eki → 22 Kas, Ara, Oca)
function base() {
  return {
    people: [{ id: "ben", name: "Ben", color: 0 }, { id: "anne", name: "Annem", color: 1 }],
    cards: [{ id: "bonus", name: "Bonus", limit: 50000, cutoffDay: 12, dueDay: 22, color: 0, trackSince: "2026-11-01" }],
    installments: [
      { id: "tv", personId: "ben", cardId: "bonus", desc: "TV", total: 6000, count: 3, date: "2026-10-05" },
      { id: "tel", personId: "anne", cardId: "bonus", desc: "Telefon", total: 3000, count: 3, date: "2026-10-20" },
    ],
    entries: [{ id: "e1", personId: "ben", asset: "TRY", amount: 50000, desc: "Açılış", date: "2026-10-01" }],
    debts: [],
  };
}

// Olaylar sırayla eklenir; her gün için beklenen eldeki / alacak / borç
function scenario() {
  const s = base();
  const steps = [
    ["2026-11-01", () => {}, 50000, 3000, 7000],
    ["2026-11-05", () => s.debts.push({ id: "m", kind: "person", side: "debt", personId: "ben", party: "Mehmet", asset: "TRY",
      amount: 10000, principal: 10000, date: "2026-11-05", due: "2027-01-05" }), 60000, 3000, 17000],
    ["2026-11-10", () => s.debts.push({ id: "kr", kind: "loan", personId: "ben", party: "Garanti", asset: "TRY", amount: 22000,
      principal: 20000, date: "2026-11-10", due: "2026-12-10", count: 4 }), 80000, 3000, 39000],
    ["2026-11-22", () => {}, 80000, 3000, 39000],                       // ekstre günü: henüz ödenmedi
    ["2026-11-23", () => {}, 77000, 3000, 36000],                       // 22 Kas ekstresi (2.000 + 1.000) düştü
    ["2026-11-25", () => s.debts.push({ id: "s1", kind: "payment", personId: "anne", amount: 1000, date: "2026-11-25" }), 78000, 2000, 36000],
    ["2026-11-26", () => s.debts.push({ id: "ali", kind: "person", side: "receivable", personId: "ben", party: "Ali", asset: "TRY",
      amount: 5000, principal: 5000, date: "2026-11-26" }), 73000, 7000, 36000],
    ["2026-12-11", () => {}, 67500, 7000, 30500],                       // 10 Ara kredi taksiti
    ["2026-12-11", () => s.installments.push({ id: "mkt", personId: "ben", cardId: null, desc: "Market", total: 1500, count: 1,
      date: "2026-12-11" }), 66000, 7000, 30500],
  ];
  return { s, steps };
}

test("örnek: Varlık = Özvarlık + Borç her adımda; özvarlık yalnızca faiz ve harcamayla değişir", () => {
  const { s, steps } = scenario();
  let equity = null;
  const expectedEquity = [46000, 46000, 44000, 44000, 44000, 44000, 44000, 44000, 42500];
  steps.forEach(([day, act, cash, receivable, debt], i) => {
    act();
    const t = B.totals(s, day, RATES);
    near(t.cash, cash, `${day} eldeki`);
    near(t.receivable.total, receivable, `${day} alacak`);
    near(t.debt.total, debt, `${day} borç`);
    near(t.assets, cash + receivable, `${day} varlık`);
    near(t.equity, t.assets - t.debt.total, `${day} eşitlik`);
    near(t.equity, expectedEquity[i], `${day} özvarlık`);
    equity = t.equity;
  });
  assert.equal(equity, 42500);
  const last = B.totals(s, "2026-12-11", RATES);
  near(last.debt.cards, 4000);
  near(last.debt.people, 10000);
  near(last.debt.loans, 16500);
});

test("ekstre takibi olmadan özvarlık ekstre gününde sıçrar (takip bunu önler)", () => {
  const s = base();
  s.cards[0].trackOff = true;
  const before = B.totals(s, "2026-11-22", RATES), after = B.totals(s, "2026-11-23", RATES);
  assert.equal(before.debt.cards, 0);
  near(before.untracked, 7000);
  near(after.cash, 50000);   // takip dışı kartın ekstresi düşmez
  const tracked = base();
  near(B.totals(tracked, "2026-11-22", RATES).equity, B.totals(tracked, "2026-11-23", RATES).equity, "takipte sabit");
});

test("kart borcu cardStats.used ile aynı; sıradaki ekstre kesilmiş mi", () => {
  const s = base();
  const c = s.cards[0];
  const used = T.outstanding(s.installments.filter(p => p.cardId === c.id).flatMap(p => T.payments(p, c)), "2026-11-15");
  const d = B.cardDebt(s, c, "2026-11-15");
  near(d.total, used);
  near(d.total, 7000);
  assert.deepEqual(d.next, { date: "2026-11-22", amount: 3000, byPerson: { ben: 2000, anne: 1000 }, cut: true });
  assert.equal(B.cardDebt(s, c, "2026-11-05").next.cut, false);   // 12 Kas kesimi henüz gelmedi
  near(d.byPerson.anne, 3000);
});

test("trackSince boşsa bugünden takipte sayılır; ensureTracking doldurur, takip dışını atlar", () => {
  const s = base();
  delete s.cards[0].trackSince;
  s.cards.push({ id: "w", name: "World", limit: 0, cutoffDay: 1, dueDay: 10, color: 1, trackOff: true });
  const t = B.totals(s, "2026-11-23", RATES);
  near(t.cash, 50000);                       // düşülen yok
  near(t.receivable.cards, 2000);            // bugünden sonraki pay
  const cards = B.ensureTracking(s, "2026-11-23");
  assert.equal(cards[0].trackSince, "2026-11-23");
  assert.equal(cards[1].trackSince, undefined);
  assert.equal(B.ensureTracking({ ...s, cards }, "2026-11-24"), null);
});

test("kart payı: ödenen, ödemesi gelen, fazla ödeme borca geçer", () => {
  const s = base();
  s.debts.push({ id: "s1", kind: "payment", personId: "anne", amount: 500, date: "2026-11-25" });
  let sh = B.shares(s, "2026-11-25").get("anne");
  near(sh.charged, 3000);
  near(sh.settled, 500);
  near(sh.dueNow, 500);
  assert.deepEqual(sh.next, { date: "2026-12-22", amount: 1000 });
  const items = B.shareItems(s, "anne", "2026-11-25");
  assert.deepEqual(items.map(x => x.covered), [500, 0, 0]);
  s.debts.push({ id: "s2", kind: "payment", personId: "anne", amount: 3000, date: "2026-11-26" });
  sh = B.shares(s, "2026-11-26").get("anne");
  near(sh.remaining, -500);
  const t = B.totals(s, "2026-11-26", RATES);
  near(t.debt.overpaid, 500);
  near(t.receivable.cards, 0);
});

test("kredi: yarısında girilen kredi, erken ödeme sondan düşer, kapatma", () => {
  const d = { id: "k", kind: "loan", personId: "ben", asset: "TRY", amount: 12000, date: "2026-11-15", due: "2026-06-15", count: 12 };
  let st = B.status(d, [], "2026-11-15");
  assert.equal(st.paidCount, 5);           // Haz–Eki ödenmiş (takipten önce)
  assert.equal(st.next.date, "2026-11-15");
  near(st.remaining, 7000);                // bugünkü dahil 7 taksit
  assert.deepEqual(B.flows(d, [], "2026-11-15").filter(f => f.type === "open"), []);   // çekilen tutar yok
  near(B.debtSpent({ people: [{ id: "ben" }], cards: [], installments: [], debts: [d] }, "2026-11-15").TRY ?? 0, 0);
  const pay = { id: "p", kind: "payment", personId: "ben", debtId: "k", amount: 2500, date: "2026-11-20" };
  st = B.status(d, [pay], "2026-11-20");
  near(st.remaining, 6000 - 2500);         // 16 Kas–15 May: 6 taksit, sondan 2.500
  assert.equal(B.plan(d, [pay]).at(-1).key, "2027-03-15");   // May ve Nis kapandı, Mar'tan 500
  near(B.plan(d, [pay]).at(-1).amount, 500);
  st = B.status({ ...d, closed: "2026-11-20" }, [pay], "2026-11-20");
  assert.equal(st.remaining, 0);
  assert.equal(st.done, true);
});

test("kişisel borç: elle ödeme, ilk giren ilk çıkar ve gecikme; otomatik ödemede tarih gelince düşer", () => {
  const d = { id: "x", kind: "person", side: "receivable", personId: "ben", party: "Ali", asset: "TRY", amount: 6000,
    principal: 6000, date: "2026-10-01", due: "2026-10-05", count: 3 };
  const pays = [{ id: "a", kind: "payment", personId: "ben", debtId: "x", amount: 2500, date: "2026-10-06" }];
  const st = B.status(d, pays, "2026-11-10");
  near(st.remaining, 3500);
  near(st.overdue, 1500);                  // Kas taksitinin 1.500'ü gecikti
  assert.equal(st.overdueSince, "2026-11-05");
  assert.deepEqual(st.next, { date: "2026-12-05", amount: 2000, no: 3 });
  const late = B.flows(d, pays, "2026-11-10").find(f => f.late);
  assert.equal(late.date, "2026-11-10");
  near(late.amount, 1500);                 // alacak: para gelecek
  // Otomatik: Kas taksiti 6 Kas'ta ödenmiş sayılır
  const auto = { ...d, autoPay: true };
  const s = { people: [{ id: "ben" }], cards: [], installments: [], debts: [auto] };
  near(B.debtSpent(s, "2026-11-05").TRY, 6000 - 2000);          // −6.000 verildi + 2.000 alındı (5 Eki)
  near(B.debtSpent(s, "2026-11-06").TRY, 6000 - 4000);
  near(B.status(auto, [], "2026-11-06").remaining, 2000);
  assert.equal(B.status(auto, [], "2026-11-06").overdue, 0);
});

test("ileri tarihli borç başlamamıştır; döviz borcu kurla, kuru yoksa sayılmaz", () => {
  const s = base();
  s.debts.push({ id: "f", kind: "person", side: "debt", personId: "ben", party: "Can", asset: "USD", amount: 100, principal: 100,
    date: "2026-12-01" });
  let t = B.totals(s, "2026-11-23", RATES);
  near(t.debt.people, 0);
  near(t.cash, 47000);
  t = B.totals(s, "2026-12-01", RATES);
  near(t.debt.people, 4000);
  near(t.cash, 47000 + 4000);
  near(t.equity, B.totals(s, "2026-11-30", RATES).equity);
  t = B.totals(s, "2026-12-01", { TRY: 1 });
  near(t.debt.people, 0);
  assert.deepEqual(t.missing, ["USD"]);
});

test("kişi silinince ödeyenin özvarlığı değişmez", () => {
  const { s, steps } = scenario();
  for (const [, act] of steps) act();
  const before = B.totals(s, "2026-12-11", RATES, "ben");
  const gone = { ...s, people: s.people.filter(p => p.id !== "anne"), installments: s.installments.filter(p => p.personId !== "anne"),
    debts: s.debts.filter(d => d.personId !== "anne") };
  near(B.totals(gone, "2026-12-11", RATES, "ben").equity, before.equity);
});

test("borç kaydı olmayan veri sıfır döner; ödenecekler ve metinler", () => {
  const empty = { people: [{ id: "ben", name: "Ben" }], cards: [], installments: [], entries: [] };
  const t = B.totals(empty, "2026-11-01", RATES);
  assert.equal(t.debt.total, 0);
  assert.equal(t.assets, 0);
  const { s, steps } = scenario();
  for (const [, act] of steps) act();
  const due = B.paymentsDue(s, "2026-12-11", "2026-12-01", "2026-12-31");
  assert.deepEqual(due.map(f => [f.date, f.amount, f.type]), [["2026-12-10", -5500, "inst"]]);
  assert.equal(B.flowText(due[0], s), "Garanti · taksit 1/4");
  assert.ok(Math.abs(B.loanRate(s.debts.find(d => d.id === "kr")) * 100 - 3.92) < 0.01, "aylık faiz");
  assert.equal(B.lastIndex(s, "2026-12-11"), T.monthIndex("2027-03"));
});

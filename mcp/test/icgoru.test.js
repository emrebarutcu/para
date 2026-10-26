import test from "node:test";
import assert from "node:assert/strict";
import I from "../../icgoru.js";
import K from "../../kategori.js";
import T from "../../taksit.js";

const TODAY = "2026-10-20";
const base = () => ({
  people: [{ id: "ben", name: "Ben", color: 0 }, { id: "ali", name: "Ali", color: 1 }],
  cards: [
    { id: "bonus", name: "Bonus", limit: 10000, cutoffDay: 19, dueDay: 29, color: 0 },   // bugün → 19 Kas kesim, 29 Kas
    { id: "world", name: "World", limit: 0, cutoffDay: 25, dueDay: 5, color: 1 },        // bugün → 25 Eki kesim, 5 Kas
  ],
  installments: [],
  entries: [],
});
const ids = list => list.map(x => x.id);

test("gelir yoksa gelir eklemeyi önerir; borcun biteceği ay", () => {
  const s = base();
  s.installments.push({ id: "tv", personId: "ben", cardId: "bonus", desc: "Televizyon", total: 6000, count: 6, date: "2026-10-01" });
  const out = I.insights(s, { today: TODAY });
  assert.ok(ids(out).includes("gelir"));
  const end = out.find(x => x.id === "bitis");
  assert.equal(end.data.lastMonth, "2027-03");   // 19 Eki kesimi 29 Eki'de; 6 taksit Eki…Mar
  assert.equal(end.data.remaining, 6000);
});

test("maaş tekrarlıysa serbest nakit ve taksit / gelir oranı; açık veren ay uyarılır", () => {
  const s = base();
  s.entries.push({ id: "maas", personId: "ben", asset: "TRY", amount: 30000, desc: "Maaş", date: "2026-01-15", repeat: 0 });
  s.entries.push({ id: "kira", personId: "ben", asset: "TRY", amount: -12000, desc: "Kira", date: "2026-01-01", repeat: 0 });
  s.installments.push({ id: "tel", personId: "ben", cardId: "world", desc: "Telefon", total: 60000, count: 6, date: "2026-10-26" });
  const out = I.insights(s, { today: TODAY });
  // 26 Eki → 25 Kas kesim, 5 Ara ödeme: Ekim'de ödeme yok, Aralık'tan itibaren ayda 10.000
  const free = out.find(x => x.id === "serbest");
  assert.equal(free.data.net, 18000);
  const load = out.find(x => x.id === "yuk");
  assert.equal(load.data.payments, 40000);   // Ara, Oca, Şub, Mar (6 aylık pencerede)
  assert.equal(load.data.income, 180000);
  assert.equal(load.tone, "info");

  s.installments.push({ id: "araba", personId: "ben", cardId: "world", desc: "Araba tamiri", total: 25000, count: 1, date: "2026-10-26" });
  const warn = I.insights(s, { today: TODAY });
  assert.equal(warn[0].id, "acik");
  assert.equal(warn[0].data.month, "2026-12");
  assert.equal(warn[0].data.net, -17000);   // 30.000 − 12.000 − 35.000
  assert.ok(ids(warn).includes("sicrama"));
});

test("limit dolmak üzere; kart seçimi: ilk ödemesi en geç olan", () => {
  const s = base();
  s.installments.push({ id: "pc", personId: "ben", cardId: "bonus", desc: "Laptop", total: 9000, count: 3, date: "2026-10-21" });
  const out = I.insights(s, { today: TODAY });
  assert.equal(out.find(x => x.id === "limit-bonus").tone, "warn");
  const card = out.find(x => x.id === "kart");
  assert.equal(card.data[0].card, "Bonus");
  assert.equal(card.data[0].firstPayment, "2026-11-29");
  assert.equal(card.data[1].firstPayment, "2026-11-05");

  // Hesaba katılmayan kart (ör. eşinin kartı) önerilmez, limiti için uyarı çıkmaz
  s.cards[0].trackOff = true;
  const off = I.insights(s, { today: TODAY });
  assert.ok(!ids(off).includes("limit-bonus"));
  assert.ok(!(off.find(x => x.id === "kart")?.data ?? []).some(x => x.card === "Bonus"));
});

test("düzenli ödemeler, kategori artışı ve diğer kişilerin payı", () => {
  const s = base();
  for (const m of ["07", "08", "09", "10"]) {
    s.installments.push({ id: `nf${m}`, personId: "ben", cardId: null, desc: "NETFLIX.COM 1234", total: 229.99, count: 1, date: `2026-${m}-03`, category: "eglence", categoryBy: "ai" });
    s.installments.push({ id: `mg${m}`, personId: "ben", cardId: null, desc: "Migros", total: m === "10" ? 5200 : 3000, count: 1, date: `2026-${m}-10`, category: "market", categoryBy: "user" });
  }
  s.installments.push({ id: "ayk", personId: "ali", cardId: null, desc: "Ayakkabı", total: 1500, count: 1, date: "2026-10-12" });
  for (const c of s.cards) c.trackOff = true;   // takipte kart yok: paylar çıkar
  const out = I.insights(s, { today: TODAY });
  const subs = out.find(x => x.id === "duzenli");
  assert.deepEqual(subs.data.map(x => x.name), ["NETFLIX.COM 1234"]);   // Migros tutarları çok farklı: düzenli sayılmaz
  const jump = out.find(x => x.id === "kategori-market");
  assert.equal(jump.data.month, 5200);
  assert.equal(jump.data.average, 3000);
  const shares = out.find(x => x.id === "paylar");
  assert.deepEqual(shares.data, [{ person: "Ali", personId: "ali", amount: 1500 }]);

  const cats = I.categoryBreakdown(s, 2026 * 12 + 9);
  assert.deepEqual(cats.rows.map(r => r.id), ["market", "", "eglence"]);
  assert.equal(cats.compared, 3);
});

const OCT = 2026 * 12 + 9;

test("borç: kredi taksiti ödemelere, çekilen para inflow'a girer (gelir ve serbest nakit değildir), verilen borç gider", () => {
  const s = base();
  s.entries.push({ id: "maas", personId: "ben", asset: "TRY", amount: 30000, desc: "Maaş", date: "2026-01-15", repeat: 0 });
  s.debts = [
    // 10.000 çekildi, 4 × 3.000 (15 Kas, Ara, Oca, Şub)
    { id: "kr", kind: "loan", personId: "ben", party: "Garanti", asset: "TRY", amount: 12000, principal: 10000, date: "2026-10-15",
      due: "2026-11-15", count: 4 },
    // Can'a 4.000 verildi, vadesi 18 Ara
    { id: "can", kind: "person", side: "receivable", personId: "ben", party: "Can", asset: "TRY", amount: 4000, principal: 4000,
      date: "2026-10-18", due: "2026-12-18" },
  ];
  const oct = I.monthFlows(s, OCT, null, [], TODAY);
  assert.deepEqual([oct.income, oct.inflow, oct.outflow, oct.payments, oct.net], [30000, 10000, 4000, 0, 26000]);
  const nov = I.monthFlows(s, OCT + 1, null, [], TODAY);
  assert.deepEqual([nov.inflow, nov.payments, nov.net], [0, 3000, 27000]);
  const dec = I.monthFlows(s, OCT + 2, null, [], TODAY);
  assert.deepEqual([dec.inflow, dec.payments, dec.net], [4000, 3000, 27000]);   // beklenen tahsilat net'e girmez
  // 4 parametreyle de çalışır (today = bugün); kredi taksiti tarihinde
  const old = I.monthFlows(s, OCT + 1, null, []);
  assert.equal(old.payments, 3000);
  assert.equal(old.income, 30000);

  const out = I.insights(s, { today: TODAY });
  assert.equal(out.find(x => x.id === "serbest").data.net, 26000);
  const load = out.find(x => x.id === "yuk");
  assert.equal(load.data.payments, 12000);
  assert.equal(load.data.income, 180000);
  assert.match(load.text, /kart, kredi ve taksit ödemelerine/);
  assert.ok(!ids(out).includes("duzenli"));      // borç düzenli ödeme değildir
  assert.ok(!ids(out).includes("borc-vade"));    // sıradaki taksit 26 gün sonra

  // Gelir girişi yoksa çekilen kredi gelir sayılmaz
  const noIncome = base();
  noIncome.debts = [s.debts[0]];
  noIncome.installments.push({ id: "tv", personId: "ben", cardId: "bonus", desc: "Televizyon", total: 6000, count: 6, date: "2026-10-01" });
  const res = I.insights(noIncome, { today: TODAY });
  assert.ok(ids(res).includes("gelir"));
  assert.ok(!ids(res).includes("serbest") && !ids(res).includes("acik"));
});

test("borc-vade: geciken ve 7 gün içindeki borç ödemeleri; kapanan, başlamamış ve uzak olanlar girmez; geciken alacak", () => {
  const s = base();
  s.debts = [
    // 3 × 1.000 (15 Eyl, Eki, Kas); 20 Eyl'de 1.500 ödendi → Eki taksitinin 500'ü gecikti
    { id: "m", kind: "person", side: "debt", personId: "ben", party: "Mehmet", asset: "TRY", amount: 3000, principal: 3000,
      date: "2026-08-01", due: "2026-09-15", count: 3 },
    { id: "p1", kind: "payment", personId: "ben", debtId: "m", amount: 1500, date: "2026-09-20" },
    // kredi: sıradaki taksit 25 Eki (5 gün sonra); diğerinin 10 Kas (uzak)
    { id: "kr", kind: "loan", personId: "ben", party: "Garanti", asset: "TRY", amount: 12000, date: "2026-09-01", due: "2026-09-25", count: 4 },
    { id: "kr2", kind: "loan", personId: "ben", party: "Akbank", asset: "TRY", amount: 6000, date: "2026-10-01", due: "2026-11-10", count: 6 },
    // dolar borcu, vadesi 22 Eki
    { id: "usd", kind: "person", side: "debt", personId: "ali", party: "Can", asset: "USD", amount: 100, principal: 100,
      date: "2026-10-01", due: "2026-10-22" },
    // kapanmış ve henüz başlamamış: girmez
    { id: "k", kind: "person", side: "debt", personId: "ben", party: "Kapanan", asset: "TRY", amount: 1000, date: "2026-08-01",
      due: "2026-09-01", closed: "2026-10-01" },
    { id: "f", kind: "person", side: "debt", personId: "ben", party: "İleri", asset: "TRY", amount: 1000, date: "2026-10-25",
      due: "2026-10-26" },
    // alacak: 1 Eki vadesi geçti
    { id: "r", kind: "person", side: "receivable", personId: "ben", party: "Veli", asset: "TRY", amount: 2000, principal: 2000,
      date: "2026-09-01", due: "2026-10-01" },
  ];
  const out = I.insights(s, { today: TODAY });
  const due = out.find(x => x.id === "borc-vade");
  assert.equal(due.tone, "warn");
  assert.equal(due.title, "Borç ödemen gecikti");
  assert.deepEqual(due.action, { kind: "debt", label: "Borçlar" });
  assert.deepEqual(due.data, [
    { debtId: "m", party: "Mehmet", amount: 500, asset: "TRY", date: "2026-10-15", overdue: true },
    { debtId: "usd", party: "Can", amount: 100, asset: "USD", date: "2026-10-22", overdue: false },
    { debtId: "kr", party: "Garanti", amount: 3000, asset: "TRY", date: "2026-10-25", overdue: false },
  ]);
  assert.match(due.text, /^Mehmet ₺500 \(5 gün gecikti\), Can \$100 \(22 Eki, 2 gün sonra\), Garanti ₺3\.000 \(25 Eki, 5 gün sonra\)\./);

  const owed = out.find(x => x.id === "alacak");
  assert.equal(owed.tone, "warn");
  assert.equal(owed.title, "Alacağın gecikti");
  assert.deepEqual(owed.action, { kind: "debt", label: "Alacaklar" });
  assert.deepEqual(owed.data, [{ debtId: "r", name: "Veli", amount: 2000, asset: "TRY", date: "2026-10-01", overdue: true }]);

  // Ödenince ve kapanınca uyarı kalkar
  s.debts.push({ id: "p2", kind: "payment", personId: "ben", debtId: "m", amount: 500, date: "2026-10-20" });
  s.debts.push({ id: "p3", kind: "payment", personId: "ben", debtId: "r", amount: 2000, date: "2026-10-20" });
  const after = I.insights(s, { today: TODAY });
  assert.deepEqual(after.find(x => x.id === "borc-vade").data.map(x => x.debtId), ["usd", "kr"]);
  assert.equal(after.find(x => x.id === "borc-vade").title, "2 borç ödemesi yaklaşıyor");
  assert.ok(!ids(after).includes("alacak"));
});

// Bonus (kesim 19, son ödeme 29) 1 Eyl'den beri takipte ve elle ödeniyor; TV 3 × 1.000 → 29 Eyl, 29 Eki, 29 Kas
function manualCard() {
  const s = base();
  Object.assign(s.cards[0], { trackSince: "2026-09-01", manualSince: "2026-09-01" });
  s.installments.push({ id: "tv", personId: "ben", cardId: "bonus", desc: "TV", total: 3000, count: 3, date: "2026-09-10" });
  s.debts = [];
  return s;
}
const cardPay = (id, amount, date) => ({ id, kind: "payment", personId: "ben", cardId: "bonus", amount, date });

test("borc-vade: elle ödenen kartın geciken ekstresi ve elle kredi; otomatik kartta ve ödenince yok", () => {
  const s = manualCard();
  // World otomatik: 25 Eyl kesimli ekstre 5 Eki'de kendiliğinden ödendi, uyarı yok
  s.cards[1].trackSince = "2026-09-01";
  s.installments.push({ id: "ks", personId: "ben", cardId: "world", desc: "Kitap", total: 500, count: 1, date: "2026-09-20" });
  // Elle kredi: 5 Eki taksiti ödenmedi
  s.debts.push({ id: "kr", kind: "loan", personId: "ben", party: "Garanti", asset: "TRY", amount: 3000, date: "2026-09-01",
    due: "2026-10-05", count: 3, autoPay: false });
  let due = I.insights(s, { today: TODAY }).find(x => x.id === "borc-vade");
  assert.equal(due.title, "2 ödemen gecikti");
  assert.deepEqual(due.data, [
    { cardId: "bonus", party: "Bonus", amount: 1000, asset: "TRY", date: "2026-09-29", overdue: true },
    { debtId: "kr", party: "Garanti", amount: 1000, asset: "TRY", date: "2026-10-05", overdue: true },
  ]);
  assert.equal(due.text, "Bonus ekstresi ₺1.000 (21 gün gecikti), Garanti ₺1.000 (15 gün gecikti). Ödediysen Borçlar'da satırındaki “Ödendi”ye dokun.");

  // Ekstre kısmen ödenince kalanı gecikmiş kalır; tamamı ödenince kart uyarısı kalkar (kart ödemesi alacak da değildir)
  s.debts.push(cardPay("c1", 400, "2026-10-01"));
  due = I.insights(s, { today: TODAY }).find(x => x.id === "borc-vade");
  assert.deepEqual(due.data[0], { cardId: "bonus", party: "Bonus", amount: 600, asset: "TRY", date: "2026-09-29", overdue: true });
  // Yalnızca kart ekstresi gecikmişse başlıkta adı
  assert.equal(I.insights({ ...s, debts: s.debts.filter(x => x.id !== "kr") }, { today: TODAY }).find(x => x.id === "borc-vade").title, "Bonus ekstresi gecikti");
  s.debts.push(cardPay("c2", 600, "2026-10-20"));
  const out = I.insights(s, { today: TODAY });
  assert.deepEqual(out.find(x => x.id === "borc-vade").data.map(x => x.debtId ?? x.cardId), ["kr"]);
  assert.equal(out.find(x => x.id === "borc-vade").title, "Borç ödemen gecikti");
  assert.ok(!ids(out).includes("alacak"));

  // Otomatiğe dönen kartta ekstreler ödenmiş sayılır
  delete s.cards[0].manualSince;
  s.debts = s.debts.filter(x => !x.cardId);
  assert.deepEqual(I.insights(s, { today: TODAY }).find(x => x.id === "borc-vade").data.map(x => x.debtId ?? x.cardId), ["kr"]);
});

test("limit kullanımı bugüne göre (alışveriş gününe değil); elle kartta ödenmemiş geçmiş ekstre de kullanımda", () => {
  const s = manualCard();
  // 29 Eyl ekstresi ödenmedi: 3.000 kullanımda (otomatikte 2.000)
  const used = date => I.cardTiming(s, date, TODAY).find(x => x.card.id === "bonus");
  assert.equal(used("2026-10-20").used, 3000);
  assert.equal(used("2026-12-01").used, 3000);    // alışveriş günü ileride olsa da bugünkü kullanım
  assert.equal(used("2026-12-01").available, 7000);
  assert.equal(used("2026-12-01").due, "2026-12-29");
  s.debts.push(cardPay("c1", 1000, "2026-10-20"));
  assert.equal(used("2026-10-20").used, 2000);
  delete s.cards[0].manualSince;
  s.debts = [];
  assert.equal(used("2026-10-20").used, 2000);

  // Limit içgörüsü de aynı kullanımla: 8.000'lik ödenmemiş ekstreyle %80 dolu
  const big = manualCard();
  big.installments.push({ id: "pc", personId: "ben", cardId: "bonus", desc: "Laptop", total: 5000, count: 1, date: "2026-09-12" });
  const limit = I.insights(big, { today: TODAY }).find(x => x.id === "limit-bonus");
  assert.deepEqual(limit.data, { card: "Bonus", used: 8000, limit: 10000 });
});

test("elle kart: ödenmemiş ekstre ödemelerde kendi ayında kalır; kart ödemesi ikinci kez ya da girdi olarak sayılmaz", () => {
  const months = s => T.buildCashflow(s.people, s.cards, s.installments, OCT - 1, OCT + 2);
  const flows = s => [OCT - 1, OCT, OCT + 1].map(idx => {
    const f = I.monthFlows(s, idx, null, months(s), TODAY);
    return [f.payments, f.inflow, f.outflow, f.net];
  });
  const salary = { id: "maas", personId: "ben", asset: "TRY", amount: 30000, desc: "Maaş", date: "2026-01-15", repeat: 0 };
  const auto = manualCard();
  delete auto.cards[0].manualSince;
  auto.entries.push(salary);
  const expected = [[1000, 0, 0, 29000], [1000, 0, 0, 29000], [1000, 0, 0, 29000]];
  assert.deepEqual(flows(auto), expected);
  // Elle kartta 29 Eyl ekstresi ödenmedi: yine Eylül ödemelerinde (months.total), bugüne taşınmaz
  const s = manualCard();
  s.entries.push(salary);
  assert.deepEqual(flows(s), expected);
  // 20 Eki'de 2.000 ödendi (Eyl ekstresi + Eki ekstresi önceden): ödemeler değişmez, toplam ekstrelerin toplamı kalır
  s.debts.push(cardPay("c1", 2000, "2026-10-20"));
  assert.deepEqual(flows(s), expected);
  assert.equal(I.insights(s, { today: TODAY }).find(x => x.id === "serbest").data.net, 29000);
});

test("alacak: takipteki kartta ödemesi gelen kart payı; paylar yalnızca takipte kart yokken", () => {
  const s = base();
  for (const c of s.cards) c.trackSince = "2026-09-01";
  // Ali'nin Bonus'taki 3 × 1.000'i: 29 Eyl, 29 Eki, 29 Kas; 1 Eki'de 400 ödedi
  s.installments.push({ id: "ayk", personId: "ali", cardId: "bonus", desc: "Ayakkabı", total: 3000, count: 3, date: "2026-09-10" });
  s.debts = [{ id: "s1", kind: "payment", personId: "ali", amount: 400, date: "2026-10-01" }];
  let out = I.insights(s, { today: TODAY });
  const owed = out.find(x => x.id === "alacak");
  assert.equal(owed.tone, "info");
  assert.equal(owed.title, "Günü gelen alacağın ₺600");
  assert.deepEqual(owed.data, [{ personId: "ali", name: "Ali", amount: 600, asset: "TRY" }]);
  assert.match(owed.text, /^Ali ₺600 \(kartındaki harcamaları\)\. .*hatırlatma/);
  assert.ok(!ids(out).includes("paylar"));   // takip açık: yerine alacak

  // Yalnızca World takipte: Bonus'taki pay alacak değil, paylar da çıkmaz
  s.cards[0].trackOff = true;
  out = I.insights(s, { today: TODAY });
  assert.ok(!ids(out).includes("alacak") && !ids(out).includes("paylar"));

  // Hiç hesaba katılan kart yok: hesaba katılmayan kartın harcamaları sayılmaz (paylar da çıkmaz); nakit harcamalarda
  // eski paylar içgörüsü
  s.cards[1].trackOff = true;
  out = I.insights(s, { today: TODAY });
  assert.ok(!ids(out).includes("alacak") && !ids(out).includes("paylar"));
  s.installments.push({ id: "kurs", personId: "ali", cardId: null, desc: "Kurs", total: 700, count: 1, date: "2026-10-05" });
  out = I.insights(s, { today: TODAY });
  assert.deepEqual(out.find(x => x.id === "paylar").data, [{ person: "Ali", personId: "ali", amount: 700 }]);
});

test("kategori: öğrenilen kategori aynı işyerinin farklı yazılışına da gelir; model örnekleri son seçimler", () => {
  const purchases = [
    { desc: "MIGROS TICARET A.S. ISTANBUL", category: "market", categoryBy: "user" },
    { desc: "Shell", category: "ulasim", categoryBy: "ai" },              // modelin tahmini öğretmez
    { desc: "Netflix", category: "eglence", categoryBy: "user" },
  ];
  const memory = K.learned(purchases);
  assert.equal(K.remembered("Migros Ticaret A.Ş. 0042", memory), "market");
  assert.equal(K.remembered("SHELL", memory), null);
  assert.deepEqual(K.examples(memory), [{ id: "market", text: "migros ticaret a s istanbul" }, { id: "eglence", text: "netflix" }]);

  // Sıralama: kategori kelimelerinden en benzer ikisinin ortalaması; kullanıcı örneği daha benzerse o kazanır
  const v = (...xs) => { const n = Math.hypot(...xs); return xs.map(x => x / n); };
  const protos = [
    { id: "market", v: v(1, 0, 0) }, { id: "market", v: v(0.9, 0.1, 0) },
    { id: "eglence", v: v(0, 1, 0) }, { id: "eglence", v: v(0, 0.9, 0.1) },
  ];
  const q = v(0.6, 0.5, 0.1);
  assert.equal(K.rank(q, protos).category, "market");
  const r = K.rank(q, protos, [{ id: "eglence", v: v(0.6, 0.5, 0.12) }]);
  assert.equal(r.category, "eglence");
  assert.ok(r.confidence > 0.5 && r.confidence <= 1);
});

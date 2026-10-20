import test from "node:test";
import assert from "node:assert/strict";
import I from "../../icgoru.js";
import K from "../../kategori.js";

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
});

test("düzenli ödemeler, kategori artışı ve diğer kişilerin payı", () => {
  const s = base();
  for (const m of ["07", "08", "09", "10"]) {
    s.installments.push({ id: `nf${m}`, personId: "ben", cardId: null, desc: "NETFLIX.COM 1234", total: 229.99, count: 1, date: `2026-${m}-03`, category: "eglence", categoryBy: "ai" });
    s.installments.push({ id: `mg${m}`, personId: "ben", cardId: null, desc: "Migros", total: m === "10" ? 5200 : 3000, count: 1, date: `2026-${m}-10`, category: "market", categoryBy: "user" });
  }
  s.installments.push({ id: "ayk", personId: "ali", cardId: null, desc: "Ayakkabı", total: 1500, count: 1, date: "2026-10-12" });
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

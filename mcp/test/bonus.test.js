// Japonya'da bonus ödemesi (ボーナス払い; taksit.js bonus): ödeme günleri, ekstreler, limit, nakit akışı, içgörü,
// tablo satırları ve asistan araçları.
import test from "node:test";
import assert from "node:assert/strict";
import T from "../../taksit.js";
import B from "../../borc.js";
import I from "../../icgoru.js";
import P from "../../para.js";
import Tablo from "../../tablo.js";
import { TOOLS } from "../tools.js";

// JCB / SMBC gibi: 15'inde kesim, ertesi ay 10'unda ödeme. Rakuten gibi: ay sonu kesim, ertesi ay 27'si.
const JCB = { id: "jcb", name: "JCB", limit: 500000, cutoffDay: 15, dueDay: 10, color: 0 };
const RAKUTEN = { id: "rak", name: "Rakuten", limit: 0, cutoffDay: 31, dueDay: 27, color: 1 };
const buy = (date, total, count = 1, extra = {}) => ({ id: `p${date}${count}`, personId: "ben", cardId: "jcb", desc: "TV", total, count, date, bonus: true, ...extra });
const keys = (p, card) => T.payments(p, card).map(x => [x.key, x.amount, x.bonus]);

test("bonusFor: yalnızca Japonya", () => {
  assert.equal(P.bonusFor("JP"), true);
  assert.equal(P.bonusFor("jp"), true);
  for (const c of ["TR", "US", "DE", null, undefined]) assert.equal(P.bonusFor(c), false);
});

test("tek bonus: 15 Haziran'a kadar Ağustos, 16 Haziran – 15 Kasım Ocak, sonrası gelecek Ağustos", () => {
  assert.deepEqual(keys(buy("2026-06-15", 120000), JCB), [["2026-08-10", 120000, "summer"]]);
  assert.deepEqual(keys(buy("2026-06-16", 120000), JCB), [["2027-01-10", 120000, "winter"]]);
  assert.deepEqual(keys(buy("2026-11-15", 120000), JCB), [["2027-01-10", 120000, "winter"]]);
  assert.deepEqual(keys(buy("2026-11-16", 120000), JCB), [["2027-08-10", 120000, "summer"]]);
  assert.deepEqual(keys(buy("2027-01-05", 120000), JCB), [["2027-08-10", 120000, "summer"]]);
  // Ay sonu kesimli kart: 30 Haziran'a kadar Ağustos, 1 Temmuz – 30 Kasım Ocak
  assert.deepEqual(keys(buy("2026-06-30", 5000, 1, { cardId: "rak" }), RAKUTEN), [["2026-08-27", 5000, "summer"]]);
  assert.deepEqual(keys(buy("2026-07-01", 5000, 1, { cardId: "rak" }), RAKUTEN), [["2027-01-27", 5000, "winter"]]);
  assert.deepEqual(keys(buy("2026-12-01", 5000, 1, { cardId: "rak" }), RAKUTEN), [["2027-08-27", 5000, "summer"]]);
});

test("iki bonus: yarı yarıya art arda iki bonusa, yen tam bölünür, artığı ilk", () => {
  assert.deepEqual(keys(buy("2026-03-01", 100001, 2), JCB), [["2026-08-10", 50001, "summer"], ["2027-01-10", 50000, "winter"]]);
  assert.deepEqual(keys(buy("2026-09-01", 99.99, 2), JCB), [["2027-01-10", 50, "winter"], ["2027-08-10", 49.99, "summer"]]);
  assert.equal(T.originalTotal(buy("2026-03-01", 100001, 2)), 100001);
  assert.equal(T.planLength(buy("2026-03-01", 100001, 2)), 2);
});

test("kartın bonus ayları değiştirilebilir (Temmuz ve Aralık)", () => {
  const card = { ...JCB, bonusMonths: [7, 12] };
  assert.deepEqual(keys(buy("2026-05-15", 1000), card), [["2026-07-10", 1000, "summer"]]);
  assert.deepEqual(keys(buy("2026-05-16", 1000), card), [["2026-12-10", 1000, "winter"]]);
  assert.deepEqual(T.bonusMonths({ bonusMonths: [8, 8] }), [8, 1]);   // geçersiz: varsayılan
  assert.equal(T.validBonusMonths([13, 1]), null);
});

test("bonus sayılmayanlar: kartsız, tekrarlayan, 3 ödemeli, tarihsiz", () => {
  assert.equal(T.bonus(buy("2026-03-01", 1000, 3)), false);
  assert.equal(T.bonus(buy("2026-03-01", 1000, 1, { repeat: 3 })), false);
  assert.equal(T.bonus({ ...buy("2026-03-01", 1000), date: undefined, firstDue: "2026-04" }), false);
  // Kart yoksa normal ödeme planı (harcama günü)
  assert.deepEqual(T.payments(buy("2026-03-01", 1000), null).map(x => x.key), ["2026-03-01"]);
});

test("kart günleri değiştiyse bonus ayında ödenen ekstrenin günü", () => {
  const card = { ...JCB, cutoffDay: 20, dueDay: 5, history: [{ until: "2026-05-15", cutoffDay: 15, dueDay: 10 }] };
  assert.deepEqual(keys(buy("2026-04-01", 1000), card), [["2026-08-05", 1000, "summer"]]);
});

test("ekstre, limit ve nakit akışı bonus gününde", () => {
  const state = T.hydrate({
    home: "JPY",
    people: [{ id: "ben", name: "Ben", color: 0 }],
    cards: [JCB],
    installments: [buy("2026-06-01", 200000), { id: "n", personId: "ben", cardId: "jcb", desc: "Market", total: 5000, count: 1, date: "2026-06-01" }],
  });
  const today = "2026-06-20";
  const lines = B.cardLines(state, JCB, today);
  assert.deepEqual(lines.map(x => [x.key, x.amount]), [["2026-07-10", 5000], ["2026-08-10", 200000]]);
  assert.equal(B.cardUsed(state, JCB, today), 205000);
  const months = B.cashflow(state, T.monthIndex("2026-07"), T.monthIndex("2026-08"), today);
  assert.deepEqual(months.map(m => m.total), [5000, 200000]);
  assert.equal(months[1].events[0].date, "2026-08-10");
  assert.equal(months[1].events[0].items[0].bonus, "summer");
});

test("içgörü: yaklaşan bonus ödemesi; abonelik sayılmaz", () => {
  const state = T.hydrate({
    home: "JPY",
    people: [{ id: "ben", name: "Ben", color: 0 }],
    cards: [JCB],
    installments: [buy("2026-06-01", 200000), buy("2026-05-01", 100000, 2)],
  });
  const out = I.insights(state, { today: "2026-06-20" });
  const x = out.find(i => i.id === "bonus");
  assert.ok(x, out.map(i => i.id).join());
  assert.equal(x.data.date, "2026-08-10");
  assert.equal(x.data.total, 250000);
  assert.equal(x.data.purchases.length, 2);
  // Üç aydan uzaksa yok
  assert.equal(I.insights(state, { today: "2026-03-01" }).some(i => i.id === "bonus"), false);
});

test("tablo: purchases.bonus ve cards.bonus_months; varsayılan aylar boş yazılır", () => {
  const state = {
    people: [{ id: "ben", name: "Ben", color: 0 }],
    cards: [{ ...JCB, bonusMonths: [7, 12] }, { ...RAKUTEN, bonusMonths: [8, 1] }],
    installments: [buy("2026-06-01", 1000), buy("2026-06-02", 1000, 1, { cardId: null }), buy("2026-06-03", 1000, 3)],
  };
  const plan = Tablo.changes(state, {});
  assert.deepEqual(plan.cards.upsert.map(x => x.row.bonus_months), [[7, 12], null]);
  assert.deepEqual(plan.purchases.upsert.map(x => x.row.bonus), [true, null, null]);
  const rows = { people: [], cards: plan.cards.upsert.map(x => x.row), purchases: plan.purchases.upsert.map(x => x.row) };
  const back = Tablo.toState(rows);
  assert.deepEqual(back.cards.map(c => c.bonusMonths), [[7, 12], undefined]);
  assert.deepEqual(back.installments.map(p => p.bonus), [true, undefined, undefined]);
});

// Bellekte veri (ulke.test.js gibi); country hesabın ülkesi
function ctxFor(country, today = "2026-06-20") {
  let state = T.hydrate({ home: P.homeOfCountry(country) });
  return {
    today, home: P.homeOfCountry(country), user: { country },
    load: async () => T.hydrate(JSON.parse(JSON.stringify(state))),
    mutate: async fn => { const s = T.hydrate(JSON.parse(JSON.stringify(state))); const out = await fn(s); state = s; return out; },
    rates: async () => ({ rates: { TRY: 1, JPY: 0.3, USD: 40 }, updatedAt: "2026-06-20T10:00:00Z", source: "test" }),
    prices: async () => ({ prices: {}, missing: [], failed: [] }),
    raw: () => state,
  };
}
const run = async (ctx, name, args = {}) => {
  try { return await TOOLS.find(t => t.name === name).run(args, ctx); } catch (e) { return { error: e.message }; }
};

test("asistan: bonus yalnızca Japonya'da ve kartla; twice iki bonusa böler; null kaldırır", async () => {
  const jp = ctxFor("JP");
  await run(jp, "add_card", { name: "JCB", cutoff_day: 15, due_day: 10, limit: 500000 });
  const p = await run(jp, "add_purchase", { description: "冷蔵庫", amount: 180000, bonus: "once", date: "2026-06-10" });
  assert.equal(p.saved, true, p.error);
  assert.equal(p.purchase.nextPayment.date, "2026-08-10");
  assert.equal(p.purchase.bonus.schedule[0].season, "summer");
  assert.match(p.preview.note, /ボーナス払い/);
  assert.equal(jp.raw().installments[0].bonus, true);

  const two = await run(jp, "add_purchase", { description: "PC", amount: 200001, bonus: "twice", date: "2026-07-01", card: "JCB" });
  assert.deepEqual(two.purchase.bonus.schedule.map(x => [x.date, x.amount]), [["2027-01-10", 100001], ["2027-08-10", 100000]]);
  assert.equal(two.purchase.installments, 2);

  const list = await run(jp, "list_purchases", { kind: "bonus" });
  assert.equal(list.count, 2);

  const back = await run(jp, "update_purchase", { id: two.purchase.id, bonus: null, installments: 1 });
  assert.equal(back.purchase.bonus, undefined);
  assert.equal(back.purchase.nextPayment.date, "2026-08-10");   // 1 Tem → 15 Tem kesim, 10 Ağu
  assert.equal(jp.raw().installments[1].bonus, undefined);

  assert.match((await run(jp, "add_purchase", { description: "x", amount: 1000, bonus: "once", card: "nakit" })).error, /credit card/);
  assert.match((await run(jp, "add_purchase", { description: "x", amount: 1000, bonus: "once", installments: 3 })).error, /installments/);
  assert.match((await run(jp, "add_purchase", { description: "x", amount: 1000, bonus: "yearly" })).error, /once/);

  const us = ctxFor("US");
  await run(us, "add_card", { name: "Visa", cutoff_day: 15, due_day: 10 });
  assert.match((await run(us, "add_purchase", { description: "TV", amount: 900, bonus: "once" })).error, /only available for accounts in Japan/);
});

test("asistan: kartın bonus ayları (Japonya), simülasyon", async () => {
  const jp = ctxFor("JP");
  const c = await run(jp, "add_card", { name: "SMBC", cutoff_day: 15, due_day: 10, bonus_months: [7, 12] });
  assert.deepEqual(c.card.bonusMonths, [7, 12]);
  const sim = await run(jp, "simulate_purchase", { amount: 50000, bonus: "once", date: "2026-06-01" });
  assert.equal(sim.error, undefined, sim.error);
  const reset = await run(jp, "update_card", { card: "SMBC", bonus_months: null });
  assert.equal(reset.card.bonusMonths, undefined);
  assert.match((await run(jp, "update_card", { card: "SMBC", bonus_months: [8, 8] })).error, /two different months/);

  const tr = ctxFor("TR");
  assert.match((await run(tr, "add_card", { name: "Bonus", cutoff_day: 15, due_day: 25, bonus_months: [8, 1] })).error, /only available for accounts in Japan/);
});

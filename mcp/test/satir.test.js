// Tek satırla kayıt (taksit.js parseLine): harcama formunda "Ne alındı?" alanına yazılan satırdan tutar, taksit, kart ve ad
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const T = createRequire(import.meta.url)("../../taksit.js");

const cards = [{ id: "b", name: "Bonus" }, { id: "a", name: "Axess" }, { id: "w", name: "World Platinum" }, { id: "m", name: "Maximum" }];
// [satır, ad, tutar, taksit, kart, ondalık ayracı (varsayılan virgül), sure (varsayılan true)]; ad null: tek satır değil
const C = [
  ["buzdolabı 36000 bonus 6 taksit", "buzdolabı", 36000, 6, "b"],
  ["Buzdolabı 36.000 TL Bonus'a 6 taksit", "Buzdolabı", 36000, 6, "b"],
  ["36000 buzdolabı", "buzdolabı", 36000, null, null],
  ["iphone 15 64000 axess 12 taksit", "iphone 15", 64000, 12, "a"],
  ["iphone 15 64.999,90 axessle x12", "iphone 15", 64999.9, 12, "a"],
  ["migros 450 nakit", "migros", 450, null, "nakit"],
  ["migros 1250,50", "migros", 1250.5, null, null],
  ["telefon 45 bin maximum 9 ay", "telefon", 45000, 9, "m"],
  ["telefon 45k maximum 9ay", "telefon", 45000, 9, "m"],
  ["koltuk takımı 82.500 world platinum ile 10 taksit", "koltuk takımı", 82500, 10, "w"],
  ["2 bilet 1500 bonus", "2 bilet", 1500, null, "b"],
  ["1500 2 bilet bonus peşin", "2 bilet", 1500, 1, "b"],
  ["₺3.200 ayakkabı tek çekim axess", "ayakkabı", 3200, 1, "a"],
  ["ayakkabı 3200₺ axess kartıyla 3 taksit", "ayakkabı", 3200, 3, "a"],
  ["netflix 229,99", "netflix", 229.99, null, null],
  ["galaxy s24 256 gb 45000 6 taksit bonus", "galaxy s24 256 gb", 45000, 6, "b"],
  ["laptop 54999 bonusla 6t", "laptop", 54999, 6, "b"],
  ["market 850", "market", 850, null, null],
  ["bonus 12000 tatil 4 taksit", "tatil", 12000, 4, "b"],
  ["Kış lastiği 4 adet 18.400 maximum 4 taksit", "Kış lastiği 4 adet", 18400, 4, "m"],
  ["fridge 1800 bonus 6 installments", "fridge", 1800, 6, "b"],
  ["coffee 5 cash", "coffee", 5, null, "nakit"],
  ["tv 1,299.99 with axess 12 months", "tv", 1299.99, 12, "a", "."],
  ["benzin 2000 TL", "benzin", 2000, null, null],
  ["Okul taksidi 15000", "Okul taksidi", 15000, null, null],
  ["3 taksit 9000 mont maximumdan", "mont", 9000, 3, "m"],
  ["kira 25.000", "kira", 25000, null, null],
  ["iPhone 15", "iPhone", 15, null, null, ",", false],
  ["kahve 85", "kahve", 85, null, null, ",", false],
  ["Migros", null],
  ["dişçi 12 taksit 24000", "dişçi", 24000, 12, null],
];

test("tek satır: tutar, taksit, kart ve ad ayrılır; ad içindeki sayı tutar sanılmaz", () => {
  for (const [text, desc, amount, count, card, decimal = ",", sure = true] of C) {
    const r = T.parseLine(text, { cards, decimal });
    if (desc === null) { assert.equal(r, null, text); continue; }
    assert.deepEqual(r, { desc, amount, count, cardId: card, sure }, text);
  }
});

test("tek satır: tutar yoksa ya da tek sözcükse null; kart yokken kart adı ad sayılır", () => {
  assert.equal(T.parseLine("bonus ile market"), null);
  assert.equal(T.parseLine("36000"), null);
  assert.equal(T.parseLine(""), null);
  assert.deepEqual(T.parseLine("market 850 bonus"), { desc: "market bonus", amount: 850, count: null, cardId: null, sure: true });
});

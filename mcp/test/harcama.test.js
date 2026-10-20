import test from "node:test";
import assert from "node:assert/strict";
import T from "../../taksit.js";
import V from "../../varlik.js";

const kira = { id: "kira", personId: "ben", cardId: null, desc: "Kira", total: 20000, count: 1, date: "2026-01-31", repeat: 0 };
const card = { id: "k", name: "K", limit: 50000, cutoffDay: 10, dueDay: 20, color: 0 };

test("tekrarlayan harcama: her ay aynı gün (kısa ayda son gün) peşin ödenir; süresiz olan 60 ay ileriye", () => {
  const pays = T.payments(kira, null, "2026-10-20");
  assert.deepEqual(pays.slice(0, 3).map(x => [x.key, x.no, x.amount]), [["2026-01-31", 1, 20000], ["2026-02-28", 2, 20000], ["2026-03-31", 3, 20000]]);
  assert.equal(pays[pays.length - 1].idx, T.parseDate("2026-10-20").idx + 60);
  assert.equal(T.nextOccurrence(kira, "2026-10-20"), "2026-10-31");
  assert.equal(T.nextOccurrence({ ...kira, repeat: 3 }, "2026-10-20"), null);
  assert.equal(T.payments({ ...kira, repeat: 3 }, null).length, 3);
  // Taksitli ya da tarihsiz harcama tekrarlamaz
  assert.equal(T.repeatOf({ ...kira, count: 2 }), null);
  assert.equal(T.repeatOf({ ...kira, date: undefined, firstDue: "2026-01" }), null);
});

test("kartla tekrarlayan harcama: her tekrar kendi ekstresinde; yapılmamış tekrarlar limitten düşmez", () => {
  const sub = { ...kira, cardId: "k", total: 300, date: "2026-10-15", repeat: 0 };
  const pays = T.payments(sub, card, "2026-10-20");
  assert.deepEqual(pays.slice(0, 2).map(x => [x.at, x.key]), [["2026-10-15", "2026-11-20"], ["2026-11-15", "2026-12-20"]]);
  assert.equal(T.outstanding(pays, "2026-10-20"), 300);
});

test("eski TL çıkış hareketleri harcamaya taşınır; diğer hareketler kalır", () => {
  const s = T.hydrate({
    installments: [{ id: "x", personId: "ben", cardId: null, desc: "x", total: 1, count: 1, date: "2026-01-01" }],
    entries: [
      { id: "kira", personId: "ben", asset: "TRY", amount: -20000, desc: "Kira", date: "2026-01-05", repeat: 0 },
      { id: "x", personId: "ben", asset: "TRY", amount: -50, desc: "Çay", date: "2026-02-01" },
      { id: "maas", personId: "ben", asset: "TRY", amount: 50000, desc: "Maaş", date: "2026-01-15", repeat: 0 },
      { id: "usd", personId: "ben", asset: "USD", amount: -10, desc: "Tatil", date: "2026-02-01" },
    ],
  });
  assert.deepEqual(s.entries.map(e => e.id), ["maas", "usd"]);
  assert.deepEqual(s.installments.slice(1), [
    { id: "kira", personId: "ben", cardId: null, desc: "Kira", total: 20000, count: 1, date: "2026-01-05", repeat: 0 },
    { id: "x-h", personId: "ben", cardId: null, desc: "Çay", total: 50, count: 1, date: "2026-02-01" },
  ]);
  assert.deepEqual(T.hydrate(s), s);   // ikinci kez değişmez
});

test("harcama ödemeleri ilk TL hareketinden bugüne kadar TL bakiyesinden düşer", () => {
  const entries = [{ id: "m", personId: "ben", asset: "TRY", amount: 50000, desc: "Maaş", date: "2026-08-15", repeat: 0 }];
  const spent = T.payments({ ...kira, date: "2026-08-01" }, null, "2026-10-20");   // 1 Ağu ilk TL hareketinden önce
  assert.equal(V.balances(entries, "2026-10-20", spent).TRY, 150000 - 40000);   // Eyl, Eki
  assert.equal(V.balances([], "2026-10-20", spent).TRY, undefined);              // TL takibi yok: düşülmez
  assert.equal(V.balances(entries, "2026-10-20").TRY, 150000);
});

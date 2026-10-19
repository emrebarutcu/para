import test from "node:test";
import assert from "node:assert/strict";
import Tablo from "../../tablo.js";

const { toState, baseOf, changes, merge, combine } = Tablo;

let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 19, 9, 0, 0, ++clock)).toISOString().replace("Z", "+00:00");
const person = (id, name, extra = {}) => ({ user_id: "u1", id, name, color: 0, created_at: at(), updated_at: at(), deleted_at: null, ...extra });
const card = (id, extra = {}) => ({
  user_id: "u1", id, name: id.toUpperCase(), credit_limit: "50000", cutoff_day: 12, due_day: 22, color: 0, last4: null,
  created_at: at(), updated_at: at(), deleted_at: null, ...extra,
});
const purchase = (id, extra = {}) => ({
  user_id: "u1", id, person_id: "ben", card_id: "k1", description: id, total: 300, count: 3, date: "2026-10-15",
  first_due: null, plan_count: null, created_at: at(), updated_at: at(), deleted_at: null, ...extra,
});
const server = () => ({
  people: [person("ben", "Ben"), person("ali", "Ali")],
  cards: [card("k1", { last4: "1234" })],
  purchases: [purchase("p1"), purchase("p2", { card_id: null, date: null, first_due: "2026-10", plan_count: 6 })],
});

test("satırlar uygulamadaki biçime çevrilir; değişmeyen veri yazılmaz", () => {
  const rows = server();
  const state = toState(rows);
  assert.deepEqual(state.people.map(p => p.id), ["ben", "ali"]);
  assert.deepEqual(state.cards[0], { id: "k1", name: "K1", limit: 50000, cutoffDay: 12, dueDay: 22, color: 0, last4: "1234" });
  assert.deepEqual(state.installments[1], { id: "p2", personId: "ben", cardId: null, desc: "p2", total: 300, count: 3, firstDue: "2026-10", planCount: 6 });

  const plan = changes(state, baseOf(rows));
  for (const t of Tablo.TABLES) assert.deepEqual(plan[t], { upsert: [], delete: [] }, t);
});

test("sıra created_at'e göre; silinenler ve boş kişi listesi", () => {
  const rows = server();
  rows.people.reverse();
  rows.purchases[0].deleted_at = at();
  const state = toState(rows);
  assert.deepEqual(state.people.map(p => p.id), ["ben", "ali"]);
  assert.deepEqual(state.installments.map(p => p.id), ["p2"]);
  assert.equal("people" in toState({}), false);   // hydrate varsayılan kişiyi koysun
  assert.deepEqual(toState({}).installments, []);
});

test("yeni, değişen ve silinen kayıtlar bulunur", () => {
  const rows = server();
  const base = baseOf(rows);
  const state = toState(rows);
  state.people[1].name = "Ali Veli";
  state.cards.push({ id: "k2", name: "B", limit: 0, cutoffDay: 25, dueDay: 5, color: 1 });
  state.installments = state.installments.filter(p => p.id !== "p1");
  state.installments.push({ id: "p3", personId: "ali", cardId: "k2", desc: "Yeni", total: 100, count: 1, date: "2026-10-19" });

  const plan = changes(state, base);
  assert.deepEqual(plan.people.upsert.map(x => x.row), [{ id: "ali", name: "Ali Veli", color: 0 }]);
  assert.deepEqual(plan.cards.upsert.map(x => x.id), ["k2"]);
  assert.deepEqual(plan.purchases.upsert.map(x => x.row), [{
    id: "p3", person_id: "ali", card_id: "k2", description: "Yeni", total: 100, count: 1, date: "2026-10-19",
    first_due: null, plan_count: null,
  }]);
  assert.deepEqual(plan.purchases.delete, ["p1"]);
  assert.deepEqual(plan.people.delete, []);
});

test("tabloya yazılamayacak kayıtlar yerelde kalır, silinmez", () => {
  const rows = server();
  const base = baseOf(rows);
  const state = toState(rows);
  state.installments.push(
    { id: "yetim", personId: "yok", cardId: "k1", desc: "Kişisi yok", total: 10, count: 1, date: "2026-10-01" },
    { id: "kartsiz", personId: "ben", cardId: "silinmis", desc: "Kartı yok", total: 10, count: 1, date: "2026-10-01" },
    { id: "bozuk", personId: "ben", cardId: null, desc: "Tarihsiz", total: 10, count: 1 },
    { id: "p1", personId: "ben", desc: "Aynı id", total: 1, count: 1, date: "2026-01-01" },
  );
  state.installments[0] = { ...state.installments[0], total: 0 };   // p1 artık geçersiz

  const plan = changes(state, base);
  assert.deepEqual(plan.purchases.upsert.map(x => [x.id, x.row.card_id]), [["kartsiz", null]]);
  assert.deepEqual(plan.purchases.delete, []);
});

test("uzaktan gelen: temiz kayıt güncellenir, yerelde bekleyen değişiklik korunur", () => {
  const rows = server();
  let base = baseOf(rows);
  let state = toState(rows);
  state.installments[0] = { ...state.installments[0], desc: "Yerelde düzenlendi" };

  const remote = [
    purchase("p1", { description: "Uzakta düzenlendi" }),
    purchase("p2", { description: "Uzakta da", card_id: null }),
    purchase("p9", { description: "Uzakta eklendi" }),
  ];
  const out = merge(state, base, "purchases", remote);
  assert.equal(out.changed, true);
  assert.deepEqual(out.state.installments.map(p => p.desc), ["Yerelde düzenlendi", "Uzakta da", "Uzakta eklendi"]);
  assert.notEqual(out.state, state);
  assert.equal(state.installments[1].desc, "p2");   // girdi değişmez

  // Yerel değişiklik yazılınca uzağı ezer
  ({ state, base } = out);
  assert.deepEqual(changes(state, base).purchases.upsert.map(x => x.id), ["p1"]);
});

test("uzakta silinen: temizse kalkar, yerelde düzenlendiyse kalır; kendi yazdığımız değişiklik getirmez", () => {
  const rows = server();
  const base = baseOf(rows);
  const state = toState(rows);
  state.installments[1] = { ...state.installments[1], desc: "Düzenlendi" };
  const gone = [purchase("p1", { deleted_at: at() }), { ...rows.purchases[1], deleted_at: at() }, purchase("hic", { deleted_at: at() })];
  const out = merge(state, base, "purchases", gone);
  assert.deepEqual(out.state.installments.map(p => p.id), ["p2"]);
  assert.equal(out.base.purchases.p1, undefined);

  // Yerel değişiklik yazıldı, aynı satır Realtime'la geri geldi
  const plan = changes(out.state, out.base);
  const sent = plan.purchases.upsert[0];
  const echoed = merge(out.state, { ...out.base, purchases: { ...out.base.purchases, p2: sent.key } }, "purchases",
    [{ ...rows.purchases[1], ...sent.row, updated_at: at() }]);
  assert.equal(echoed.changed, false);
  assert.equal(echoed.state, out.state);
});

test("yerelde silinmiş, uzakta da silinmişse bekleyen silme kalkar", () => {
  const rows = server();
  const base = baseOf(rows);
  const state = toState(rows);
  state.installments = state.installments.filter(p => p.id !== "p1");
  const out = merge(state, base, "purchases", [purchase("p1", { deleted_at: at() })]);
  assert.equal(out.changed, false);
  assert.deepEqual(changes(out.state, out.base).purchases.delete, []);
});

test("tarih ay sonuna çekilir, sayılar metin gelse de aynı anahtar", () => {
  const state = { people: [{ id: "ben", name: "Ben", color: 0 }], cards: [], installments: [
    { id: "a", personId: "ben", cardId: "", desc: "Şubat", total: 10, count: 1, date: "2026-2-30" },
  ] };
  const plan = changes(state, {});
  assert.equal(plan.purchases.upsert[0].row.date, "2026-02-28");
  assert.equal(plan.purchases.upsert[0].row.card_id, null);

  const rows = server();
  rows.purchases[0].total = "300";   // numeric bazı ayarlarda metin döner
  const base = baseOf(rows);
  assert.deepEqual(changes(toState(rows), base).purchases.upsert, []);
});

test("varlık hareketleri: satıra çevrilir, geçersizler ve kişisi olmayanlar yazılmaz", () => {
  const rows = server();
  rows.entries = [{ user_id: "u1", id: "e1", person_id: "ben", asset: "GAU", amount: "2.5", description: "Altın", date: "2026-10-19",
    created_at: at(), updated_at: at(), deleted_at: null }];
  const base = baseOf(rows);
  const state = toState(rows);
  assert.deepEqual(state.entries, [{ id: "e1", personId: "ben", asset: "GAU", amount: 2.5, desc: "Altın", date: "2026-10-19" }]);
  assert.deepEqual(changes(state, base).entries, { upsert: [], delete: [] });

  state.entries.push(
    { id: "e2", personId: "ali", asset: "USD", amount: -30, desc: "Tatil", date: "2026-10-19" },
    { id: "btc", personId: "ben", asset: "BTC", amount: 1, desc: "Desteklenmiyor", date: "2026-10-19" },
    { id: "sifir", personId: "ben", asset: "TRY", amount: 0, desc: "Sıfır", date: "2026-10-19" },
    { id: "yetim", personId: "yok", asset: "TRY", amount: 5, desc: "Kişisi yok", date: "2026-10-19" },
  );
  const plan = changes(state, base);
  assert.deepEqual(plan.entries.upsert.map(x => x.row), [{ id: "e2", person_id: "ali", asset: "USD", amount: -30, description: "Tatil", date: "2026-10-19", repeat_count: null }]);
  assert.deepEqual(toState({}).entries, []);
});

test("tekrarlayan varlık hareketi: repeat_count ↔ repeat (0 süresiz, 1 tek seferlik sayılır)", () => {
  const rows = server();
  rows.entries = [
    { user_id: "u1", id: "maas", person_id: "ben", asset: "TRY", amount: "50000", description: "Maaş", date: "2026-10-15", repeat_count: 0,
      created_at: at(), updated_at: at(), deleted_at: null },
    { user_id: "u1", id: "kira", person_id: "ben", asset: "TRY", amount: "-20000", description: "Kira", date: "2026-10-01", repeat_count: 12,
      created_at: at(), updated_at: at(), deleted_at: null },
  ];
  const base = baseOf(rows);
  const state = toState(rows);
  assert.deepEqual(state.entries.map(e => [e.id, e.repeat]), [["maas", 0], ["kira", 12]]);
  assert.deepEqual(changes(state, base).entries, { upsert: [], delete: [] });

  state.entries = state.entries.map(e => (e.id === "kira" ? { ...e, repeat: 1 } : e));
  state.entries.push({ id: "aidat", personId: "ben", asset: "TRY", amount: -500, desc: "Aidat", date: "2026-10-05", repeat: 6 });
  const plan = changes(state, base);
  assert.deepEqual(plan.entries.upsert.map(x => [x.id, x.row.repeat_count]), [["kira", null], ["aidat", 6]]);
});

test("cihazdaki veri hesaba eklenir: aynı kayıt iki kez eklenmez, aynı kişi / kart birleşir", () => {
  const account = {
    people: [{ id: "ben", name: "Emre", color: 0 }, { id: "a1", name: "Ali", color: 1 }],
    cards: [{ id: "k1", name: "Bonus", limit: 0, cutoffDay: 12, dueDay: 22, color: 0, last4: "1234" }, { id: "kart", name: "Kredi kartı", limit: 0, cutoffDay: 1, dueDay: 10, color: 1 }],
    installments: [{ id: "p1", personId: "ben", cardId: "k1", desc: "Eski", total: 100, count: 1, date: "2026-10-01" }],
    entries: [],
  };
  const local = {
    people: [{ id: "ben", name: "Ben", color: 0 }, { id: "x1", name: "ali ", color: 2 }, { id: "y1", name: "Ayşe", color: 3 }],
    cards: [
      { id: "c9", name: "Benim kartım", limit: 0, cutoffDay: 12, dueDay: 22, color: 0, last4: "1234" },
      { id: "c8", name: "World", limit: 0, cutoffDay: 5, dueDay: 15, color: 2, last4: "9999" },
      { id: "kart", name: "Kredi kartı", limit: 0, cutoffDay: 1, dueDay: 10, color: 0 },
    ],
    installments: [
      { id: "p1", personId: "ben", cardId: "k1", desc: "Eski", total: 100, count: 1, date: "2026-10-01" },
      { id: "p2", personId: "x1", cardId: "c9", desc: "Ali'nin", total: 300, count: 3, date: "2026-10-05" },
      { id: "p3", personId: "y1", cardId: "c8", desc: "Ayşe'nin", total: 50, count: 1, date: "2026-10-06" },
      { id: "p4", personId: "ben", cardId: null, desc: "Nakit", total: 20, count: 1, date: "2026-10-07" },
    ],
    entries: [{ id: "e1", personId: "x1", asset: "TRY", amount: 10, desc: "Maaş", date: "2026-10-01" }],
  };
  const out = combine(account, local);
  assert.deepEqual(out.people.map(p => [p.id, p.name]), [["ben", "Emre"], ["a1", "Ali"], ["y1", "Ayşe"]]);
  assert.deepEqual(out.cards.map(c => c.id), ["k1", "kart", "c8"]);
  assert.deepEqual(out.installments.map(p => [p.id, p.personId, p.cardId]),
    [["p1", "ben", "k1"], ["p2", "a1", "k1"], ["p3", "y1", "c8"], ["p4", "ben", null]]);
  assert.deepEqual(out.entries.map(e => [e.id, e.personId]), [["e1", "a1"]]);
  assert.equal(account.people.length, 2);   // hesabın verisi değişmez
  assert.equal(changes(out, {}).purchases.upsert.length, 4);
});

test("kartın eski günleri: satıra çevrilir, sıralanır, geçersizler atılır", () => {
  const history = [{ until: "2026-11-10", cutoffDay: 10, dueDay: 20 }, { until: "2026-2-31", cutoffDay: "5", dueDay: 15 }, { until: "x", cutoffDay: 1, dueDay: 1 }];
  const state = { people: [{ id: "ben", name: "Ben", color: 0 }], cards: [{ id: "k1", name: "A", limit: 0, cutoffDay: 20, dueDay: 30, color: 0, history }] };
  const row = changes(state, {}).cards.upsert[0].row;
  assert.deepEqual(row.history, [{ until: "2026-02-28", cutoff_day: 5, due_day: 15 }, { until: "2026-11-10", cutoff_day: 10, due_day: 20 }]);

  const rows = { cards: [card("k1", { history: row.history })] };
  assert.deepEqual(toState(rows).cards[0].history, [{ until: "2026-02-28", cutoffDay: 5, dueDay: 15 }, { until: "2026-11-10", cutoffDay: 10, dueDay: 20 }]);
  assert.equal(toState({ cards: [card("k2", { history: [] })] }).cards[0].history, undefined);
  assert.equal(changes(state, {}).cards.upsert.length, 1);
  assert.deepEqual(changes(toState(rows), baseOf(rows)).cards, { upsert: [], delete: [] });
});

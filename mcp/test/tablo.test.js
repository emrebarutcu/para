import test from "node:test";
import assert from "node:assert/strict";
import Tablo from "../../tablo.js";

const { toState, baseOf, changes, merge, combine, rekey } = Tablo;

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
    first_due: null, plan_count: null, category: null, category_by: null,
    asset: null, repeat_count: null, repeat_every: null, repeat_unit: null,
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
  assert.deepEqual(plan.entries.upsert.map(x => x.row), [{ id: "e2", person_id: "ali", asset: "USD", amount: -30, description: "Tatil", date: "2026-10-19",
    repeat_count: null, repeat_every: null, repeat_unit: null }]);
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

test("repeat yalnızca 0 ya da 2…600 tamsayıysa yazılır (varlik.js repeatOf gibi); null, boş, kesirli tek seferlik", () => {
  const state = { people: [{ id: "ben", name: "Ben", color: 0 }], entries: [null, "", false, -0.4, "12", 2.5, 1, 0, 12, 601]
    .map((repeat, i) => ({ id: `e${i}`, personId: "ben", asset: "TRY", amount: 100, desc: "x", date: "2026-10-01", repeat })) };
  assert.deepEqual(changes(state, {}).entries.upsert.map(x => x.row.repeat_count), [null, null, null, null, null, null, null, 0, 12, null]);
});

test("1.x tabanı (yeni sütunsuz) rekey ile çevrilir: yükseltmede bir şey yazılmaz, uzaktaki yeni sütun alınır", () => {
  const rows = server();
  rows.entries = [{ user_id: "u1", id: "maas", person_id: "ben", asset: "TRY", amount: 50000, description: "Maaş", date: "2026-10-15",
    created_at: at(), updated_at: at(), deleted_at: null }];
  const state = toState(rows);
  // 1.x'in kaydettiği taban: satırların yeni sütunlar (history, repeat_count) olmadan JSON'u
  const old = baseOf(rows);
  for (const t of ["cards", "entries"]) {
    for (const id of Object.keys(old[t])) {
      const { history, repeat_count, ...row } = JSON.parse(old[t][id]);
      old[t][id] = JSON.stringify(row);
    }
  }
  assert.ok(changes(state, old).cards.upsert.length);   // çevrilmeden her kart yeniden yazılırdı

  const base = rekey(old);
  assert.deepEqual(base, baseOf(rows));
  for (const t of Tablo.TABLES) assert.deepEqual(changes(state, base)[t], { upsert: [], delete: [] }, t);

  // Başka cihaz kartın eski günlerini, maaşın tekrarını yazmış: yeniden çekilince yerel kayıt güncellenir
  const k1 = { ...rows.cards[0], history: [{ until: "2026-09-12", cutoff_day: 5, due_day: 15 }], updated_at: at() };
  const maas = { ...rows.entries[0], repeat_count: 0, updated_at: at() };
  let out = merge(state, base, "cards", [k1]);
  assert.equal(out.changed, true);
  assert.deepEqual(out.state.cards[0].history, [{ until: "2026-09-12", cutoffDay: 5, dueDay: 15 }]);
  out = merge(out.state, out.base, "entries", [maas]);
  assert.equal(out.changed, true);
  assert.equal(out.state.entries[0].repeat, 0);
  for (const t of Tablo.TABLES) assert.deepEqual(changes(out.state, out.base)[t], { upsert: [], delete: [] }, t);
});

test("harcama kategorisi: satıra çevrilir, geçersizi yazılmaz; kimin verdiği yalnızca kategoriyle", () => {
  const rows = server();
  const base = baseOf(rows);
  const state = toState(rows);
  state.installments[0] = { ...state.installments[0], category: "market", categoryBy: "user" };
  state.installments[1] = { ...state.installments[1], category: "Market!", categoryBy: "ai" };
  state.installments.push({ id: "p3", personId: "ben", cardId: null, desc: "x", total: 5, count: 1, date: "2026-10-19", categoryBy: "user" });
  const rowsOut = changes(state, base).purchases.upsert.map(x => x.row);
  assert.deepEqual(rowsOut.map(r => [r.id, r.category, r.category_by]), [["p1", "market", "user"], ["p3", null, null]]);

  const back = toState({ ...rows, purchases: [purchase("p4", { category: "yeme", category_by: "ai" }), purchase("p5", { category: "yeme", category_by: "kim" })] });
  assert.deepEqual(back.installments.map(p => [p.category, p.categoryBy]), [["yeme", "ai"], ["yeme", undefined]]);
});

test("2.x tabanı (kategori sütunsuz) rekey ile çevrilir: yükseltmede harcamalar yeniden yazılmaz", () => {
  const rows = server();
  const state = toState(rows);
  const old = baseOf(rows);
  for (const id of Object.keys(old.purchases)) {
    const { category, category_by, ...row } = JSON.parse(old.purchases[id]);
    old.purchases[id] = JSON.stringify(row);
  }
  assert.ok(changes(state, old).purchases.upsert.length);
  const base = rekey(old);
  for (const t of Tablo.TABLES) assert.deepEqual(changes(state, base)[t], { upsert: [], delete: [] }, t);
  const out = merge(state, base, "purchases", [{ ...rows.purchases[0], category: "ev", category_by: "user", updated_at: at() }]);
  assert.equal(out.state.installments[0].category, "ev");
});

test("her N gün / hafta / ayda bir: repeat_every ve repeat_unit; varsayılanlar (1, ay) boş yazılır", () => {
  const state = { people: [{ id: "ben", name: "Ben", color: 0 }], entries: [
    { id: "a", personId: "ben", asset: "TRY", amount: 100, desc: "x", date: "2026-10-01", repeat: 0, every: 2, unit: "week" },
    { id: "b", personId: "ben", asset: "TRY", amount: 100, desc: "x", date: "2026-10-01", repeat: 5, every: 1, unit: "month" },
    { id: "c", personId: "ben", asset: "TRY", amount: 100, desc: "x", date: "2026-10-01", every: 3, unit: "day" },
    { id: "d", personId: "ben", asset: "TRY", amount: 100, desc: "x", date: "2026-10-01", repeat: 0, every: 500, unit: "yıl" },
  ] };
  const cols = changes(state, {}).entries.upsert.map(({ row }) => [row.repeat_count, row.repeat_every, row.repeat_unit]);
  assert.deepEqual(cols, [[0, 2, "week"], [5, null, null], [null, null, null], [0, null, null]]);
  const back = toState({ entries: changes(state, {}).entries.upsert.map(({ row }) => ({ ...row, created_at: at() })) }).entries;
  assert.deepEqual(back.map(({ repeat, every, unit }) => ({ repeat, every, unit })), [
    { repeat: 0, every: 2, unit: "week" }, { repeat: 5, every: undefined, unit: undefined },
    { repeat: undefined, every: undefined, unit: undefined }, { repeat: 0, every: undefined, unit: undefined }]);
});

test("harcama: döviz / altın varlığı ve tekrar sütunları; tarihsiz harcama tekrarlamaz", () => {
  const people = [{ id: "ben", name: "Ben", color: 0 }];
  const state = { people, installments: [
    { id: "a", personId: "ben", cardId: null, desc: "Netflix", total: 10, count: 1, date: "2026-10-01", asset: "USD", repeat: 0 },
    { id: "b", personId: "ben", cardId: null, desc: "Market", total: 500, count: 1, date: "2026-10-01", asset: "TRY", repeat: 4, every: 1, unit: "week" },
    { id: "c", personId: "ben", cardId: null, desc: "Excel", total: 500, count: 2, firstDue: "2026-11", repeat: 0 },
  ] };
  const rows = changes(state, {}).purchases.upsert.map(x => x.row);
  assert.deepEqual(rows.map(r => [r.asset, r.repeat_count, r.repeat_every, r.repeat_unit]),
    [["USD", 0, null, null], [null, 4, null, "week"], [null, null, null, null]]);
  const back = toState({ people: [], purchases: rows.map(r => ({ ...r, created_at: at() })) }).installments;
  assert.equal(back[0].asset, "USD");
  assert.equal(back[0].repeat, 0);
  assert.equal(back[1].asset, undefined);
  assert.equal(back[1].unit, "week");
  assert.equal(back[2].repeat, undefined);
});

const debt = (id, extra = {}) => ({
  user_id: "u1", id, kind: "person", person_id: "ben", debt_id: null, side: "debt", party: "Mehmet", description: "",
  asset: "TRY", amount: "10000", principal: "10000", date: "2026-11-05", due: null, count: null, auto_pay: null, closed: null,
  created_at: at(), updated_at: at(), deleted_at: null, ...extra,
});

test("borçlar: her tür satıra çevrilir ve geri gelir; geçersiz kayıt yazılmaz", () => {
  const rows = {
    ...server(),
    debts: [
      debt("m"),
      debt("kr", { kind: "loan", side: null, party: "Garanti", amount: "22000", principal: "20000", due: "2026-12-10", count: 4 }),
      debt("al", { side: "receivable", party: "Ali", asset: "USD", principal: null, due: "2027-01-05", count: 3, auto_pay: true }),
      debt("o1", { kind: "payment", debt_id: "m", side: null, party: null, asset: null, amount: "2500", principal: null, date: "2026-11-20" }),
      debt("s1", { kind: "payment", person_id: "ali", side: null, party: null, asset: null, amount: 1000, principal: null }),
    ],
  };
  const state = toState(rows);
  assert.deepEqual(state.debts, [
    { id: "m", kind: "person", personId: "ben", side: "debt", party: "Mehmet", asset: "TRY", amount: 10000, principal: 10000, date: "2026-11-05" },
    { id: "kr", kind: "loan", personId: "ben", party: "Garanti", asset: "TRY", amount: 22000, principal: 20000, date: "2026-11-05", due: "2026-12-10", count: 4 },
    { id: "al", kind: "person", personId: "ben", side: "receivable", party: "Ali", asset: "USD", amount: 10000, date: "2026-11-05", due: "2027-01-05", count: 3, autoPay: true },
    { id: "o1", kind: "payment", personId: "ben", debtId: "m", amount: 2500, date: "2026-11-20" },
    { id: "s1", kind: "payment", personId: "ali", amount: 1000, date: "2026-11-05" },
  ]);
  for (const t of Tablo.TABLES) assert.deepEqual(changes(state, baseOf(rows))[t], { upsert: [], delete: [] }, t);

  const bad = [
    { id: "b1", kind: "person", personId: "ben", side: "debt", asset: "TRY", amount: Infinity, date: "2026-11-01" },
    { id: "b2", kind: "person", personId: "ben", asset: "TRY", amount: 5, date: "2026-11-01" },             // yönsüz
    { id: "b3", kind: "loan", personId: "ben", asset: "TRY", amount: 5, date: "2026-11-01", count: 3 },   // vadesiz kredi
    { id: "b4", kind: "payment", personId: "ben", amount: 0, date: "2026-11-01" },
    { id: "b5", kind: "card", personId: "ben", amount: 5, date: "2026-11-01" },
    { id: "b6", kind: "person", personId: "yok", side: "debt", asset: "TRY", amount: 5, date: "2026-11-01" },   // kişisi yok
    { id: "b7", kind: "person", personId: "ben", side: "debt", asset: "XAU", amount: 5, date: "2026-11-01" },
  ];
  const plan = changes({ ...state, debts: [...state.debts, ...bad] }, baseOf(rows));
  assert.deepEqual(plan.debts, { upsert: [], delete: [] });

  // Sayısız taksit ve otomatik ödeme vadesiz yazılmaz; kayıt kişisinin silinmesi borcu da siler
  const loose = changes({ people: state.people, debts: [{ id: "n", kind: "person", personId: "ali", side: "receivable", asset: "EUR",
    amount: 50, principal: -1, date: "2026-11-01", count: 3, autoPay: true, desc: "Not" }] }, {}).debts.upsert[0].row;
  assert.deepEqual(loose, { id: "n", kind: "person", person_id: "ali", debt_id: null, card_id: null, side: "receivable", party: null, description: "Not",
    asset: "EUR", amount: 50, principal: null, date: "2026-11-01", due: null, count: null, auto_pay: null, closed: null });
});

test("kart takibi: track_since / track_off satıra çevrilir; 4.x tabanı rekey ile çevrilir, takip başlayınca kart yazılır", () => {
  const rows = server();
  const old = baseOf(rows);
  for (const id of Object.keys(old.cards)) {
    const { track_since, track_off, ...row } = JSON.parse(old.cards[id]);
    old.cards[id] = JSON.stringify(row);
  }
  const state = toState(rows);
  assert.equal(state.cards[0].trackSince, undefined);
  assert.ok(changes(state, old).cards.upsert.length);   // çevrilmeden her kart yeniden yazılırdı
  const base = rekey(old);
  for (const t of Tablo.TABLES) assert.deepEqual(changes(state, base)[t], { upsert: [], delete: [] }, t);

  state.cards[0] = { ...state.cards[0], trackSince: "2026-10-24" };
  state.cards.push({ id: "k2", name: "Eşimin", limit: 0, cutoffDay: 1, dueDay: 10, color: 1, trackOff: true });
  const up = changes(state, base).cards.upsert.map(x => [x.id, x.row.track_since, x.row.track_off]);
  assert.deepEqual(up, [["k1", "2026-10-24", false], ["k2", null, true]]);
  const back = toState({ cards: [card("k1", { track_since: "2026-10-24", track_off: false }), card("k2", { track_off: true })] });
  assert.deepEqual(back.cards.map(c => [c.trackSince, c.trackOff]), [["2026-10-24", undefined], [undefined, true]]);
});

test("cihazdaki borçlar hesaba eklenir; birleşen kartın takibi erken başlayanınkidir", () => {
  const account = {
    people: [{ id: "ben", name: "Emre", color: 0 }],
    cards: [{ id: "k1", name: "Bonus", limit: 0, cutoffDay: 12, dueDay: 22, color: 0, last4: "1234", trackSince: "2026-10-24" }],
    installments: [], entries: [], debts: [],
  };
  const local = {
    people: [{ id: "ben", name: "Ben", color: 0 }, { id: "x1", name: "Ali", color: 1 }],
    cards: [{ id: "c9", name: "Bonus", limit: 0, cutoffDay: 12, dueDay: 22, color: 0, last4: "1234", trackSince: "2026-10-20" }],
    installments: [], entries: [],
    debts: [
      { id: "d1", kind: "person", personId: "x1", side: "debt", party: "Can", asset: "TRY", amount: 100, date: "2026-10-21" },
      { id: "d2", kind: "payment", personId: "x1", debtId: "d1", amount: 50, date: "2026-10-22" },
    ],
  };
  const out = combine(account, local);
  assert.deepEqual(out.cards.map(c => [c.id, c.trackSince]), [["k1", "2026-10-20"]]);
  assert.deepEqual(out.debts.map(d => [d.id, d.personId, d.debtId]), [["d1", "x1", undefined], ["d2", "x1", "d1"]]);
  assert.equal(account.cards[0].trackSince, "2026-10-24");   // hesabın verisi değişmez
});

test("elle ödeme: kart ödemesi (card_id), cards.manual_since ve elle kredi satıra çevrilir; kartı bilinmeyen ödeme yazılmaz", () => {
  const rows = {
    ...server(),
    cards: [card("k1", { manual_since: "2026-10-24", track_since: "2026-09-01", track_off: false })],
    debts: [
      debt("kp", { kind: "payment", card_id: "k1", side: null, party: null, asset: null, amount: "3000", principal: null, date: "2026-10-25" }),
      debt("kr", { kind: "loan", side: null, party: "Garanti", due: "2026-12-10", count: 4, auto_pay: false }),
    ],
  };
  const state = toState(rows);
  assert.equal(state.cards[0].manualSince, "2026-10-24");
  assert.deepEqual(state.debts[0], { id: "kp", kind: "payment", personId: "ben", cardId: "k1", amount: 3000, date: "2026-10-25" });
  assert.equal(state.debts[1].autoPay, false);
  for (const t of Tablo.TABLES) assert.deepEqual(changes(state, baseOf(rows))[t], { upsert: [], delete: [] }, t);

  // Kartı yalnızca yerelde olan ödeme yazılmaz; borcu olan ödemede card_id boş kalır
  const plan = changes({ ...state, debts: [
    { id: "x1", kind: "payment", personId: "ben", cardId: "yok", amount: 5, date: "2026-10-25" },
    { id: "x2", kind: "payment", personId: "ben", debtId: "kr", cardId: "k1", amount: 5, date: "2026-10-25" },
  ] }, baseOf(rows)).debts.upsert;
  assert.deepEqual(plan.map(x => [x.id, x.row.debt_id, x.row.card_id]), [["x2", "kr", null]]);

  // 5. biçim tabanı (manual_since / card_id yok) rekey ile çevrilir: yükseltmede bir şey yazılmaz
  const old = baseOf(rows);
  for (const t of ["cards", "debts"]) {
    for (const id of Object.keys(old[t])) {
      const { manual_since, card_id, ...row } = JSON.parse(old[t][id]);
      old[t][id] = JSON.stringify(row);
    }
  }
  const plain = toState({ ...rows, cards: [card("k1", { track_since: "2026-09-01", track_off: false })], debts: [rows.debts[1]] });
  for (const t of Tablo.TABLES) assert.deepEqual(changes(plain, rekey(old))[t].upsert.map(x => x.id), t === "debts" ? [] : [], t);
});

test("birleşmede yereldeki elle ödenen kartın modu hesaptaki otomatik karta geçer (ödemeleri önceki ekstrelerde erimesin)", () => {
  const account = { people: [{ id: "ben", name: "Ben", color: 0 }], installments: [], entries: [], debts: [],
    cards: [{ id: "k", name: "Bonus", limit: 0, cutoffDay: 12, dueDay: 22, color: 0, last4: "1234", trackSince: "2026-09-01" }] };
  const local = { people: [{ id: "ben", name: "Ben", color: 0 }], installments: [], entries: [],
    cards: [{ id: "l", name: "Bonus", limit: 0, cutoffDay: 12, dueDay: 22, color: 0, last4: "1234", trackSince: "2026-10-01", manualSince: "2026-10-01" }],
    debts: [{ id: "p", kind: "payment", personId: "ben", cardId: "l", amount: 3000, date: "2026-10-23" }] };
  const out = combine(account, local);
  assert.deepEqual(out.cards.map(c => [c.id, c.trackSince, c.manualSince]), [["k", "2026-09-01", "2026-10-01"]]);
  assert.equal(out.debts[0].cardId, "k");
  // Hesaptaki kart zaten elleyse ya da yereldeki takip dışıysa dokunulmaz
  const off = combine(account, { ...local, cards: [{ ...local.cards[0], trackOff: true }] });
  assert.equal(off.cards[0].manualSince, undefined);
});

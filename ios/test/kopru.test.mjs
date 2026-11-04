// iOS köprüsü (ios/js/kopru.js): JavaScriptCore'a benzer bir ortamda (module, require, console, crypto yok) web
// modülleri ve mcp/tools.js yüklenir, araçlar Motor.swift'in çağırdığı gibi çağrılır.
// Çalıştırma: node --test ios/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = p => readFileSync(new URL(p, root), "utf8");
// Motor.swift'teki sıra
const SCRIPTS = ["dil.js", "para.js", "tekrar.js", "taksit.js", "varlik.js", "borc.js", "kategori.js", "eposta.js", "icgoru.js", "nakit.js", "tablo.js", "ios/js/kopru.js"];

function engine(initial = "") {
  let saved = initial;
  const logs = [];
  const sandbox = {
    native: {
      load: () => saved,
      save: json => { saved = json; },
      random: n => Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256),
      log: (level, msg) => logs.push(`${level}: ${msg}`),
    },
  };
  vm.createContext(sandbox);
  for (const f of SCRIPTS) vm.runInContext(read(f), sandbox, { filename: f });
  const names = sandbox.Kopru.loadTools(read("mcp/tools.js"));
  // Motor.swift gibi: sonuç çağrı dönerken gelir (mikro görevler); burada bir tur beklenir
  const call = async (name, args = {}, today = "2026-10-31") => {
    let out;
    sandbox.Kopru.run(name, JSON.stringify(args), today, (json, err) => { out = err ? { err } : { ok: JSON.parse(json) }; });
    await new Promise(r => setImmediate(r));
    assert.ok(out, `${name} sonuç vermedi`);
    return out;
  };
  return { sandbox, names, call, saved: () => saved, logs };
}

test("araçlar düz betiğe çevrilip yüklenir", () => {
  const { names, sandbox } = engine();
  for (const n of ["get_overview", "list_cards", "card_statements", "add_card", "list_purchases", "add_purchase", "get_assets", "add_entry", "list_people"]) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(typeof sandbox.module, "undefined");
  const c = JSON.parse(sandbox.Kopru.constants());
  assert.ok(c.categories.some(x => x.id === "market"));
  assert.deepEqual(c.assets.map(a => a.code), ["TRY", "USD", "EUR", "GAU"]);
});

test("kart, harcama, özet: hesaplar web ile aynı modüllerden", async () => {
  const e = engine();
  const card = await e.call("add_card", { name: "Bonus", limit: 50000, cutoff_day: 10, due_day: 20, last4: "1234" });
  assert.equal(card.ok.saved, true);
  const p = await e.call("add_purchase", { description: "Telefon", amount: 12000, installments: 3, date: "2026-10-05", card: "Bonus" });
  assert.equal(p.ok.saved, true);
  // 10'unda kesilen ekstreye girer, 20 Ekim'de ödenir; sonraki taksitler Kasım ve Aralık
  assert.deepEqual(p.ok.purchase.nextPayment, { date: "2026-11-20", amount: 4000 });
  const g = await e.call("get_purchase", { id: p.ok.purchase.id });
  assert.deepEqual(g.ok.payments.map(x => x.date), ["2026-10-20", "2026-11-20", "2026-12-20"]);
  const o = await e.call("get_overview");
  assert.equal(o.ok.nextMonth.total, 4000);
  assert.equal(o.ok.remainingTotal, 12000);
  const cards = await e.call("list_cards");
  assert.equal(cards.ok.cards[0].used, 8000);
  // Kayıtlı veri web'in biçimindedir (localStorage cashflow.v1 gibi)
  const state = JSON.parse(e.saved());
  assert.equal(state.installments[0].desc, "Telefon");
  assert.equal(state.cards[0].cutoffDay, 10);
  assert.match(state.cards[0].id, /^[0-9a-z]{8}$/);
});

test("doğrulama hatası kullanıcıya gösterilecek hata olarak döner", async () => {
  const e = engine();
  const r = await e.call("add_purchase", { description: "x", amount: -5 });
  assert.equal(r.err.user, true);
  const u = await e.call("yok_boyle");
  assert.equal(u.err.user, false);
});

test("varlıklar: kur yokken yalnızca TL, kur verilince TL karşılığı", async () => {
  const e = engine();
  await e.call("add_entry", { asset: "TRY", direction: "in", amount: 1000, description: "Maaş", date: "2026-10-01" });
  await e.call("add_entry", { asset: "USD", direction: "in", amount: 10, description: "Hediye", date: "2026-10-01" });
  let a = await e.call("get_assets");
  assert.equal(a.ok.totalTry, 1000);
  assert.ok(a.ok.ratesError);
  e.sandbox.Kopru.setRates(JSON.stringify({ rates: { TRY: 1, USD: 40, EUR: 45, GAU: 4000 }, updatedAt: "2026-10-31T10:00:00Z", source: "test" }));
  a = await e.call("get_assets");
  assert.equal(a.ok.totalTry, 1400);
});

test("eşitleme: değişen satırlar, uzaktan gelenler, boş veri", async () => {
  const e = engine();
  const S = e.sandbox.Kopru.sync;
  assert.equal(S.isBlank(S.state()), true);
  await e.call("add_person", { name: "Ayşe" });
  assert.equal(S.isBlank(S.state()), false);
  const plan = JSON.parse(S.changes(S.state(), "{}"));
  assert.deepEqual(plan.people.upsert.map(x => x.row.name).sort(), ["Ayşe", "Ben"]);
  // Uzaktan gelen kart (sync.js pull → Tablo.merge)
  const row = { id: "k1", name: "Axess", credit_limit: 1000, cutoff_day: 5, due_day: 15, color: 1, last4: null, history: null,
    track_since: "2026-10-01", track_off: false, manual_since: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null };
  const m = JSON.parse(S.merge(S.state(), "{}", JSON.stringify({ cards: [row] })));
  assert.equal(m.changed, true);
  assert.equal(m.state.cards[0].name, "Axess");
  assert.ok(m.base.cards.k1);
  // Hiç eşitlenmemiş cihaz: tablolar esastır
  const f = JSON.parse(S.fromRows(e.sandbox.Kopru.defaultState(), JSON.stringify({ cards: [row] })));
  assert.equal(f.state.cards.length, 1);
  assert.equal(f.state.people[0].id, "ben");
  assert.equal(S.SCHEMA, 8);
});

test("grafikler: Nakit ve Varlığın seyri web'deki nakit.js ile", async () => {
  const e = engine();
  const K = e.sandbox.Kopru;
  K.setRates(JSON.stringify({ rates: { TRY: 1, USD: 40, EUR: 45, GAU: 4000 }, updatedAt: "x", source: "t" }));
  const today = JSON.parse(K.cash("today", 0)).today;
  await e.call("add_entry", { asset: "TRY", direction: "in", amount: 1000, description: "Maaş", date: today }, today);
  await e.call("add_entry", { asset: "USD", direction: "in", amount: 10, description: "Hediye", date: today }, today);
  const c = JSON.parse(K.cash("today", 0));
  assert.equal(c.from, today);
  assert.equal(c.days[0].balance, 1000);           // dolar nakit sayılmaz (varsayılan: TL ve para piyasası fonları)
  assert.ok(c.days[0].moves.some(m => m.desc === "Maaş" && m.value === 1000));
  const plan = JSON.parse(K.assetPlan("1m"));
  assert.equal(plan.span, 30);
  assert.deepEqual(plan.codes, ["USD"]);
  const a = JSON.parse(K.asset("1m", JSON.stringify({ USD: [[today, 40]] })));
  assert.equal(a.points.at(-1).date, today);
  assert.equal(a.points.at(-1).value, 1400);
  assert.equal(a.points[0].value, 0);              // 30 gün önce kayıt yok
});

test("ülke: euro hesabında tutarlar, kurlar ve formlar euroya göre", async () => {
  const e = engine();
  const K = e.sandbox.Kopru;
  K.setHome("EUR");
  K.setRates(JSON.stringify({ rates: { TRY: 1, USD: 50, EUR: 55, GBP: 66, GAU: 6000 }, updatedAt: "x", source: "t" }));
  const c = JSON.parse(K.constants());
  assert.equal(c.home, "EUR");
  assert.equal(c.markets, false);
  assert.deepEqual(c.assets.map(a => a.code), ["EUR", "USD", "GBP", "TRY", "GAU"]);
  assert.ok(c.countries.some(x => x.code === "DE" && x.currency === "EUR"));
  assert.equal(K.sync.homeOf("GB"), "GBP");
  const today = JSON.parse(K.cash("today", 0)).today;
  await e.call("add_entry", { asset: "EUR", direction: "in", amount: 1000, description: "Gehalt", date: today }, today);
  await e.call("add_entry", { asset: "USD", direction: "in", amount: 110, description: "Geschenk", date: today }, today);
  const a = await e.call("get_assets", {}, today);
  assert.equal(a.ok.currency, "EUR");
  assert.equal(a.ok.totalTry, 1100);                          // 110 $ × 50 / 55
  assert.equal(JSON.parse(K.cash("today", 0)).days[0].balance, 1000);
  assert.equal(JSON.parse(e.saved()).home, "EUR");
  const fon = await e.call("add_entry", { asset: "FON:AFT", direction: "in", amount: 1 }, today);
  assert.equal(fon.err.user, true);
  // Eşitleme: euro hesabında euro harcaması satırda boş varlıkla yazılır
  await e.call("add_purchase", { description: "Brot", amount: 3, card: "nakit", date: today }, today);
  const plan = JSON.parse(K.sync.changes(K.sync.state(), "{}"));
  assert.equal(plan.purchases.upsert[0].row.asset, null);
});

// İngilizce (telefon Türkçe değilken Motor.swift Dil.setLang("en", sözlük) çağırır)
test("İngilizce: kategoriler, tekrar etiketi, içgörüler ve ay adları sözlükten", async () => {
  const { sandbox, call } = engine();
  sandbox.Dil.setLang("en", read("dil/en.json"));
  try {
    const c = JSON.parse(sandbox.Kopru.constants());
    assert.equal(c.categories.find(x => x.id === "market").name, "Groceries");
    await call("add_card", { name: "Chase", cutoff_day: 10, due_day: 5, limit: 1000 });
    await call("add_purchase", { description: "Netflix", amount: 15, card: "Chase", repeat: 0 });
    const list = (await call("list_purchases", {})).ok.purchases;
    assert.equal(list[0].repeat.label, "Monthly");
    await call("add_purchase", { description: "TV", amount: 1500, installments: 3, card: "Chase" });
    const ins = (await call("get_insights", {})).ok.insights;
    const limit = ins.find(i => i.id.startsWith("limit-"));
    assert.ok(limit && /Chase is maxed out|Chase is \d+% used/.test(limit.title), JSON.stringify(ins.map(i => i.title)));
    assert.equal(sandbox.Taksit.monthName(10), "November");
  } finally {
    sandbox.Dil.setLang("tr");
  }
});

test("banka e-postaları: Swift'in verdiği liste; yalnızca sunucuda işaretlenenler eklenir", async () => {
  const e = engine();
  await e.call("add_card", { name: "Bonus", limit: 50000, cutoff_day: 10, due_day: 20, last4: "1234" });
  const rows = [
    { id: 1, sender: "banka", subject: null, received_at: "2026-10-17T10:00:00Z", body: "1234 ile biten kartınızdan 17.10.2026 tarihinde MIGROS işyerinde 1.250,00 TL tutarında harcama yapılmıştır." },
    { id: 2, sender: "banka", subject: null, received_at: "2026-10-17T11:00:00Z", body: "1234 ile biten kartınızdan 17.10.2026 tarihinde A101 işyerinde 99,00 TL tutarında harcama yapılmıştır." },
    { id: 3, sender: "banka", subject: null, received_at: "2026-10-17T12:00:00Z", body: "9999 ile biten kartınızdan 17.10.2026 tarihinde AMAZON işyerinde 600,00 TL tutarında harcama yapılmıştır." },
  ];
  e.sandbox.Kopru.setInbox(JSON.stringify(rows), "[]");
  const list = await e.call("list_inbox");
  assert.deepEqual(list.ok.emails.filter(x => !x.needsReview).map(x => x.emailId), [1, 2]);
  // 2'yi başka cihaz önce işledi: sunucu yalnızca 1'i verdi
  e.sandbox.Kopru.setInbox(JSON.stringify(rows), "[1]");
  const out = await e.call("check_inbox");
  assert.deepEqual(out.ok.added.map(p => p.description), ["MIGROS"]);
  assert.deepEqual(out.ok.needsReview.map(x => x.emailId), [3]);
  assert.equal(JSON.parse(e.saved()).installments.length, 1);
  const rest = await e.call("list_inbox", { include_body: true });
  assert.deepEqual(rest.ok.emails.map(x => x.emailId), [2, 3]);
  assert.match(rest.ok.emails[1].body, /AMAZON/);
  assert.equal(e.sandbox.Kopru.inboxReleased(), "[]");
});

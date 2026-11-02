// Ülke ve ana para birimi (para.js): Türkiye dışındaki hesapta tutarlar ana para biriminde, kurlar ona çevrilir, fon ve
// hisse yok.
import { test } from "node:test";
import assert from "node:assert/strict";
import T from "../../taksit.js";
import V from "../../varlik.js";
import { TOOLS, todayKey } from "../tools.js";
import { getUser } from "../supabase.js";

// Bellekte veri; kurlar kur.js gibi TL karşılıkları
function ctxFor(home, today = "2026-11-01") {
  let state = T.hydrate({ home });
  return {
    today, home,
    load: async () => T.hydrate(JSON.parse(JSON.stringify(state))),
    mutate: async fn => { const s = T.hydrate(JSON.parse(JSON.stringify(state))); const out = await fn(s); state = s; return out; },
    rates: async () => ({ rates: { TRY: 1, USD: 50, EUR: 55, GBP: 66, GAU: 6000 }, updatedAt: "2026-11-01T10:00:00Z", source: "test" }),
    prices: async () => ({ prices: {}, missing: [], failed: [] }),
    raw: () => state,
  };
}
const run = async (ctx, name, args = {}) => {
  try { return await TOOLS.find(t => t.name === name).run(args, ctx); } catch (e) { return { error: e.message }; }
};

test("euro hesabı: bakiyeler ve toplamlar euroda, kurlar euroya göre", async () => {
  const ctx = ctxFor("EUR");
  await run(ctx, "add_entry", { asset: "EUR", direction: "in", amount: 1000, description: "Gehalt", date: "2026-10-01" });
  // Euroyla dolar alışı: 100 $ × 0,9 € = 90 € euro bakiyesinden düşer
  const fx = await run(ctx, "add_entry", { asset: "USD", direction: "in", amount: 100, price: 0.9, settle: true, date: "2026-10-02" });
  assert.equal(fx.saved, true);
  const a = await run(ctx, "get_assets");
  assert.equal(a.currency, "EUR");
  assert.deepEqual(a.assets.map(x => x.asset), ["EUR", "USD", "GBP", "TRY", "GAU"]);
  assert.equal(a.assets[0].balance, 910);
  assert.equal(a.assets[1].tryValue, 90.91);       // 100 $ × 50 / 55
  assert.equal(a.totalTry, 1000.91);
  assert.equal(a.rates.USD, 50 / 55);
});

test("euro hesabı: harcama ve kart euroda, TL yabancı para", async () => {
  const ctx = ctxFor("EUR");
  await run(ctx, "add_card", { name: "Visa", cutoff_day: 10, due_day: 20, limit: 2000 });
  const p = await run(ctx, "add_purchase", { description: "Laptop", amount: 900, installments: 3, date: "2026-10-05", card: "Visa" });
  assert.equal(p.purchase.asset, "EUR");
  assert.equal(ctx.raw().installments[0].asset, undefined);   // boş varlık ana para birimidir
  const lira = await run(ctx, "add_purchase", { description: "İstanbul'da kahve", amount: 200, asset: "TRY", card: "nakit", date: "2026-10-06" });
  assert.equal(lira.purchase.asset, "TRY");
  const cards = await run(ctx, "list_cards");
  assert.equal(cards.currency, "EUR");
  assert.equal(cards.cards[0].used, 600);
  const o = await run(ctx, "get_overview");
  assert.equal(o.currency, "EUR");
  assert.equal(o.remainingTotal, 600);                        // TL harcaması euro akışına girmez
});

test("fon ve hisse yalnızca Türkiye'de", async () => {
  const eur = ctxFor("EUR");
  assert.match((await run(eur, "add_entry", { asset: "FON:AFT", direction: "in", amount: 10 })).error, /only available for accounts in Turkey/);
  assert.match((await run(eur, "search_market", { query: "altın" })).error, /only available for accounts in Turkey/);
  const tr = ctxFor("TRY");
  const ok = await run(tr, "add_entry", { asset: "FON:AFT", direction: "in", amount: 10, price: 1.5, settle: false });
  assert.notEqual(ok.error?.includes("only available"), true);
});

test("banka e-postaları ve para piyasası fonları yalnızca Türkiye'de", async () => {
  const usd = ctxFor("USD");
  for (const name of ["get_inbox_address", "list_inbox", "check_inbox", "try_bank_email"]) {
    assert.match((await run(usd, name, { text: "x" })).error, /only available for accounts in Turkey/, name);
  }
  assert.deepEqual(V.cashDefault("USD"), ["USD"]);
  assert.deepEqual(V.cashDef(["USD", "MMF"], "USD"), ["USD"]);
  assert.deepEqual(V.cashDefault("TRY"), ["TRY", "MMF"]);
  assert.deepEqual(V.cashDef(["TRY", "MMF"], "TRY"), ["TRY", "MMF"]);
});

test("Türkiye hesabı eskisi gibi", async () => {
  const ctx = ctxFor("TRY");
  await run(ctx, "add_entry", { asset: "TRY", direction: "in", amount: 1000, description: "Maaş", date: "2026-10-01" });
  await run(ctx, "add_entry", { asset: "USD", direction: "in", amount: 10, description: "Hediye", date: "2026-10-01" });
  const a = await run(ctx, "get_assets");
  assert.equal(a.currency, "TRY");
  assert.deepEqual(a.assets.map(x => x.asset), ["TRY", "USD", "EUR", "GAU"]);
  assert.equal(a.totalTry, 1500);
});

// ── Saat dilimi: "bugün" kullanıcının saatinde ───────────────────────────────

test("todayKey: aynı an New York'ta bir gün geride", () => {
  const an = new Date("2026-11-02T03:30:00Z");   // İstanbul 06:30 (2 Kasım), New York 22:30 (1 Kasım)
  assert.equal(todayKey(an, "Europe/Istanbul"), "2026-11-02");
  assert.equal(todayKey(an, "America/New_York"), "2026-11-01");
});

test("getUser: saat dilimi hesaptan, yoksa ya da geçersizse ülkenin saat dilimi", async () => {
  const user = meta => async () => new Response(JSON.stringify({ id: "u1", email: "a@b.c", user_metadata: meta }), { status: 200 });
  const args = { url: "https://x.supabase.co", key: "k", token: "t" };
  assert.equal((await getUser({ ...args, fetch: user({ country: "US", tz: "America/Chicago" }) })).tz, "America/Chicago");
  assert.equal((await getUser({ ...args, fetch: user({ country: "US" }) })).tz, "America/New_York");
  assert.equal((await getUser({ ...args, fetch: user({ country: "US", tz: "Mars/Olympus" }) })).tz, "America/New_York");
  assert.equal((await getUser({ ...args, fetch: user({}) })).tz, "Europe/Istanbul");
});

// ── Döner kredi (APR) asistanda ─────────────────────────────────────────────────────────────────────────────────────
test("APR: yalnızca ABD'de; elle ödenen kartta kalan devreder, asgari ve geri ödeme görünür", async () => {
  const tr = ctxFor("TRY");
  assert.match((await run(tr, "add_card", { name: "Bonus", cutoff_day: 3, due_day: 28, apr: 40 })).error, /only available for accounts in the US/);
  const ctx = ctxFor("USD", "2026-09-01");
  await run(ctx, "add_entry", { asset: "USD", direction: "in", amount: 5000, description: "Opening", date: "2026-09-01" });
  const added = await run(ctx, "add_card", { name: "Chase", cutoff_day: 3, due_day: 28, limit: 5000, apr: 24, auto_pay: false });
  assert.equal(added.card.apr, 24);
  await run(ctx, "add_purchase", { description: "TV", amount: 1000, date: "2026-09-10", card: "Chase" });
  await run(ctx, "add_purchase", { description: "Headphones", amount: 200, date: "2026-10-10", card: "Chase" });
  ctx.today = "2026-10-20";
  const paid = await run(ctx, "pay_debt", { card: "Chase", amount: 300 });
  assert.equal(paid.minimumDue, 0);                     // asgari (40) ödendi
  ctx.today = "2026-11-10";
  const cards = await run(ctx, "list_cards");
  const rev = cards.cards[0].tracking.revolving;
  assert.deepEqual([rev.apr, rev.carried, rev.interestCharged, rev.minimumDue], [24, 700, 14, 40]);
  assert.deepEqual(rev.payoff, { monthsAtMinimum: 31, interestAtMinimum: 286.44, monthlyToClearIn12: 86.43 });
  assert.equal(cards.cards[0].used, 914);
  assert.equal(cards.cards[0].statement.balance, 914);
  const flow = await run(ctx, "get_cashflow", { from_month: "2026-10", months: 2 });
  assert.equal(flow.months[0].total, 300);
  assert.equal(flow.months[1].total, 914);
  // APR değişince faiz yeniden hesaplanır; otomatiğe dönünce faiz harcama olarak kalır, özvarlık değişmez
  const up = await run(ctx, "update_card", { card: "Chase", apr: 12 });
  assert.equal(up.interestChangeTry, -7);
  const before = (await run(ctx, "get_assets")).netWorthTry;
  const auto = await run(ctx, "update_card", { card: "Chase", auto_pay: true });
  assert.deepEqual(auto.interestSavedAsPurchases, { count: 1, total: 7 });
  assert.equal((await run(ctx, "get_assets")).netWorthTry, before);
});

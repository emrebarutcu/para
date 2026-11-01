// Ülke ve ana para birimi (para.js): Türkiye dışındaki hesapta tutarlar ana para biriminde, kurlar ona çevrilir, fon ve
// hisse yok.
import { test } from "node:test";
import assert from "node:assert/strict";
import T from "../../taksit.js";
import { TOOLS } from "../tools.js";

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

test("Türkiye hesabı eskisi gibi", async () => {
  const ctx = ctxFor("TRY");
  await run(ctx, "add_entry", { asset: "TRY", direction: "in", amount: 1000, description: "Maaş", date: "2026-10-01" });
  await run(ctx, "add_entry", { asset: "USD", direction: "in", amount: 10, description: "Hediye", date: "2026-10-01" });
  const a = await run(ctx, "get_assets");
  assert.equal(a.currency, "TRY");
  assert.deepEqual(a.assets.map(x => x.asset), ["TRY", "USD", "EUR", "GAU"]);
  assert.equal(a.totalTry, 1500);
});

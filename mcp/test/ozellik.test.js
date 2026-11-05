// Ülkeye göre özellikler (para.js features): taksit, şimdi al sonra öde sağlayıcıları, kartın faizi, fon / hisse,
// banka e-postaları; asistan araçları hesabın ülkesine göre doğrular ve listeler.
import { test } from "node:test";
import assert from "node:assert/strict";
import P from "../../para.js";
import T from "../../taksit.js";
import { TOOLS, toolsFor, instructionsFor, featuresOf } from "../tools.js";

function ctxFor(country, today = "2026-11-01") {
  const home = P.homeOfCountry(country);
  let state = T.hydrate({ home });
  return {
    today, home, country,
    load: async () => T.hydrate(JSON.parse(JSON.stringify(state))),
    mutate: async fn => { const s = T.hydrate(JSON.parse(JSON.stringify(state))); const out = await fn(s); state = s; return out; },
    rates: async () => ({ rates: { TRY: 1, USD: 50, EUR: 55, GBP: 66, JPY: 0.33, AED: 13.6, GAU: 6000 }, updatedAt: "2026-11-01T10:00:00Z", source: "test" }),
    prices: async () => ({ prices: {}, missing: [], failed: [] }),
    raw: () => state,
    set: s => { state = T.hydrate(s); },
  };
}
const run = async (ctx, name, args = {}) => {
  try { return await TOOLS.find(t => t.name === name).run(args, ctx); } catch (e) { return { error: e.message }; }
};

test("tablo: taksit, Pay in 4 sağlayıcıları ve kartın faizi ülkeye göre", () => {
  const f = P.features;
  // Taksit: öne çıkan ülkeler; diğerlerinde ikinci planda (hiçbir yerde gizlenmez)
  for (const c of ["TR", "JP", "KR", "AE", "SA", "QA", "KW", "IL", "BR", "MX"]) assert.equal(f(c).installments, "primary", c);
  for (const c of ["US", "GB", "DE", "FR", "CA", "AU", "CH", "PL", "XX", "", null]) assert.equal(f(c).installments, "secondary", String(c));
  // Pay in 4: ülkenin sağlayıcıları, sonda hep "other"
  assert.deepEqual(f("US").bnpl, ["klarna", "afterpay", "affirm", "paypal", "zip", "sezzle", "other"]);
  assert.deepEqual(f("CA").bnpl, ["klarna", "afterpay", "affirm", "paypal", "other"]);
  assert.deepEqual(f("GB").bnpl, ["klarna", "clearpay", "paypal", "other"]);
  assert.deepEqual(f("AU").bnpl, ["afterpay", "zip", "klarna", "paypal", "other"]);
  assert.deepEqual(f("NZ").bnpl, ["afterpay", "zip", "klarna", "other"]);
  for (const c of ["DE", "AT", "NL", "BE", "SE", "NO", "DK", "FI", "ES"]) assert.deepEqual(f(c).bnpl, ["klarna", "paypal", "other"], c);
  assert.deepEqual(f("FR").bnpl, ["klarna", "paypal", "alma", "other"]);
  assert.deepEqual(f("IT").bnpl, ["klarna", "paypal", "scalapay", "other"]);
  for (const c of ["AE", "SA", "QA", "KW"]) assert.deepEqual(f(c).bnpl, ["tabby", "tamara", "other"], c);
  for (const c of ["TR", "JP", "CH", "PL", "XX"]) assert.deepEqual(f(c).bnpl, [], c);
  // Bütün sağlayıcılar taksit.js'te ve adları var
  for (const c of Object.keys(P.FEATURES)) for (const id of f(c).bnpl) {
    assert.ok(T.BNPL.includes(id), id);
    assert.ok(T.BNPL_NAMES[id], id);
  }
  // Kartın faizi (döner kredi)
  for (const c of ["US", "CA", "GB", "AU", "NZ", "JP"]) assert.equal(f(c).apr, true, c);
  for (const c of ["TR", "DE", "FR", "AE", "XX"]) assert.equal(f(c).apr, false, c);
  // Türkiye'ye özel olanlar
  for (const k of ["markets", "bankEmails", "excelImport"]) {
    assert.equal(f("TR")[k], true, k);
    for (const c of ["US", "DE", "JP", "XX"]) assert.equal(f(c)[k], false, `${c} ${k}`);
  }
  // Küçük harf; dönen nesneyi değiştirmek tabloyu bozmaz
  assert.deepEqual(f("de"), f("DE"));
  f("US").bnpl.push("acme");
  assert.equal(f("US").bnpl.includes("acme"), false);
  // Tablodaki ülkelerin hepsi bilinen alanlarla
  for (const [c, v] of Object.entries(P.FEATURES)) for (const k of Object.keys(v)) assert.ok(k in P.DEFAULT_FEATURES, `${c}.${k}`);
});

test("eski, para birimine göre sorular: tek ülkenin para birimi o ülke; euro varsayılan", () => {
  assert.equal(P.countryOfHome("TRY"), "TR");
  assert.equal(P.countryOfHome("USD"), "US");
  assert.equal(P.countryOfHome("GBP"), "GB");
  assert.equal(P.countryOfHome("EUR"), null);
  assert.equal(P.marketsFor("TRY"), true);
  assert.equal(P.marketsFor("USD"), false);
  assert.equal(P.aprFor("USD"), true);
  assert.equal(P.aprFor("JPY"), true);
  assert.equal(P.aprFor("EUR"), false);
  assert.equal(P.bnplFor("USD"), true);
  assert.equal(P.bnplFor("TRY"), false);
  // Asistan: ülke verilmezse para biriminden
  assert.deepEqual(featuresOf({ home: "USD" }), P.features("US"));
  assert.deepEqual(featuresOf({}), P.features("TR"));
  assert.deepEqual(featuresOf({ home: "EUR", country: "FR" }), P.features("FR"));
});

test("Pay in 4: yalnızca ülkenin sağlayıcıları; kayıttaki başka sağlayıcı korunur", async () => {
  const de = ctxFor("DE");
  const ok = await run(de, "add_purchase", { description: "Schuhe", amount: 120, card: "nakit", bnpl: "klarna", date: "2026-11-01" });
  assert.equal(ok.purchase.bnpl.provider, "klarna");
  assert.match((await run(de, "add_purchase", { description: "x", amount: 40, card: "nakit", bnpl: "afterpay" })).error, /bnpl must be one of klarna, paypal, other \(the providers offered in Germany\)/);
  const gb = ctxFor("GB");
  assert.equal((await run(gb, "add_purchase", { description: "Coat", amount: 80, card: "nakit", bnpl: "clearpay" })).purchase.bnpl.name, "Clearpay");
  const ae = ctxFor("AE");
  assert.equal((await run(ae, "add_purchase", { description: "Phone", amount: 4000, card: "nakit", bnpl: "tabby" })).purchase.bnpl.name, "Tabby");
  const jp = ctxFor("JP");
  assert.match((await run(jp, "add_purchase", { description: "x", amount: 4000, card: "nakit", bnpl: "klarna" })).error, /not available for accounts in Japan/);
  // Ülkesi değişmiş hesap: ABD'de girilmiş Afterpay harcaması Almanya'da görünür ve düzenlenir
  de.set({ home: "EUR", installments: [{ id: "a1", personId: de.raw().people[0].id, desc: "Sneakers", total: 100, count: 4, date: "2026-10-20", cardId: null, bnpl: "afterpay" }] });
  const list = await run(de, "list_purchases");
  assert.equal(list.purchases[0].bnpl.name, "Afterpay");
  const up = await run(de, "update_purchase", { id: "a1", description: "Trainers" });
  assert.equal(up.purchase.bnpl.provider, "afterpay");
  assert.equal((await run(de, "update_purchase", { id: "a1", bnpl: "afterpay", amount: 120 })).purchase.bnpl.provider, "afterpay");
  // Kaldırılabilir, ama başka bir yabancı sağlayıcıya geçilemez
  assert.match((await run(de, "update_purchase", { id: "a1", bnpl: "zip" })).error, /bnpl must be one of/);
  assert.equal((await run(de, "update_purchase", { id: "a1", bnpl: null, installments: 1 })).purchase.bnpl, undefined);
});

test("kartın faizi (APR): yalnızca döner kredi olan ülkelerde; kayıtlı olan korunur", async () => {
  for (const c of ["GB", "CA", "AU", "NZ", "JP"]) {
    const ctx = ctxFor(c);
    assert.equal((await run(ctx, "add_card", { name: "Visa", cutoff_day: 3, due_day: 28, apr: 20 })).card.apr, 20, c);
  }
  const de = ctxFor("DE");
  assert.match((await run(de, "add_card", { name: "Visa", cutoff_day: 3, due_day: 28, apr: 20 })).error, /not available for accounts in Germany/);
  de.set({ home: "EUR", cards: [{ id: "c1", name: "Chase", cutoffDay: 3, dueDay: 28, limit: 0, apr: 24 }] });
  assert.equal((await run(de, "update_card", { card: "Chase", name: "Chase Visa" })).card.name, "Chase Visa");
  assert.equal((await run(de, "update_card", { card: "c1", apr: null })).saved, true);
});

test("araç listesi ve bilgi hesabın ülkesine göre", () => {
  const names = ctx => toolsFor(ctx).map(t => t.name);
  const tool = (ctx, name) => toolsFor(ctx).find(t => t.name === name);
  // Türkiye: banka e-postaları ve fon araması var; Pay in 4 ve APR alanı yok
  const tr = { country: "TR", home: "TRY" };
  assert.ok(names(tr).includes("check_inbox"));
  assert.ok(names(tr).includes("search_market"));
  assert.equal(tool(tr, "add_purchase").inputSchema.properties.bnpl, undefined);
  assert.equal(tool(tr, "add_card").inputSchema.properties.apr, undefined);
  assert.ok(tool(tr, "add_purchase").inputSchema.properties.installments);   // taksit her yerde
  // ABD: sağlayıcılar ve APR; banka e-postaları ve fon yok
  const us = { country: "US", home: "USD" };
  for (const n of ["check_inbox", "list_inbox", "try_bank_email", "get_inbox_address", "search_market"]) assert.equal(names(us).includes(n), false, n);
  const bnpl = tool(us, "add_purchase").inputSchema.properties.bnpl;
  assert.deepEqual(bnpl.enum, ["klarna", "afterpay", "affirm", "paypal", "zip", "sezzle", "other", null]);
  assert.match(bnpl.description, /offered in United States: Klarna, Afterpay, Affirm, PayPal, Zip, Sezzle, other/);
  assert.deepEqual(tool(us, "update_purchase").inputSchema.properties.bnpl.enum, bnpl.enum);
  assert.ok(tool(us, "update_card").inputSchema.properties.apr);
  // Almanya: Klarna, PayPal; APR yok
  const de = { country: "DE", home: "EUR" };
  assert.deepEqual(tool(de, "simulate_purchase").inputSchema.properties.bnpl.enum, ["klarna", "paypal", "other", null]);
  assert.equal(tool(de, "add_card").inputSchema.properties.apr, undefined);
  // Asıl araç tanımları değişmez
  assert.deepEqual(TOOLS.find(t => t.name === "add_purchase").inputSchema.properties.bnpl.enum, [...T.BNPL, null]);
  assert.match(instructionsFor(us), /This account is in United States: .*buy now, pay later with Klarna, Afterpay/);
  assert.match(instructionsFor(tr), /This account is in Türkiye: card installments are common.*no buy now, pay later.*TEFAS funds.*bank e-mails/);
  assert.match(instructionsFor({ country: "JP", home: "JPY" }), /Japan: card installments are common.*card APR/);
});

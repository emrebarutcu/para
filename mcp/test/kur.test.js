// Kurlar (kur.js): Truncgil'in tutmayan para birimleri open.er-api'ninkiyle değiştirilir
import { test } from "node:test";
import assert from "node:assert/strict";
import { getRates, clearRates } from "../kur.js";

const TRUNCGIL = {
  Update_Date: "2026-11-04 20:54:01",
  USD: { Selling: "50.03" }, EUR: { Selling: "56.25" }, GRA: { Selling: "6543.41" },
  GBP: { Selling: "67.45" }, JPY: { Selling: "0.003168" }, HUF: { Selling: "0.1552" },
};
const ER = { rates: { USD: 1, TRY: 50, EUR: 0.889, GBP: 0.745, JPY: 158.3, HUF: 325.5 } };

function fetcher({ er = true } = {}) {
  return async url => {
    const host = new URL(url).hostname;
    if (host === "finans.truncgil.com") return new Response(JSON.stringify(TRUNCGIL));
    if (host === "open.er-api.com" && er) return new Response(JSON.stringify(ER));
    return new Response("{}", { status: 503 });
  };
}

test("Japon yeni: Truncgil 100'de bir verirse open.er-api'ninki kullanılır; tutanlar Truncgil'den", async () => {
  clearRates();
  const { rates, source } = await getRates({ fetch: fetcher() });
  assert.equal(source, "truncgil");
  assert.equal(rates.USD, 50.03);
  assert.equal(rates.GAU, 6543.41);
  assert.equal(rates.GBP, 67.45);
  assert.equal(rates.HUF, 0.1552);
  assert.ok(Math.abs(rates.JPY - 50 / 158.3) < 1e-4, String(rates.JPY));
});

test("open.er-api alınamazsa Truncgil'in kurları olduğu gibi", async () => {
  clearRates();
  const { rates } = await getRates({ fetch: fetcher({ er: false }) });
  assert.equal(rates.JPY, 0.003168);
  assert.equal(rates.GBP, 67.45);
});

import test from "node:test";
import assert from "node:assert/strict";
import { handleSubscription, handleNotification, appleToken, jwsPayload, BUNDLE_ID } from "../abonelik.js";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const DAY = 86_400_000;
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";
const YEARLY = `${BUNDLE_ID}.premium.yearly`;

const b64url = s => Buffer.from(s).toString("base64url");
const jws = payload => `${b64url(JSON.stringify({ alg: "ES256" }))}.${b64url(JSON.stringify(payload))}.imza`;

// Gerçek bir P-256 anahtarı (App Store Connect'in .p8'i gibi PKCS#8 PEM)
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
const P8 = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`;
const ENV = { SUPABASE_SERVICE_KEY: "sb_secret_test", APPSTORE_KEY_ID: "KEY123", APPSTORE_ISSUER_ID: "issuer-1", APPSTORE_KEY_P8: P8 };

// Sahte Apple + Supabase. apple: { ortam: { işlemKimliği: { status, tx, renewal } } }; db: subscriptions satırları
function world({ apple = {}, rows = [] } = {}) {
  const db = rows.map(r => ({ ...r }));
  const calls = [];
  const events = [];   // PostHog'a giden olaylar
  const users = { tok1: U1, tok2: U2 };
  async function f(url, init = {}) {
    const u = new URL(url);
    calls.push(`${init.method || "GET"} ${u.host}${u.pathname}`);
    if (u.host === "us.i.posthog.com") {
      events.push(JSON.parse(init.body));
      return new Response("{}");
    }
    if (u.pathname === "/auth/v1/user") {
      const id = users[init.headers.Authorization.replace("Bearer ", "")];
      return id ? new Response(JSON.stringify({ id, user_metadata: { country: "US" } })) : new Response("{}", { status: 401 });
    }
    const env = u.host.includes("sandbox") ? "Sandbox" : u.host.includes("storekit") ? "Production" : null;
    if (env) {
      assert.match(init.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      const id = decodeURIComponent(u.pathname.split("/").pop());
      const x = apple[env]?.[id];
      if (!x) return new Response(JSON.stringify({ errorCode: 4040010 }), { status: 404 });
      return new Response(JSON.stringify({
        environment: env, bundleId: x.bundleId ?? BUNDLE_ID,
        data: [{ subscriptionGroupIdentifier: "g1", lastTransactions: [{ originalTransactionId: x.tx.originalTransactionId, status: x.status, signedTransactionInfo: jws(x.tx), signedRenewalInfo: jws(x.renewal ?? { autoRenewStatus: 1 }) }] }],
      }));
    }
    if (u.pathname === "/rest/v1/subscriptions") {
      assert.equal(init.headers.apikey, ENV.SUPABASE_SERVICE_KEY);
      if ((init.method || "GET") === "GET") {
        const [col, val] = [...u.searchParams].find(([k]) => k !== "select");
        return new Response(JSON.stringify(db.filter(r => String(r[col]) === val.replace(/^eq\./, ""))));
      }
      const row = JSON.parse(init.body);
      if (![U1, U2].includes(row.user_id)) return new Response(JSON.stringify({ code: "23503" }), { status: 409 });
      const i = db.findIndex(r => r.user_id === row.user_id);
      if (i >= 0) db[i] = { ...db[i], ...row }; else db.push(row);
      return new Response(null, { status: 201 });
    }
    throw new Error(`beklenmeyen istek ${url}`);
  }
  return { f, db, calls, events };
}
const tx = (id, extra = {}) => ({ transactionId: id, originalTransactionId: "1000", productId: YEARLY, bundleId: BUNDLE_ID, expiresDate: NOW + 7 * DAY, ...extra });

const post = (path, body, token) => new Request(`https://cashfollow.app${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body),
});
async function bind(w, body, token = "tok1", env = ENV) {
  const res = await handleSubscription(post("/api/abonelik", body, token), env, { fetch: w.f, now: NOW });
  return { status: res.status, body: await res.json() };
}
async function notify(w, payload, env = ENV) {
  const res = await handleNotification(post("/api/appstore", { signedPayload: jws(payload) }), env, { fetch: w.f, now: NOW });
  return { status: res.status, body: await res.json() };
}
const notice = (type, t, environment = "Production") => ({ notificationType: type, data: { bundleId: BUNDLE_ID, environment, signedTransactionInfo: jws(t) } });

test("App Store JWT: ES256, Apple'ın istediği alanlar, imza anahtarla doğrulanır", async () => {
  const token = await appleToken(ENV, NOW);
  const [h, p, s] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "KEY123", typ: "JWT" });
  const body = JSON.parse(Buffer.from(p, "base64url"));
  assert.deepEqual(body, { iss: "issuer-1", iat: NOW / 1000, exp: NOW / 1000 + 1200, aud: "appstoreconnect-v1", bid: BUNDLE_ID });
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(ok);
  assert.deepEqual(jwsPayload(jws({ a: "ç" })), { a: "ç" });
  assert.equal(jwsPayload("bozuk"), null);
});

test("/api/abonelik: giriş, anahtarlar ve girdi denetlenir", async () => {
  const w = world();
  assert.equal((await bind(w, { transactionId: "1" }, null)).status, 401);
  assert.equal((await bind(w, { transactionId: "1" }, "kotu")).status, 401);
  assert.equal((await bind(w, { transactionId: "1" }, "tok1", { ...ENV, APPSTORE_KEY_P8: "" })).status, 503);
  assert.equal((await bind(w, { transactionId: "abc" })).status, 400);
  assert.equal((await bind(w, {})).status, 400);
  assert.equal((await bind(w, { transactionId: "999" })).status, 404);
});

test("/api/abonelik: TestFlight (sandbox) aboneliği hesaba yazılır; sonra Premium", async () => {
  const w = world({ apple: { Sandbox: { 2000: { status: 1, tx: tx("2000", { appAccountToken: U1.toUpperCase() }) } } } });
  const out = await bind(w, { transactionId: "2000" });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { premium: true, expiresAt: new Date(NOW + 7 * DAY).toISOString(), source: "appstore" });
  assert.deepEqual(w.calls.filter(c => c.includes("storekit")), ["GET api.storekit.itunes.apple.com/inApps/v1/subscriptions/2000", "GET api.storekit-sandbox.itunes.apple.com/inApps/v1/subscriptions/2000"]);
  assert.equal(w.db.length, 1);
  assert.deepEqual({ ...w.db[0], updated_at: undefined }, {
    user_id: U1, source: "appstore", product_id: YEARLY, original_transaction_id: "1000", environment: "Sandbox", status: "active",
    expires_at: new Date(NOW + 7 * DAY).toISOString(), auto_renew: true, updated_at: undefined,
  });
});

test("/api/abonelik: başka hesabın aboneliği bağlanmaz; ilk kullanıcının satırına dokunulmaz", async () => {
  // İşlem U1'in hesabından alınmış (appAccountToken): U2 bağlayamaz
  let w = world({ apple: { Production: { 2000: { status: 1, tx: tx("2000", { appAccountToken: U1 }) } } } });
  assert.equal((await bind(w, { transactionId: "2000" }, "tok2")).status, 403);
  // Girişsiz alınmış abonelik U1'e bağlıyken U2'ye bağlanmaz
  w = world({ apple: { Production: { 2000: { status: 1, tx: tx("2000") } } }, rows: [{ user_id: U1, source: "appstore", original_transaction_id: "1000", status: "active" }] });
  assert.equal((await bind(w, { transactionId: "2000" }, "tok2")).status, 409);
  assert.equal(w.db.length, 1);
  // İlk kullanıcı (süresiz) aynı kalır, cevap Premium
  w = world({ apple: { Production: { 2000: { status: 1, tx: tx("2000") } } }, rows: [{ user_id: U1, source: "grandfathered", status: "active", expires_at: null }] });
  const out = await bind(w, { transactionId: "2000" });
  assert.deepEqual(out.body, { premium: true, expiresAt: null, source: "grandfathered" });
  assert.deepEqual(w.db, [{ user_id: U1, source: "grandfathered", status: "active", expires_at: null }]);
  // Başka uygulamanın işlemi
  w = world({ apple: { Production: { 2000: { status: 1, bundleId: "com.baska", tx: tx("2000") } } } });
  assert.equal((await bind(w, { transactionId: "2000" })).status, 404);
});

test("/api/appstore: yenileme, ek süre, iade ve süre bitimi satırı günceller", async () => {
  const apple = { Production: {} };
  const w = world({ apple, rows: [{ user_id: U1, source: "appstore", original_transaction_id: "1000", status: "active", expires_at: new Date(NOW - DAY).toISOString() }] });
  // Yenilendi (appAccountToken yok: hesap kayıtlı satırdan bulunur)
  apple.Production["3000"] = { status: 1, tx: tx("3000", { expiresDate: NOW + 365 * DAY }), renewal: { autoRenewStatus: 1 } };
  assert.deepEqual(await notify(w, notice("DID_RENEW", tx("3000"))), { status: 200, body: { ok: true } });
  assert.equal(w.db[0].status, "active");
  assert.equal(w.db[0].expires_at, new Date(NOW + 365 * DAY).toISOString());
  // Ödeme alınamadı, ek süre: erişim ek sürenin sonuna kadar
  apple.Production["3000"] = { status: 4, tx: tx("3000", { expiresDate: NOW - DAY }), renewal: { autoRenewStatus: 1, gracePeriodExpiresDate: NOW + 3 * DAY } };
  await notify(w, notice("DID_FAIL_TO_RENEW", tx("3000")));
  assert.deepEqual([w.db[0].status, w.db[0].expires_at], ["grace", new Date(NOW + 3 * DAY).toISOString()]);
  // İade
  apple.Production["3000"] = { status: 5, tx: tx("3000", { revocationDate: NOW }) };
  await notify(w, notice("REFUND", tx("3000")));
  assert.equal(w.db[0].status, "revoked");
  // Süre bitti, yenileme kapalı
  apple.Production["3000"] = { status: 2, tx: tx("3000", { expiresDate: NOW - DAY }), renewal: { autoRenewStatus: 0 } };
  await notify(w, notice("EXPIRED", tx("3000")));
  assert.deepEqual([w.db[0].status, w.db[0].auto_renew], ["expired", false]);
});

test("/api/appstore: hesap appAccountToken'dan; bilinmeyen işlem, TEST ve başka uygulama 200 ile geçilir", async () => {
  const w = world({ apple: { Sandbox: { 4000: { status: 1, tx: tx("4000", { originalTransactionId: "1400", appAccountToken: U2 }) } } } });
  assert.equal((await notify(w, notice("SUBSCRIBED", tx("4000"), "Sandbox"))).status, 200);
  assert.equal(w.db[0].user_id, U2);
  assert.equal(w.db[0].environment, "Sandbox");
  // İstenen ortam önce sorulur
  assert.ok(w.calls.find(c => c.includes("storekit")).includes("sandbox"));
  assert.equal((await notify(w, notice("SUBSCRIBED", tx("5000")))).status, 200);
  assert.equal((await notify(w, { notificationType: "TEST", data: { bundleId: BUNDLE_ID } })).status, 200);
  assert.equal((await notify(w, { notificationType: "SUBSCRIBED", data: { bundleId: "com.baska", signedTransactionInfo: jws(tx("4000")) } })).status, 200);
  assert.equal(w.db.length, 1);
  // Silinmiş hesabın aboneliği (yabancı anahtar): satır yazılmaz, yine 200
  const w2 = world({ apple: { Production: { 6000: { status: 1, tx: tx("6000", { appAccountToken: "33333333-3333-4333-8333-333333333333" }) } } } });
  assert.equal((await notify(w2, notice("SUBSCRIBED", tx("6000")))).status, 200);
  assert.equal(w2.db.length, 0);
  // Anahtarlar yoksa 503: Apple sonra yeniden gönderir
  assert.equal((await notify(w, notice("SUBSCRIBED", tx("4000")), { ...ENV, SUPABASE_SERVICE_KEY: "" })).status, 503);
});

test("/api/appstore: abonelik olayları PostHog'a; gelir yalnızca production'daki tahsilatta", async () => {
  const apple = { Production: {}, Sandbox: {} };
  const w = world({ apple, rows: [{ user_id: U1, source: "appstore", original_transaction_id: "1000", status: "active" }] });
  const env = { ...ENV, POSTHOG_KEY: "phc_test" };
  const send = async (type, t, environment = "Production", subtype) => {
    apple[environment][t.transactionId] = { status: type === "REFUND" ? 5 : 1, tx: t };
    const n = notice(type, t, environment);
    if (subtype) n.subtype = subtype;
    const res = await handleNotification(post("/api/appstore", { signedPayload: jws(n) }), env, { fetch: w.f, now: NOW });
    assert.equal(res.status, 200);
    return w.events.at(-1);
  };
  // Deneme başladı: ücret yok
  let e = await send("SUBSCRIBED", tx("7000", { price: 0, currency: "USD", offerDiscountType: "FREE_TRIAL" }), "Production", "INITIAL_BUY");
  assert.equal(e.event, "subscription_subscribed");
  assert.equal(e.api_key, "phc_test");
  assert.equal(e.properties.distinct_id, U1);
  assert.equal(e.properties.subtype, "INITIAL_BUY");
  assert.equal(e.properties.trial, true);
  assert.equal(e.properties.revenue, undefined);
  assert.equal(e.properties.$geoip_disable, true);
  // Denemeden sonra ilk tahsilat: gelir
  e = await send("DID_RENEW", tx("7001", { price: 39990, currency: "USD" }));
  assert.equal(e.event, "subscription_did_renew");
  assert.deepEqual([e.properties.revenue, e.properties.currency, e.properties.product], [39.99, "USD", YEARLY]);
  // Sandbox tahsilatı gelir sayılmaz
  e = await send("DID_RENEW", tx("7002", { price: 39990, currency: "USD" }), "Sandbox");
  assert.equal(e.properties.environment, "Sandbox");
  assert.equal(e.properties.revenue, undefined);
  // İade
  e = await send("REFUND", tx("7003", { price: 39990, currency: "USD", revocationDate: NOW }));
  assert.deepEqual([e.event, e.properties.refund_amount, e.properties.status], ["subscription_refund", 39.99, "revoked"]);
  // Anahtar yoksa gönderilmez
  const before = w.events.length;
  apple.Production["7004"] = { status: 1, tx: tx("7004") };
  await handleNotification(post("/api/appstore", { signedPayload: jws(notice("DID_RENEW", tx("7004"))) }), { ...ENV, POSTHOG_KEY: "" }, { fetch: w.f, now: NOW });
  assert.equal(w.events.length, before);
});

import test from "node:test";
import assert from "node:assert/strict";
import { handleAppleRevoke, clientSecret, _denetimSifirla } from "../apple.js";
import { jwsPayload, BUNDLE_ID } from "../abonelik.js";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
const P8 = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`;
const ENV = { APPLE_SIWA_KEY_P8: P8, APPLE_SIWA_KEY_ID: "SIWA123", APPLE_TEAM_ID: "TEAM456" };
const CODE = "c0de.abcdefghijklmnop";

// Sahte Supabase (kullanıcı) + Apple (token, revoke)
function world({ token = { status: 200, body: { access_token: "at", refresh_token: "rt" } }, revoke = 200 } = {}) {
  const calls = [];
  async function f(url, init = {}) {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") {
      return init.headers.Authorization === "Bearer tok1" ? new Response(JSON.stringify({ id: "u1" })) : new Response("{}", { status: 401 });
    }
    assert.equal(u.host, "appleid.apple.com");
    const p = Object.fromEntries(new URLSearchParams(init.body));
    calls.push({ path: u.pathname, p });
    if (u.pathname === "/auth/token") return new Response(JSON.stringify(token.body), { status: token.status });
    if (u.pathname === "/auth/revoke") return new Response("", { status: revoke });
    throw new Error(`beklenmeyen istek ${url}`);
  }
  return { f, calls };
}
const req = (body, auth = "Bearer tok1") => new Request("https://cashfollow.app/api/apple-iptal", { method: "POST", headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) });

test("client_secret: Apple'ın istediği ES256 JWT ve imzası doğrulanır", async () => {
  const jwt = await clientSecret(ENV, NOW);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "SIWA123" });
  assert.deepEqual(jwsPayload(jwt), { iss: "TEAM456", iat: NOW / 1000, exp: NOW / 1000 + 300, aud: "https://appleid.apple.com", sub: BUNDLE_ID });
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(ok);
});

test("code → refresh token → iptal", async () => {
  const w = world();
  const res = await handleAppleRevoke(req({ code: CODE }), ENV, { fetch: w.f, now: NOW });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { revoked: true });
  assert.deepEqual(w.calls.map(c => c.path), ["/auth/token", "/auth/revoke"]);
  assert.equal(w.calls[0].p.code, CODE);
  assert.equal(w.calls[0].p.grant_type, "authorization_code");
  assert.equal(w.calls[0].p.client_id, BUNDLE_ID);
  assert.deepEqual([w.calls[1].p.token, w.calls[1].p.token_type_hint], ["rt", "refresh_token"]);
});

test("refresh token yoksa access token iptal edilir", async () => {
  const w = world({ token: { status: 200, body: { access_token: "at" } } });
  const res = await handleAppleRevoke(req({ code: CODE }), ENV, { fetch: w.f, now: NOW });
  assert.equal(res.status, 200);
  assert.deepEqual([w.calls[1].p.token, w.calls[1].p.token_type_hint], ["at", "access_token"]);
});

test("Apple code'u reddederse 502 ve hata adı", async () => {
  const w = world({ token: { status: 400, body: { error: "invalid_grant" } } });
  const res = await handleAppleRevoke(req({ code: CODE }), ENV, { fetch: w.f, now: NOW });
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "invalid_grant" });
  assert.equal(w.calls.length, 1);
});

test("girişsiz 401, anahtar yoksa 503, bozuk code 400", async () => {
  const w = world();
  assert.equal((await handleAppleRevoke(req({ code: CODE }, null), ENV, { fetch: w.f })).status, 401);
  assert.equal((await handleAppleRevoke(req({ code: CODE }, "Bearer kotu"), ENV, { fetch: w.f })).status, 401);
  assert.equal((await handleAppleRevoke(req({ code: CODE }), {}, { fetch: w.f })).status, 503);
  assert.equal((await handleAppleRevoke(req({ code: "x" }), ENV, { fetch: w.f })).status, 400);
  assert.equal(w.calls.length, 0);
});

// GET: kurulum denetimi
const getReq = () => new Request("https://cashfollow.app/api/apple-iptal");
function appleCevap(status, body, calls = []) {
  return async (url, init = {}) => {
    calls.push({ url, p: Object.fromEntries(new URLSearchParams(init.body)) });
    return new Response(JSON.stringify(body), { status });
  };
}

test("denetim: anahtar yoksa hangi değişkenlerin eksik olduğu, Apple'a gidilmez", async () => {
  _denetimSifirla();
  const calls = [];
  const res = await handleAppleRevoke(getReq(), { APPLE_TEAM_ID: "TEAM456" }, { fetch: appleCevap(200, {}, calls), now: NOW });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ready: false, missing: ["APPLE_SIWA_KEY_P8", "APPLE_SIWA_KEY_ID"] });
  assert.equal(calls.length, 0);
});

test("denetim: Apple yalnızca code'u reddederse (invalid_grant) kurulum doğru; gizli bilgi dönmez", async () => {
  _denetimSifirla();
  const calls = [];
  const res = await handleAppleRevoke(getReq(), ENV, { fetch: appleCevap(400, { error: "invalid_grant" }, calls), now: NOW });
  const body = await res.json();
  assert.deepEqual(body, { ready: true, apple: "ok" });
  assert.ok(!JSON.stringify(body).includes("SIWA123") && !JSON.stringify(body).includes("TEAM456"));
  assert.equal(new URL(calls[0].url).pathname, "/auth/token");
  assert.equal(calls[0].p.client_id, BUNDLE_ID);
  assert.equal(calls[0].p.grant_type, "authorization_code");
});

test("denetim: invalid_client → anahtar, Key ID ya da Team ID yanlış", async () => {
  _denetimSifirla();
  const res = await handleAppleRevoke(getReq(), ENV, { fetch: appleCevap(400, { error: "invalid_client" }), now: NOW });
  assert.deepEqual(await res.json(), { ready: true, apple: "invalid_client" });
});

test("denetim: bozuk .p8 → bad_key_format; sonuç 10 dakika saklanır", async () => {
  _denetimSifirla();
  const kotu = { ...ENV, APPLE_SIWA_KEY_P8: "-----BEGIN PRIVATE KEY-----\nbozuk\n-----END PRIVATE KEY-----" };
  const calls = [];
  const r1 = await (await handleAppleRevoke(getReq(), kotu, { fetch: appleCevap(400, { error: "invalid_grant" }, calls), now: NOW })).json();
  assert.equal(r1.apple, "bad_key_format");
  const r2 = await (await handleAppleRevoke(getReq(), kotu, { fetch: appleCevap(400, { error: "invalid_grant" }, calls), now: NOW + 60_000 })).json();
  assert.equal(r2.apple, "bad_key_format");
  assert.equal(calls.length, 0);
});

// ---------- CashFollow Premium: App Store abonelikleri → Supabase (subscriptions) ----------
// POST /api/abonelik: iPhone uygulaması satın alma ya da geri yüklemeden sonra işlem kimliğini gönderir (kullanıcının
// token'ıyla); abonelik o hesaba bağlanır. POST /api/appstore: App Store Server Notifications V2 (yenileme, iptal, iade…).
// İkisinde de durum Apple'a sorulur (App Store Server API, Get All Subscription Statuses): cevap Apple'dan TLS ile gelir,
// gelen JWS'lerin imza zincirini doğrulamak gerekmez; bildirim yalnızca hangi işleme bakılacağını söyler.
// Satırı service role yazar (SUPABASE_SERVICE_KEY, eposta Worker'ındakiyle aynı); Apple'a In-App Purchase anahtarıyla
// gidilir (APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_KEY_P8). Biri eksikse 503: uygulama cihazdaki aboneliğe güvenir.
// Bildirimler ürün analitiğine de gider (PostHog, anahtar varsa): subscription_did_renew, subscription_refund… ve
// production'daki ücretli işlemde gelir (revenue).
import Tablo from "../tablo.js";
import { config, userFor } from "./server.js";

export const BUNDLE_ID = "app.cashfollow.ios";
export const PRODUCTS = ["weekly", "monthly", "yearly"].map(p => `${BUNDLE_ID}.premium.${p}`);
const APPLE = { Production: "https://api.storekit.itunes.apple.com", Sandbox: "https://api.storekit-sandbox.itunes.apple.com" };
// Apple'ın abonelik durumu → subscriptions.status (erişim: active, grace; tablo.js premium)
const STATUS = { 1: "active", 2: "expired", 3: "billing_retry", 4: "grace", 5: "revoked" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const ready = env => !!(env.SUPABASE_SERVICE_KEY && env.APPSTORE_KEY_ID && env.APPSTORE_ISSUER_ID && env.APPSTORE_KEY_P8);

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const bytesOf = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
// JWS'in gövdesi, imzası doğrulanmadan (yalnızca Apple'dan TLS ile gelen ya da ipucu olarak kullanılan veride)
export function jwsPayload(jws) {
  try {
    const part = String(jws).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(bytesOf(part + "=".repeat((4 - (part.length % 4)) % 4))));
  } catch {
    return null;
  }
}

// App Store Server API için ES256 JWT (20 dakika). WebCrypto'nun ECDSA imzası JWS'in istediği r‖s biçimindedir.
export async function appleToken(env, now = Date.now()) {
  const der = bytesOf(env.APPSTORE_KEY_P8.replace(/-----[^-]+-----|\s+/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  const part = o => b64url(enc.encode(JSON.stringify(o)));
  const input = `${part({ alg: "ES256", kid: env.APPSTORE_KEY_ID, typ: "JWT" })}.${part({ iss: env.APPSTORE_ISSUER_ID, iat, exp: iat + 1200, aud: "appstoreconnect-v1", bid: BUNDLE_ID })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

// Apple'ın bir aboneliği → subscriptions satırı. Erişimin bittiği an: ek sürede ek sürenin sonu, değilse dönemin sonu;
// bilinmiyorsa geçmiş (App Store satırında expires_at hiç boş olmaz: boş süresiz demektir).
function rowOf(item, environment, now) {
  const t = jwsPayload(item.signedTransactionInfo) || {};
  const r = jwsPayload(item.signedRenewalInfo) || {};
  const status = t.revocationDate ? "revoked" : STATUS[item.status] ?? "expired";
  const until = status === "grace" ? r.gracePeriodExpiresDate ?? t.expiresDate : t.expiresDate;
  return {
    row: {
      source: "appstore", product_id: t.productId ?? null,
      original_transaction_id: String(item.originalTransactionId ?? t.originalTransactionId ?? ""),
      environment, status, expires_at: new Date(Number(until) || 0).toISOString(),
      auto_renew: r.autoRenewStatus == null ? null : r.autoRenewStatus === 1, updated_at: new Date(now).toISOString(),
    },
    token: typeof t.appAccountToken === "string" && UUID.test(t.appAccountToken.toLowerCase()) ? t.appAccountToken.toLowerCase() : null,
    tx: t,
  };
}

// İşlemin aboneliği: { environment, row, token } ya da null (Apple tanımıyor ya da bu uygulamanın Premium'u değil).
// Önce istenen ortam (bildirimin söylediği; yoksa production), 404'te öteki: TestFlight alımları sandbox'tadır.
// Birden fazla abonelik varsa erişim verenlerden, yoksa en geç biteni.
export async function appleStatus(transactionId, env, { fetch: f = fetch, prefer = "Production", now = Date.now() } = {}) {
  const token = await appleToken(env, now);
  const order = prefer === "Sandbox" ? ["Sandbox", "Production"] : ["Production", "Sandbox"];
  for (const environment of order) {
    const res = await f(`${APPLE[environment]}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`App Store ${res.status}`);
    const body = await res.json();
    if (body?.bundleId && body.bundleId !== BUNDLE_ID) return null;
    const all = (body?.data || []).flatMap(g => g?.lastTransactions || []).map(x => rowOf(x, environment, now))
      .filter(x => PRODUCTS.includes(x.row.product_id) && x.row.original_transaction_id);
    if (!all.length) return null;
    const rank = x => [Tablo.premium(x.row, now) ? 1 : 0, Date.parse(x.row.expires_at)];
    all.sort((a, b) => rank(b)[0] - rank(a)[0] || rank(b)[1] - rank(a)[1]);
    return { environment, ...all[0] };
  }
  return null;
}

// ---------- Supabase (service role) ----------
function service(env) {
  const key = env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;   // eski JWT biçimli service_role anahtarı
  return headers;
}
async function rowWhere(column, value, env, f) {
  const res = await f(`${config(env).url}/rest/v1/subscriptions?select=*&${column}=eq.${encodeURIComponent(value)}`, { headers: service(env) });
  if (!res.ok) throw new Error(`subscriptions ${res.status}: ${await res.text()}`);
  return (await res.json())[0] ?? null;
}

// Aboneliği hesaba yazar. İlk kullanıcının süresiz satırına dokunulmaz; aynı App Store aboneliği başka hesaba bağlıysa
// { conflict: true }. Dönen satır hesabın şimdiki satırıdır.
export async function save(userId, row, env, f = fetch) {
  const mine = await rowWhere("user_id", userId, env, f);
  if (mine?.source === "grandfathered") return { row: mine };
  const owner = await rowWhere("original_transaction_id", row.original_transaction_id, env, f);
  if (owner && owner.user_id !== userId) return { conflict: true, row: mine };
  const next = { ...row, user_id: userId };
  const res = await f(`${config(env).url}/rest/v1/subscriptions?on_conflict=user_id`, {
    method: "POST",
    headers: { ...service(env), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(next),
  });
  // 409: aynı abonelik bu arada başka hesaba yazıldı ya da hesap silinmiş (yabancı anahtar)
  if (res.status === 409) return { conflict: true, row: mine };
  if (!res.ok) throw new Error(`subscriptions ${res.status}: ${await res.text()}`);
  return { row: next };
}

// Abonelik olayı PostHog'a (Analitik.swift ile aynı kişi: hesabın kimliği). Gelir yalnızca production'da tahsil edilen
// işlemde (ücretsiz deneme 0, sandbox sayılmaz); iadede tutar refund_amount. Gönderilemezse bildirim yine işlenmiş sayılır.
const CHARGES = ["SUBSCRIBED", "DID_RENEW", "OFFER_REDEEMED"];
async function analitik(userId, hint, st, cfg, f, now) {
  if (!cfg.posthogKey || !hint.type) return;
  const t = st.tx || {};
  const amount = Number(t.price) > 0 ? Number(t.price) / 1000 : 0;   // App Store: binde bir para birimi
  const props = {
    distinct_id: userId, $lib: "cashfollow-server", platform: "ios", $geoip_disable: true,
    subtype: hint.subtype ?? null, product: st.row.product_id, environment: st.environment, status: st.row.status,
    auto_renew: st.row.auto_renew, trial: t.offerDiscountType === "FREE_TRIAL", price: amount, currency: t.currency ?? null,
  };
  if (st.environment === "Production" && amount > 0 && CHARGES.includes(hint.type)) props.revenue = amount;
  if (hint.type === "REFUND") props.refund_amount = amount;
  try {
    await f(`${cfg.posthogHost}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: cfg.posthogKey, event: `subscription_${String(hint.type).toLowerCase()}`, properties: props, timestamp: new Date(now).toISOString() }),
    });
  } catch (err) {
    console.error("analitik:", err);
  }
}

// POST /api/abonelik { transactionId } (Authorization: Bearer <Supabase oturumu>) → { premium, expiresAt, source }
export async function handleSubscription(request, env = {}, { fetch: f = fetch, now = Date.now() } = {}) {
  if (request.method !== "POST") return json({ error: "POST" }, 405);
  const bearer = (request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer) return json({ error: "unauthorized" }, 401);
  const user = await userFor(bearer, config(env), f);
  if (!user) return json({ error: "invalid_token" }, 401);
  if (!ready(env)) return json({ error: "unavailable" }, 503);
  let id;
  try { id = String((await request.json())?.transactionId ?? ""); } catch {}
  if (!/^\d{1,30}$/.test(id ?? "")) return json({ error: "transactionId" }, 400);

  try {
    const st = await appleStatus(id, env, { fetch: f, now });
    if (!st) return json({ error: "not_found" }, 404);
    if (st.token && st.token !== user.id.toLowerCase()) return json({ error: "other_account" }, 403);
    const out = await save(user.id, st.row, env, f);
    if (out.conflict) return json({ error: "linked_to_other_account" }, 409);
    return json({ premium: Tablo.premium(out.row, now), expiresAt: out.row.expires_at, source: out.row.source });
  } catch (err) {
    console.error("abonelik:", err);
    return json({ error: "failed" }, 502);
  }
}

// POST /api/appstore (App Store Server Notifications V2, { signedPayload }). Hesap işlemin appAccountToken'ından
// (uygulama girişliyken satın alımda koyar) ya da daha önce bağlanmış aboneliğin satırından bulunur; bulunamazsa
// uygulama girişte bağlar. Hata olursa 503: Apple bildirimi sonra yeniden gönderir.
export async function handleNotification(request, env = {}, { fetch: f = fetch, now = Date.now() } = {}) {
  if (request.method !== "POST") return json({ error: "POST" }, 405);
  if (!ready(env)) return json({ error: "unavailable" }, 503);
  let hint = null;
  try {
    const p = jwsPayload((await request.json())?.signedPayload);
    hint = { type: p?.notificationType, subtype: p?.subtype, environment: p?.data?.environment, bundleId: p?.data?.bundleId, tx: jwsPayload(p?.data?.signedTransactionInfo) };
  } catch {}
  // TEST bildirimi ve başka uygulamanınki: işlem yok
  if (!hint?.tx?.transactionId || hint.bundleId !== BUNDLE_ID) return json({ ok: true });

  try {
    const st = await appleStatus(String(hint.tx.transactionId), env, { fetch: f, prefer: hint.environment, now });
    if (!st) return json({ ok: true });
    const userId = st.token ?? (await rowWhere("original_transaction_id", st.row.original_transaction_id, env, f))?.user_id;
    if (userId) {
      await save(userId, st.row, env, f);
      await analitik(userId, hint, st, config(env), f, now);
    }
    return json({ ok: true });
  } catch (err) {
    console.error("appstore:", err);
    return json({ error: "failed" }, 503);
  }
}

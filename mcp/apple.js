// ---------- Apple ile giriş: hesap silinirken Apple belirtecinin iptali ----------
// App Store kuralı (5.1.1(v)): Sign in with Apple kullanan uygulama, hesap silinince kullanıcının Apple belirteçlerini
// iptal eder (REST API: auth/revoke). Belirteç saklanmaz: iPhone silmeden hemen önce kullanıcıya Apple ile yeniden
// onaylatır ve yeni authorization code'u (5 dakika geçerli, tek kullanımlık) buraya gönderir; burada code → refresh token
// alınır ve hemen iptal edilir. Ardından uygulama hesabı siler (delete_my_account).
// POST /api/apple-iptal { code } (kullanıcının Supabase token'ıyla). Apple'a "Sign in with Apple" anahtarıyla gidilir:
// APPLE_SIWA_KEY_P8 (secret), APPLE_SIWA_KEY_ID, APPLE_TEAM_ID. Biri eksikse 503: uygulama silmeyi yine de yapar.
import { config, userFor } from "./server.js";
import { BUNDLE_ID, es256 } from "./abonelik.js";

const APPLE = "https://appleid.apple.com";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export const ready = env => !!(env.APPLE_SIWA_KEY_P8 && env.APPLE_SIWA_KEY_ID && env.APPLE_TEAM_ID);

// client_secret: Apple'ın istediği ES256 JWT (en çok 6 ay; burada 5 dakika)
export async function clientSecret(env, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  return es256(env.APPLE_SIWA_KEY_P8, { kid: env.APPLE_SIWA_KEY_ID },
    { iss: env.APPLE_TEAM_ID, iat, exp: iat + 300, aud: APPLE, sub: BUNDLE_ID });
}

const form = o => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });

// code → refresh token (yoksa access token) → iptal. Apple'ın hatası olduğu gibi döner (invalid_grant: code eski / kullanılmış).
export async function revoke(code, env, { fetch: f = fetch, now = Date.now() } = {}) {
  const secret = await clientSecret(env, now);
  const base = { client_id: BUNDLE_ID, client_secret: secret };
  const res = await f(`${APPLE}/auth/token`, form({ ...base, code, grant_type: "authorization_code" }));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error || `token_${res.status}` };
  const [token, hint] = body.refresh_token ? [body.refresh_token, "refresh_token"] : [body.access_token, "access_token"];
  if (!token) return { ok: false, error: "no_token" };
  const out = await f(`${APPLE}/auth/revoke`, form({ ...base, token, token_type_hint: hint }));
  return out.ok ? { ok: true } : { ok: false, error: `revoke_${out.status}` };
}

// GET /api/apple-iptal: kurulum denetimi (girişsiz; gizli bilgi dönmez). Anahtar tanımlıysa Apple'a geçersiz bir code
// ile gidilir: "invalid_grant" → Apple istemciyi tanıdı, yalnızca code'u reddetti: anahtar, Key ID ve Team ID doğru
// (apple: "ok"); "invalid_client" → anahtar / Key ID / Team ID yanlış ya da anahtar bu App ID'ye bağlı değil. Sonuç
// 10 dakika saklanır (Apple'a sık gidilmesin).
let denetimSonucu = null;
export async function denetim(env, { fetch: f = fetch, now = Date.now() } = {}) {
  if (!ready(env)) return { ready: false, missing: ["APPLE_SIWA_KEY_P8", "APPLE_SIWA_KEY_ID", "APPLE_TEAM_ID"].filter(k => !env[k]) };
  if (denetimSonucu && now - denetimSonucu.at < 600_000) return denetimSonucu.body;
  let apple, secret;
  try { secret = await clientSecret(env, now); } catch { apple = "bad_key_format"; }   // .p8 okunamadı
  if (secret) {
    try {
      const res = await f(`${APPLE}/auth/token`, form({ client_id: BUNDLE_ID, client_secret: secret,
        code: "denetim.gecersiz.kod", grant_type: "authorization_code" }));
      const err = (await res.json().catch(() => ({}))).error;
      apple = err === "invalid_grant" ? "ok" : err || `http_${res.status}`;
    } catch { apple = "unreachable"; }
  }
  const body = { ready: true, apple };
  denetimSonucu = { at: now, body };
  return body;
}
export const _denetimSifirla = () => { denetimSonucu = null; };   // testler için

export async function handleAppleRevoke(request, env = {}, { fetch: f = fetch, now = Date.now() } = {}) {
  if (request.method === "GET") return json(await denetim(env, { fetch: f, now }));
  if (request.method !== "POST") return json({ error: "POST" }, 405);
  const bearer = (request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer) return json({ error: "unauthorized" }, 401);
  const user = await userFor(bearer, config(env), f);
  if (!user) return json({ error: "invalid_token" }, 401);
  if (!ready(env)) return json({ error: "unavailable" }, 503);
  let code;
  try { code = String((await request.json())?.code ?? ""); } catch {}
  if (!/^[\w.-]{10,512}$/.test(code ?? "")) return json({ error: "code" }, 400);
  try {
    const r = await revoke(code, env, { fetch: f, now });
    return r.ok ? json({ revoked: true }) : json({ error: r.error }, 502);
  } catch (err) {
    console.error("apple-iptal:", err);
    return json({ error: "failed" }, 502);
  }
}

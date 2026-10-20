// ---------- POST /api/kategori: harcama kategorisi önerisi (Cloudflare Workers AI) ----------
// Giriş yapmış kullanıcılara: uygulama açıklamaları (ve kullanıcının kategorisini seçtiği son harcamaları, örnek olarak)
// gönderir, çok dilli metin gömme modeliyle kategori önerileri döner. Sıralama cihazdakiyle aynıdır (kategori.js);
// yalnızca model büyük ve sunucuda. Kimlik: Supabase oturum anahtarı (Authorization: Bearer), MCP'deki gibi doğrulanır.
//   → { items: ["MIGROS TICARET A.S.", …], examples: [{ text, id }] }
//   ← { model, results: [{ category, confidence }] }   (items sırasıyla)
// Veri saklanmaz; vektörler yalnızca bu Worker örneğinin belleğinde önbellekte kalır.
import K from "../kategori.js";
import { config, userFor } from "./server.js";

// Model ve ona göre ayarlanmış güven keskinliği (benzerlik aralığı modele göre değişir). Ölçüm (115 harcamalık,
// test markalarını görmemiş deneme): bge-m3 güveni ≥ 0.3 olanların %96'sı doğru, harcamaların %59'u eşiği geçiyor;
// cls ya da mean havuzlamada sonuç aynı. qwen3-embedding-0.6b daha çok atıyor ama doğru oranı %85'te kaldı.
export const MODEL = { id: "@cf/baai/bge-m3", sharpness: 20 };

const MAX_ITEMS = 50;          // bir istekte en fazla açıklama
const MAX_EXAMPLES = K.EXAMPLES;
const MAX_TEXT = 200;
const RATE = 300;              // kullanıcı başına dakikada en fazla açıklama (bu Worker örneğinde)
const CACHE = 2000;            // bellekte tutulan en fazla vektör

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Metin → vektör (açıklamalar, kategori kelimeleri ve örnekler aynı biçimde)
const vectors = new Map();     // metin → vektör
let words = null;              // kategori kelimelerinin vektörleri (Worker örneği başına bir kez)

async function embed(ai, texts) {
  const missing = [...new Set(texts.filter(t => !vectors.has(t)))];
  if (missing.length) {
    const out = await ai.run(MODEL.id, { text: missing });
    const data = out?.data ?? out?.response;
    if (!Array.isArray(data) || data.length !== missing.length || !Array.isArray(data[0])) throw new Error("embedding cevabı beklenen biçimde değil");
    if (vectors.size + missing.length > CACHE) vectors.clear();
    missing.forEach((t, i) => vectors.set(t, normalize(data[i])));
  }
  return texts.map(t => vectors.get(t));
}

function normalize(v) {
  const n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
}

async function wordVectors(ai) {
  words ??= (async () => {
    const list = K.words();
    const v = await embed(ai, list.map(w => w.text));
    return list.map((w, i) => ({ id: w.id, v: v[i] }));
  })().catch(err => { words = null; throw err; });
  return words;
}

// Kullanıcı başına dakikalık sayaç (Worker örneği içinde; kaba bir sınır)
const usage = new Map();
function allow(userId, n) {
  const minute = Math.floor(Date.now() / 60_000);
  const u = usage.get(userId);
  const used = u?.minute === minute ? u.used : 0;
  if (used + n > RATE) return false;
  if (usage.size > 5000) usage.clear();
  usage.set(userId, { minute, used: used + n });
  return true;
}

function parse(body) {
  const items = body?.items, examples = body?.examples ?? [];
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return null;
  if (!Array.isArray(examples) || examples.length > MAX_EXAMPLES) return null;
  const text = v => (typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "");
  const list = items.map(x => K.clean(text(x)));
  const ex = examples.map(e => ({ id: e?.id, text: text(e?.text) })).filter(e => K.valid(e.id) && e.text);
  return list.every(Boolean) ? { items: list, examples: ex } : null;
}

export async function handleCategories(request, env = {}, { fetch: f = fetch } = {}) {
  if (request.method !== "POST") return json({ error: "POST" }, 405);
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return json({ error: "unauthorized" }, 401);
  const user = await userFor(token, config(env), f);
  if (!user) return json({ error: "invalid_token" }, 401);
  if (!env.AI) return json({ error: "ai_unavailable" }, 503);

  let input;
  try { input = parse(await request.json()); } catch {}
  if (!input) return json({ error: `items: 1–${MAX_ITEMS} açıklama, examples: en fazla ${MAX_EXAMPLES} { text, id }` }, 400);
  if (!allow(user.id, input.items.length)) return json({ error: "rate_limited" }, 429);

  try {
    const [protos, qs, ex] = await Promise.all([
      wordVectors(env.AI),
      embed(env.AI, input.items),
      input.examples.length ? embed(env.AI, input.examples.map(e => e.text)) : [],
    ]);
    const users = input.examples.map((e, i) => ({ id: e.id, v: ex[i] }));
    const results = qs.map(q => {
      const r = K.rank(q, protos, users, { sharpness: MODEL.sharpness });
      return { category: r.category, confidence: Math.round(r.confidence * 1000) / 1000 };
    });
    return json({ model: MODEL.id, results });
  } catch (err) {
    console.error("kategori:", err);
    return json({ error: "ai_failed" }, 503);
  }
}

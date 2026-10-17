// ---------- Para e-posta karşılayıcı (Cloudflare Email Worker) ----------
// <adres>@alanadi'na gelen e-posta → ingest_email(adres, metin) → inbox_messages.
// Ayrıştırma uygulamada yapılır; burada yalnızca düz metin çıkarılıp kullanıcının kutusuna yazılır.
import PostalMime from "postal-mime";
import Eposta from "../../../eposta.js";

const MAX_RAW = 2 * 1024 * 1024;   // ekli ekstre PDF'leri vb. — harcama bildirimi bunun çok altında

export async function handleEmail(message, env, fetchFn = fetch) {
  const address = String(message.to).split("@")[0].split("+")[0].toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(address)) {
    message.setReject("Unknown address");
    return;
  }
  if (message.rawSize > MAX_RAW) {
    message.setReject("Message too large");
    return;
  }

  const email = await PostalMime.parse(message.raw);
  const body = Eposta.plainText(email.text || email.html || "");
  if (!body) return;   // boş e-posta: sessizce düşür

  const key = env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;   // eski JWT biçimli service_role anahtarı

  const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/ingest_email`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      address,
      body,
      subject: email.subject ?? null,
      sender: email.from?.address ?? message.from,
      message_id: email.messageId ?? null,
    }),
  });
  // Supabase'e yazılamazsa hata fırlatılır; Cloudflare günlüğünde görünür
  if (!res.ok) throw new Error(`ingest_email ${res.status}: ${await res.text()}`);
  const out = await res.json();
  if (!out.ok && out.error === "unknown address") message.setReject("Unknown address");
}

export default {
  async email(message, env) {
    await handleEmail(message, env);
  },
};

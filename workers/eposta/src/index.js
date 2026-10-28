// ---------- CashFollow e-posta karşılayıcı (Cloudflare Email Worker) ----------
// <adres>@alanadi'na gelen e-posta → ingest_email(adres, metin) → inbox_messages.
// Ayrıştırma uygulamada yapılır; burada e-postanın metni çıkarılıp kullanıcının kutusuna yazılır.
// Bağımlılığı yoktur: Cloudflare panelindeki kod düzenleyicisine olduğu gibi yapıştırılabilir.
// Ortam: SUPABASE_URL (metin), SUPABASE_SERVICE_KEY (gizli).

const MAX_RAW = 2 * 1024 * 1024;   // ekli ekstre PDF'leri vb. — harcama bildirimi bunun çok altında

export default {
  async email(message, env) {
    await handleEmail(message, env);
  },
  // Panel önizlemesi / tarayıcı: Worker'ın ayakta olduğunu göstermek için (e-posta işini etkilemez)
  async fetch() {
    return new Response("CashFollow e-posta servisi çalışıyor.\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};

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

  const email = parseEmail(new Uint8Array(await new Response(message.raw).arrayBuffer()));
  // Düz metin yeğlenir; çok kısaysa ya da HTML'deki bağlantıları taşımıyorsa (banka doğrulama e-postası) HTML kullanılır
  const plainOk = email.text && email.text.trim().length >= 40
    && (/https?:\/\//i.test(email.text) || !/<a\b[^>]*\bhref\s*=\s*["']?https?:/i.test(email.html || ""));
  const text = plainOk ? email.text : htmlToText(email.html || email.text || "");
  if (!text.trim()) return;   // boş e-posta: sessizce düşür

  const key = env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;   // eski JWT biçimli service_role anahtarı

  const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/ingest_email`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      address,
      body: text.trim(),
      subject: email.subject || null,
      sender: email.from || message.from,
      message_id: email.messageId || null,
    }),
  });
  // Supabase'e yazılamazsa hata fırlatılır; Cloudflare günlüğünde görünür
  if (!res.ok) throw new Error(`ingest_email ${res.status}: ${await res.text()}`);
  const out = await res.json();
  if (!out.ok && out.error === "unknown address") message.setReject("Unknown address");
}

// ---------- MIME ----------
// Ham e-posta → { subject, from, messageId, text, html }. Ekler atlanır.
export function parseEmail(bytes) {
  const top = parsePart(bytesToBinary(bytes));
  const found = { text: null, html: null };
  collectBodies(top, found);
  const from = decodeWords(top.headers["from"] || "");
  return {
    subject: decodeWords(top.headers["subject"] || "").trim(),
    from: (from.match(/<([^>]+)>/) || [null, from.trim()])[1],
    messageId: (top.headers["message-id"] || "").trim(),
    text: found.text,
    html: found.html,
  };
}

// Her bayt bir karakter: başlıklar ve sınırlar bu metin üzerinde aranır, gövde sonra karakter kümesine göre çözülür
function bytesToBinary(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
}

function parsePart(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : "";
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const name = line.slice(0, i).trim().toLowerCase();
      if (!(name in headers)) headers[name] = line.slice(i + 1).trim();
    }
  }
  return { headers, body };
}

function headerParams(value) {
  const [main, ...rest] = String(value || "").split(";");
  const params = {};
  for (const p of rest) {
    const i = p.indexOf("=");
    if (i > 0) params[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { value: main.trim().toLowerCase(), params };
}

function collectBodies(part, found) {
  const type = headerParams(part.headers["content-type"] || "text/plain");
  const disposition = headerParams(part.headers["content-disposition"]).value;
  if (type.value.startsWith("multipart/") && type.params.boundary) {
    const sep = "--" + type.params.boundary;
    const chunks = part.body.split(sep).slice(1);
    for (const chunk of chunks) {
      if (chunk.startsWith("--")) break;   // kapanış sınırı
      collectBodies(parsePart(chunk.replace(/^\r?\n/, "")), found);
    }
    return;
  }
  if (disposition === "attachment") return;
  if (type.value === "message/rfc822") {
    collectBodies(parsePart(part.body), found);
    return;
  }
  if (type.value !== "text/plain" && type.value !== "text/html") return;
  const bytes = decodeTransfer(part.body, (part.headers["content-transfer-encoding"] || "").toLowerCase());
  const text = decodeCharset(bytes, type.params.charset);
  if (type.value === "text/plain" && found.text == null) found.text = text;
  if (type.value === "text/html" && found.html == null) found.html = text;
}

function decodeTransfer(body, encoding) {
  if (encoding === "base64") {
    const clean = body.replace(/[^A-Za-z0-9+/=]/g, "");
    return binaryToBytes(atob(clean.slice(0, clean.length - (clean.length % 4))));
  }
  if (encoding === "quoted-printable") {
    return binaryToBytes(body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  }
  return binaryToBytes(body);
}

function binaryToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// ISO-8859-9 / Windows-1254: Latin-1'den farkı Türkçe harfler (Workers'ın TextDecoder'ı bunları tanımayabilir)
const TURKISH = { 0xd0: "Ğ", 0xdd: "İ", 0xde: "Ş", 0xf0: "ğ", 0xfd: "ı", 0xfe: "ş" };

function decodeCharset(bytes, charset) {
  const cs = String(charset || "utf-8").toLowerCase().replace(/^"|"$/g, "");
  if (/^(iso-?8859-?9|windows-1254|cp1254|latin5)$/.test(cs)) {
    let s = "";
    for (const b of bytes) s += TURKISH[b] || String.fromCharCode(b);
    return s;
  }
  if (/^(iso-?8859-?1|windows-1252|latin1|us-ascii|ascii)$/.test(cs)) return bytesToBinary(bytes);
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// RFC 2047: "=?UTF-8?B?...?=" / "=?ISO-8859-9?Q?...?="
function decodeWords(value) {
  return String(value)
    .replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, data) => {
      const bin = enc.toLowerCase() === "b"
        ? atob(data)
        : data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16)));
      return decodeCharset(binaryToBytes(bin), cs);
    });
}

// <a href="https://…">Doğrula</a> → "Doğrula (https://…)": uygulama bağlantıyı tıklanabilir gösterir
const LINK = /<a\b[^>]*?\bhref\s*=\s*["']?(https?:[^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
function linkText(_, url, label) {
  return label.includes(url) ? label : `${label} (${url})`;
}

// HTML → düz metin (eposta.js'teki plainText ile aynı kurallar)
function htmlToText(s) {
  return String(s || "")
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(LINK, linkText)
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n[\s\n]*/g, "\n")
    .trim();
}

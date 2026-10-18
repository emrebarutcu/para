import test from "node:test";
import assert from "node:assert/strict";
import { handleEmail } from "../src/index.js";

const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "sb_secret_abc" };

function mime({ html = false } = {}) {
  const text = "1234 ile biten kartınızdan 17.10.2026 tarihinde MIGROS işyerinde 1.250,00 TL tutarında harcama yapılmıştır.";
  const b64 = Buffer.from(html ? `<html><body><p>${text}</p></body></html>` : text).toString("base64");
  return [
    "From: Banka <bildirim@banka.com.tr>",
    "To: abc123def456@para.example",
    "Subject: =?UTF-8?B?" + Buffer.from("Kartınızla harcama yapıldı").toString("base64") + "?=",
    "Message-ID: <m1@banka.com.tr>",
    "MIME-Version: 1.0",
    `Content-Type: ${html ? "text/html" : "text/plain"}; charset=utf-8`,
    "Content-Transfer-Encoding: base64",
    "",
    b64,
  ].join("\r\n");
}

function message(to, raw) {
  const bytes = new TextEncoder().encode(raw);
  return {
    to, from: "bounce@banka.com.tr", rawSize: bytes.length,
    raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    rejected: null,
    setReject(r) { this.rejected = r; },
  };
}

function fakeFetch(reply = { ok: true, duplicate: false }, status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply), { status });
  };
  fn.calls = calls;
  return fn;
}

test("e-postayı kullanıcının adresine yazar", async () => {
  const f = fakeFetch();
  const m = message("ABC123def456@para.example", mime());
  await handleEmail(m, ENV, f);
  assert.equal(m.rejected, null);
  assert.equal(f.calls.length, 1);
  const { url, init, body } = f.calls[0];
  assert.equal(url, "https://x.supabase.co/rest/v1/rpc/ingest_email");
  assert.equal(init.headers.apikey, "sb_secret_abc");
  assert.equal(init.headers.Authorization, undefined);
  assert.equal(body.address, "abc123def456");
  assert.equal(body.subject, "Kartınızla harcama yapıldı");
  assert.equal(body.sender, "bildirim@banka.com.tr");
  assert.equal(body.message_id, "<m1@banka.com.tr>");
  assert.match(body.body, /1\.250,00 TL/);
});

test("HTML e-posta düz metne çevrilir", async () => {
  const f = fakeFetch();
  await handleEmail(message("abc123def456@para.example", mime({ html: true })), ENV, f);
  assert.doesNotMatch(f.calls[0].body.body, /<p>|<html>/);
  assert.match(f.calls[0].body.body, /MIGROS/);
});

test("JWT biçimli anahtar Authorization başlığıyla da gönderilir", async () => {
  const f = fakeFetch();
  await handleEmail(message("abc123def456@para.example", mime()), { ...ENV, SUPABASE_SERVICE_KEY: "eyJhbGci.x.y" }, f);
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer eyJhbGci.x.y");
});

test("biçimi tutmayan adres Supabase'e gitmeden reddedilir", async () => {
  const f = fakeFetch();
  const m = message("info@para.example", mime());
  await handleEmail(m, ENV, f);
  assert.equal(m.rejected, "Unknown address");
  assert.equal(f.calls.length, 0);
});

test("kayıtlı olmayan adres reddedilir", async () => {
  const m = message("000000000000@para.example", mime());
  await handleEmail(m, ENV, fakeFetch({ ok: false, error: "unknown address" }));
  assert.equal(m.rejected, "Unknown address");
});

test("Supabase hatası fırlatılır", async () => {
  const m = message("abc123def456@para.example", mime());
  await assert.rejects(handleEmail(m, ENV, fakeFetch({ message: "boom" }, 500)), /ingest_email 500/);
});

function raw(lines) { return lines.join("\r\n"); }

test("multipart, quoted-printable ve ISO-8859-9 çözülür; ek atlanır", async () => {
  const latin5 = s => Buffer.from([...s].map(ch => ({ "ı": 0xfd, "ş": 0xfe, "ğ": 0xf0, "İ": 0xdd, "Ş": 0xde, "Ğ": 0xd0 })[ch] ?? ch.charCodeAt(0)));
  const qp = buf => [...buf].map(b => (b >= 33 && b <= 126 && b !== 61 ? String.fromCharCode(b) : b === 32 ? " " : "=" + b.toString(16).toUpperCase().padStart(2, "0"))).join("");
  const text = "1234 ile biten kartınızdan 17.10.2026 tarihinde ŞOK MARKET işyerinde 45,90 TL tutarında harcama yapılmıştır.";
  const m = message("abc123def456@para.example", raw([
    "From: =?ISO-8859-9?Q?Banka_Bildirim?= <bildirim@banka.com.tr>",
    "To: abc123def456@para.example",
    "Subject: =?ISO-8859-9?Q?Kart=FDn=FDzla_harcama?=",
    "Message-ID: <m2@banka.com.tr>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="dis"',
    "",
    "--dis",
    'Content-Type: multipart/alternative; boundary="ic"',
    "",
    "--ic",
    "Content-Type: text/plain; charset=ISO-8859-9",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    qp(latin5(text)),
    "--ic",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>HTML sürüm</p>",
    "--ic--",
    "--dis",
    "Content-Type: application/pdf; name=ekstre.pdf",
    "Content-Disposition: attachment; filename=ekstre.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0xLjQK",
    "--dis--",
  ]));
  const f = fakeFetch();
  await handleEmail(m, ENV, f);
  const body = f.calls[0].body;
  assert.equal(body.subject, "Kartınızla harcama");
  assert.equal(body.sender, "bildirim@banka.com.tr");
  assert.equal(body.body, text);
});

test("düz metin çok kısaysa HTML kullanılır", async () => {
  const m = message("abc123def456@para.example", raw([
    "From: bildirim@banka.com.tr",
    "Subject: Harcama",
    'Content-Type: multipart/alternative; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "HTML görüntüleyin.",
    "--b",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("<table><tr><td>Tutar:</td><td>1.250,00 TL</td></tr><tr><td>Kart:</td><td>**** 1234</td></tr></table>").toString("base64"),
    "--b--",
  ]));
  const f = fakeFetch();
  await handleEmail(m, ENV, f);
  assert.match(f.calls[0].body.body, /Tutar: 1\.250,00 TL\nKart: \*\*\*\* 1234/);
  assert.equal(f.calls[0].body.sender, "bildirim@banka.com.tr");
});

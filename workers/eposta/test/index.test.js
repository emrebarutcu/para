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

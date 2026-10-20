import test from "node:test";
import assert from "node:assert/strict";
import { handleCategories, MODEL } from "../kategori.js";

// Sahte Workers AI: harf üçlülerinden vektör (benzer metin → benzer vektör); çağrılar sayılır
function fakeAI() {
  const calls = [];
  const vec = t => {
    const v = new Array(64).fill(0), s = ` ${t.toLowerCase()} `;
    for (let i = 0; i < s.length - 2; i++) {
      let h = 0;
      for (const c of s.slice(i, i + 3)) h = (h * 31 + c.charCodeAt(0)) % 64;
      v[h]++;
    }
    return v;
  };
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      const list = input.text;
      return { shape: [list.length, 64], data: list.map(vec) };
    },
  };
}
const fetchAuth = async (url, init) => {
  const token = init.headers.Authorization.replace("Bearer ", "");
  return token === "good" ? new Response(JSON.stringify({ id: "u1" })) : new Response("{}", { status: 401 });
};
const req = (body, token = "good") => new Request("https://cashfollow.app/api/kategori", {
  method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body),
});
const call = async (body, { token, env } = {}) => {
  const res = await handleCategories(req(body, token), env, { fetch: fetchAuth });
  return { status: res.status, body: await res.json() };
};

test("kategori: giriş gerekir, girdi denetlenir, AI yoksa 503", async () => {
  const env = { AI: fakeAI() };
  assert.equal((await call({ items: ["x"] }, { token: null, env })).status, 401);
  assert.equal((await call({ items: ["x"] }, { token: "bad", env })).status, 401);
  assert.equal((await call({ items: [] }, { env })).status, 400);
  assert.equal((await call({ items: new Array(51).fill("a") }, { env })).status, 400);
  assert.equal((await call({ items: ["a"], examples: "x" }, { env })).status, 400);
  assert.equal((await call({ items: ["a"] }, { env: {} })).status, 503);
});

test("kategori: sonuçlar sırayla; kullanıcı örneği aynı işyerinde kazanır; kelime vektörleri bir kez", async () => {
  const ai = fakeAI();
  const env = { AI: ai };
  const r = await call({ items: ["ECZANE 0042", "Netflix Abonelik"], examples: [{ text: "netflix abonelik", id: "eglence" }] }, { env });
  assert.equal(r.status, 200);
  assert.equal(r.body.model, MODEL.id);
  assert.equal(r.body.results.length, 2);
  assert.equal(r.body.results[1].category, "eglence");
  for (const x of r.body.results) assert.ok(x.confidence > 0 && x.confidence <= 1);
  // Açıklama temizlenir ("0042" atılır)
  assert.ok(ai.calls.some(c => c.model === MODEL.id && c.input.text.includes("ECZANE") && c.input.text.includes("Netflix Abonelik")));

  const before = ai.calls.length;
  await call({ items: ["ECZANE"] }, { env });
  assert.equal(ai.calls.length, before);   // hepsi önbellekte
});

test("kategori: kullanıcı başına dakikalık sınır", async () => {
  const env = { AI: fakeAI() };
  let last;
  for (let i = 0; i < 7; i++) last = await call({ items: new Array(50).fill(0).map((_, k) => `harcama ${i} ${k} x`) }, { env, token: "good" });
  assert.equal(last.status, 429);
});

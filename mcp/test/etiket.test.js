// Etiketler (purchases.tags): temizleme, tablo satırı, etiket raporu (icgoru.js tagList, tagSummary) ve asistan araçları
import test from "node:test";
import assert from "node:assert/strict";
import T from "../../taksit.js";
import I from "../../icgoru.js";
import Tablo from "../../tablo.js";
import { TOOLS } from "../tools.js";

test("etiket adı: baştaki # ve virgül atılır, harf farkı aynı etiket, en fazla 10 / 40 harf", () => {
  assert.deepEqual(Tablo.tags(["#Maldivler", " maldivler ", "Balayı", "MALDİVLER"]), ["Maldivler", "Balayı"]);
  assert.deepEqual(Tablo.tags("Düğün, düğün ,Ev  tadilatı"), ["Düğün", "Ev tadilatı"]);
  assert.equal(Tablo.tagKey("Italy"), Tablo.tagKey("italy"));       // İngilizce I / i
  assert.equal(Tablo.tagKey("İzmir"), Tablo.tagKey("IZMIR"));       // Türkçe İ / I
  assert.equal(Tablo.tags([]), null);
  assert.equal(Tablo.tags(["", "#", "  "]), null);
  assert.equal(Tablo.tags(Array.from({ length: 15 }, (_, i) => `e${i}`)).length, 10);
  assert.equal(Array.from(Tablo.tags(["ş".repeat(50)])[0]).length, 40);
});

test("tablo satırı: tags yazılır ve okunur, boşsa null; eski taban yeni biçime çevrilir", () => {
  const p = { id: "a", personId: "ben", cardId: null, desc: "Otel", total: 100, count: 1, date: "2026-11-01", tags: ["Maldivler", "maldivler", "Balayı"] };
  const row = JSON.parse(Tablo.keyOf("purchases", p));
  assert.deepEqual(row.tags, ["Maldivler", "Balayı"]);
  assert.equal(JSON.parse(Tablo.keyOf("purchases", { ...p, tags: [] })).tags, null);
  const back = Tablo.toState({ purchases: [{ ...row, created_at: "1" }] }).installments[0];
  assert.deepEqual(back.tags, ["Maldivler", "Balayı"]);
  assert.equal("tags" in Tablo.toState({ purchases: [{ ...row, tags: null, created_at: "1" }] }).installments[0], false);
  // Etiketsiz kayıt: eski (tags'siz) tabandaki anahtar rekey ile bugünkünün aynısı olur, yeniden yazılmaz
  const old = { ...JSON.parse(Tablo.keyOf("purchases", { ...p, tags: undefined })) };
  delete old.tags;
  const base = Tablo.rekey({ purchases: { a: JSON.stringify(old) } });
  assert.equal(Tablo.changes(T.hydrate({ installments: [{ ...p, tags: undefined }] }), base).purchases.upsert.length, 0);
});

const STATE = () => T.hydrate({
  people: [{ id: "ben", name: "Sen" }, { id: "es", name: "Eşin" }],
  cards: [{ id: "k1", name: "Kart A", cutoffDay: 10, dueDay: 20, limit: 0 }, { id: "k2", name: "Kart B", cutoffDay: 5, dueDay: 15, limit: 0 }],
  installments: [
    { id: "u", personId: "ben", cardId: "k1", desc: "Uçak", total: 62400, count: 6, date: "2026-09-15", category: "seyahat", tags: ["Maldivler"] },
    { id: "o", personId: "es", cardId: "k2", desc: "Otel", total: 78000, count: 4, date: "2026-10-20", category: "seyahat", tags: ["maldivler", "Balayı"] },
    { id: "t", personId: "ben", cardId: null, desc: "Transfer", total: 640, count: 1, date: "2026-11-15", asset: "USD", category: "seyahat", tags: ["Maldivler"] },
    { id: "y", personId: "ben", cardId: "k1", desc: "Akşam yemeği", total: 9870, count: 1, date: "2026-11-17", category: "yeme", tags: ["Maldivler"] },
    { id: "m", personId: "ben", cardId: "k1", desc: "Market", total: 500, count: 1, date: "2026-11-15" },
  ],
});
const RATES = { USD: 42 };

test("tagSummary: toplam (bütün taksitler), ödenen / kalan, dağılımlar, para birimleri", () => {
  const s = I.tagSummary(STATE(), "MALDİVLER", "2026-11-27", RATES);
  assert.equal(s.name, "Maldivler");
  assert.equal(s.count, 4);
  assert.equal(s.total, 62400 + 78000 + 640 * 42 + 9870);
  assert.equal(Math.round(s.paid + s.left), s.total);
  assert.ok(s.left > 0 && s.paid > 0);
  assert.equal(s.lastPayment, "2027-03-20");                       // uçağın son taksidi
  assert.deepEqual([s.first, s.last, s.days], ["2026-09-15", "2026-11-17", 64]);
  assert.deepEqual(s.assets, [{ asset: "TRY", amount: 62400 + 78000 + 9870 }, { asset: "USD", amount: 640 }]);
  assert.deepEqual(s.categories.map(c => c.id), ["seyahat", "yeme"]);
  assert.deepEqual(s.people.map(p => [p.id, p.value]), [["ben", 62400 + 26880 + 9870], ["es", 78000]]);
  assert.equal(s.cards.find(c => c.id === null).name, "Nakit");
  assert.equal(s.purchases[0].id, "y");                             // yeniden eskiye
  assert.equal(s.missing, 0);
  // Kur yoksa dövizli harcama sayılmaz, missing'de
  const n = I.tagSummary(STATE(), "Maldivler", "2026-11-27", null);
  assert.equal(n.missing, 1);
  assert.equal(n.total, 62400 + 78000 + 9870);
  assert.equal(I.tagSummary(STATE(), "yok", "2026-11-27"), null);
  assert.equal(I.tagSummary(STATE(), "", "2026-11-27"), null);
});

test("tagSummary: tekrarlayan harcamanın bugüne kadarki tekrarları; tarihsiz kayıt asıl toplamıyla", () => {
  const s = T.hydrate({ installments: [
    { id: "r", personId: "ben", cardId: null, desc: "Kira", total: 1000, count: 1, date: "2026-09-01", repeat: 0, tags: ["Ev"] },
    { id: "x", personId: "ben", cardId: null, desc: "Eski", total: 300, count: 3, firstDue: "2026-12", planCount: 6, tags: ["Ev"] },
  ] });
  const r = I.tagSummary(s, "ev", "2026-11-15");
  assert.equal(r.total, 3 * 1000 + 600);                            // Eylül, Ekim, Kasım + 6 × 100
  assert.equal(r.left, 300);                                         // tarihsizde kalan 3 taksit
  assert.equal(I.tagList(s, "2026-11-15")[0].total, 3600);
});

test("tagList: etiketler, sayıları ve toplamları; en son kullanılan önce", () => {
  const list = I.tagList(STATE(), "2026-11-27", RATES);
  assert.deepEqual(list.map(t => [t.name, t.count]), [["Maldivler", 4], ["Balayı", 1]]);
  assert.equal(list[1].total, 78000);
});

function ctxFor(today = "2026-11-27") {
  let state = STATE();
  return {
    today, home: "TRY", country: "TR",
    load: async () => T.hydrate(JSON.parse(JSON.stringify(state))),
    mutate: async fn => { const s = T.hydrate(JSON.parse(JSON.stringify(state))); const out = await fn(s); state = s; return out; },
    rates: async () => ({ rates: { TRY: 1, USD: 42 }, updatedAt: "2026-11-27T10:00:00Z", source: "test" }),
    prices: async () => ({ prices: {}, missing: [], failed: [] }),
    raw: () => state,
  };
}
const run = async (ctx, name, args = {}) => {
  try { return await TOOLS.find(t => t.name === name).run(args, ctx); } catch (e) { return { error: e.message }; }
};

test("asistan: list_tags, tag_summary, list_purchases tag, add / update tags, tag_purchases", async () => {
  const ctx = ctxFor();
  const tags = await run(ctx, "list_tags");
  assert.deepEqual(tags.tags.map(t => [t.tag, t.purchases]), [["Maldivler", 4], ["Balayı", 1]]);
  assert.equal(tags.tags[0].total, 62400 + 78000 + 26880 + 9870);

  const sum = await run(ctx, "tag_summary", { tag: "maldivler" });
  assert.equal(sum.tag, "Maldivler");
  assert.equal(sum.byCard.find(c => c.id === null).name, "Nakit");
  assert.equal(sum.list.length, 4);
  assert.match((await run(ctx, "tag_summary", { tag: "Bodrum" })).error, /No purchase has the tag/);

  const list = await run(ctx, "list_purchases", { status: "all", tag: "BALAYI" });
  assert.deepEqual(list.purchases.map(p => p.id), ["o"]);
  assert.deepEqual(list.purchases[0].tags, ["maldivler", "Balayı"]);

  // Yeni harcamada var olan etiketin yazılışı kullanılır; düzenlemede verilmeyen etiket kalır, null siler
  const add = await run(ctx, "add_purchase", { description: "Hediyelik", amount: 3600, card: "Kart A", date: "2026-11-18", tags: ["maldivler", "#Hediye"] });
  assert.deepEqual(add.purchase.tags, ["Maldivler", "Hediye"]);
  const upd = await run(ctx, "update_purchase", { id: add.purchase.id, amount: 3700 });
  assert.deepEqual(upd.purchase.tags, ["Maldivler", "Hediye"]);
  assert.deepEqual((await run(ctx, "update_purchase", { id: add.purchase.id, tags: null })).purchase.tags, []);
  assert.match((await run(ctx, "update_purchase", { id: add.purchase.id, tags: [1] })).error, /list of strings/);

  const tp = await run(ctx, "tag_purchases", { tag: "BALAYI", add: ["u", "m"], remove: ["o"] });
  assert.equal(tp.tag, "Balayı");
  assert.deepEqual(tp.changed.map(c => [c.id, c.tags]), [["u", ["Maldivler", "Balayı"]], ["m", ["Balayı"]], ["o", ["maldivler"]]]);
  assert.equal(ctx.raw().installments.find(p => p.id === "o").tags.length, 1);
  assert.match((await run(ctx, "tag_purchases", { tag: "x" })).error, /add or remove/);
  assert.match((await run(ctx, "tag_purchases", { tag: "x", add: ["yok"] })).error, /No purchase with id/);
});

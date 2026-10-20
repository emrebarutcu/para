import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server.js";
import Tablo from "../../tablo.js";

const NOW = () => new Date("2026-10-18T09:00:00Z");
const ORIGIN = "https://cashfollow.app";

// Bellekte Supabase: auth/v1/user ve kullanılan PostgREST uçları (RLS: yalnızca token sahibinin satırları)
const DATA = ["people", "cards", "purchases", "entries"];
const RATES = { USD: { Selling: 40 }, EUR: { Selling: 45 }, GRA: { Selling: 4000 }, Update_Date: "2026-10-18 12:00:00" };
function fakeSupabase({ users = { good: { id: "u1", email: "a@b.c" }, other: { id: "u2", email: "x@y.z" } } } = {}) {
  const db = { people: [], cards: [], purchases: [], entries: [], inbox_messages: [], inbox_addresses: [] };
  const rates = { down: false };
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 18, 9, 0, 0, ++clock)).toISOString().replace("Z", "+00:00");
  const calls = [];
  const hooks = { beforeWrite: null };

  // in.(1,2) ya da in.("a","b")
  const inList = v => v.slice(4, -1).split(",").map(x => x.replace(/^"(.*)"$/, "$1"));

  const fn = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    const token = (init.headers?.Authorization || "").replace("Bearer ", "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: url.pathname, search: url.search, body });
    const user = users[token];
    const reply = (out, status = 200) => new Response(out === null ? null : JSON.stringify(out), { status });

    if (url.hostname === "finans.truncgil.com") return rates.down ? reply({}, 503) : reply(RATES);
    if (url.hostname === "open.er-api.com" || url.hostname === "api.gold-api.com") return reply({}, 503);
    if (url.pathname === "/auth/v1/user") return user ? reply(user) : reply({ msg: "bad jwt" }, 403);
    if (!user) return reply({ message: "JWT expired" }, 401);

    const table = url.pathname.replace("/rest/v1/", "");
    const rows = db[table];
    if (!rows) return reply({ code: "PGRST205" }, 404);
    const p = url.searchParams;
    const filters = [...p].filter(([k]) => !["select", "order", "limit", "offset", "on_conflict"].includes(k));
    const match = r => r.user_id === user.id && filters.every(([k, v]) => {
      if (v === "is.null") return r[k] == null;
      if (v.startsWith("eq.")) return String(r[k]) === v.slice(3);
      if (v.startsWith("in.(")) return inList(v).includes(String(r[k]));
      throw new Error("filter " + v);
    });
    if (method !== "GET" && hooks.beforeWrite) { const h = hooks.beforeWrite; hooks.beforeWrite = null; h(); }

    if (method === "GET") {
      let out = rows.filter(match);
      if (p.get("order")) {
        const keys = p.get("order").split(",");
        out.sort((a, b) => { for (const k of keys) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0; });
      }
      const offset = Number(p.get("offset") || 0);
      out = out.slice(offset, p.get("limit") ? offset + Number(p.get("limit")) : undefined);
      return reply(structuredClone(out));
    }
    if (method === "POST" && DATA.includes(table)) {
      for (const row of body) {
        if (row.user_id !== user.id) return reply({ message: "rls" }, 403);
        if ((table === "purchases" || table === "entries") && !db.people.some(x => x.user_id === user.id && x.id === row.person_id)) return reply({ code: "23503" }, 409);
        if (table === "purchases" && row.card_id && !db.cards.some(x => x.user_id === user.id && x.id === row.card_id)) return reply({ code: "23503" }, 409);
      }
      for (const row of body) {
        const cur = rows.find(x => x.user_id === user.id && x.id === row.id);
        if (cur) Object.assign(cur, row, { updated_at: stamp() });
        else { const at = stamp(); rows.push({ ...row, created_at: at, updated_at: at }); }
      }
      return reply(null, 201);
    }
    if (method === "POST" && table === "inbox_addresses") {
      if (body.user_id !== user.id) return reply({ message: "rls" }, 403);
      const row = { user_id: user.id, address: crypto.randomUUID().replace(/-/g, "").slice(0, 12) };
      rows.push(row);
      return reply([{ address: row.address }], 201);
    }
    if (method === "PATCH") {
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, body, DATA.includes(table) ? { updated_at: stamp() } : {});
      return reply(init.headers?.Prefer?.includes("return=representation") ? structuredClone(hit) : null, init.headers?.Prefer?.includes("return=representation") ? 200 : 204);
    }
    if (method === "DELETE" && !DATA.includes(table)) {
      db[table] = rows.filter(r => !match(r));
      return reply(null, 204);
    }
    return reply({}, 405);
  };
  return { fetch: fn, db, calls, hooks, stamp, rates };
}

function client(sb, token = "good") {
  let id = 0;
  const post = async body => {
    const res = await handle(new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }), {}, { fetch: sb.fetch, now: NOW });
    return { status: res.status, headers: res.headers, body: res.status === 202 ? null : await res.json() };
  };
  const rpc = (method, params) => post({ jsonrpc: "2.0", id: ++id, method, params });
  const call = async (name, args = {}) => {
    const { body } = await rpc("tools/call", { name, arguments: args });
    assert.ok(body.result, JSON.stringify(body));
    const text = body.result.content[0].text;
    return body.result.isError ? { error: text } : JSON.parse(text);
  };
  return { post, rpc, call };
}

// u1'in tablolardaki verisi, uygulamadaki biçimde
const stored = sb => Tablo.toState(Object.fromEntries(DATA.map(t => [t, sb.db[t].filter(r => r.user_id === "u1")])));

test("token yoksa 401 ve kaynak bilgisi", async () => {
  const sb = fakeSupabase();
  const res = await client(sb, null).rpc("initialize", {});
  assert.equal(res.status, 401);
  assert.match(res.headers.get("WWW-Authenticate"), /resource_metadata="https:\/\/cashfollow\.app\/\.well-known\/oauth-protected-resource\/mcp"/);

  const bad = await client(sb, "nope").rpc("initialize", {});
  assert.equal(bad.status, 401);
  assert.match(bad.headers.get("WWW-Authenticate"), /error="invalid_token"/);
});

test("korunan kaynak bilgisi Supabase Auth'u gösterir", async () => {
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const res = await handle(new Request(ORIGIN + path), {});
    const meta = await res.json();
    assert.equal(meta.resource, `${ORIGIN}/mcp`);
    assert.deepEqual(meta.authorization_servers, ["https://bffqfhgctlgexjdyvaup.supabase.co/auth/v1"]);
  }
});

test("initialize, tools/list, ping ve bildirimler", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  const init = await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.ok(init.body.result.capabilities.tools);
  assert.match(init.body.result.instructions, /kesim/);

  const old = await c.rpc("initialize", { protocolVersion: "1999-01-01" });
  assert.equal(old.body.result.protocolVersion, "2025-06-18");

  const note = await c.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);

  const { body } = await c.rpc("tools/list");
  const names = body.result.tools.map(t => t.name);
  for (const n of ["get_overview", "get_cashflow", "list_purchases", "add_purchase", "update_purchase", "delete_purchase",
    "list_cards", "add_card", "update_card", "delete_card", "list_people", "add_person", "rename_person", "delete_person",
    "list_inbox", "check_inbox", "add_inbox_purchase", "dismiss_inbox_email", "export_data", "import_data"]) {
    assert.ok(names.includes(n), n);
  }
  for (const t of body.result.tools) assert.equal(t.inputSchema.type, "object", t.name);
  assert.equal(body.result.tools.find(t => t.name === "delete_card").annotations.destructiveHint, true);

  assert.deepEqual((await c.rpc("ping")).body.result, {});
  assert.equal((await c.rpc("nope/nope")).body.error.code, -32601);
  assert.equal((await c.rpc("tools/call", { name: "nope" })).body.error.code, -32602);
});

test("kart ve taksitli harcama: ödeme tarihleri kesim / son ödeme gününe göre", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  const card = await c.call("add_card", { name: "Bonus", cutoff_day: 12, due_day: 22, limit: 50000, last4: "1234" });
  assert.equal(card.card.purchaseToday.statementCutoff, "2026-11-12");
  assert.equal(card.card.purchaseToday.dueDate, "2026-11-22");

  // 15 Eki, kesim 12 → 12 Kas ekstresi → 22 Kas; 3 taksit
  const dry = await c.call("add_purchase", { description: "Telefon", amount: 3000, installments: 3, date: "2026-10-15", dry_run: true });
  assert.equal(dry.saved, false);
  assert.deepEqual(dry.purchase.payments.map(p => p.date), ["2026-11-22", "2026-12-22", "2027-01-22"]);
  assert.equal(stored(sb).installments.length, 0);

  const added = await c.call("add_purchase", { description: "Telefon", amount: 3000, installments: 3, date: "2026-10-15" });
  assert.equal(added.saved, true);
  assert.equal(added.preview.statementCutoff, "2026-11-12");
  assert.equal(added.purchase.perInstallment, 1000);
  assert.equal(added.purchase.card, "Bonus");
  assert.equal(added.purchase.person, "Ben");

  const data = stored(sb);
  assert.equal(data.installments.length, 1);
  assert.equal(data.installments[0].cardId, data.cards[0].id);

  // Taksit başına tutar, nakit, son 4 haneyle kart
  const per = await c.call("add_purchase", { description: "Kurs", amount: 500, amount_type: "per_installment", installments: 4, card: "1234", date: "2026-10-01" });
  assert.equal(per.purchase.total, 2000);
  assert.equal(per.purchase.nextPayment.date, "2026-10-22");
  const cash = await c.call("add_purchase", { description: "Market", amount: 250, card: "nakit", date: "2026-10-20" });
  assert.equal(cash.purchase.card, "Nakit");
  assert.equal(cash.purchase.nextPayment.date, "2026-10-20");

  const cards = await c.call("list_cards");
  assert.equal(cards.cards[0].used, 5000);
  assert.equal(cards.cards[0].available, 45000);
  assert.deepEqual(cards.cards[0].nextPayment, { date: "2026-10-22", amount: 500 });

  const overview = await c.call("get_overview");
  assert.equal(overview.today, "2026-10-18");
  assert.equal(overview.dueThisMonth, 750);
  assert.equal(overview.nextMonth.total, 1500);
  assert.equal(overview.remainingTotal, 5250);
  assert.equal(overview.lastPaymentMonth, "2027-01");
  assert.deepEqual(overview.upcomingPayments.map(e => e.date), ["2026-10-20", "2026-10-22", "2026-11-22", "2026-12-22", "2027-01-22"]);

  const flow = await c.call("get_cashflow", { months: 2 });
  assert.equal(flow.months[1].month, "2026-11");
  assert.equal(flow.months[1].payments[0].items.length, 2);
  assert.deepEqual(flow.months[1].byCard, { Bonus: 1500 });
  assert.equal(flow.months[1].payments[0].items.find(i => i.description === "Telefon").installment, "1/3");
});

test("harcama doğrulama, düzenleme, silme ve süzme", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_card", { name: "A", cutoff_day: 12, due_day: 22 });
  await c.call("add_card", { name: "B", cutoff_day: 25, due_day: 5 });

  assert.match((await c.call("add_purchase", { description: "X", amount: 10 })).error, /several cards/);
  assert.match((await c.call("add_purchase", { description: "X", amount: -1, card: "A" })).error, /positive/);
  assert.match((await c.call("add_purchase", { description: "X", amount: 1, card: "A", installments: 61 })).error, /between 1 and 60/);
  assert.match((await c.call("add_purchase", { description: "X", amount: 1, card: "A", date: "2026-02-30" })).error, /valid date/);
  assert.match((await c.call("add_purchase", { description: "X", amount: 1, card: "Z" })).error, /Unknown card/);
  assert.match((await c.call("add_purchase", { description: "X", amount: 1, card: "A", person: "Ali" })).error, /Unknown person/);
  assert.equal(stored(sb).installments.length, 0);

  // kesim 25 / son ödeme 5: 25 Eki ekstresi 5 Kas'ta
  const { purchase } = await c.call("add_purchase", { description: "Ayakkabı", amount: 1200, card: "b", date: "2026-10-25", installments: 2 });
  assert.equal(purchase.nextPayment.date, "2026-11-05");

  const upd = await c.call("update_purchase", { id: purchase.id, installments: 3, card: "A" });
  assert.equal(upd.purchase.total, 1200);
  assert.equal(upd.purchase.installments, 3);
  assert.equal(upd.purchase.date, "2026-10-25");
  assert.equal(upd.purchase.nextPayment.date, "2026-11-22");   // A: 25 > kesim 12 → Kas ekstresi

  const sched = await c.call("get_purchase", { id: purchase.id });
  assert.equal(sched.payments.length, 3);

  assert.equal((await c.call("list_purchases", { search: "ayakk" })).count, 1);
  assert.equal((await c.call("list_purchases", { card: "B" })).count, 0);
  assert.equal((await c.call("list_purchases", { status: "done" })).count, 0);

  const del = await c.call("delete_purchase", { id: purchase.id });
  assert.equal(del.deleted.description, "Ayakkabı");
  assert.match((await c.call("delete_purchase", { id: purchase.id })).error, /No purchase/);
});

test("kişiler ve kart silme kuralları", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  assert.match((await c.call("delete_person", { person: "Ben" })).error, /At least one/);
  const ali = await c.call("add_person", { name: "Ali" });
  assert.match((await c.call("add_person", { name: "ali" })).error, /already exists/);
  await c.call("add_card", { name: "A", cutoff_day: 12, due_day: 22, last4: "1111" });
  assert.match((await c.call("add_card", { name: "B", cutoff_day: 1, due_day: 10, last4: "1111" })).error, /already has last4/);
  assert.match((await c.call("add_card", { name: "B", cutoff_day: 0, due_day: 10 })).error, /cutoff_day/);

  await c.call("add_purchase", { description: "P1", amount: 100, person: "Ali" });
  await c.call("add_purchase", { description: "P2", amount: 100, person: ali.person.id, card: "nakit" });
  const people = await c.call("list_people");
  assert.equal(people.people.find(p => p.name === "Ali").purchaseCount, 2);

  await c.call("rename_person", { person: "Ali", name: "Ali Veli" });
  const upd = await c.call("update_card", { card: "1111", limit: 1000, last4: "" });
  assert.equal(upd.card.last4, null);
  assert.equal(upd.card.limit, 1000);

  const delCard = await c.call("delete_card", { card: "A" });
  assert.equal(delCard.deletedPurchases, 1);
  const delPerson = await c.call("delete_person", { person: "ali veli" });
  assert.equal(delPerson.deletedPurchases, 1);
  assert.deepEqual(stored(sb).people.map(p => p.name), ["Ben"]);
  assert.equal(stored(sb).installments.length, 0);
});

test("kartın günleri değişirken arada kalan harcamalar sorulur", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_card", { name: "A", cutoff_day: 10, due_day: 20 });
  const cut = await c.call("add_purchase", { description: "Kesilmiş", amount: 100, date: "2026-10-05" });   // 10 Eki ekstresi → 20 Eki
  const open = await c.call("add_purchase", { description: "Arada", amount: 300, installments: 3, date: "2026-10-15" });   // 10 Kas → 20 Kas
  const dates = async id => (await c.call("get_purchase", { id })).payments.map(x => x.date);

  // Yalnızca limit değişince sorulmaz
  assert.equal((await c.call("update_card", { card: "A", limit: 1000 })).card.limit, 1000);

  const ask = await c.call("update_card", { card: "A", cutoff_day: 20, due_day: 30 });
  assert.match(ask.error, /1 payment\(s\) totalling 100 TRY .* cut on 2026-11-10/);
  assert.match(ask.error, /"old".*"new".*"fix"/);
  assert.equal(stored(sb).cards[0].cutoffDay, 10);
  assert.match((await c.call("update_card", { card: "A", cutoff_day: 20, due_day: 30, transition: "later" })).error, /transition must be "old", "new", "fix"/);
  for (const transition of ["constructor", "__proto__", "toString", 1])
    assert.match((await c.call("update_card", { card: "A", cutoff_day: 20, due_day: 30, transition })).error, /transition must be/);

  // Yeni günler bugünden: kesilmiş ekstre kalır, açık ekstredekiler 20 Eki ekstresine geçer
  const upd = await c.call("update_card", { card: "A", cutoff_day: 20, due_day: 30, transition: "new" });
  assert.deepEqual(upd.card.purchaseToday, { statementCutoff: "2026-10-20", dueDate: "2026-10-30" });
  assert.deepEqual(stored(sb).cards[0].history, [{ until: "2026-10-17", cutoffDay: 10, dueDay: 20 }]);
  assert.deepEqual(await dates(cut.purchase.id), ["2026-10-20"]);
  assert.deepEqual(await dates(open.purchase.id), ["2026-10-30", "2026-11-30", "2026-12-30"]);

  // Vazgeçip açık ekstreyi eski günlerle kesmek: 10 Kas ekstresi 20 Kas'ta ödenir, sonraki taksitler yeni günlerle
  await c.call("update_card", { card: "A", cutoff_day: 10, due_day: 20, transition: "fix" });
  await c.call("update_card", { card: "A", cutoff_day: 20, due_day: 30, transition: "old" });
  assert.deepEqual(stored(sb).cards[0].history, [{ until: "2026-11-10", cutoffDay: 10, dueDay: 20 }]);
  assert.deepEqual(await dates(open.purchase.id), ["2026-11-20", "2026-11-30", "2026-12-30"]);

  // Günler yanlış girilmişti: geçmiş dahil hepsi yeniden hesaplanır, eski günler unutulmaz (kesilmiş ekstreler kalır)
  await c.call("update_card", { card: "A", cutoff_day: 25, due_day: 5, transition: "fix" });
  assert.deepEqual(stored(sb).cards[0].history, [{ until: "2026-11-10", cutoffDay: 10, dueDay: 20 }]);
  assert.deepEqual(await dates(open.purchase.id), ["2026-11-20", "2026-12-05", "2027-01-05"]);

  // Harcaması olmayan kartta sorulmaz
  await c.call("add_card", { name: "B", cutoff_day: 10, due_day: 20 });
  assert.equal((await c.call("update_card", { card: "B", cutoff_day: 15, due_day: 25 })).card.cutoffDay, 15);
  assert.equal(stored(sb).cards[1].history, undefined);
});

test("yalnızca değişen satırlar yazılır, silinenler işaretlenir", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_card", { name: "A", cutoff_day: 12, due_day: 22 });
  const { purchase } = await c.call("add_purchase", { description: "P", amount: 100 });
  await c.call("add_purchase", { description: "Q", amount: 50 });

  sb.calls.length = 0;
  await c.call("update_purchase", { id: purchase.id, amount: 120 });
  const writes = sb.calls.filter(x => x.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/rest/v1/purchases");
  assert.deepEqual(writes[0].body.map(r => [r.id, r.total]), [[purchase.id, 120]]);

  await c.call("delete_card", { card: "A" });
  assert.equal(sb.db.purchases.length, 2);   // satırlar kalır, deleted_at alır
  assert.ok(sb.db.purchases.every(r => r.deleted_at));
  assert.ok(sb.db.cards[0].deleted_at);
  assert.equal((await c.call("list_purchases")).count, 0);
  assert.equal((await c.call("list_cards")).cards.length, 0);
});

test("başka cihaz araya yazarsa onun değişikliği kaybolmaz", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_card", { name: "A", cutoff_day: 12, due_day: 22 });
  // Uygulama, MCP okuduktan sonra ama yazmadan önce bir kişi ekliyor
  sb.hooks.beforeWrite = () => {
    const at = sb.stamp();
    sb.db.people.push({ user_id: "u1", id: "app", name: "Uygulamadan", color: 1, created_at: at, updated_at: at, deleted_at: null });
  };
  await c.call("add_purchase", { description: "P", amount: 100 });
  const data = stored(sb);
  assert.deepEqual(data.people.map(p => p.name), ["Ben", "Uygulamadan"]);
  assert.equal(data.installments.length, 1);
});

test("kullanıcılar birbirinin verisini görmez", async () => {
  const sb = fakeSupabase();
  await client(sb).call("add_person", { name: "Gizli" });
  const other = await client(sb, "other").call("list_people");
  assert.deepEqual(other.people.map(p => p.name), ["Ben"]);
});

test("banka e-postaları: otomatik ekleme, onay bekleyen, elle ekleme, yok sayma", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_card", { name: "A", cutoff_day: 12, due_day: 22, last4: "1234" });
  await c.call("add_card", { name: "B", cutoff_day: 25, due_day: 5 });
  const mail = (id, body) => ({ id, user_id: "u1", message_key: String(id), sender: "bank", subject: "Harcama", body, received_at: "2026-10-17T10:00:00+00:00", processed_at: null });
  sb.db.inbox_messages.push(
    mail(1, "1234 ile biten kartınızdan 17.10.2026 tarihinde MIGROS işyerinde 1.250,00 TL tutarında harcama yapılmıştır."),
    mail(2, "9999 ile biten kartınızdan 16.10.2026 tarihinde AMAZON işyerinde 600,00 TL tutarında 3 taksitli harcama yapılmıştır."),
    mail(3, "Lütfen adresinizi doğrulayın: https://banka.example/verify?x=1"),
    { ...mail(4, "başka kullanıcının e-postası 1234 kartı 10,00 TL"), user_id: "u2" },
  );

  const pending = await c.call("list_inbox", { include_body: true });
  assert.deepEqual(pending.emails.map(e => e.emailId), [1, 2, 3]);
  assert.equal(pending.emails[0].needsReview, null);
  assert.equal(pending.emails[0].matchedCard, "A");
  assert.match(pending.emails[1].needsReview, /9999/);
  assert.match(pending.emails[2].body, /https:\/\/banka\.example\/verify/);

  const checked = await c.call("check_inbox");
  assert.equal(checked.added.length, 1);
  assert.equal(checked.added[0].description, "MIGROS");
  assert.equal(checked.added[0].total, 1250);
  assert.deepEqual(checked.needsReview.map(e => e.emailId), [2, 3]);
  assert.ok(sb.db.inbox_messages[0].processed_at);

  assert.match((await c.call("add_inbox_purchase", { email_id: 2 })).error, /Pass card/);
  const manual = await c.call("add_inbox_purchase", { email_id: 2, card: "B" });
  assert.equal(manual.purchase.description, "AMAZON");
  assert.equal(manual.purchase.installments, 3);
  assert.equal(manual.purchase.date, "2026-10-16");
  assert.equal(manual.purchase.card, "B");
  assert.match((await c.call("add_inbox_purchase", { email_id: 2, card: "B" })).error, /No pending e-mail/);

  const dismissed = await c.call("dismiss_inbox_email", { email_id: 3 });
  assert.equal(dismissed.dismissed, true);
  assert.equal((await c.call("list_inbox")).emails.length, 0);
  assert.equal(sb.db.inbox_messages[3].processed_at, null);   // u2'nin e-postasına dokunulmadı
  assert.equal(stored(sb).installments.length, 2);

  const tried = await c.call("try_bank_email", { text: "1234 ile biten kartınızdan 01.10.2026 tarihinde X işyerinde 99,90 TL tutarında harcama yapılmıştır." });
  assert.equal(tried.parsed.amount, 99.9);
  assert.equal(tried.wouldAutoAdd, true);
});

test("e-posta adresi ve yenileme", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  const a = await c.call("get_inbox_address");
  assert.match(a.address, /^[0-9a-f]{12}@cashfollow\.app$/);
  assert.equal((await c.call("get_inbox_address")).address, a.address);
  const b = await c.call("renew_inbox_address");
  assert.notEqual(b.address, a.address);
  assert.equal(sb.db.inbox_addresses.length, 1);
});

test("varlıklar: TL, döviz ve gram altın hareketleri, güncel kurla TL karşılığı", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_person", { name: "Ayşe" });
  const maas = await c.call("add_entry", { asset: "TRY", direction: "in", amount: 50000, description: "Maaş" });
  assert.equal(maas.entry.date, "2026-10-18");
  assert.equal(maas.entry.person, "Ben");
  await c.call("add_entry", { asset: "dolar", direction: "in", amount: 100, description: "Dolar alımı", date: "2026-10-01" });
  await c.call("add_entry", { asset: "USD", direction: "out", amount: 30, description: "Tatil" });
  const gold = await c.call("add_entry", { asset: "gram altın", direction: "in", amount: 2.5, description: "Altın", person: "Ayşe" });
  assert.equal(gold.entry.asset, "GAU");
  assert.equal(gold.entry.tryValueNow, 10000);
  assert.equal(gold.balance, 2.5);

  assert.match((await c.call("add_entry", { asset: "BTC", direction: "in", amount: 1, description: "x" })).error, /TRY, USD, EUR, GAU/);
  assert.match((await c.call("add_entry", { asset: "USD", direction: "in", amount: -5, description: "x" })).error, /positive/);
  assert.match((await c.call("add_entry", { asset: "USD", direction: "in", amount: 5, description: "x", date: "2026-02-30" })).error, /valid date/);

  const all = await c.call("get_assets");
  const by = Object.fromEntries(all.assets.map(a => [a.asset, a]));
  assert.equal(by.TRY.balance, 50000);
  assert.equal(by.USD.balance, 70);
  assert.equal(by.USD.tryValue, 2800);
  assert.equal(by.EUR.balance, 0);
  assert.equal(by.GAU.balance, 2.5);
  assert.equal(all.totalTry, 50000 + 2800 + 10000);
  assert.deepEqual(all.rates, { TRY: 1, USD: 40, EUR: 45, GAU: 4000, updatedAt: "2026-10-18T09:00:00.000Z", source: "truncgil" });
  assert.equal((await c.call("get_assets", { person: "ayşe" })).totalTry, 10000);

  const list = await c.call("list_entries", { asset: "USD" });
  assert.deepEqual(list.entries.map(e => [e.description, e.direction, e.amount]), [["Tatil", "out", 30], ["Dolar alımı", "in", 100]]);
  const upd = await c.call("update_entry", { id: list.entries[0].id, amount: 40 });
  assert.equal(upd.entry.direction, "out");
  assert.equal((await c.call("get_assets")).assets[1].balance, 60);

  // Tabloya varlığın kendi biriminde, işaretli yazılır
  const row = sb.db.entries.find(r => r.description === "Tatil");
  assert.equal(row.amount, -40);
  assert.equal(row.asset, "USD");

  await c.call("delete_entry", { id: maas.entry.id });
  assert.ok(sb.db.entries.find(r => r.id === maas.entry.id).deleted_at);
  const del = await c.call("delete_person", { person: "Ayşe" });
  assert.equal(del.deletedEntries, 1);
  assert.deepEqual(stored(sb).entries.map(e => e.desc), ["Dolar alımı", "Tatil"]);
});

test("tekrarlayan varlık hareketleri: bakiyeye yalnızca tarihi gelen tekrarlar girer", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  // Bugün 2026-10-18
  const maas = await c.call("add_entry", { asset: "TRY", direction: "in", amount: 50000, description: "Maaş", date: "2026-08-15", repeat: 0 });
  assert.deepEqual(maas.entry.repeat, { every: "month", times: null, lastDate: null, processed: 3, nextDate: "2026-11-15" });
  assert.equal(maas.balance, 150000);
  const kira = await c.call("add_entry", { asset: "TRY", direction: "out", amount: 20000, description: "Kira", date: "2026-10-20", repeat: 3 });
  assert.deepEqual(kira.entry.repeat, { every: "month", times: 3, lastDate: "2026-12-20", processed: 0, nextDate: "2026-10-20" });
  assert.equal(kira.balance, 150000);
  const tek = await c.call("add_entry", { asset: "USD", direction: "in", amount: 10, description: "Tek", repeat: 1 });
  assert.equal(tek.entry.repeat, undefined);
  assert.match((await c.call("add_entry", { asset: "TRY", direction: "in", amount: 1, description: "x", repeat: 601 })).error, /repeat/);
  for (const repeat of ["", " ", true]) assert.match((await c.call("add_entry", { asset: "TRY", direction: "in", amount: 1, description: "x", repeat })).error, /repeat/);

  assert.equal(sb.db.entries.find(r => r.id === maas.entry.id).repeat_count, 0);
  assert.equal(sb.db.entries.find(r => r.id === kira.entry.id).repeat_count, 3);
  assert.equal(sb.db.entries.find(r => r.id === tek.entry.id).repeat_count, null);

  // Aralık süzgeci: tekrarlayan hareket aralıkta yinelenmeye devam ediyorsa listelenir
  const range = await c.call("list_entries", { asset: "TRY", from: "2027-01-01" });
  assert.deepEqual(range.entries.map(e => e.description), ["Maaş"]);
  assert.deepEqual((await c.call("list_entries", { asset: "TRY", to: "2026-10-01" })).entries.map(e => e.description), ["Maaş"]);

  // Süresiz tekrarı durdurmak: repeat işlenen sayıya çekilir; diğer alanlar korunur
  const stop = await c.call("update_entry", { id: maas.entry.id, repeat: 3 });
  assert.equal(stop.entry.repeat.nextDate, null);
  assert.equal(stop.entry.amount, 50000);
  const once = await c.call("update_entry", { id: kira.entry.id, amount: 25000 });
  assert.equal(once.entry.repeat.times, 3);
  assert.equal((await c.call("get_assets")).assets[0].balance, 150000);
});

test("kur alınamazsa yalnızca TL sayılır", async () => {
  const { clearRates } = await import("../kur.js");
  clearRates();
  const sb = fakeSupabase();
  sb.rates.down = true;
  const c = client(sb);
  await c.call("add_entry", { asset: "TRY", direction: "in", amount: 100, description: "Nakit" });
  await c.call("add_entry", { asset: "EUR", direction: "in", amount: 10, description: "Euro" });
  const out = await c.call("get_assets");
  assert.equal(out.totalTry, 100);
  assert.deepEqual(out.notIncludedInTotal, ["EUR"]);
  assert.equal(out.rates, null);
  assert.match(out.ratesError, /unavailable/);
  clearRates();
});

test("dışa / içe aktarma", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_person", { name: "Ali" });
  const backup = await c.call("export_data");
  assert.deepEqual(backup.people.map(p => p.name), ["Ben", "Ali"]);

  // Eski sürüm yedeği (statement alanlı) uygulamadaki gibi taşınır
  const out = await c.call("import_data", { data: { people: [{ id: "ben", name: "Ben", color: 0 }], installments: [{ id: "x", personId: "ben", desc: "Eski", statement: "2026-09", count: 3, total: 300 }], dueDay: 22 } });
  assert.deepEqual(out, { imported: true, people: 1, cards: 1, purchases: 1, entries: 0 });
  const data = stored(sb);
  assert.equal(data.installments[0].firstDue, "2026-10");
  assert.equal(data.cards[0].dueDay, 22);

  const view = await c.call("get_purchase", { id: "x" });
  assert.equal(view.firstDueMonth, "2026-10");
  assert.equal(view.nextPayment.date, "2026-10-22");

  // Tarihsiz (Excel) kayıt düzenlenirken ödeme ayı korunur
  const upd = await c.call("update_purchase", { id: "x", description: "Eski TV" });
  assert.equal(upd.purchase.firstDueMonth, "2026-10");
  assert.equal(upd.purchase.date, null);

  assert.match((await c.call("import_data", { data: { foo: 1 } })).error, /people and installments/);
});

test("kategoriler, içgörüler, kategori dağılımı ve alışveriş simülasyonu", async () => {
  const sb = fakeSupabase();
  const { call } = client(sb);
  await call("add_card", { name: "Bonus", cutoff_day: 19, due_day: 29, limit: 20000 });
  await call("add_card", { name: "World", cutoff_day: 25, due_day: 5 });
  await call("add_entry", { asset: "TRY", direction: "in", amount: 30000, description: "Maaş", date: "2026-01-15", repeat: 0 });

  const a = await call("add_purchase", { description: "MIGROS TICARET A.S.", amount: 2000, card: "Bonus", date: "2026-10-10", category: "Market" });
  assert.equal(a.purchase.category, "market");
  assert.equal(stored(sb).installments[0].categoryBy, "user");
  // Aynı işyerinin farklı yazılışı: kullanıcının kategorisi önerilir
  const b = await call("add_purchase", { description: "Migros Ticaret A.Ş. 0042", amount: 800, card: "World", date: "2026-10-12" });
  assert.equal(b.purchase.categoryName, "Market");
  assert.equal(stored(sb).installments[1].categoryBy, "ai");
  assert.match((await call("add_purchase", { description: "x", amount: 1, card: "nakit", category: "kumar" })).error, /category must be one of/);
  // Düzenlemede verilmeyen kategori kalır, null kaldırır
  assert.equal((await call("update_purchase", { id: a.purchase.id, amount: 2100 })).purchase.category, "market");
  // Önerilmiş kategori açıklama değişince yeniden önerilir; kullanıcının seçtiği kalır
  assert.equal((await call("update_purchase", { id: b.purchase.id, description: "Kira" })).purchase.category, null);
  assert.equal((await call("update_purchase", { id: b.purchase.id, description: "MIGROS TICARET A.S. 01" })).purchase.category, "market");
  assert.equal((await call("update_purchase", { id: a.purchase.id, description: "Migros Kadıköy" })).purchase.category, "market");
  assert.equal((await call("update_purchase", { id: b.purchase.id, category: null })).purchase.category, null);
  assert.equal((await call("list_purchases", { category: null })).count, 1);
  assert.equal((await call("list_purchases", { category: "market" })).count, 1);

  const cats = await call("spending_by_category", { month: "2026-10" });
  assert.deepEqual(cats.months[0].categories.map(c => [c.category, c.amount]), [["market", 2100], [null, 800]]);

  const { insights } = await call("get_insights");
  const ids = insights.map(x => x.id);
  assert.deepEqual(ids, ["yuk", "serbest", "bitis"]);   // bugün (18 Eki) iki kartın ilk ödemesi arasında 7 gün var: öneri yok

  const sim = await call("simulate_purchase", { amount: 12000, installments: 3, date: "2026-10-20" });
  assert.equal(sim.purchase.card, "Bonus");   // ilk ödemesi en geç (29 Kas)
  assert.equal(sim.purchase.payments[0].date, "2026-11-29");
  assert.deepEqual(sim.months.map(m => [m.month, m.paymentsBefore, m.paymentsAfter]), [["2026-11", 800, 4800], ["2026-12", 0, 4000], ["2027-01", 0, 4000]]);
  assert.deepEqual([sim.months[0].freeCashBefore, sim.months[0].freeCashAfter], [29200, 25200]);
  assert.equal(sim.card.availableAfter, 20000 - 2100 - 12000);
  assert.equal(stored(sb).installments.length, 2);   // kaydedilmedi
});

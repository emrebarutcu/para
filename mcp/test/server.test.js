import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server.js";
import Tablo from "../../tablo.js";

const NOW = () => new Date("2026-10-18T09:00:00Z");
const ORIGIN = "https://cashfollow.app";

// Bellekte Supabase: auth/v1/user ve kullanılan PostgREST uçları (RLS: yalnızca token sahibinin satırları)
const DATA = ["people", "cards", "purchases", "entries", "debts"];
const RATES = { USD: { Selling: 40 }, EUR: { Selling: 45 }, GRA: { Selling: 4000 }, Update_Date: "2026-10-18 12:00:00" };
function fakeSupabase({ users = { good: { id: "u1", email: "a@b.c" }, other: { id: "u2", email: "x@y.z" } } } = {}) {
  const db = { people: [], cards: [], purchases: [], entries: [], debts: [], inbox_messages: [], inbox_addresses: [] };
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
        if ((table === "purchases" || table === "entries" || table === "debts") && !db.people.some(x => x.user_id === user.id && x.id === row.person_id)) return reply({ code: "23503" }, 409);
        if (table === "purchases" && row.card_id && !db.cards.some(x => x.user_id === user.id && x.id === row.card_id)) return reply({ code: "23503" }, 409);
      }
      for (const row of body) {
        const cur = rows.find(x => x.user_id === user.id && x.id === row.id);
        if (cur) Object.assign(cur, row, { updated_at: stamp() });
        else { const at = stamp(); rows.push({ ...(table === "cards" && { track_off: false }), ...row, created_at: at, updated_at: at }); }
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

// now: sunucunun saati (bugün; varsayılan 2026-10-18)
function client(sb, token = "good", { now = NOW } = {}) {
  let id = 0;
  const post = async body => {
    const res = await handle(new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }), {}, { fetch: sb.fetch, now });
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

// u1'in verisini doğrudan tablolara yazar (uygulamadan eşitlenmiş gibi)
function seed(sb, state) {
  for (const t of DATA) {
    for (const item of state[Tablo.FIELD[t]] || []) {
      const at = sb.stamp();
      sb.db[t].push({ ...JSON.parse(Tablo.keyOf(t, item)), user_id: "u1", created_at: at, updated_at: at, deleted_at: null });
    }
  }
}

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
  assert.match(init.body.result.instructions, /totalAssetsTry = netWorthTry \+ debtsTry/);

  const old = await c.rpc("initialize", { protocolVersion: "1999-01-01" });
  assert.equal(old.body.result.protocolVersion, "2025-06-18");

  const note = await c.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);

  const { body } = await c.rpc("tools/list");
  const names = body.result.tools.map(t => t.name);
  for (const n of ["get_overview", "get_cashflow", "list_purchases", "add_purchase", "update_purchase", "delete_purchase",
    "list_cards", "add_card", "update_card", "delete_card", "list_people", "add_person", "rename_person", "delete_person",
    "list_inbox", "check_inbox", "add_inbox_purchase", "dismiss_inbox_email", "export_data", "import_data",
    "get_assets", "list_debts", "get_debt", "add_debt", "update_debt", "delete_debt", "pay_debt", "delete_debt_payment"]) {
    assert.ok(names.includes(n), n);
  }
  for (const t of body.result.tools) assert.equal(t.inputSchema.type, "object", t.name);
  for (const n of ["delete_card", "delete_debt", "delete_debt_payment"]) assert.equal(body.result.tools.find(t => t.name === n).annotations.destructiveHint, true, n);
  assert.equal(body.result.tools.find(t => t.name === "list_debts").annotations.readOnlyHint, true);

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
  assert.deepEqual(maas.entry.repeat, { every: 1, unit: "month", label: "Ayda bir", times: null, lastDate: null, processed: 3, nextDate: "2026-11-15" });
  assert.equal(maas.balance, 150000);
  const kira = await c.call("add_entry", { asset: "TRY", direction: "out", amount: 20000, description: "Kira", date: "2026-10-20", repeat: 3 });
  assert.deepEqual(kira.entry.repeat, { every: 1, unit: "month", label: "Ayda bir", times: 3, lastDate: "2026-12-20", processed: 0, nextDate: "2026-10-20" });
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

test("harcama varlıktan: döviz / altın harcaması ve nakit harcama bakiyeden düşer; her N hafta / ayda bir tekrar", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  // Bugün 2026-10-18
  await c.call("add_entry", { asset: "USD", direction: "in", amount: 100, description: "Dolar alımı", date: "2026-10-01" });
  await c.call("add_entry", { asset: "TRY", direction: "in", amount: 10000, description: "Maaş", date: "2026-10-01" });
  const usd = await c.call("add_purchase", { description: "Kitap", amount: 12.5, asset: "dolar", date: "2026-10-10" });
  assert.equal(usd.purchase.asset, "USD");
  assert.equal(usd.purchase.card, "Nakit");
  assert.match(usd.preview.note, /USD asset balance/);
  assert.match((await c.call("add_purchase", { description: "x", amount: 5, asset: "USD", installments: 3 })).error, /installments must be 1/);
  await c.call("add_card", { name: "Bonus", cutoff_day: 10, due_day: 20 });
  assert.match((await c.call("add_purchase", { description: "x", amount: 5, asset: "USD", card: "Bonus" })).error, /nakit/);

  // Haftalık market (nakit): 4, 11, 18 Ekim geldi → 3 × 500; 25 Ekim henüz değil
  const market = await c.call("add_purchase", { description: "Market", amount: 500, card: "nakit", date: "2026-10-04", repeat: 0, repeat_unit: "week" });
  assert.deepEqual(market.purchase.repeat, { every: 1, unit: "week", label: "Haftada bir", times: null, lastDate: null, processed: 3, nextDate: "2026-10-25" });
  assert.equal(market.purchase.nextPayment.date, "2026-10-18");   // bugünkü ödeme henüz ödenmedi sayılır (taksitlerdeki gibi)
  const bals = Object.fromEntries((await c.call("get_assets")).assets.map(a => [a.asset, a.balance]));
  assert.equal(bals.USD, 87.5);
  assert.equal(bals.TRY, 10000 - 1500);

  // İki ayda bir kartla abonelik, 3 kez: her tekrar kendi ekstresine
  const sub = await c.call("add_purchase", { description: "Dergi", amount: 300, card: "Bonus", date: "2026-09-05", repeat: 3, repeat_every: 2 });
  const full = await c.call("get_purchase", { id: sub.purchase.id });
  assert.deepEqual(full.payments.map(x => x.date), ["2026-09-20", "2026-11-20", "2027-01-20"]);
  assert.equal(full.repeat.label, "2 ayda bir");
  // Kart limitine yalnızca tarihi gelmiş tekrarlar girer (5 Kasım'daki henüz çekilmedi)
  assert.equal((await c.call("list_cards")).cards[0].used, 0);
  const row = sb.db.purchases.find(r => r.id === sub.purchase.id);
  assert.deepEqual([row.repeat_count, row.repeat_every, row.repeat_unit, row.asset], [3, 2, null, null]);
  assert.equal(sb.db.purchases.find(r => r.id === usd.purchase.id).asset, "USD");

  // Döviz harcaması TL akışına girmez
  const flow = await c.call("get_cashflow", { from_month: "2026-10", months: 1 });
  assert.equal(flow.months[0].total, 2000);   // 4 hafta market
  assert.match((await c.call("add_purchase", { description: "x", amount: 5, repeat_every: 2 })).error, /need repeat/);
  assert.match((await c.call("add_purchase", { description: "x", amount: 5, card: "nakit", repeat: 0, repeat_unit: "yıl" })).error, /repeat_unit/);
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
  assert.deepEqual(out, { imported: true, people: 1, cards: 1, purchases: 1, entries: 0, debts: 0 });
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

  // Borçlar ve ödemeleri yedekle gelir, yedeğe girer
  const debts = [
    { id: "d1", kind: "person", side: "receivable", personId: "ben", party: "Ali", asset: "TRY", amount: 1000, principal: 1000, date: "2026-10-01" },
    { id: "p1", kind: "payment", personId: "ben", debtId: "d1", amount: 400, date: "2026-10-05" },
  ];
  const withDebts = await c.call("import_data", { data: { people: [{ id: "ben", name: "Ben", color: 0 }], installments: [], debts } });
  assert.equal(withDebts.debts, 2);
  assert.equal((await c.call("get_debt", { id: "d1" })).remaining, 600);
  assert.deepEqual((await c.call("export_data")).debts, debts);

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

test("borçlar: borç aldım / borç verdim / kredi ekleme, listeleme, düzenleme, silme ve doğrulama", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_person", { name: "Ayşe" });
  await c.call("add_entry", { asset: "TRY", direction: "in", amount: 10000, description: "Maaş", date: "2026-10-01" });

  const bad = async (args, re) => assert.match((await c.call("add_debt", args)).error, re);
  await bad({ type: "hediye", amount: 1 }, /type must be "borrowed"/);
  await bad({ type: "borrowed", amount: 100 }, /party is required: who the money was borrowed from/);
  await bad({ type: "lent", party: "Ali", amount: 0 }, /amount must be a positive number/);
  await bad({ type: "lent", party: "Ali", amount: 300, installments: 3 }, /due_date .* required with installments/);
  await bad({ type: "loan", amount: 1000, installments: 12 }, /due_date .* required for a loan/);
  await bad({ type: "loan", amount: 1000, due_date: "2026-11-05" }, /installments .* required for a loan/);
  await bad({ type: "loan", amount: 1000, installments: 601, due_date: "2026-11-05" }, /between 1 and 600/);
  await bad({ type: "loan", amount: 1000, installments: 12, due_date: "2026-11-05", auto_pay: "no" }, /auto_pay must be true or false/);
  await bad({ type: "borrowed", party: "X", amount: 100, principal: 200 }, /principal \(200\) must not be more than amount/);
  await bad({ type: "borrowed", party: "X", amount: 100, principal: -1 }, /principal must be zero or a positive/);
  await bad({ type: "borrowed", party: "X", amount: 100, auto_pay: true }, /auto_pay needs due_date/);
  await bad({ type: "borrowed", party: "X", amount: 100, date: "2026-02-30" }, /date must be a valid date/);
  await bad({ type: "borrowed", party: "X", amount: 100, due_date: "2026-13-01" }, /due_date must be a valid date/);
  await bad({ type: "borrowed", party: "X", amount: 100, asset: "BTC" }, /TRY, USD, EUR, GAU/);
  await bad({ type: "borrowed", party: "X", amount: 100, person: "Zeynep" }, /Unknown person/);
  assert.equal(stored(sb).debts.length, 0);

  // Borç aldım: para bugün Ben'in TL varlığına girer; vade 1 Ara
  const dry = await c.call("add_debt", { type: "borç aldım", party: "Mehmet", amount: 5000, due_date: "2026-12-01", dry_run: true });
  assert.equal(dry.saved, false);
  assert.deepEqual(dry.balance, { person: "Ben", asset: "TRY", before: 10000, after: 15000 });
  assert.equal(stored(sb).debts.length, 0);
  const borrowed = await c.call("add_debt", { type: "borç aldım", party: "Mehmet", amount: 5000, due_date: "2026-12-01" });
  const m = borrowed.debt;
  assert.equal(borrowed.saved, true);
  assert.deepEqual([m.type, m.side, m.date, m.dueDate, m.principal, m.remaining, m.status, m.installments, m.autoPay],
    ["borrowed", "debt", "2026-10-18", "2026-12-01", 5000, 5000, "open", 1, false]);
  assert.deepEqual(m.nextPayment, { date: "2026-12-01", amount: 5000, installment: "1/1" });
  assert.deepEqual(borrowed.balance, { person: "Ben", asset: "TRY", before: 10000, after: 15000 });

  // Borç verdim, 3 taksit: Eylül ve Ekim taksitleri gecikti
  const lent = (await c.call("add_debt", { type: "lent", party: "Ali", amount: 3000, installments: 3, due_date: "2026-09-10", date: "2026-08-20", description: "Araba tamiri" })).debt;
  assert.deepEqual([lent.side, lent.remaining, lent.overdue, lent.overdueSince, lent.perInstallment], ["receivable", 3000, 2000, "2026-09-10", 1000]);
  assert.deepEqual(lent.nextPayment, { date: "2026-11-10", amount: 1000, installment: "3/3" });

  // Kredi: tutar taksit başına; çekilen 12.000, faiz ve masraf 1.200
  const loan = await c.call("add_debt", { type: "kredi", party: "Garanti", amount: 1100, installments: 12, due_date: "2026-11-05", principal: 12000 });
  assert.deepEqual([loan.debt.total, loan.debt.cost, loan.debt.autoPay, loan.debt.perInstallment], [13200, 1200, true, 1100]);
  assert.deepEqual([loan.preview.firstPayment, loan.preview.lastPayment, loan.preview.monthlyInterestRate], ["2026-11-05", "2027-10-05", 1.5]);
  assert.deepEqual(loan.balance, { person: "Ben", asset: "TRY", before: 12000, after: 24000 });
  assert.deepEqual(stored(sb).debts.find(d => d.id === loan.debt.id),
    { id: loan.debt.id, kind: "loan", personId: "ben", party: "Garanti", asset: "TRY", amount: 13200, principal: 12000, date: "2026-10-18", due: "2026-11-05", count: 12 });

  // İleri tarihli dolar borcu henüz başlamadı: bakiyeye ve toplamlara girmez
  const later = (await c.call("add_debt", { type: "borrowed", party: "Can", amount: 100, asset: "dolar", date: "2026-11-01" })).debt;
  assert.deepEqual([later.status, later.started, later.asset, later.remaining], ["not_started", false, "USD", 0]);

  const all = await c.call("list_debts");
  assert.deepEqual(all.debts.map(d => d.party), ["Garanti", "Ali", "Mehmet", "Can"]);   // sıradaki ödemeye göre
  assert.deepEqual(all.totals, {
    cashTry: 24000, receivablesTry: 3000, debtsTry: 18200, totalAssetsTry: 27000, netWorthTry: 8800, untrackedCardDebtTry: 0,
    debtsByKind: { cards: 0, cashInstallments: 0, loans: 13200, people: 5000, overpaidCardShares: 0 },
    receivablesByKind: { cardShares: 0, people: 3000, cardCredit: 0 },
  });
  assert.deepEqual([all.cards, all.shares, all.cashInstallments], [[], [], { totalTry: 0, byAsset: {} }]);
  assert.deepEqual((await c.call("list_debts", { side: "receivable" })).debts.map(d => d.party), ["Ali"]);
  assert.deepEqual((await c.call("list_debts", { side: "debt", search: "garan" })).debts.map(d => d.party), ["Garanti"]);
  assert.deepEqual((await c.call("list_debts", { search: "tamir" })).debts.map(d => d.party), ["Ali"]);
  assert.equal((await c.call("list_debts", { person: "Ayşe" })).debts.length, 0);
  assert.match((await c.call("list_debts", { side: "mine" })).error, /side must be/);

  const ali = await c.call("get_debt", { id: lent.id });
  assert.deepEqual(ali.schedule.map(x => [x.date, x.amount, x.covered, x.state]),
    [["2026-09-10", 1000, 0, "late"], ["2026-10-10", 1000, 0, "late"], ["2026-11-10", 1000, 0, "open"]]);
  assert.match((await c.call("get_debt", { id: "yok" })).error, /No debt with id "yok"/);

  // Özvarlık yalnızca kredinin faiziyle değişti: Varlık = Özvarlık + Borç
  const assets = await c.call("get_assets");
  assert.deepEqual([assets.totalTry, assets.receivablesTry, assets.debtsTry, assets.netWorthTry], [24000, 3000, 18200, 8800]);
  assert.equal(assets.totalAssetsTry, assets.netWorthTry + assets.debtsTry);

  // Toplam değişince (ana parayla eşitti) ana para da değişir; sahibi değişince para Ayşe'nin bakiyesine geçer
  const upd = await c.call("update_debt", { id: m.id, amount: 6000, person: "Ayşe" });
  assert.deepEqual([upd.debt.total, upd.debt.principal, upd.debt.person, upd.debt.dueDate], [6000, 6000, "Ayşe", "2026-12-01"]);
  assert.equal((await c.call("get_assets", { person: "Ayşe" })).totalTry, 6000);
  assert.equal((await c.call("update_debt", { id: m.id, due_date: null })).debt.dueDate, null);
  assert.match((await c.call("update_debt", { id: m.id, closed: "2026-10-19" })).error, /not be after today/);
  assert.match((await c.call("update_debt", { id: lent.id, closed: "2026-08-01" })).error, /not be before the debt's date/);
  assert.match((await c.call("update_debt", { id: loan.debt.id, due_date: null })).error, /due_date .* required for a loan/);
  const closed = await c.call("update_debt", { id: m.id, closed: "2026-10-18" });
  assert.deepEqual([closed.debt.status, closed.debt.remaining], ["closed", 0]);
  assert.equal((await c.call("list_debts")).debts.some(d => d.id === m.id), false);
  assert.deepEqual((await c.call("list_debts", { status: "closed" })).debts.map(d => d.id), [m.id]);
  assert.equal((await c.call("update_debt", { id: m.id, closed: null })).debt.status, "open");
  // Taksit sayısı değişince toplam kalır
  const redo = await c.call("update_debt", { id: lent.id, installments: 2 });
  assert.deepEqual([redo.debt.total, redo.debt.perInstallment], [3000, 1500]);

  const del = await c.call("delete_debt", { id: later.id });
  assert.deepEqual(del, { deleted: { id: later.id, type: "borrowed", party: "Can", description: "" }, deletedPayments: 0 });
  assert.match((await c.call("delete_debt", { id: later.id })).error, /No debt/);
  assert.equal((await c.call("delete_debt", { id: loan.debt.id })).deleted.type, "loan");
  assert.deepEqual(stored(sb).debts.map(d => d.party), ["Mehmet", "Ali"]);
  assert.equal((await c.call("get_assets", { person: "Ben" })).totalTry, 10000 - 3000);   // kredinin parası da gitti
});

test("borç ödemesi: kısmi ödeme ve kapatma; kredide erken ödeme sondan düşer; otomatik ödeme ile elle ödeme", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_entry", { asset: "TRY", direction: "in", amount: 20000, description: "Maaş", date: "2026-10-01" });
  const bal = async () => (await c.call("get_assets")).assets[0].balance;

  const { debt } = await c.call("add_debt", { type: "borrowed", party: "Mehmet", amount: 10000, date: "2026-10-01", due_date: "2026-12-01" });
  assert.match((await c.call("pay_debt", { amount: 100 })).error, /Pass debt/);
  assert.match((await c.call("pay_debt", { debt: debt.id, person: "Ben", amount: 100 })).error, /only one of debt, person or card/);
  assert.match((await c.call("pay_debt", { debt: debt.id })).error, /amount is required/);
  assert.match((await c.call("pay_debt", { debt: debt.id, amount: 100, date: "2026-10-19" })).error, /not be after today/);
  assert.match((await c.call("pay_debt", { debt: debt.id, amount: 100, date: "2026-09-30" })).error, /before the debt's date \(2026-10-01\)/);
  assert.match((await c.call("pay_debt", { debt: debt.id, amount: 0 })).error, /positive/);
  assert.match((await c.call("pay_debt", { debt: "yok", amount: 1 })).error, /No debt/);

  const part = await c.call("pay_debt", { debt: debt.id, amount: 4000, date: "2026-10-10", description: "İlk ödeme" });
  assert.deepEqual(part.payment, { id: part.payment.id, date: "2026-10-10", amount: 4000, asset: "TRY", description: "İlk ödeme" });
  assert.deepEqual([part.debt.paid, part.debt.remaining, part.debt.status, part.warning], [4000, 6000, "open", undefined]);
  assert.equal(await bal(), 20000 + 10000 - 4000);

  // Kalanı aşan ödeme uyarılır; close borcu bugünle kapatır
  const done = await c.call("pay_debt", { debt: debt.id, amount: 7000, close: true });
  assert.match(done.warning, /more than the 6000 TRY left/);
  assert.deepEqual([done.debt.remaining, done.debt.status, done.debt.closed, done.debt.payments.length], [0, "closed", "2026-10-18", 2]);
  assert.match((await c.call("pay_debt", { debt: debt.id, amount: 1 })).error, /closed on 2026-10-18/);
  assert.equal(await bal(), 19000);
  const removed = await c.call("delete_debt_payment", { id: part.payment.id });
  assert.deepEqual(removed.deleted, { id: part.payment.id, date: "2026-10-10", amount: 4000, asset: "TRY" });
  assert.equal(removed.debt.paid, 7000);
  // Kapanmış borcun ödemesi silinince borç yeniden açılır: kalan 3.000 sessizce silinmez
  assert.deepEqual([removed.reopened, removed.debt.status, removed.debt.remaining, removed.debt.closed], [true, "open", 3000, null]);
  assert.match((await c.call("delete_debt_payment", { id: part.payment.id })).error, /No debt payment/);
  assert.equal(await bal(), 23000);
  assert.equal((await c.call("update_debt", { id: debt.id, closed: "2026-10-18" })).debt.status, "closed");

  // Eski kredi (ana para yok), 4 × 1.000, ilk taksit 5 Eki: o taksit ödendi, 1.500 erken ödeme Oca'yı ve Ara'nın yarısını kapatır
  const loan = (await c.call("add_debt", { type: "loan", party: "Garanti", amount: 1000, installments: 4, due_date: "2026-10-05", date: "2026-10-01" })).debt;
  assert.deepEqual([loan.remaining, loan.paid, loan.nextPayment.date, loan.principal], [3000, 1000, "2026-11-05", 0]);
  assert.equal(await bal(), 22000);
  const extra = await c.call("pay_debt", { debt: loan.id, amount: 1500 });
  assert.deepEqual([extra.debt.remaining, extra.debt.nextPayment], [1500, { date: "2026-11-05", amount: 1000, installment: "2/4" }]);
  const sched = (await c.call("get_debt", { id: loan.id })).schedule;
  assert.deepEqual(sched.map(x => [x.date, x.amount, x.state]),
    [["2026-10-05", 1000, "paid"], ["2026-11-05", 1000, "open"], ["2026-12-05", 500, "open"], ["2027-01-05", 1000, "paid"]]);
  assert.equal(await bal(), 20500);

  // Özet: kart / nakit tutarları aynı kalır, borç taksitleri ayrı
  const ov = await c.call("get_overview");
  assert.equal(ov.dueThisMonth, 0);
  assert.deepEqual(ov.debts, {
    dueThisMonth: 9500, nextMonth: 1000,   // Eki: 5 Eki taksiti + bugünkü 7.000 ve 1.500 ödeme
    upcoming: [
      { date: "2026-11-05", description: "Garanti · taksit 2/4", amount: 1000, asset: "TRY", debtId: loan.id },
      { date: "2026-12-05", description: "Garanti · taksit 3/4", amount: 500, asset: "TRY", debtId: loan.id },
    ],
  });

  // Aynı alacak iki kez: elle ödenende 15 Eki taksiti gecikmiş, otomatikte ödenmiş sayılır
  const args = { type: "lent", party: "Ali", amount: 2000, installments: 2, due_date: "2026-10-15", date: "2026-09-01" };
  const manual = (await c.call("add_debt", args)).debt;
  const before = await bal();
  const auto = (await c.call("add_debt", { ...args, auto_pay: true })).debt;
  assert.deepEqual([manual.remaining, manual.overdue, manual.nextPayment.date, manual.autoPay], [2000, 1000, "2026-11-15", false]);
  assert.deepEqual([auto.remaining, auto.overdue, auto.paid, auto.nextPayment.date, auto.autoPay], [1000, 0, 1000, "2026-11-15", true]);
  assert.equal(await bal(), before - 2000 + 1000);   // verilen 2.000 çıktı, 15 Eki taksiti geldi
  assert.equal(stored(sb).debts.find(d => d.id === auto.id).autoPay, true);
  // 15 Eki taksiti geçmişte: ödeme modu değişmez (gecikmiş taksit ödenmiş sayılır, ödenen ikinci kez düşerdi)
  assert.match((await c.call("update_debt", { id: manual.id, auto_pay: true })).error,
    /payment mode can't change: this debt has an installment due before today \(on 2026-10-15\).*stays paid by hand.*add a new one for what is left, with its due date today or later/);
  // Kişisel borçta kayıt tarihinden önceki taksit de kilitler (kredideki gibi "tarihiyle bugün arası" değil)
  const early = (await c.call("add_debt", { type: "borrowed", party: "Veli", amount: 1000, date: "2026-10-10", due_date: "2026-10-01", principal: 0 })).debt;
  const locked = (await c.call("update_debt", { id: early.id, auto_pay: true })).error;
  assert.match(locked, /this debt has an installment due before today \(on 2026-10-01\)/);
  assert.doesNotMatch(locked, /between its date/);
  await c.call("delete_debt", { id: early.id });
  assert.match((await c.call("update_debt", { id: auto.id, auto_pay: false })).error, /stays automatic/);
  // Tür değişince varsayılan mod da değişirdi: kilitliyken kayıttaki modun verilmesi istenir
  assert.match((await c.call("update_debt", { id: manual.id, type: "loan" })).error, /pass auto_pay: false to keep it/);
  assert.equal((await c.call("update_debt", { id: manual.id, description: "Araba" })).debt.autoPay, false);
});

test("kart takibi: ekstre son ödeme gününün ertesi günü TL'den düşer; diğer kişinin payı alacaktır, ödeyince kapanır", async () => {
  const sb = fakeSupabase();
  // Bonus 1 Eyl'den beri takipte (kesim 10, son ödeme 20). 5 Eyl: Ben'in TV'si 3 × 1.000, Annem'in telefonu 3 × 500
  // → 20 Eyl, 20 Eki, 20 Kas
  seed(sb, {
    people: [{ id: "ben", name: "Ben", color: 0 }, { id: "anne", name: "Annem", color: 1 }],
    cards: [{ id: "bonus", name: "Bonus", limit: 50000, cutoffDay: 10, dueDay: 20, color: 0, trackSince: "2026-09-01" }],
    installments: [
      { id: "tv", personId: "ben", cardId: "bonus", desc: "TV", total: 3000, count: 3, date: "2026-09-05" },
      { id: "tel", personId: "anne", cardId: "bonus", desc: "Telefon", total: 1500, count: 3, date: "2026-09-05" },
    ],
    entries: [{ id: "e1", personId: "ben", asset: "TRY", amount: 10000, desc: "Maaş", date: "2026-09-01" }],
  });
  const c = client(sb);
  const on = day => client(sb, "good", { now: () => new Date(`${day}T09:00:00Z`) });
  const worth = async (cl = c) => {
    const a = await cl.call("get_assets");
    assert.equal(a.totalAssetsTry, a.netWorthTry + a.debtsTry);
    return [a.totalTry, a.receivablesTry, a.debtsTry, a.totalAssetsTry, a.netWorthTry];
  };

  // 20 Eyl ekstresi (1.000 + 500) düştü; kalan iki ekstre borç, Annem'in 1.500'ü alacak. Özvarlık = 10.000 − TV
  assert.deepEqual(await worth(), [8500, 1500, 3000, 10000, 7000]);
  assert.deepEqual(await worth(on("2026-10-20")), [8500, 1500, 3000, 10000, 7000]);   // son ödeme günü: henüz ödenmedi
  // Otomatik kartta son ödeme günündeki ekstre Ödendi beklemez (yarın kendiliğinden ödenmiş sayılır)
  const dueDay = on("2026-10-20");
  assert.equal((await dueDay.call("get_overview")).debts.unpaidCardStatements, undefined);
  assert.deepEqual((await dueDay.call("list_cards")).cards[0].tracking, { since: "2026-09-01", autoPay: true, unpaid: 0, overdue: 0 });
  assert.deepEqual(await worth(on("2026-10-21")), [7000, 1500, 1500, 8500, 7000]);
  assert.deepEqual((await c.call("get_assets")).cardTracking, [{ card: "Bonus", cardId: "bonus", since: "2026-09-01" }]);

  const card = (await c.call("list_cards")).cards[0];
  assert.deepEqual([card.used, card.tracking, card.statement],
    [3000, { since: "2026-09-01", autoPay: true, unpaid: 0, overdue: 0 }, { date: "2026-10-20", amount: 1500, alreadyCut: true }]);
  const people = (await c.call("list_people")).people;
  assert.deepEqual(people.map(p => p.owesUser), [undefined, 1500]);
  const list = await c.call("list_debts");
  assert.deepEqual(list.cards, [{
    cardId: "bonus", card: "Bonus", tracked: true, since: "2026-09-01", debt: 3000,
    statement: { date: "2026-10-20", amount: 1500, alreadyCut: true }, byPerson: { Ben: 2000, Annem: 1000 }, autoPay: true,
  }]);
  assert.deepEqual(list.shares, [{ personId: "anne", person: "Annem", owed: 1500, dueNow: 500, settled: 0, nextPayment: { date: "2026-10-20", amount: 500 }, payments: [] }]);
  assert.deepEqual((await c.call("list_debts", { side: "debt" })).shares, []);

  // Annem payını öder: Ben'in TL'sine girer, alacak azalır
  assert.match((await c.call("pay_debt", { person: "Ben", amount: 100 })).error, /Ben pays the cards/);
  assert.match((await c.call("pay_debt", { person: "Annem", amount: 100, close: true })).error, /close is only for a debt/);
  const paid = await c.call("pay_debt", { person: "annem", amount: 500 });
  assert.deepEqual([paid.share.owed, paid.share.dueNow, paid.share.settled, paid.share.payments.length, paid.warning], [1000, 0, 500, 1, undefined]);
  assert.deepEqual(await worth(), [9000, 1000, 3000, 10000, 7000]);
  const row = sb.db.debts.find(r => r.id === paid.payment.id);
  assert.deepEqual([row.kind, row.person_id, row.debt_id, row.amount, row.asset], ["payment", "anne", null, 500, null]);

  // Fazla ödenen pay borca geçer
  const over = await c.call("pay_debt", { person: "Annem", amount: 1200 });
  assert.match(over.warning, /200 TRY more than their card share/);
  const totals = (await c.call("list_debts")).totals;
  assert.deepEqual([totals.debtsByKind.overpaidCardShares, totals.receivablesTry, totals.netWorthTry], [200, 0, 7000]);
  const undo = await c.call("delete_debt_payment", { id: over.payment.id });
  assert.equal(undo.share.owed, 1000);
  await c.call("delete_debt_payment", { id: paid.payment.id });

  // Takipten çıkan kartın ekstresi bakiyeye döner; borcu toplama girmez
  const off = await c.call("update_card", { card: "Bonus", track_statements: false });
  assert.deepEqual([off.balanceChangeTry, off.card.tracking], [1500, null]);
  assert.deepEqual([stored(sb).cards[0].trackOff, stored(sb).cards[0].trackSince], [true, "2026-09-01"]);
  assert.deepEqual(await worth(), [10000, 0, 0, 10000, 10000]);
  assert.equal((await c.call("get_assets")).untrackedCardDebtTry, 3000);
  assert.match((await c.call("pay_debt", { person: "Annem", amount: 100 })).error, /No card's statements are tracked/);
  assert.match((await c.call("update_card", { card: "Bonus", track_statements: false, track_since: "2026-09-01" })).error, /track_since needs tracking on/);
  assert.match((await c.call("update_card", { card: "Bonus", track_since: "2026-10-19" })).error, /not be after today/);

  // Yeniden takipte: verilmezse bugünden (düşülen yok), sonra 1 Eyl'den
  const back = await c.call("update_card", { card: "Bonus", track_statements: true });
  assert.deepEqual([back.balanceChangeTry, back.card.tracking.since], [0, "2026-10-18"]);
  assert.equal(stored(sb).cards[0].trackOff, undefined);
  assert.equal((await c.call("update_card", { card: "Bonus", track_since: "2026-09-01" })).balanceChangeTry, -1500);
  // Takip alanları verilmezse korunur
  const limit = await c.call("update_card", { card: "Bonus", limit: 60000 });
  assert.equal(limit.balanceChangeTry, undefined);
  assert.deepEqual([stored(sb).cards[0].trackSince, stored(sb).cards[0].trackOff, stored(sb).cards[0].limit], ["2026-09-01", undefined, 60000]);

  // Kart silinince düşülen ekstresi bakiyeye döner; yeni kart bugünden takipte
  const del = await c.call("delete_card", { card: "Bonus" });
  assert.deepEqual([del.deletedPurchases, del.deletedPayments, del.balanceChangeTry], [2, 0, 1500]);
  const added = await c.call("add_card", { name: "World", cutoff_day: 1, due_day: 10 });
  assert.deepEqual(added.card.tracking, { since: "2026-10-18", autoPay: true, unpaid: 0, overdue: 0 });
  assert.equal(stored(sb).cards[0].trackSince, "2026-10-18");
});

test("elle ödenen kart: son ödeme günü geçince TL değişmez ve gecikir; Ödendi tam / kısmi; ön ödeme varken otomatiğe dönülmez; kart silinince ödemeleri de gider", async () => {
  const sb = fakeSupabase();
  // Bonus 1 Eyl'den beri takipte (kesim 10, son ödeme 20). 5 Eyl: TV 3 × 1.000 → 20 Eyl, 20 Eki, 20 Kas
  seed(sb, {
    people: [{ id: "ben", name: "Ben", color: 0 }],
    cards: [{ id: "bonus", name: "Bonus", limit: 50000, cutoffDay: 10, dueDay: 20, color: 0, trackSince: "2026-09-01" }],
    installments: [{ id: "tv", personId: "ben", cardId: "bonus", desc: "TV", total: 3000, count: 3, date: "2026-09-05" }],
    entries: [{ id: "e1", personId: "ben", asset: "TRY", amount: 10000, desc: "Maaş", date: "2026-09-01" }],
  });
  const c = client(sb);
  const on = day => client(sb, "good", { now: () => new Date(`${day}T09:00:00Z`) });
  const worth = async (cl = c) => {
    const a = await cl.call("get_assets");
    assert.equal(a.totalAssetsTry, a.netWorthTry + a.debtsTry);
    return [a.totalTry, a.receivablesTry, a.debtsTry, a.totalAssetsTry, a.netWorthTry];
  };
  assert.deepEqual(await worth(), [9000, 0, 2000, 9000, 7000]);   // 20 Eyl ekstresi kendiliğinden ödendi

  // Elle moda geçiş bugünden: önceki ekstreler ödenmiş kalır, bakiye değişmez
  const man = await c.call("update_card", { card: "Bonus", auto_pay: false });
  assert.deepEqual(man.card.tracking, { since: "2026-09-01", autoPay: false, unpaid: 0, overdue: 0, manualSince: "2026-10-18", overdueSince: null });
  assert.equal(man.balanceChangeTry, 0);
  assert.match(man.note, /^From 2026-10-18 Bonus's statements stay owed until marked paid with pay_debt card="Bonus"/);
  assert.deepEqual([stored(sb).cards[0].manualSince, sb.db.cards[0].manual_since], ["2026-10-18", "2026-10-18"]);
  assert.match((await c.call("update_card", { card: "Bonus", auto_pay: "no" })).error, /auto_pay must be true or false/);

  // Son ödeme günü: bugün ödenecek; ertesi gün ödenmediyse gecikti, TL düşmez
  const d20 = on("2026-10-20");
  assert.deepEqual(await worth(d20), [9000, 0, 2000, 9000, 7000]);
  assert.deepEqual((await d20.call("list_debts")).cards[0].statements,
    [{ date: "2026-10-20", amount: 1000, covered: 0, state: "due" }, { date: "2026-11-20", amount: 1000, covered: 0, state: "open" }]);
  assert.deepEqual((await d20.call("get_overview")).debts.unpaidCardStatements, [{ card: "Bonus", cardId: "bonus", amount: 1000, since: "2026-10-20" }]);

  const d21 = on("2026-10-21");
  assert.deepEqual(await worth(d21), [9000, 0, 2000, 9000, 7000]);   // otomatikte 8.000 TL, 1.000 borç olurdu
  assert.deepEqual((await d21.call("list_debts")).cards, [{
    cardId: "bonus", card: "Bonus", tracked: true, since: "2026-09-01", debt: 2000,
    statement: { date: "2026-11-20", amount: 1000, alreadyCut: false }, byPerson: { Ben: 2000 }, autoPay: false,
    manualSince: "2026-10-18", unpaid: 1000, overdue: 1000, overdueSince: "2026-10-20",
    statements: [{ date: "2026-10-20", amount: 1000, covered: 0, state: "late" }, { date: "2026-11-20", amount: 1000, covered: 0, state: "open" }],
  }]);
  const listed = (await d21.call("list_cards")).cards[0];
  assert.deepEqual([listed.used, listed.available, listed.tracking.overdue, listed.tracking.overdueSince], [2000, 48000, 1000, "2026-10-20"]);
  const ov = await d21.call("get_overview");
  assert.deepEqual(ov.debts.unpaidCardStatements, [{ card: "Bonus", cardId: "bonus", amount: 1000, since: "2026-10-20", late: true }]);
  assert.deepEqual(ov.cards[0], { name: "Bonus", used: 2000, available: 48000, nextPayment: { date: "2026-11-20", amount: 1000 }, autoPay: false, unpaid: 1000, overdue: 1000 });
  // Sıradaki ödemeler: ödenmemiş geçmiş ekstre gecikmiş olarak en üstte
  assert.deepEqual(ov.upcomingPayments, [
    { date: "2026-10-20", card: "Bonus", total: 1000, byPerson: { Ben: 1000 }, late: true },
    { date: "2026-11-20", card: "Bonus", total: 1000, byPerson: { Ben: 1000 } },
  ]);
  assert.deepEqual((await d21.call("get_insights")).insights.find(x => x.id === "borc-vade").data,
    [{ cardId: "bonus", party: "Bonus", amount: 1000, asset: "TRY", date: "2026-10-20", overdue: true }]);

  assert.match((await d21.call("pay_debt", { card: "Bonus", amount: 100, date: "2026-10-17" })).error, /not be before 2026-10-18/);
  assert.match((await d21.call("pay_debt", { card: "Bonus", amount: 100, date: "2026-10-22" })).error, /not be after today/);
  assert.match((await d21.call("pay_debt", { card: "Bonus", close: true })).error, /close is only for a debt/);
  assert.match((await d21.call("pay_debt", { card: "nakit" })).error, /Cash is not a card/);
  assert.match((await d21.call("pay_debt", { card: "Bonus", person: "Ben" })).error, /only one of debt, person or card \(got person and card\)/);
  assert.equal(stored(sb).debts.length, 0);

  // Ödendi: tutar verilmezse ödemesi gelen ekstreler; TL düşer, gecikme kalkar
  const full = await d21.call("pay_debt", { card: "bonus" });
  assert.deepEqual(full.payment, { id: full.payment.id, date: "2026-10-21", amount: 1000, asset: "TRY" });
  assert.deepEqual([full.card.debt, full.card.unpaid, full.card.overdue, full.card.overdueSince, full.warning], [1000, 0, 0, null, undefined]);
  assert.deepEqual(full.card.statements,
    [{ date: "2026-10-20", amount: 1000, covered: 1000, state: "paid" }, { date: "2026-11-20", amount: 1000, covered: 0, state: "open" }]);
  assert.deepEqual(full.card.payments, [full.payment]);
  assert.deepEqual(await worth(d21), [8000, 0, 1000, 8000, 7000]);
  const row = sb.db.debts.find(r => r.id === full.payment.id);
  assert.deepEqual([row.kind, row.person_id, row.card_id, row.debt_id], ["payment", "ben", "bonus", null]);
  assert.match((await d21.call("pay_debt", { card: "Bonus" })).error, /amount is required: no statement of Bonus is due or cut yet \(next: 1000 TRY so far, due 2026-11-20\)/);

  // Kesilmiş ekstre: tutar verilmezse onun tamamı; ödeme silinince yeniden borç
  const d12 = on("2026-11-12");
  const cut = await d12.call("pay_debt", { card: "Bonus" });
  assert.deepEqual([cut.payment.amount, cut.card.debt, cut.card.statement, cut.warning], [1000, 0, null, undefined]);
  // Önceden ödenen ekstre sıradaki ödemelerden ve kartın sıradaki ödemesinden düşer
  const paidAhead = await d12.call("get_overview");
  assert.deepEqual([paidAhead.upcomingPayments, paidAhead.cards[0].nextPayment], [[], null]);
  assert.equal((await d12.call("list_cards")).cards[0].nextPayment, null);
  const undo = await d12.call("delete_debt_payment", { id: cut.payment.id });
  assert.deepEqual([undo.deleted.amount, undo.card.debt, undo.card.statement], [1000, 1000, { date: "2026-11-20", amount: 1000, alreadyCut: true }]);
  assert.equal(undo.share, undefined);   // kart ödemesi kart payı değildir

  // Kısmi ödeme: kalanı gecikmiş kalır
  const d22 = on("2026-11-22");
  const part = await d22.call("pay_debt", { card: "Bonus", amount: 400 });
  assert.deepEqual([part.card.debt, part.card.unpaid, part.card.overdue, part.card.overdueSince], [600, 600, 600, "2026-11-20"]);
  assert.deepEqual(part.card.statements, [{ date: "2026-11-20", amount: 1000, covered: 400, state: "late" }]);
  assert.deepEqual(await worth(d22), [7600, 0, 600, 7600, 7000]);

  // Borçtan fazlası kartta artı bakiye (alacak); ön ödeme varken otomatiğe dönülmez
  const over = await d22.call("pay_debt", { card: "Bonus", amount: 2000 });
  assert.match(over.warning, /1400 TRY more than the statements due or already cut \(600 TRY\).*1400 TRY is more than the card's whole debt/);
  assert.deepEqual([over.card.debt, over.card.credit, over.card.overdue], [0, 1400, 0]);
  assert.deepEqual(await worth(d22), [5600, 1400, 0, 7000, 7000]);
  assert.equal((await d22.call("list_debts")).totals.receivablesByKind.cardCredit, 1400);
  // Kartta artı bakiye alacaklarla listelenir: listelenen alacaklar receivablesTry'ye eşit
  const owed = await d22.call("list_debts", { side: "receivable" });
  assert.deepEqual([owed.totals.receivablesTry, owed.cardCredit, owed.cards, owed.shares, owed.debts],
    [1400, [{ cardId: "bonus", card: "Bonus", credit: 1400 }], [], [], []]);
  assert.deepEqual((await d22.call("list_debts", { side: "debt" })).cardCredit, []);
  assert.match((await d22.call("update_card", { card: "Bonus", auto_pay: true })).error,
    /Bonus can't go back to automatic yet: 1000 TRY of its recorded card payments would stop counting.*raising Ben's lira balance.*delete_debt_payment/);
  assert.equal(stored(sb).cards[0].manualSince, "2026-10-18");
  // Takip dışıyken otomatiğe dönülmez (elle mod korunur); yeniden takipte otomatiğe dönüşte ön ödeme yine denetlenir
  assert.match((await d22.call("update_card", { card: "Bonus", track_statements: false, auto_pay: true })).error,
    /auto_pay true needs the card's statements tracked: Bonus stays paid by hand while not tracked/);
  assert.equal((await d22.call("update_card", { card: "Bonus", track_statements: false })).card.tracking, null);
  assert.equal(stored(sb).cards[0].manualSince, "2026-10-18");
  assert.match((await d22.call("update_card", { card: "Bonus", track_since: "2026-09-01", auto_pay: true })).error,
    /Bonus can't go back to automatic yet: 1000 TRY/);
  const retracked = await d22.call("update_card", { card: "Bonus", track_since: "2026-09-01" });
  assert.deepEqual([retracked.card.tracking.autoPay, retracked.card.tracking.manualSince], [false, "2026-10-18"]);
  assert.deepEqual(await worth(d22), [5600, 1400, 0, 7000, 7000]);
  await d22.call("delete_debt_payment", { id: over.payment.id });

  // Otomatiğe dönüş: gecikmiş kalan ödenmiş sayılır (bakiyeden düşer), kaydedilen ödemeler ikinci kez düşmez
  const back = await d22.call("update_card", { card: "Bonus", auto_pay: true });
  assert.match(back.note, /^1 overdue statement\(s\) \(600 TRY\) now count as paid, deducted from Ben's lira balance/);
  assert.deepEqual([back.balanceChangeTry, back.card.tracking], [-600, { since: "2026-09-01", autoPay: true, unpaid: 0, overdue: 0 }]);
  assert.equal(stored(sb).cards[0].manualSince, undefined);
  assert.deepEqual(await worth(d22), [7000, 0, 0, 7000, 7000]);
  assert.match((await d22.call("pay_debt", { card: "Bonus", amount: 100 })).error, /paid automatically .*update_card auto_pay false/);

  // Takip dışı kartta elle mod ve Ödendi yok; takip aynı çağrıda açılırken elle mod takibin başladığı günden
  await c.call("add_card", { name: "World", cutoff_day: 25, due_day: 5 });
  await c.call("update_card", { card: "World", track_statements: false });
  assert.match((await c.call("pay_debt", { card: "World", amount: 100 })).error, /World's statements are not tracked/);
  assert.match((await c.call("update_card", { card: "World", auto_pay: false })).error, /needs the card's statements tracked/);
  const restart = await c.call("update_card", { card: "World", track_since: "2026-09-01", auto_pay: false });
  assert.deepEqual([restart.card.tracking.since, restart.card.tracking.manualSince], ["2026-09-01", "2026-09-01"]);
  const added = await c.call("add_card", { name: "Axess", cutoff_day: 1, due_day: 10, auto_pay: false });
  assert.deepEqual(added.card.tracking, { since: "2026-10-18", autoPay: false, unpaid: 0, overdue: 0, manualSince: "2026-10-18", overdueSince: null });

  // Kart silinince ödemeleri de gider; düşülen ekstreler bakiyeye döner
  const del = await d22.call("delete_card", { card: "Bonus" });
  assert.deepEqual([del.deletedPurchases, del.deletedPayments, del.balanceChangeTry], [1, 2, 3000]);
  assert.deepEqual(stored(sb).debts, []);
  assert.ok(sb.db.debts.every(r => r.deleted_at));
  assert.deepEqual(await worth(d22), [10000, 0, 0, 10000, 10000]);
  assert.match((await d22.call("delete_debt_payment", { id: full.payment.id })).error, /list_cards \(payments\)/);
});

test("elle ödenen kart: sıradaki ödemeler ekstrelerden (süresiz tekrarın ileriki tekrarları dahil); bugün ödeme varken elle moda geçilmez; takibin başından elle modda ön ödeme engel değil; takibin başından geçişte notu", async () => {
  const sb = fakeSupabase();
  // Kesim 12, son ödeme 22. Bonus 1 Eki'den beri takipte ve elle: Netflix 500 her ay (10 Eyl'den, süresiz), TV 1.000 (1 Kas)
  // → 22 Eki 500, 22 Kas 1.500 (10 Kas tekrarı dahil), sonra her ay 500. World otomatik: kulaklık 600 → 22 Eki.
  // Axess 1 Kas'tan beri takipte ve elle: telefon 3.000 → 22 Kas
  seed(sb, {
    people: [{ id: "ben", name: "Ben", color: 0 }],
    cards: [
      { id: "bonus", name: "Bonus", limit: 50000, cutoffDay: 12, dueDay: 22, color: 0, trackSince: "2026-10-01", manualSince: "2026-10-01" },
      { id: "world", name: "World", limit: 50000, cutoffDay: 12, dueDay: 22, color: 1, trackSince: "2026-10-01" },
      { id: "axess", name: "Axess", limit: 50000, cutoffDay: 12, dueDay: 22, color: 2, trackSince: "2026-11-01", manualSince: "2026-11-01" },
    ],
    installments: [
      { id: "netflix", personId: "ben", cardId: "bonus", desc: "Netflix", total: 500, count: 1, date: "2026-09-10", repeat: 0 },
      { id: "tv", personId: "ben", cardId: "bonus", desc: "TV", total: 1000, count: 1, date: "2026-11-01" },
      { id: "kulaklik", personId: "ben", cardId: "world", desc: "Kulaklık", total: 600, count: 1, date: "2026-10-05" },
      { id: "tel", personId: "ben", cardId: "axess", desc: "Telefon", total: 3000, count: 1, date: "2026-11-03" },
    ],
    entries: [{ id: "e1", personId: "ben", asset: "TRY", amount: 20000, desc: "Maaş", date: "2026-09-01" }],
  });
  const on = day => client(sb, "good", { now: () => new Date(`${day}T09:00:00Z`) });
  const d5 = on("2026-11-05");
  const bonus = (x = {}) => ({ card: "Bonus", byPerson: { Ben: x.total }, ...x });

  // Gecikmiş 22 Eki en üstte; 22 Kas ekstresine 10 Kas'taki Netflix tekrarı da girer
  const ov = await d5.call("get_overview");
  assert.deepEqual(ov.upcomingPayments, [
    bonus({ date: "2026-10-22", total: 500, late: true }),
    bonus({ date: "2026-11-22", total: 1500 }),
    { date: "2026-11-22", card: "Axess", total: 3000, byPerson: { Ben: 3000 } },
    bonus({ date: "2026-12-22", total: 500 }),
    bonus({ date: "2027-01-22", total: 500 }),
  ]);
  assert.deepEqual(ov.cards.map(x => x.nextPayment), [{ date: "2026-11-22", amount: 1500 }, null, { date: "2026-11-22", amount: 3000 }]);

  // Ödendi 1.000: 22 Eki kapanır, 22 Kas'ın 500'ü ödenir (covered); kalan kısmı sıradaki ödeme
  await d5.call("pay_debt", { card: "Bonus", amount: 1000 });
  const paid = await d5.call("get_overview");
  assert.deepEqual(paid.upcomingPayments.slice(0, 3), [
    { ...bonus({ date: "2026-11-22", total: 1000 }), covered: 500 },
    { date: "2026-11-22", card: "Axess", total: 3000, byPerson: { Ben: 3000 } },
    bonus({ date: "2026-12-22", total: 500 }),
  ]);
  assert.deepEqual((await d5.call("list_cards")).cards[0].nextPayment, { date: "2026-11-22", amount: 1000 });

  // Otomatiğe dönüş (kaybolan ödeme yok); aynı gün elle moda geri dönülmez (bugünkü ödeme ikinci kez düşerdi), ertesi gün olur
  const auto = await d5.call("update_card", { card: "Bonus", auto_pay: true });
  assert.deepEqual([auto.balanceChangeTry, auto.card.tracking.autoPay], [0, true]);
  assert.match((await d5.call("update_card", { card: "Bonus", auto_pay: false })).error, /A payment on Bonus is dated today.*Switch to paid by hand tomorrow/);
  assert.equal(stored(sb).cards[0].manualSince, undefined);
  const d6 = on("2026-11-06");
  const man = await d6.call("update_card", { card: "Bonus", auto_pay: false });
  assert.deepEqual([man.balanceChangeTry, man.card.tracking.manualSince, man.card.tracking.unpaid], [0, "2026-11-06", 0]);
  assert.match(man.note, /^From 2026-11-06 .* Earlier statements stay paid\.$/);

  // Takibin başından elle modda (Axess) kesilmemiş ekstreyi önceden ödemek otomatiğe dönüşü engellemez: bakiye değişmez
  await d5.call("pay_debt", { card: "Axess", amount: 3000 });
  const axess = await d5.call("update_card", { card: "Axess", auto_pay: true });
  assert.deepEqual([axess.balanceChangeTry, axess.card.tracking.autoPay], [0, true]);

  // Elle moda takibin yeni başından geçiş: o günden beri ödenmiş sayılan ekstre ödenmemiş olur (not bunu söyler)
  const world = await d5.call("update_card", { card: "World", auto_pay: false, track_since: "2026-09-15" });
  assert.equal(world.balanceChangeTry, 600);
  assert.deepEqual(world.card.tracking, { since: "2026-09-15", autoPay: false, unpaid: 600, overdue: 600, manualSince: "2026-09-15", overdueSince: "2026-10-22" });
  assert.match(world.note, /1 statement\(s\) due since 2026-09-15 \(600 TRY\) are now unpaid: they stay owed until marked paid \(overdue since 2026-10-22\)\.$/);
  assert.doesNotMatch(world.note, /Earlier statements stay paid/);

  // Hesaba katılmayan kart bugün yeniden takibe alınmaz: bugünkü ödemenin ödediği ekstre takipten önce kalır, ödeme sonraki
  // ekstreleri kapatırdı. Ertesi gün olur (o günden takipte; önceki gün ödemesi sayılmaz)
  await d5.call("update_card", { card: "Axess", track_statements: false });
  assert.match((await d5.call("update_card", { card: "Axess", track_statements: true })).error, /A payment on Axess is dated today.*Turn tracking on tomorrow/);
  assert.equal(stored(sb).cards.find(x => x.id === "axess").trackOff, true);
  const back = await d6.call("update_card", { card: "Axess", track_statements: true });
  assert.deepEqual([back.card.tracking.since, back.card.tracking.autoPay], ["2026-11-06", true]);
});

test("elle ödenen kredi: taksit günü geçince gecikir, Ödendi ile kapanır; ödeme modu geçmiş taksit varken değişmez", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_entry", { asset: "TRY", direction: "in", amount: 10000, description: "Maaş", date: "2026-10-01" });
  const worth = async (cl = c) => {
    const a = await cl.call("get_assets");
    assert.equal(a.totalAssetsTry, a.netWorthTry + a.debtsTry);
    return [a.totalTry, a.receivablesTry, a.debtsTry, a.totalAssetsTry, a.netWorthTry];
  };
  // Takipten önceki taksitli kredi elle modda da ana parayla girilemez
  assert.match((await c.call("add_debt", { type: "loan", amount: 1000, installments: 3, due_date: "2026-09-05", date: "2026-10-01", principal: 2000, auto_pay: false })).error,
    /principal can only be given when date/);

  // 2.700 çekildi, 3 × 1.000 (5 Eki, Kas, Ara); 5 Eki taksiti ödenmedi
  const added = await c.call("add_debt", { type: "loan", party: "Garanti", amount: 1000, installments: 3, due_date: "2026-10-05", date: "2026-10-01", principal: 2700, auto_pay: false });
  const loan = added.debt;
  assert.deepEqual([loan.autoPay, loan.remaining, loan.overdue, loan.overdueSince, loan.paid], [false, 3000, 1000, "2026-10-05", 0]);
  assert.match(added.preview.note, /paid by hand: each installment is paid only when recorded with pay_debt/);
  assert.equal(stored(sb).debts[0].autoPay, false);
  assert.equal(sb.db.debts[0].auto_pay, false);
  assert.deepEqual(await worth(), [12700, 0, 3000, 12700, 9700]);   // otomatikte 11.700 TL, 2.000 borç
  assert.deepEqual((await c.call("get_insights")).insights.find(x => x.id === "borc-vade").data,
    [{ debtId: loan.id, party: "Garanti", amount: 1000, asset: "TRY", date: "2026-10-05", overdue: true }]);

  // Mod kilidi: 5 Eki taksiti kayıt tarihiyle bugün arasında
  assert.match((await c.call("update_debt", { id: loan.id, auto_pay: true })).error, /payment mode can't change: this loan has installments between its date \(2026-10-01\) and today/);
  assert.equal(stored(sb).debts[0].autoPay, false);

  // Ödendi: ilk taksitten kapatır
  const paid = await c.call("pay_debt", { debt: loan.id, amount: 1000 });
  assert.deepEqual([paid.debt.overdue, paid.debt.remaining, paid.debt.nextPayment], [0, 2000, { date: "2026-11-05", amount: 1000, installment: "2/3" }]);
  assert.deepEqual(await worth(), [11700, 0, 2000, 11700, 9700]);
  const nov = client(sb, "good", { now: () => new Date("2026-11-06T09:00:00Z") });
  const late = await nov.call("get_debt", { id: loan.id });
  assert.deepEqual([late.overdue, late.overdueSince], [1000, "2026-11-05"]);
  assert.deepEqual(late.schedule.map(x => [x.date, x.covered, x.state]), [["2026-10-05", 1000, "paid"], ["2026-11-05", 0, "late"], ["2026-12-05", 0, "open"]]);
  assert.deepEqual(await worth(nov), [11700, 0, 2000, 11700, 9700]);

  // Taksiti henüz gelmemiş kredinin modu değişir; varsayılan otomatik
  const fresh = (await c.call("add_debt", { type: "loan", party: "Akbank", amount: 500, installments: 2, due_date: "2026-11-01" })).debt;
  assert.equal(fresh.autoPay, true);
  const switched = await c.call("update_debt", { id: fresh.id, auto_pay: false });
  assert.equal(switched.debt.autoPay, false);
  assert.match((await c.call("get_debt", { id: fresh.id })).preview.note, /paid by hand/);
  assert.equal((await c.call("update_debt", { id: fresh.id, auto_pay: true })).debt.autoPay, true);
  assert.equal(stored(sb).debts.find(d => d.id === fresh.id).autoPay, undefined);
});

test("borç silme zincirleri; yalnızca değişen borç satırları yazılır", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  const ayse = (await c.call("add_person", { name: "Ayşe" })).person;
  const a = (await c.call("add_debt", { type: "borrowed", party: "Mehmet", amount: 1000, date: "2026-10-01" })).debt;
  await c.call("add_debt", { type: "lent", party: "Ali", amount: 500, person: "Ayşe" });

  sb.calls.length = 0;
  const pay = await c.call("pay_debt", { debt: a.id, amount: 300 });
  let writes = sb.calls.filter(x => x.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/rest/v1/debts");
  assert.deepEqual(writes[0].body.map(r => [r.id, r.debt_id, r.person_id]), [[pay.payment.id, a.id, "ben"]]);

  // Sahibi değişince ödemeleri de aynı yazmada taşınır
  sb.calls.length = 0;
  await c.call("update_debt", { id: a.id, person: "Ayşe" });
  writes = sb.calls.filter(x => x.method !== "GET");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.map(r => [r.id, r.person_id]).sort(), [[a.id, ayse.id], [pay.payment.id, ayse.id]].sort());

  // Borç silinince ödemeleri de gider (satırlar silindi olarak işaretlenir)
  const v = (await c.call("add_debt", { type: "lent", party: "Veli", amount: 200 })).debt;
  await c.call("pay_debt", { debt: v.id, amount: 50 });
  assert.equal((await c.call("delete_debt", { id: v.id })).deletedPayments, 1);
  assert.ok(sb.db.debts.filter(r => r.id === v.id || r.debt_id === v.id).every(r => r.deleted_at));

  // Kişi silinince borçları ve onların ödemeleri gider
  const gone = await c.call("delete_person", { person: "Ayşe" });
  assert.deepEqual([gone.deletedDebts, gone.deletedPurchases, gone.deletedEntries, gone.deletedCardPayments, gone.deletedSharePayments], [2, 0, 0, 0, 0]);
  assert.deepEqual(stored(sb).debts, []);
  assert.ok(sb.db.debts.every(r => r.deleted_at));

  // İlk kişi (kartları ödeyen) silinirse ona yapılan kart payı ödemeleri ve yaptığı kart ekstresi ödemeleri de gider
  await c.call("add_card", { name: "A", cutoff_day: 10, due_day: 20, auto_pay: false });
  await c.call("add_person", { name: "Annem" });
  const share = await c.call("pay_debt", { person: "Annem", amount: 100 });
  assert.match(share.warning, /more than their card share/);
  assert.equal((await c.call("list_people")).people[1].owesUser, -100);
  await c.call("pay_debt", { card: "A", amount: 50 });
  const payer = await c.call("delete_person", { person: "Ben" });
  assert.deepEqual([payer.deletedDebts, payer.deletedCardPayments, payer.deletedSharePayments], [0, 1, 1]);
  assert.deepEqual(stored(sb).debts, []);
});

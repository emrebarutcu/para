import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server.js";

const NOW = () => new Date("2026-10-18T09:00:00Z");
const ORIGIN = "https://cashfollow.app";

// Bellekte Supabase: auth/v1/user ve kullanılan PostgREST uçları (RLS: yalnızca token sahibinin satırları)
function fakeSupabase({ users = { good: { id: "u1", email: "a@b.c" }, other: { id: "u2", email: "x@y.z" } } } = {}) {
  const db = { cashflow_data: [], inbox_messages: [], inbox_addresses: [] };
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 18, 9, 0, 0, ++clock)).toISOString().replace("Z", "+00:00");
  const calls = [];
  const hooks = { beforePatch: null };

  const fn = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    const token = (init.headers?.Authorization || "").replace("Bearer ", "");
    calls.push({ method, path: url.pathname, search: url.search });
    const user = users[token];
    const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });

    if (url.pathname === "/auth/v1/user") return user ? reply(user) : reply({ msg: "bad jwt" }, 403);
    if (!user) return reply({ message: "JWT expired" }, 401);

    const table = url.pathname.replace("/rest/v1/", "");
    const rows = db[table];
    if (!rows) return reply({ code: "PGRST205" }, 404);
    const filters = [...url.searchParams].filter(([k]) => !["select", "order", "limit"].includes(k));
    const match = r => r.user_id === user.id && filters.every(([k, v]) => {
      if (v === "is.null") return r[k] == null;
      if (v.startsWith("eq.")) return String(r[k]) === v.slice(3);
      if (v.startsWith("in.(")) return v.slice(4, -1).split(",").map(Number).includes(r[k]);
      throw new Error("filter " + v);
    });
    const body = init.body ? JSON.parse(init.body) : null;

    if (method === "GET") return reply(structuredClone(rows.filter(match)));
    if (method === "POST") {
      if (body.user_id !== user.id) return reply({ message: "rls" }, 403);
      if (table === "cashflow_data") {
        if (rows.some(r => r.user_id === user.id)) return reply({ code: "23505" }, 409);
        rows.push({ ...body, updated_at: stamp() });
        return reply(null, 201);
      }
      if (table === "inbox_addresses") {
        const row = { user_id: user.id, address: crypto.randomUUID().replace(/-/g, "").slice(0, 12) };
        rows.push(row);
        return reply([{ address: row.address }], 201);
      }
    }
    if (method === "PATCH") {
      if (hooks.beforePatch) { const h = hooks.beforePatch; hooks.beforePatch = null; h(); }
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, body, table === "cashflow_data" ? { updated_at: stamp() } : {});
      return reply(structuredClone(hit));
    }
    if (method === "DELETE") {
      db[table] = rows.filter(r => !match(r));
      return reply(null, 204);
    }
    return reply({}, 405);
  };
  return { fetch: fn, db, calls, hooks, stamp };
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

const stored = sb => sb.db.cashflow_data.find(r => r.user_id === "u1")?.data;

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
  assert.ok(data._v > 0);

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

test("başka cihaz araya yazarsa değişiklik kaybolmadan yeniden denenir", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_card", { name: "A", cutoff_day: 12, due_day: 22 });
  // Uygulama, MCP okuduktan sonra ama yazmadan önce bir kişi ekliyor
  sb.hooks.beforePatch = () => {
    const row = sb.db.cashflow_data[0];
    row.data = { ...row.data, people: [...row.data.people, { id: "app", name: "Uygulamadan", color: 1 }] };
    row.updated_at = sb.stamp();
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

test("dışa / içe aktarma", async () => {
  const sb = fakeSupabase();
  const c = client(sb);
  await c.call("add_person", { name: "Ali" });
  const backup = await c.call("export_data");
  assert.deepEqual(backup.people.map(p => p.name), ["Ben", "Ali"]);

  // Eski sürüm yedeği (statement alanlı) uygulamadaki gibi taşınır
  const out = await c.call("import_data", { data: { people: [{ id: "ben", name: "Ben", color: 0 }], installments: [{ id: "x", personId: "ben", desc: "Eski", statement: "2026-09", count: 3, total: 300 }], dueDay: 22 } });
  assert.deepEqual(out, { imported: true, people: 1, cards: 1, purchases: 1 });
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

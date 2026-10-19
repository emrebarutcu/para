// ---------- CashFollow MCP araçları ----------
// Ön yüzdeki çekirdek işlemler (özet, akış, harcama / kart / kişi, banka e-postaları, yedek) LLM'lere araç
// olarak açılır. Hesaplar uygulamayla aynı modüllerden (taksit.js, eposta.js) gelir; doğrulama kuralları
// app.js'teki formlarla aynıdır. Araçlar kullanıcının verisine yalnızca ctx üzerinden erişir (bkz. server.js):
//   ctx.today            "YYYY-MM-DD" (Türkiye saati)
//   ctx.load()           → hydrate edilmiş veri
//   ctx.mutate(fn)       → fn(veri) çalışır, değişen kişi / kart / harcamalar kaydedilir
//   ctx.inbox            → pending(), claim(ids), release(ids), address(renew)
import T from "../taksit.js";
import E from "../eposta.js";

export const TIME_ZONE = "Europe/Istanbul";
const MAX_MONTHS = 60;       // akıştaki en fazla ay (app.js ile aynı)
const MAX_COUNT = 60;        // en fazla taksit (formdaki sınır)
const UPCOMING = 5;          // özetteki yaklaşan ödeme sayısı
const BODY_LIMIT = 4000;     // list_inbox'ta döndürülen e-posta metninin uzunluğu

// Kullanıcıya (LLM'e) isError ile dönen hata; diğer hatalar sunucu hatasıdır
export class ToolError extends Error {}
function fail(message) { throw new ToolError(message); }

const round = n => Math.round((n || 0) * 100) / 100;

export function todayKey(now = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function uid() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => (b % 36).toString(36)).join("");
}

// ---------- Argümanlar ----------
function text(v, name) {
  if (typeof v !== "string") fail(`${name} must be a string`);
  return v.trim();
}

function validDate(s) {
  const d = T.parseDate(s);
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(s) && d.day >= 1 && d.day <= T.daysInMonth(d.idx) && Number(s.slice(5, 7)) <= 12;
}

function monthArg(v, name, today) {
  if (v == null || v === "") return T.parseDate(today).idx;
  if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) fail(`${name} must be a month like "2026-10"`);
  return T.monthIndex(v);
}

function intArg(v, name, min, max, fallback) {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

// ---------- Kişi / kart bulma ----------
function personById(state, id) { return state.people.find(p => p.id === id); }
function cardById(state, id) { return state.cards.find(c => c.id === id); }
function cardName(state, id) { return cardById(state, id)?.name ?? "Nakit"; }
function personName(state, id) { return personById(state, id)?.name ?? "?"; }
const list = items => items.map(x => `"${x.name}" (${x.id})`).join(", ");

// Kimlik ya da ad (büyük/küçük harf ve Türkçe harf duyarsız)
function findPerson(state, ref) {
  const s = String(ref ?? "").trim();
  return personById(state, s)
    ?? state.people.find(p => T.normalize(p.name) === T.normalize(s))
    ?? fail(`Unknown person "${s}". People: ${list(state.people)}`);
}

// Kimlik, ad ya da son 4 hane; "nakit" / "cash" → null (kartsız)
function findCard(state, ref) {
  if (ref === null) return null;
  const s = String(ref ?? "").trim();
  if (["nakit", "cash", "none", ""].includes(T.normalize(s))) return null;
  return cardById(state, s)
    ?? state.cards.find(c => T.normalize(c.name) === T.normalize(s))
    ?? (/^\d{4}$/.test(s) ? state.cards.find(c => c.last4 === s) : null)
    ?? fail(`Unknown card "${s}". Cards: ${state.cards.length ? list(state.cards) : "none"} — use "nakit" for cash / debit card.`);
}

function findPurchase(state, id) {
  return state.installments.find(p => p.id === String(id ?? "")) ?? fail(`No purchase with id "${id}". Use list_purchases to find ids.`);
}

// Kart belirtilmezse: tek kart varsa o, hiç yoksa nakit; birden çok kartta LLM sormalı
function defaultCardFor(state) {
  if (state.cards.length <= 1) return state.cards[0] ?? null;
  fail(`The user has several cards; pass card (one of ${list(state.cards)}, or "nakit").`);
}

// ---------- Görünümler ----------
function knownPurchases(state) {
  const known = new Set(state.people.map(p => p.id));
  return state.installments.filter(p => known.has(p.personId));
}

function paymentsOf(state, p) { return T.payments(p, cardById(state, p.cardId)); }

function lastPaymentIndex(state) {
  let last = -Infinity;
  for (const p of knownPurchases(state)) {
    const pays = paymentsOf(state, p);
    if (pays.length) last = Math.max(last, pays[pays.length - 1].idx);
  }
  return last;
}

const byName = (state, map, nameOf) =>
  Object.fromEntries(Object.entries(map).map(([id, v]) => [nameOf(state, id), round(v)]));
const cardKeyName = (state, key) => (key === T.CASH ? "Nakit" : cardName(state, key));

function purchaseView(state, p, today, { schedule = false } = {}) {
  const card = cardById(state, p.cardId);
  const pays = T.payments(p, card);
  const plan = T.planLength(p);
  const per = T.perInstallment(p);
  const left = pays.filter(x => x.key >= today);
  const v = {
    id: p.id,
    description: p.desc,
    person: personName(state, p.personId),
    personId: p.personId,
    card: card ? card.name : "Nakit",
    cardId: card ? card.id : null,
    date: p.date ?? null,
    total: round(p.total),
    installments: plan,
    perInstallment: round(per),
    paidInstallments: plan - left.length,
    remainingInstallments: left.length,
    remainingAmount: round(left.length * per),
    nextPayment: left[0] ? { date: left[0].key, amount: round(left[0].amount) } : null,
    lastPaymentDate: pays.length ? pays[pays.length - 1].key : null,
    status: left.length ? "active" : "done",
  };
  if (!p.date) {
    // Excel'den gelen tarihsiz kayıt: total/count kalan taksitlerdir
    v.firstDueMonth = p.firstDue;
    v.remainingTotalAtImport = v.total;
    v.total = round(T.originalTotal(p));
  }
  if (card && p.date) v.statementCutoff = T.dateKey(T.statementIndex(card, p.date), card.cutoffDay);
  if (schedule) v.payments = pays.map(x => ({ no: x.no, date: x.key, amount: round(x.amount), paid: x.key < today }));
  return v;
}

function cardView(state, c, today) {
  const known = new Set(state.people.map(p => p.id));
  const mine = state.installments.filter(p => p.cardId === c.id && known.has(p.personId));
  const pays = mine.flatMap(p => T.payments(p, c));
  const upcoming = pays.filter(x => x.key >= today);
  const next = upcoming.reduce((min, x) => (!min || x.key < min ? x.key : min), null);
  const used = T.outstanding(pays, today);
  const s = T.statementIndex(c, today);
  return {
    id: c.id,
    name: c.name,
    last4: c.last4 ?? null,
    limit: round(c.limit),
    used: round(used),
    available: c.limit ? round(c.limit - used) : null,
    cutoffDay: c.cutoffDay,
    dueDay: c.dueDay,
    nextPayment: next ? { date: next, amount: round(upcoming.filter(x => x.key === next).reduce((t, x) => t + x.amount, 0)) } : null,
    purchaseCount: mine.length,
    purchaseToday: { statementCutoff: T.dateKey(s, c.cutoffDay), dueDate: T.dateKey(T.dueIndex(c, s), c.dueDay) },
  };
}

function eventView(state, ev, { items = true } = {}) {
  const v = {
    date: ev.date,
    card: ev.cardId ? cardName(state, ev.cardId) : "Nakit",
    total: round(ev.total),
    byPerson: byName(state, ev.byPerson, personName),
  };
  if (items) {
    v.items = ev.items.map(x => ({
      purchaseId: x.purchase.id,
      description: x.purchase.desc,
      person: personName(state, x.purchase.personId),
      installment: `${x.no}/${T.planLength(x.purchase)}`,
      amount: round(x.amount),
    }));
  }
  return v;
}

// Kesim ve ödeme önizlemesi (formdaki önizlemeyle aynı bilgiler)
function preview(state, p) {
  const card = cardById(state, p.cardId);
  const pays = T.payments(p, card);
  const out = {
    perInstallment: round(T.perInstallment(p)),
    firstPayment: pays[0]?.key ?? null,
    lastPayment: pays.length ? pays[pays.length - 1].key : null,
  };
  if (card && p.date) out.statementCutoff = T.dateKey(T.statementIndex(card, p.date), card.cutoffDay);
  if (!card) out.note = p.count > 1 ? "Cash — paid each month on the purchase day" : "Cash — paid on the purchase day";
  return out;
}

// ---------- Harcama / kart / kişi kuralları (app.js formlarıyla aynı) ----------
// base: düzenlenen harcama ya da e-postadan gelen taslak; verilmeyen alanlar ondan alınır
function buildPurchase(state, args, today, base = null) {
  const desc = args.description !== undefined ? text(args.description, "description") : base?.desc;
  if (!desc) fail("description is required (what was bought).");

  const count = intArg(args.installments, "installments", 1, MAX_COUNT, base?.count ?? 1);

  let total = base?.total;
  if (args.amount !== undefined) {
    const amount = Number(args.amount);
    if (!(amount > 0)) fail("amount must be a positive number.");
    if (args.amount_type !== undefined && !["total", "per_installment"].includes(args.amount_type)) {
      fail('amount_type must be "total" or "per_installment".');
    }
    total = args.amount_type === "per_installment" ? round(amount * count) : round(amount);
  }
  if (!(total > 0)) fail("amount is required.");

  let date = args.date !== undefined ? args.date : base ? base.date : today;
  if (date === null || date === "") date = undefined;
  if (date !== undefined && (typeof date !== "string" || !validDate(date))) fail('date must be a valid date like "2026-10-18".');
  if (!date && !base?.firstDue) fail("date is required.");

  const person = args.person !== undefined ? findPerson(state, args.person)
    : (base?.personId && personById(state, base.personId)) || state.people[0];
  if (!person) fail("Add a person first (add_person).");

  const card = args.card !== undefined ? findCard(state, args.card)
    : base ? cardById(state, base.cardId) ?? null
    : defaultCardFor(state);

  const p = { desc, cardId: card ? card.id : null, count, total };
  if (date) {
    p.date = date;
  } else {
    // Excel'den gelen tarihsiz kayıt: ödeme ayı ve plan korunur
    p.firstDue = base.firstDue;
    if (base.planCount) p.planCount = base.planCount;
  }
  return { personId: person.id, p };
}

function buildCard(state, args, base = null) {
  const v = {
    name: args.name !== undefined ? text(args.name, "name") : base?.name,
    limit: args.limit !== undefined ? Number(args.limit) : base?.limit ?? 0,
    cutoffDay: args.cutoff_day !== undefined ? T.validDay(args.cutoff_day) : base?.cutoffDay,
    dueDay: args.due_day !== undefined ? T.validDay(args.due_day) : base?.dueDay,
    last4: args.last4 !== undefined ? String(args.last4 ?? "").replace(/\D/g, "") : base?.last4 ?? "",
  };
  if (!v.name) fail("name is required.");
  if (!(v.limit >= 0)) fail("limit must be zero or a positive number.");
  if (!v.cutoffDay) fail("cutoff_day (hesap kesim günü) must be a day between 1 and 31.");
  if (!v.dueDay) fail("due_day (son ödeme günü) must be a day between 1 and 31.");
  if (v.last4 && v.last4.length !== 4) fail("last4 must be exactly 4 digits.");
  if (v.last4 && state.cards.some(c => c.id !== base?.id && c.last4 === v.last4)) fail(`Another card already has last4 ${v.last4}.`);
  const { last4, ...rest } = v;
  return last4 ? { ...rest, last4 } : rest;
}

function personNameArg(state, v, exceptId) {
  const name = text(v ?? "", "name");
  if (!name) fail("name is required.");
  if (state.people.some(p => p.id !== exceptId && T.normalize(p.name) === T.normalize(name))) fail(`A person named "${name}" already exists.`);
  return name;
}

// ---------- E-postadan harcama (app.js ile aynı eşleştirme) ----------
function emailCard(state, parsed) {
  if (parsed.last4) return state.cards.find(c => c.last4 === parsed.last4) ?? null;
  return state.cards.length === 1 ? state.cards[0] : null;
}

function emailPurchase(parsed, card) {
  return { desc: parsed.merchant || "Kart harcaması", cardId: card?.id ?? null, count: parsed.count, total: parsed.amount, date: parsed.date };
}

function emailItem(state, row) {
  const parsed = E.parse({ body: row.body, subject: row.subject, receivedAt: row.received_at });
  const card = emailCard(state, parsed);
  const reason = parsed.reason
    || (card ? null : parsed.last4 ? `No card with last4 ${parsed.last4}` : "Card could not be read");
  return { row, parsed, card, reason };
}

function emailView(x, { body = false } = {}) {
  const { row, parsed, card, reason } = x;
  const v = {
    emailId: row.id,
    receivedAt: row.received_at,
    sender: row.sender ?? null,
    subject: row.subject ?? null,
    parsed: {
      amount: parsed.amount, currency: parsed.currency, date: parsed.date, installments: parsed.count,
      merchant: parsed.merchant, cardLast4: parsed.last4, refund: parsed.refund,
    },
    matchedCard: card ? card.name : null,
    needsReview: reason,
  };
  if (body) {
    const plain = E.plainText(row.body);
    v.body = plain.length > BODY_LIMIT ? plain.slice(0, BODY_LIMIT) + "…" : plain;
  }
  return v;
}

// ---------- Şema yardımcıları ----------
const S = {
  str: description => ({ type: "string", description }),
  int: (description, minimum, maximum) => ({ type: "integer", description, minimum, maximum }),
  num: description => ({ type: "number", description }),
  bool: description => ({ type: "boolean", description }),
  month: description => ({ type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$", description }),
  date: description => ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description }),
};
const obj = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });

const PURCHASE_FIELDS = {
  description: S.str("What was bought (shown as the purchase title)."),
  amount: S.num("Amount in TRY. The purchase total, unless amount_type is per_installment."),
  amount_type: { type: "string", enum: ["total", "per_installment"], description: 'How to read amount. Default "total".' },
  installments: S.int("Number of installments (taksit), 1 = single payment (peşin).", 1, MAX_COUNT),
  date: S.date("Purchase date, YYYY-MM-DD. Decides which statement (ekstre) it falls into."),
  card: { type: ["string", "null"], description: 'Card id, name or last 4 digits; "nakit" (or null) for cash / debit card.' },
  person: S.str("Person id or name the purchase belongs to."),
};
const CARD_FIELDS = {
  name: S.str("Card name, e.g. bank name."),
  limit: S.num("Credit limit in TRY (0 = unknown)."),
  cutoff_day: S.int("Statement cutoff day of month (hesap kesim günü).", 1, 31),
  due_day: S.int("Payment due day of month (son ödeme günü).", 1, 31),
  last4: S.str('Last 4 digits of the card (used to match bank e-mails). "" removes it.'),
};

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTROY = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

// ---------- Araçlar ----------
export const TOOLS = [
  // ── Özet / akış ──
  {
    name: "get_overview",
    title: "Overview (Özet)",
    description: "Dashboard summary like the app's Özet tab: amount due in the month, next month's total, remaining total, the next upcoming payments, per-person and per-card figures.",
    inputSchema: obj({ month: S.month("Month to summarize, YYYY-MM. Default: current month.") }),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const today = ctx.today;
      const start = monthArg(args.month, "month", today);
      const last = lastPaymentIndex(state);
      const end = Math.min(last, start + MAX_MONTHS - 1);
      const months = end >= start ? T.buildCashflow(state.people, state.cards, state.installments, start, end) : [];
      const at = idx => months.find(m => m.idx === idx);
      const thisMonth = at(start);

      const from = T.parseDate(today).idx;
      const upcoming = last >= from
        ? T.buildCashflow(state.people, state.cards, state.installments, from, Math.min(last, from + 24))
          .flatMap(m => m.events).filter(e => e.date >= today).slice(0, UPCOMING)
        : [];
      return {
        today,
        month: T.monthKey(start),
        dueThisMonth: round(thisMonth?.total),
        dueThisMonthByPerson: byName(state, thisMonth?.byPerson ?? {}, personName),
        dueThisMonthByCard: byName(state, thisMonth?.byCard ?? {}, cardKeyName),
        nextMonth: { month: T.monthKey(start + 1), total: round(at(start + 1)?.total) },
        remainingTotal: round(months.reduce((s, m) => s + m.total, 0)),
        lastPaymentMonth: months.length ? T.monthKey(months[months.length - 1].idx) : null,
        upcomingPayments: upcoming.map(ev => eventView(state, ev, { items: false })),
        people: state.people.map(p => ({
          name: p.name,
          dueThisMonth: round(thisMonth?.byPerson[p.id]),
          remaining: round(months.reduce((s, m) => s + (m.byPerson[p.id] || 0), 0)),
        })),
        cards: state.cards.map(c => {
          const v = cardView(state, c, today);
          return { name: v.name, used: v.used, available: v.available, nextPayment: v.nextPayment };
        }),
        currency: "TRY",
      };
    },
  },
  {
    name: "get_cashflow",
    title: "Cash flow (Akış)",
    description: "Month-by-month payment plan like the app's Akış tab: for each month the total, totals per person and per card, and each payment (date + card) with the installments in it.",
    inputSchema: obj({
      from_month: S.month("First month, YYYY-MM. Default: current month."),
      months: S.int("How many months to return (default 12).", 1, MAX_MONTHS),
      person: S.str("Only this person's payments (id or name)."),
      include_items: S.bool("Include the installments inside each payment (default true)."),
    }),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const start = monthArg(args.from_month, "from_month", ctx.today);
      const count = intArg(args.months, "months", 1, MAX_MONTHS, 12);
      const people = args.person !== undefined ? [findPerson(state, args.person)] : state.people;
      const months = T.buildCashflow(people, state.cards, state.installments, start, start + count - 1);
      const items = args.include_items !== false;
      return {
        months: months.map(m => ({
          month: T.monthKey(m.idx),
          total: round(m.total),
          byPerson: byName(state, m.byPerson, personName),
          byCard: byName(state, m.byCard, cardKeyName),
          payments: m.events.map(ev => eventView(state, ev, { items })),
        })),
        currency: "TRY",
      };
    },
  },

  // ── Harcamalar ──
  {
    name: "list_purchases",
    title: "List purchases (Harcamalar)",
    description: "Purchases with installment progress, remaining amount and next payment. Defaults to active (still being paid) purchases.",
    inputSchema: obj({
      status: { type: "string", enum: ["active", "done", "all"], description: 'Default "active".' },
      person: S.str("Only this person's purchases (id or name)."),
      card: { type: ["string", "null"], description: 'Only this card (id, name or last 4); "nakit" for cash.' },
      search: S.str("Case-insensitive text to look for in the description."),
      limit: S.int("Maximum number of purchases (default 100).", 1, 1000),
    }),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const status = args.status ?? "active";
      if (!["active", "done", "all"].includes(status)) fail('status must be "active", "done" or "all".');
      const person = args.person !== undefined ? findPerson(state, args.person) : null;
      const card = args.card !== undefined ? findCard(state, args.card) : undefined;
      const q = args.search ? T.normalize(args.search) : "";
      const all = knownPurchases(state)
        .filter(p => !person || p.personId === person.id)
        .filter(p => card === undefined || (card ? p.cardId === card.id : !cardById(state, p.cardId)))
        .filter(p => !q || T.normalize(p.desc).includes(q))
        .map(p => purchaseView(state, p, ctx.today))
        .filter(v => status === "all" || v.status === status)
        .sort((a, b) => (a.nextPayment?.date ?? "9").localeCompare(b.nextPayment?.date ?? "9")
          || (b.lastPaymentDate ?? "").localeCompare(a.lastPaymentDate ?? "")
          || a.description.localeCompare(b.description, "tr"));
      const limit = intArg(args.limit, "limit", 1, 1000, 100);
      return { count: all.length, purchases: all.slice(0, limit), currency: "TRY" };
    },
  },
  {
    name: "get_purchase",
    title: "Get purchase",
    description: "One purchase with its full payment schedule (every installment's date and amount).",
    inputSchema: obj({ id: S.str("Purchase id.") }, ["id"]),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      return purchaseView(state, findPurchase(state, args.id), ctx.today, { schedule: true });
    },
  },
  {
    name: "add_purchase",
    title: "Add purchase",
    description: "Add a single or installment purchase. Payment dates are computed from the card's cutoff and due days: a purchase up to and including the cutoff day goes into that month's statement, installments fall into following statements one month apart; cash is paid on the purchase day. Use dry_run to preview the schedule first.",
    inputSchema: obj({
      ...PURCHASE_FIELDS,
      date: S.date("Purchase date, YYYY-MM-DD. Default: today."),
      card: { ...PURCHASE_FIELDS.card, description: PURCHASE_FIELDS.card.description + " Default: the only card if there is exactly one, cash if there is none; required when there are several." },
      person: S.str("Person id or name. Default: the first person."),
      dry_run: S.bool("Only compute and return the payment preview, do not save."),
    }, ["description", "amount"]),
    annotations: WRITE,
    async run(args, ctx) {
      const make = state => {
        const { personId, p } = buildPurchase(state, args, ctx.today);
        return { id: uid(), personId, ...p };
      };
      if (args.dry_run) {
        const state = await ctx.load();
        const p = make(state);
        return { saved: false, purchase: purchaseView(state, p, ctx.today, { schedule: true }), preview: preview(state, p) };
      }
      return ctx.mutate(state => {
        const p = make(state);
        state.installments.push(p);
        return { saved: true, purchase: purchaseView(state, p, ctx.today), preview: preview(state, p) };
      });
    },
  },
  {
    name: "update_purchase",
    title: "Update purchase",
    description: "Change fields of a purchase; omitted fields stay as they are. Changing installments keeps the total unless amount is given too.",
    inputSchema: obj({ id: S.str("Purchase id."), ...PURCHASE_FIELDS }, ["id"]),
    annotations: { ...WRITE, idempotentHint: true },
    async run(args, ctx) {
      return ctx.mutate(state => {
        const cur = findPurchase(state, args.id);
        const { personId, p } = buildPurchase(state, args, ctx.today, cur);
        const next = { id: cur.id, personId, ...p };
        state.installments = state.installments.map(x => (x.id === cur.id ? next : x));
        return { saved: true, purchase: purchaseView(state, next, ctx.today), preview: preview(state, next) };
      });
    },
  },
  {
    name: "delete_purchase",
    title: "Delete purchase",
    description: "Permanently delete a purchase and all of its installments.",
    inputSchema: obj({ id: S.str("Purchase id.") }, ["id"]),
    annotations: { ...DESTROY, idempotentHint: true },
    async run(args, ctx) {
      return ctx.mutate(state => {
        const p = findPurchase(state, args.id);
        state.installments = state.installments.filter(x => x.id !== p.id);
        return { deleted: { id: p.id, description: p.desc } };
      });
    },
  },

  // ── Kartlar ──
  {
    name: "list_cards",
    title: "List cards (Kartlar)",
    description: "Credit cards with limit, used limit (installments still to be paid), available limit, cutoff and due days, next payment and where a purchase made today would fall.",
    inputSchema: obj(),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      return { cards: state.cards.map(c => cardView(state, c, ctx.today)), currency: "TRY" };
    },
  },
  {
    name: "add_card",
    title: "Add card",
    description: "Add a credit card. cutoff_day and due_day are on the card statement (ekstre).",
    inputSchema: obj(CARD_FIELDS, ["name", "cutoff_day", "due_day"]),
    annotations: WRITE,
    async run(args, ctx) {
      return ctx.mutate(state => {
        const c = { id: uid(), ...buildCard(state, args), color: T.nextColor(state.cards) };
        state.cards.push(c);
        return { saved: true, card: cardView(state, c, ctx.today) };
      });
    },
  },
  {
    name: "update_card",
    title: "Update card",
    description: "Change a card's name, limit, cutoff / due day or last 4 digits; omitted fields stay as they are. Payment dates of its purchases are recomputed.",
    inputSchema: obj({ card: S.str("Card id, name or last 4 digits."), ...CARD_FIELDS }, ["card"]),
    annotations: { ...WRITE, idempotentHint: true },
    async run(args, ctx) {
      return ctx.mutate(state => {
        const cur = findCard(state, args.card) ?? fail("Cash is not a card.");
        const next = { id: cur.id, ...buildCard(state, args, cur), color: cur.color };
        state.cards = state.cards.map(c => (c.id === cur.id ? next : c));
        return { saved: true, card: cardView(state, next, ctx.today) };
      });
    },
  },
  {
    name: "delete_card",
    title: "Delete card",
    description: "Permanently delete a card AND every purchase on it (as the app does). Tell the user how many purchases will go before calling.",
    inputSchema: obj({ card: S.str("Card id, name or last 4 digits.") }, ["card"]),
    annotations: DESTROY,
    async run(args, ctx) {
      return ctx.mutate(state => {
        const c = findCard(state, args.card) ?? fail("Cash is not a card.");
        const n = state.installments.filter(p => p.cardId === c.id).length;
        state.cards = state.cards.filter(x => x.id !== c.id);
        state.installments = state.installments.filter(p => p.cardId !== c.id);
        return { deleted: { id: c.id, name: c.name }, deletedPurchases: n };
      });
    },
  },

  // ── Kişiler ──
  {
    name: "list_people",
    title: "List people (Kişiler)",
    description: "People purchases are tracked for, with their purchase count, amount due this month and remaining amount.",
    inputSchema: obj(),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const start = T.parseDate(ctx.today).idx;
      const end = Math.min(lastPaymentIndex(state), start + MAX_MONTHS - 1);
      const months = end >= start ? T.buildCashflow(state.people, state.cards, state.installments, start, end) : [];
      return {
        people: state.people.map(p => ({
          id: p.id,
          name: p.name,
          purchaseCount: state.installments.filter(i => i.personId === p.id).length,
          dueThisMonth: round(months[0]?.idx === start ? months[0].byPerson[p.id] : 0),
          remaining: round(months.reduce((s, m) => s + (m.byPerson[p.id] || 0), 0)),
        })),
        currency: "TRY",
      };
    },
  },
  {
    name: "add_person",
    title: "Add person",
    description: "Add a person (e.g. a family member whose purchases go on the user's cards).",
    inputSchema: obj({ name: S.str("Name.") }, ["name"]),
    annotations: WRITE,
    async run(args, ctx) {
      return ctx.mutate(state => {
        const p = { id: uid(), name: personNameArg(state, args.name), color: T.nextColor(state.people) };
        state.people.push(p);
        return { saved: true, person: { id: p.id, name: p.name } };
      });
    },
  },
  {
    name: "rename_person",
    title: "Rename person",
    description: "Rename a person.",
    inputSchema: obj({ person: S.str("Person id or current name."), name: S.str("New name.") }, ["person", "name"]),
    annotations: { ...WRITE, idempotentHint: true },
    async run(args, ctx) {
      return ctx.mutate(state => {
        const p = findPerson(state, args.person);
        p.name = personNameArg(state, args.name, p.id);
        return { saved: true, person: { id: p.id, name: p.name } };
      });
    },
  },
  {
    name: "delete_person",
    title: "Delete person",
    description: "Permanently delete a person AND all of their purchases. At least one person must remain.",
    inputSchema: obj({ person: S.str("Person id or name.") }, ["person"]),
    annotations: DESTROY,
    async run(args, ctx) {
      return ctx.mutate(state => {
        const p = findPerson(state, args.person);
        if (state.people.length === 1) fail("At least one person must remain.");
        const n = state.installments.filter(i => i.personId === p.id).length;
        state.people = state.people.filter(x => x.id !== p.id);
        state.installments = state.installments.filter(i => i.personId !== p.id);
        return { deleted: { id: p.id, name: p.name }, deletedPurchases: n };
      });
    },
  },

  // ── Banka e-postaları ──
  {
    name: "get_inbox_address",
    title: "Bank e-mail address",
    description: "The user's personal address for bank spending notifications. Spending e-mails sent to it are turned into purchases on the card with the matching last 4 digits.",
    inputSchema: obj(),
    annotations: { ...READ, readOnlyHint: false, idempotentHint: true },
    async run(args, ctx) {
      return { address: await ctx.inbox.address(false) };
    },
  },
  {
    name: "renew_inbox_address",
    title: "Renew bank e-mail address",
    description: "Replace the bank e-mail address with a new one. Mail to the old address is rejected from now on, so the user must update it at their bank.",
    inputSchema: obj(),
    annotations: DESTROY,
    async run(args, ctx) {
      return { address: await ctx.inbox.address(true), note: "Update the notification address at the bank." };
    },
  },
  {
    name: "list_inbox",
    title: "Pending bank e-mails",
    description: "Bank e-mails that have not been processed yet, with what was read from them (amount, date, installments, merchant, card). needsReview explains why one cannot be added automatically.",
    inputSchema: obj({ include_body: S.bool("Include the e-mail text (e.g. to show a bank verification link).") }),
    annotations: READ,
    async run(args, ctx) {
      const [state, rows] = await Promise.all([ctx.load(), ctx.inbox.pending()]);
      return { emails: rows.map(row => emailView(emailItem(state, row), { body: !!args.include_body })) };
    },
  },
  {
    name: "check_inbox",
    title: "Process bank e-mails",
    description: "Like the app's 'Şimdi kontrol et': adds every pending e-mail that could be fully read and matched to a card as a purchase (for the first person), and lists the ones that need review.",
    inputSchema: obj(),
    annotations: WRITE,
    async run(args, ctx) {
      const [state, rows] = await Promise.all([ctx.load(), ctx.inbox.pending()]);
      const items = rows.map(row => emailItem(state, row));
      const ready = items.filter(x => !x.reason);
      // Önce işaretlenir: başka bir cihaz aynı anda okuduysa harcama iki kez eklenmez
      const claimed = new Set(ready.length ? await ctx.inbox.claim(ready.map(x => x.row.id)) : []);
      const toAdd = ready.filter(x => claimed.has(x.row.id));
      let added = [];
      if (toAdd.length) {
        try {
          added = await ctx.mutate(fresh => {
            const personId = fresh.people[0].id;
            return toAdd.map(x => {
              const card = emailCard(fresh, x.parsed);
              const p = { id: uid(), personId, ...emailPurchase(x.parsed, card) };
              fresh.installments.push(p);
              return purchaseView(fresh, p, ctx.today);
            });
          });
        } catch (err) {
          await ctx.inbox.release(toAdd.map(x => x.row.id));
          throw err;
        }
      }
      return {
        added,
        needsReview: items.filter(x => x.reason).map(x => emailView(x)),
      };
    },
  },
  {
    name: "add_inbox_purchase",
    title: "Add purchase from bank e-mail",
    description: "Add a pending bank e-mail as a purchase and mark it processed. Fields read from the e-mail are used unless overridden (e.g. pass card when it could not be matched, or amount for a foreign-currency charge).",
    inputSchema: obj({ email_id: S.int("emailId from list_inbox."), ...PURCHASE_FIELDS }, ["email_id"]),
    annotations: WRITE,
    async run(args, ctx) {
      const { email_id: emailId, ...fields } = args;
      const [state, rows] = await Promise.all([ctx.load(), ctx.inbox.pending()]);
      const row = rows.find(r => r.id === Number(emailId)) ?? fail(`No pending e-mail with id ${emailId}.`);
      const x = emailItem(state, row);
      if (!x.card && fields.card === undefined) {
        fail(`${x.reason || "Card could not be matched"}. Pass card (${state.cards.length ? list(state.cards) : "no cards yet"}) or "nakit".`);
      }
      const base = { ...emailPurchase(x.parsed, x.card), personId: undefined };
      if (base.count == null) base.count = 1;
      buildPurchase(state, fields, ctx.today, base);   // kaydetmeden önce doğrula

      const claimed = await ctx.inbox.claim([row.id]);
      if (!claimed.includes(row.id)) fail("This e-mail was already processed (maybe on another device).");
      try {
        return await ctx.mutate(fresh => {
          const { personId, p } = buildPurchase(fresh, fields, ctx.today, base);
          const purchase = { id: uid(), personId, ...p };
          fresh.installments.push(purchase);
          return { saved: true, purchase: purchaseView(fresh, purchase, ctx.today), preview: preview(fresh, purchase) };
        });
      } catch (err) {
        await ctx.inbox.release([row.id]);
        throw err;
      }
    },
  },
  {
    name: "dismiss_inbox_email",
    title: "Dismiss bank e-mail",
    description: "Mark a pending bank e-mail as processed without adding a purchase (the app's 'Yok say').",
    inputSchema: obj({ email_id: S.int("emailId from list_inbox.") }, ["email_id"]),
    annotations: { ...WRITE, idempotentHint: true },
    async run(args, ctx) {
      const id = Number(args.email_id);
      const claimed = await ctx.inbox.claim([id]);
      return { dismissed: claimed.includes(id), emailId: id };
    },
  },
  {
    name: "try_bank_email",
    title: "Test a bank e-mail",
    description: "Read a pasted bank spending notification without saving anything: shows the amount, date, installments, merchant and card that would be used.",
    inputSchema: obj({ text: S.str("The e-mail text.") }, ["text"]),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const x = emailItem(state, { id: null, body: text(args.text, "text"), received_at: new Date().toISOString() });
      const v = emailView(x);
      return { parsed: v.parsed, matchedCard: v.matchedCard, needsReview: v.needsReview, wouldAutoAdd: !x.reason };
    },
  },

  // ── Yedek ──
  {
    name: "export_data",
    title: "Export data",
    description: "The user's complete data as JSON (people, cards, purchases) — the same backup as Ayarlar → Dışa aktar.",
    inputSchema: obj(),
    annotations: READ,
    async run(args, ctx) {
      return ctx.load();
    },
  },
  {
    name: "import_data",
    title: "Import data",
    description: "Replace ALL of the user's data with a JSON backup produced by export_data or the app (Ayarlar → İçe aktar). Everything not in the backup is lost; confirm with the user first.",
    inputSchema: obj({ data: { type: "object", description: "Backup object with people, cards and installments arrays." } }, ["data"]),
    annotations: DESTROY,
    async run(args, ctx) {
      const data = args.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) fail("data must be a backup object.");
      if (!Array.isArray(data.people) || !Array.isArray(data.installments)) fail("data must contain people and installments arrays.");
      return ctx.mutate(state => {
        const next = T.hydrate(data);
        for (const k of Object.keys(state)) delete state[k];
        Object.assign(state, next);
        return { imported: true, people: next.people.length, cards: next.cards.length, purchases: next.installments.length };
      });
    },
  },
];

// Sunucunun initialize cevabında LLM'e verilen genel bilgi
export const INSTRUCTIONS = `CashFollow tracks credit card and cash purchases (single or in installments / taksit) for one or more people, and shows when each installment is paid.
- Amounts are Turkish lira (TRY). Dates are YYYY-MM-DD, months YYYY-MM, in Turkey time.
- A card has a statement cutoff day (hesap kesim günü) and a due day (son ödeme günü). A purchase on or before the cutoff day goes into that month's statement; the statement is paid on the due day (same month if the due day is after the cutoff, otherwise the next month). Installments fall into the following statements one month apart. Cash purchases are paid on the purchase day.
- A card's used limit is the sum of installments still to be paid.
- Cards and people can be referred to by id or name, cards also by their last 4 digits. "nakit" means cash / debit card.
- Deleting a card or a person also deletes their purchases; confirm destructive actions with the user.
- Reply to the user in their language (the app is Turkish).`;

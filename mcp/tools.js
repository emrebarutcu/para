// ---------- CashFollow MCP araçları ----------
// Ön yüzdeki çekirdek işlemler (özet, akış, harcama / kart / kişi, varlıklar, borçlar, banka e-postaları, yedek)
// LLM'lere araç olarak açılır. Hesaplar uygulamayla aynı modüllerden (taksit.js, borc.js, eposta.js…) gelir; doğrulama
// kuralları app.js'teki formlarla aynıdır. Araçlar kullanıcının verisine yalnızca ctx üzerinden erişir (bkz. server.js):
//   ctx.today            "YYYY-MM-DD" (Türkiye saati); ekstre, kredi taksiti ve ödemelerin varlığa etkisi buna göre
//   ctx.load()           → hydrate edilmiş veri
//   ctx.mutate(fn)       → fn(veri) çalışır, değişen kişi / kart / harcama / hareket / borç kayıtları kaydedilir
//   ctx.inbox            → pending(), claim(ids), release(ids), address(renew)
//   ctx.rates()          → { rates: { TRY, USD, EUR, GAU }, updatedAt, source } (kur.js)
import T from "../taksit.js";
import E from "../eposta.js";
import V from "../varlik.js";
import R from "../tekrar.js";
import K from "../kategori.js";
import I from "../icgoru.js";
import B from "../borc.js";

export const TIME_ZONE = "Europe/Istanbul";
const MAX_MONTHS = 60;       // akıştaki en fazla ay (app.js ile aynı)
const MAX_COUNT = 60;        // en fazla taksit (formdaki sınır)
const MAX_DEBT_COUNT = 600;  // borç / kredide en fazla taksit (tablodaki sınır)
const UPCOMING = 5;          // özetteki yaklaşan ödeme sayısı
const BODY_LIMIT = 4000;     // list_inbox'ta döndürülen e-posta metninin uzunluğu

// Kullanıcıya (LLM'e) isError ile dönen hata; diğer hatalar sunucu hatasıdır
export class ToolError extends Error {}
function fail(message) { throw new ToolError(message); }

const round = n => Math.round((n || 0) * 100) / 100;
const EPS = 0.005;   // kuruştan küçük fark yok sayılır (borc.js ile aynı)

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
  if (typeof v === "boolean" || (typeof v === "string" && !v.trim())) fail(`${name} must be an integer between ${min} and ${max}`);
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

function findEntry(state, id) {
  return state.entries.find(e => e.id === String(id ?? "")) ?? fail(`No entry with id "${id}". Use list_entries to find ids.`);
}

// "USD", "dolar", "gram altın"… → varlık kodu
const ASSET_NAMES = { tl: "TRY", try: "TRY", lira: "TRY", usd: "USD", dolar: "USD", dollar: "USD", eur: "EUR", euro: "EUR",
  gau: "GAU", altın: "GAU", altin: "GAU", gold: "GAU", "gram altın": "GAU", "gram altin": "GAU", "gram gold": "GAU" };
function assetArg(v, name = "asset") {
  const code = ASSET_NAMES[T.normalize(v)];
  return code ?? fail(`${name} must be one of TRY, USD, EUR, GAU (gram gold).`);
}

// Kategori kimliği ya da adı ("market", "Yeme-içme", "yeme içme"…); null kategoriyi kaldırır
function categoryArg(v) {
  if (v === null || v === "") return null;
  const s = K.keyOf(v);
  const c = K.CATEGORIES.find(x => x.id === s || K.keyOf(x.name) === s);
  return c ? c.id : fail(`category must be one of ${K.CATEGORIES.map(x => `"${x.id}" (${x.name})`).join(", ")}, or null.`);
}

// Tekrar: repeat (1 tek seferlik, N kez, 0 süresiz), repeat_every (her N…), repeat_unit (day / week / month); verilmeyen
// base'den gelir. → kayda yazılacak alanlar (tekrar.js fields)
function repeatArgs(args, base) {
  const n = args.repeat !== undefined ? intArg(args.repeat, "repeat", 0, R.MAX_REPEAT) : R.count(base) ?? 1;
  if (n === 1) {
    if (args.repeat_every !== undefined || args.repeat_unit !== undefined) fail("repeat_every / repeat_unit need repeat (0 = no end, N = N times).");
    return {};
  }
  const every = args.repeat_every !== undefined ? intArg(args.repeat_every, "repeat_every", 1, R.MAX_EVERY) : R.every(base);
  const unit = args.repeat_unit === undefined ? R.unit(base)
    : R.UNITS.includes(args.repeat_unit) ? args.repeat_unit : fail('repeat_unit must be "day", "week" or "month".');
  return R.fields({ repeat: n, every, unit });
}

// Tekrarın görünümü (cevaplarda)
function repeatView(x, today) {
  const r = R.rule(x);
  return r && {
    every: r.every, unit: r.unit, label: R.label(x), times: r.n || null,
    lastDate: R.lastDate(x), processed: R.countUntil(x, today), nextDate: R.nextDate(x, today),
  };
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

function paymentsOf(state, p, until) { return T.payments(p, cardById(state, p.cardId), until); }

// Son ödemenin ayı; süresiz tekrarlayan TL harcaması varsa en az bir yıl ileri (app.js ile aynı)
function lastPaymentIndex(state, today) {
  let last = -Infinity;
  for (const p of knownPurchases(state)) {
    if (T.assetOf(p) !== "TRY") continue;
    const pays = paymentsOf(state, p, today);
    if (pays.length) last = Math.max(last, pays[pays.length - 1].idx);
    if (T.endless(p)) last = Math.max(last, T.parseDate(today).idx + 11);
  }
  return last;
}

// Varlık bakiyesinden today'e kadar düşülenler, varlık başına: kartsız harcamaların ödenen kısmı ve borç etkileri
// (borç / kredi akışları, takipteki kartların ödenen ekstreleri, kart payı ödemeleri; borc.js spent)
function cashSpent(state, today, personId = null) {
  return B.spent(state, today, personId ?? undefined);
}

const byName = (state, map, nameOf) =>
  Object.fromEntries(Object.entries(map).map(([id, v]) => [nameOf(state, id), round(v)]));
const cardKeyName = (state, key) => (key === T.CASH ? "Nakit" : cardName(state, key));

function purchaseView(state, p, today, { schedule = false } = {}) {
  const card = cardById(state, p.cardId);
  // Tekrarlayanda sıradaki tekrarın ödemeleri de kalan sayılır
  const pays = T.payments(p, card, T.repeats(p) ? R.nextDate(p, today) ?? today : today);
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
    category: K.valid(p.category) ? p.category : null,
    categoryName: K.category(p.category)?.name ?? null,
    asset: T.assetOf(p),
  };
  if (T.repeats(p)) v.repeat = repeatView(p, today);
  if (!p.date) {
    // Excel'den gelen tarihsiz kayıt: total/count kalan taksitlerdir
    v.firstDueMonth = p.firstDue;
    v.remainingTotalAtImport = v.total;
    v.total = round(T.originalTotal(p));
  }
  if (card && p.date) v.statementCutoff = T.statementOf(card, p.date).cut;
  if (schedule) v.payments = pays.map(x => ({ no: x.no, date: x.key, amount: round(x.amount), paid: x.key < today }));
  return v;
}

// Kartın sıradaki ekstresi (borc.js cardDebt; takipte ödenmemiş kısmı): alreadyCut kesilmiş, son ödeme günü bekleniyor
function statementView(debt) {
  const n = debt.next;
  return n ? { date: n.date, amount: round(n.amount), alreadyCut: n.cut } : null;
}

// Ekstre takibi ve ödeme modu (borc.js cardDebt): autoPay ekstreler son ödeme gününün ertesi günü ödenmiş sayılır; elle
// modda (manualSince'tan sonraki ekstreler) pay_debt card=… ile ödenir, unpaid ödemesi gelmiş (gecikmiş ya da bugün),
// overdue gecikmiş kısım. Otomatikte ödenecek ekstre yoktur (bugün son ödeme günü olan ekstre yarın ödenmiş sayılır): 0
function trackingView(debt) {
  if (!debt.tracked) return null;
  const own = x => (debt.manual ? round(x) : 0);
  const v = { since: debt.since, autoPay: !debt.manual, unpaid: own(debt.unpaid), overdue: own(debt.overdue) };
  if (debt.manual) Object.assign(v, { manualSince: debt.manualFrom, overdueSince: debt.overdueSince });
  return v;
}

// Sıradaki ödemelerin ufku (get_overview'daki akışla aynı: bu aydan 24 ay sonrasının sonu)
const upcomingUntil = today => T.dateKey(T.parseDate(today).idx + 24, 31);

// Elle ödenen takipteki kartın ekstreleri (borc.js cardState; until'e kadar süresiz tekrarların ileriki tekrarları da):
// ödenecekler (kapanmamış kısmı olan), otomatik ödenmiş sayılanlar hariç. Elle değilse null.
function manualStatements(state, c, today, until = upcomingUntil(today)) {
  if (!B.tracked(c) || !B.manual(c)) return null;
  const cs = B.cardState(state, c, today, undefined, until);
  return { manualFrom: cs.manualFrom, due: cs.statements.filter(x => !x.auto && x.key <= until && x.amount - x.covered > EPS) };
}

// Elle ödenen kartın ödenecek ekstresi (Sıradaki ödemeler'de): total kapanmamış kısmı, kişi payları orantılı; covered
// ödenen kısmı, late son ödeme günü geçmiş
function cardDueView(state, c, x) {
  const open = x.amount - x.covered, by = {};
  for (const l of x.lines) by[l.personId] = (by[l.personId] || 0) + l.amount * open / x.amount;
  return {
    date: x.key, card: c.name, total: round(open), byPerson: byName(state, by, personName),
    ...(x.covered > EPS && { covered: round(x.covered) }), ...(x.state === "late" && { late: true }),
  };
}

// Elle ödenen kartın ekstreleri (manualSince'tan sonrakiler; ödemeler en eskiden kapatır): ödenmemiş geçmiş ekstreler,
// bugüne kadarki sonuncusu ve ödenecek ilk ekstreye kadar ilerikiler (önceden ödenenler dahil). covered ödenen kısım.
function statementsView(debt, today) {
  const own = debt.statements.filter(x => !x.auto);
  const last = own.filter(x => x.key <= today).pop();
  const next = own.find(x => x.key > today && x.amount - x.covered > EPS);
  return own.filter(x => (x.key <= today ? x.state !== "paid" || x === last : !next || x.key <= next.key))
    .map(x => ({ date: x.key, amount: round(x.amount), covered: round(x.covered), state: x.state }));
}

// Kartın kaydedilen ödemeleri (pay_debt card): delete_debt_payment ile silinebilir
function cardPaysView(state, card) {
  return (B.known(state).cardPays.get(card.id) ?? []).map(x => paymentView(x, "TRY"));
}

function cardView(state, c, today) {
  const known = new Set(state.people.map(p => p.id));
  const mine = state.installments.filter(p => p.cardId === c.id && known.has(p.personId));
  const pays = mine.flatMap(p => T.payments(p, c, today));
  const upcoming = pays.filter(x => x.key >= today);
  const next = upcoming.reduce((min, x) => (!min || x.key < min ? x.key : min), null);
  // Limitten kullanılan: elle ödenen kartta ödenmemiş geçmiş ekstreler dahil, ön ödeme düşülmüş (borc.js cardUsed)
  const used = B.cardUsed(state, c, today);
  const s = T.statementOf(c, today);
  const debt = B.cardDebt(state, c, today);
  const payments = cardPaysView(state, c);
  // Elle ödenen kartta sıradaki ödeme borc.js'in ekstrelerinden: ödenmiş / önceden ödenmiş olan düşer, kapanmamış kısmı
  // (gecikmişler tracking.unpaid / overdue'da)
  const own = manualStatements(state, c, today);
  const first = own?.due.find(x => x.key >= today);
  return {
    id: c.id,
    name: c.name,
    last4: c.last4 ?? null,
    limit: round(c.limit),
    used: round(used),
    available: c.limit ? round(c.limit - used) : null,
    cutoffDay: c.cutoffDay,
    dueDay: c.dueDay,
    nextPayment: own ? (first ? { date: first.key, amount: round(first.amount - first.covered) } : null)
      : next ? { date: next, amount: round(upcoming.filter(x => x.key === next).reduce((t, x) => t + x.amount, 0)) } : null,
    purchaseCount: mine.length,
    purchaseToday: { statementCutoff: s.cut, dueDate: s.due },
    tracking: trackingView(debt),
    statement: statementView(debt),
    ...(payments.length && { payments }),
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
  if (card && p.date) out.statementCutoff = T.statementOf(card, p.date).cut;
  if (!card) {
    out.note = (p.count > 1 ? "Cash — paid each month on the purchase day" : "Cash — paid on the purchase day")
      + `, deducted from the ${T.assetOf(p)} asset balance`;
  }
  if (T.repeats(p)) out.repeat = R.label(p) + (R.rule(p).n ? ` · ${R.rule(p).n} times` : " · no end");
  return out;
}

// ---------- Harcama / kart / kişi kuralları (app.js formlarıyla aynı) ----------
// base: düzenlenen harcama ya da e-postadan gelen taslak; verilmeyen alanlar ondan alınır
function buildPurchase(state, args, today, base = null) {
  const desc = args.description !== undefined ? text(args.description, "description") : base?.desc;
  if (!desc) fail("description is required (what was bought).");

  const count = intArg(args.installments, "installments", 1, MAX_COUNT, base?.count ?? 1);
  // Döviz / altın harcaması o varlıktan ödenir: kartsız ve peşin
  const asset = args.asset !== undefined ? assetArg(args.asset) : T.assetOf(base);
  const foreign = asset !== "TRY";
  if (foreign && count !== 1) fail("A USD / EUR / gold purchase is paid at once from that asset: installments must be 1.");

  let total = base?.total;
  if (args.amount !== undefined) {
    const amount = Number(args.amount);
    if (!(amount > 0)) fail("amount must be a positive number.");
    if (args.amount_type !== undefined && !["total", "per_installment"].includes(args.amount_type)) {
      fail('amount_type must be "total" or "per_installment".');
    }
    total = V.round(args.amount_type === "per_installment" ? amount * count : amount, asset);
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
    : foreign ? null
    : base ? cardById(state, base.cardId) ?? null
    : defaultCardFor(state);
  if (foreign && card) fail(`Only TRY purchases can go on a card; use card "nakit" for ${asset}.`);

  const rep = repeatArgs(args, base);
  if (rep.repeat != null && !date) fail("A repeating purchase needs a date.");
  const p = { desc, cardId: card ? card.id : null, count, total, ...(foreign && { asset }), ...rep };
  // Kategori: verilirse kullanıcının seçimi sayılır (uygulama bundan öğrenir); verilmezse düzenlenen kayıttaki kalır,
  // yeni kayıtta kullanıcının aynı işyerine daha önce verdiği kategori önerilir
  // Açıklama değişince kullanıcının seçmediği (önerilmiş) kategori yeniden önerilir (app.js'teki gibi)
  const category = args.category !== undefined ? categoryArg(args.category) : undefined;
  const keep = K.valid(base?.category) && (base.categoryBy === "user" || base.desc === desc);
  if (category) Object.assign(p, { category, categoryBy: "user" });
  else if (category === undefined && keep) Object.assign(p, { category: base.category, ...(base.categoryBy && { categoryBy: base.categoryBy }) });
  else if (category === undefined) {
    const guess = K.remembered(desc, K.learned(state.installments));
    if (guess) Object.assign(p, { category: guess, categoryBy: "ai" });
  }
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

// Kesim / son ödeme günü değişirken kullanıcıya sorulacak seçenekler (app.js'teki kart formuyla aynı)
function transitionQuestion({ choices, open, next }, given) {
  const text = {
    old: `"old": the open statement is still cut on the old days (cutoff ${open.cut}, paid ${open.due}); later statements use the new days.`,
    new: `"new": statements already cut stay as they are; the new days start today${open.count ? ` and the open statement's payments move to the statement cut on ${next.cut}, paid ${next.due}` : ""}.`,
    fix: `"fix": the current days were entered wrong; every payment computed with them, past ones too, is recomputed with the new days (earlier day changes stay).`,
  };
  const head = given !== undefined ? `transition must be ${choices.map(k => `"${k}"`).join(", ")}. ` : "";
  const intro = open.count
    ? `Changing the days affects purchases in between: ${open.count} payment(s) totalling ${round(open.total)} TRY in the statement to be cut on ${open.cut} are not cut yet.`
    : "Changing the days changes payment dates of this card's purchases.";
  return `${head}${intro} Ask the user which one and pass it as transition: ${choices.map(k => text[k]).join(" ")}`;
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

// Kullanıcının aynı işyerine daha önce verdiği kategori (app.js'teki gibi)
function withRemembered(state, p) {
  const guess = K.remembered(p.desc, K.learned(state.installments));
  return guess ? { ...p, category: guess, categoryBy: "ai" } : p;
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

// ---------- Varlıklar ----------
async function ratesOrNull(ctx) {
  try { return await ctx.rates(); } catch (err) { console.warn("kur:", err.message); return null; }
}

function entryView(state, e, rates, today) {
  const value = V.toTry(e.amount, e.asset, rates?.rates);
  const n = V.repeatOf(e);
  const v = {
    id: e.id,
    date: e.date,
    description: e.desc,
    asset: e.asset,
    direction: e.amount > 0 ? "in" : "out",
    amount: Math.abs(e.amount),
    tryValueNow: value == null ? null : round(Math.abs(value)),
    person: personName(state, e.personId),
    personId: e.personId,
  };
  if (n != null) v.repeat = repeatView(e, today);
  return v;
}

// Tekrarlayan hareketin [from, to] aralığına düşen tekrarı var mı (tek seferlikte tarihi)
function entryInRange(e, from, to) {
  const last = V.lastDate(e);
  return (!to || e.date <= to) && (!from || last == null || last >= from);
}

function knownEntries(state) {
  const known = new Set(state.people.map(p => p.id));
  return state.entries.filter(e => known.has(e.personId));
}

// Yeni ya da düzenlenen hareket; base verilirse belirtilmeyen alanlar ondan gelir
function buildEntry(state, args, today, base = null) {
  const asset = args.asset !== undefined ? assetArg(args.asset) : base?.asset ?? fail("asset is required.");
  const dir = args.direction ?? (base ? (base.amount > 0 ? "in" : "out") : fail('direction is required ("in" or "out").'));
  if (!["in", "out"].includes(dir)) fail('direction must be "in" or "out".');
  let amount = base ? Math.abs(base.amount) : null;
  if (args.amount !== undefined) {
    amount = V.round(Number(args.amount), asset);
    if (!(amount > 0)) fail("amount must be a positive number (use direction for outflows).");
  }
  if (amount == null) fail("amount is required.");
  const desc = args.description !== undefined ? text(args.description, "description") : base?.desc ?? "";
  if (!desc) fail("description must not be empty.");
  const date = args.date ?? base?.date ?? today;
  if (!validDate(date)) fail("date must be a valid date like 2026-10-19.");
  const personId = args.person !== undefined ? findPerson(state, args.person).id : base?.personId ?? state.people[0].id;
  return { personId, asset, amount: dir === "out" ? -amount : amount, desc, date, ...repeatArgs(args, base) };
}

// Kişinin bir varlıktaki bugünkü bakiyesi (nakit harcamalar ve borç etkileri düşülmüş)
function balanceOf(state, personId, asset, today) {
  return V.balances(knownEntries(state).filter(e => e.personId === personId), today, cashSpent(state, today, personId))[asset] ?? 0;
}

// Varlık = Özvarlık + Borç (borc.js totals), TL. Özvarlık yuvarlanmış iki değerin farkıdır: eşitlik cevapta da tutar.
function worthView(t) {
  const assets = round(t.assets), debts = round(t.debt.total);
  return {
    cashTry: round(t.cash), receivablesTry: round(t.receivable.total), debtsTry: debts, totalAssetsTry: assets,
    netWorthTry: round(assets - debts), untrackedCardDebtTry: round(t.untracked),
  };
}

// ---------- Borçlar / alacaklar (borc.js) ----------
// Özet'teki ayrı satır: kullanıcının borç / kredi ödemeleri (kart / nakit tutarlarına girmez). idx ayı (yapılmışlar dahil) ve
// sonraki ay TL, upcoming bugünden itibaren henüz ödenmemiş sıradakiler (gecikmiş beklenen ödeme bugünde).
// unpaidCardStatements: elle ödenen kartlarda ödemesi gelmiş, ödenmemiş ekstreler (kart tutarları ekstreyi kendi gününde
// sayar; bunlar ayrıca Ödendi bekler). since ilk ödenmemiş ekstrenin son ödeme günü.
async function debtsDue(state, today, idx, ctx) {
  const due = (from, to) => B.paymentsDue(state, today, from, to);
  const month = i => due(T.dateKey(i, 1), T.dateKey(i, 31));
  const thisMonth = month(idx), nextMonth = month(idx + 1), upcoming = due(today, "9999-12-31").filter(f => !f.paid).slice(0, UPCOMING);
  const rates = [...thisMonth, ...nextMonth].some(f => f.asset !== "TRY") ? (await ratesOrNull(ctx))?.rates : null;
  const missing = new Set();
  const tl = list => list.reduce((s, f) => {
    const v = V.toTry(-f.amount, f.asset, rates);
    if (v == null) missing.add(f.asset);
    return s + (v ?? 0);
  }, 0);
  const out = {
    dueThisMonth: round(tl(thisMonth)),
    nextMonth: round(tl(nextMonth)),
    upcoming: upcoming.map(f => ({
      date: f.date, description: B.flowText(f, state), amount: V.round(-f.amount, f.asset), asset: f.asset, debtId: f.debt.id,
      ...(f.late && { late: true }),
    })),
  };
  if (missing.size) out.notIncludedInTotal = [...missing];
  const k = B.known(state);
  // Yalnızca elle ödenen kartlar (otomatikte bugün son ödeme günü olan ekstre yarın kendiliğinden ödenmiş sayılır)
  const unpaid = state.cards.map(c => B.cardDebt(state, c, today, k.cardPays.get(c.id) || [])).filter(c => c.manual && c.unpaid > EPS).map(c => ({
    card: c.card.name, cardId: c.card.id, amount: round(c.unpaid),
    since: c.statements.find(x => x.state === "late" || x.state === "due").key, ...(c.overdue > EPS && { late: true }),
  }));
  if (unpaid.length) out.unpaidCardStatements = unpaid;
  return out;
}

// type ↔ kayıt: borrowed kişiden borç aldım (person, debt), lent kişiye borç verdim (person, receivable), loan kredi
const DEBT_TYPES = {
  borrowed: "borrowed", borrow: "borrowed", "borç aldım": "borrowed", "borc aldim": "borrowed", borç: "borrowed", borc: "borrowed",
  lent: "lent", lend: "lent", "borç verdim": "lent", "borc verdim": "lent", alacak: "lent",
  loan: "loan", "bank loan": "loan", kredi: "loan", "banka kredisi": "loan",
};
function typeArg(v) {
  return DEBT_TYPES[T.normalize(v)] ?? fail('type must be "borrowed" (borç aldım), "lent" (borç verdim) or "loan" (kredi).');
}
function typeOf(d) { return d.kind === "loan" ? "loan" : d.side === "debt" ? "borrowed" : "lent"; }

// Artı, sonlu tutar; varlığın hane sayısına yuvarlanır
function amountArg(v, asset) {
  const n = v == null || v === "" || typeof v === "boolean" ? NaN : Number(v);
  const amount = Number.isFinite(n) ? V.round(n, asset) : NaN;
  if (!(Number.isFinite(amount) && amount > 0)) fail("amount must be a positive number.");
  return amount;
}

// Sahibi bilinen geçerli borç / alacak / kredi kaydı (borc.js known; eski istemcilerin bıraktığı yetimler görünmez)
function findDebt(state, id) {
  return B.known(state).items.find(d => d.id === String(id ?? "")) ?? fail(`No debt with id "${id}". Use list_debts to find ids.`);
}

function findDebtPayment(state, id) {
  return state.debts.find(x => x?.kind === "payment" && x.id === String(id ?? ""))
    ?? fail(`No debt payment with id "${id}". Payment ids are in get_debt (payments), list_debts (shares and cards payments) and list_cards (payments).`);
}

const paymentsOfDebt = (state, d) => B.known(state).pays.get(d.id) ?? [];

function paymentView(x, asset) {
  return { id: x.id, date: x.date, amount: V.round(x.amount, asset), asset, ...(x.desc && { description: x.desc }) };
}

// Borcun görünümü; tutarlar borcun varlığında. status: open (başlamış, kalanı var), closed (ödendi ya da kapatıldı),
// not_started (ileri tarihli). schedule: taksitler ve ne kadarının ödendiği.
function debtView(state, d, today, rates, { schedule = false, pays = paymentsOfDebt(state, d) } = {}) {
  const st = B.status(d, pays, today);
  const r = x => V.round(x || 0, d.asset);
  const remainingTry = V.toTry(st.remaining, d.asset, rates);
  const v = {
    id: d.id,
    type: typeOf(d),
    side: B.side(d),
    party: d.party ?? null,
    description: d.desc ?? "",
    person: personName(state, d.personId),
    personId: d.personId,
    asset: d.asset,
    total: r(d.amount),
    principal: d.principal > 0 ? r(d.principal) : 0,
    date: d.date,
    started: st.started,
    dueDate: d.due ?? null,
    installments: st.count || null,
    perInstallment: st.count ? r(d.amount / st.count) : null,
    autoPay: st.auto,
    paid: r(st.paid),
    remaining: r(st.remaining),
    remainingTry: remainingTry == null ? null : round(remainingTry),
    overdue: r(st.overdue),
    overdueSince: st.overdueSince,
    nextPayment: st.next ? { date: st.next.date, amount: r(st.next.amount), installment: `${st.next.no}/${st.count}` } : null,
    closed: d.closed ?? null,
    status: !st.started ? "not_started" : st.done ? "closed" : "open",
    cost: r(st.cost),
    payments: pays.map(x => paymentView(x, d.asset)),
  };
  if (schedule) {
    // Kendiliğinden ödenende covered true / false, elle ödenende ilk giren ilk çıkar kapanan tutar
    v.schedule = st.items.map(x => ({
      no: x.no, date: x.key, amount: r(x.amount),
      covered: r(typeof x.covered === "number" ? x.covered : x.covered ? x.amount : 0), state: x.state,
    }));
  }
  return v;
}

// Ödeme planı özeti (formdaki önizlemeyle aynı bilgiler)
function debtPreview(state, d) {
  const items = B.schedule(d);
  const asset = d.asset;
  const out = {
    installments: items.length || null,
    perInstallment: items.length ? V.round(d.amount / items.length, asset) : null,
    firstPayment: items[0]?.key ?? null,
    lastPayment: items.length ? items[items.length - 1].key : null,
    cost: d.principal > 0 ? V.round(d.amount - d.principal, asset) : 0,
  };
  const rate = B.loanRate(d);
  if (rate != null) out.monthlyInterestRate = Math.round(rate * 10000) / 100;   // yüzde
  // Takipten önce ödenmiş: kredide (otomatik ya da elle) ve kendiliğinden ödenen kişisel borçta date'ten önceki taksitler
  const before = d.kind === "loan" || B.auto(d) ? items.filter(x => x.key < d.date).length : 0;
  if (before) out.paidBeforeDate = before;
  const who = personName(state, d.personId);
  const notes = [];
  notes.push(!(d.principal > 0) ? `No money changed hands on ${d.date} (principal 0): ${who}'s ${asset} balance does not change now`
    : B.side(d) === "debt" ? `${V.round(d.principal, asset)} ${asset} enters ${who}'s ${asset} balance on ${d.date}`
    : `${V.round(d.principal, asset)} ${asset} leaves ${who}'s ${asset} balance on ${d.date}`);
  const pre = before ? `the ${before} installment(s) before ${d.date} count as paid before` : "";
  if (B.auto(d)) {
    notes.push(`automatic: each installment counts as paid the day after its date (no pay_debt needed)${pre && `; ${pre}`}`);
  } else if (d.kind === "loan") {
    notes.push(`paid by hand: each installment is paid only when recorded with pay_debt (Ödendi; payments cover the earliest unpaid installment first); unpaid installments past their date are overdue${pre && `; ${pre}`}`);
  } else {
    notes.push(`repaid only when recorded with pay_debt (in parts too)${items.length ? "; unpaid installments past their date are overdue" : ""}`);
  }
  out.note = notes.join("; ") + ".";
  return out;
}

// Yeni ya da düzenlenen borç kaydı (app.js'teki borç formuyla aynı kurallar); base verilirse belirtilmeyen alanlar ondan
function buildDebt(state, args, today, base = null) {
  const type = args.type !== undefined ? typeArg(args.type) : base ? typeOf(base) : fail('type is required: "borrowed", "lent" or "loan".');
  const loan = type === "loan";
  const asset = args.asset !== undefined ? assetArg(args.asset) : base?.asset ?? "TRY";

  const party = args.party !== undefined ? text(args.party ?? "", "party") : base?.party ?? "";
  if (!loan && !party) fail(`party is required: who the money was ${type === "borrowed" ? "borrowed from" : "lent to"}.`);
  const desc = args.description !== undefined ? text(args.description ?? "", "description") : base?.desc ?? "";

  const date = args.date !== undefined ? args.date : base?.date ?? today;
  if (typeof date !== "string" || !validDate(date)) fail('date must be a valid date like "2026-10-18".');

  // Vade ya da ilk taksit; taksitler sonraki ayların aynı gününe düşer (kredide şart)
  let due = args.due_date !== undefined ? args.due_date : base?.due;
  if (due === null || due === "") due = undefined;
  if (due !== undefined && (typeof due !== "string" || !validDate(due))) fail('due_date must be a valid date like "2026-11-18".');
  if (loan && !due) fail("due_date (the first installment's date) is required for a loan.");
  const count = intArg(args.installments, "installments", 1, MAX_DEBT_COUNT, base?.count ?? (loan ? undefined : 1));
  if (count == null) fail("installments (number of monthly installments) is required for a loan.");
  if (count > 1 && !due) fail("due_date (the first installment's date) is required with installments.");

  let total = base?.amount;
  if (args.amount !== undefined) {
    const kind = args.amount_type ?? (loan ? "per_installment" : "total");
    if (!["total", "per_installment"].includes(kind)) fail('amount_type must be "total" or "per_installment".');
    const amount = amountArg(args.amount, asset);
    total = kind === "per_installment" ? V.round(amount * count, asset) : amount;
  }
  if (!(total > 0)) fail("amount is required.");
  if (!Number.isFinite(total)) fail("amount is too large.");

  // Ana para: date günü el değiştiren (borçta varlığa girer, alacakta çıkar); 0 = para hareketi yok (eski borç).
  // Verilmezse kişisel borçta toplam, kredide yok; düzenlemede toplama eşitse yeni toplamı izler.
  let principal;
  if (args.principal !== undefined) {
    const n = args.principal == null || typeof args.principal === "boolean" ? NaN : Number(args.principal);
    if (!Number.isFinite(n) || n < 0) fail("principal must be zero or a positive number (0 = no money changed hands on date).");
    principal = V.round(n, asset);
  } else if (base) {
    principal = base.principal > 0 && base.principal === base.amount ? total : base.principal ?? 0;
  } else {
    principal = loan ? 0 : total;
  }
  if (principal > total) fail(`principal (${principal}) must not be more than amount, the total to repay (${total}).`);

  // Ödeme modu: verilmezse kayıttaki (tür değişmediyse), yoksa türün varsayılanı (kredi otomatik, kişisel borç elle)
  const same = base && (base.kind === "loan") === loan;
  const autoPay = args.auto_pay !== undefined ? args.auto_pay : same ? (loan ? base.autoPay !== false : base.autoPay === true) : loan;
  if (typeof autoPay !== "boolean") fail("auto_pay must be true or false.");
  if (!loan && autoPay && !due) fail("auto_pay needs due_date: installments count as paid the day after their dates.");

  const person = args.person !== undefined ? findPerson(state, args.person)
    : (base?.personId && personById(state, base.personId)) || state.people[0];

  // Kapatma: kalan artık beklenmez (kredide sonraki taksitler düşer); null / "" yeniden açar
  let closed = base?.closed;
  if (args.closed !== undefined) {
    closed = args.closed === null || args.closed === "" ? undefined : args.closed;
    if (closed !== undefined && (typeof closed !== "string" || !validDate(closed))) fail('closed must be a date like "2026-10-18", or null to reopen.');
    if (closed > today) fail("closed must not be after today.");
  }
  if (closed && closed < date) fail(`closed must not be before the debt's date (${date}).`);

  // Kredinin (otomatik ya da elle) ve kendiliğinden ödenen borcun date'ten önceki taksitleri takipten önce ödenmiş sayılır;
  // o günlerde çekilen para da varlığa çoktan girmiştir: ana para ancak ilk taksitten önceki bir tarihte girilir (yoksa
  // özvarlık yanlış artar)
  if (principal > 0 && (loan || autoPay) && due && due < date) {
    fail(`principal can only be given when date (${date}) is on or before the first installment (${due}): earlier installments count as paid before date. For an existing loan or debt, leave principal out (or 0).`);
  }

  const d = { kind: loan ? "loan" : "person", personId: person.id };
  if (!loan) d.side = type === "borrowed" ? "debt" : "receivable";
  if (party) d.party = party;
  if (desc) d.desc = desc;
  d.asset = asset;
  d.amount = total;
  if (principal > 0) d.principal = principal;
  d.date = date;
  if (due) { d.due = due; d.count = count; }
  if (loan && !autoPay) d.autoPay = false;
  if (!loan && autoPay) d.autoPay = true;
  if (closed) d.closed = closed;
  return d;
}

// Kart payı (borc.js shares): owed eksiyse fazla ödemiştir (kullanıcı ona borçlu); payments silinebilir ödemeleri
function shareView(state, pid, s, today) {
  const k = B.known(state);
  return {
    personId: pid,
    person: personName(state, pid),
    owed: round(s?.remaining),
    dueNow: round(s?.dueNow),
    settled: round(s?.settled),
    nextPayment: s?.next ? { date: s.next.date, amount: round(s.next.amount) } : null,
    payments: k.settlements.filter(x => x.personId === pid && x.date <= today).map(x => paymentView(x, "TRY")),
  };
}

// Kartın borcu (borc.js cardDebt): debt ödenmemiş taksitler (elle modda ödenmemiş geçmiş ekstreler dahil), statement
// sıradaki ekstre, byPerson kişi payları (kapanmamış ekstrelerden; toplamı borçtur); credit fazla ödenmiş kartta artı
// bakiye (alacak). Takipte autoPay ödeme modu; elle modda unpaid / overdue ve ekstreler; kaydedilen kart ödemeleri
// (silinebilir)
function cardDebtView(state, c, today) {
  const v = {
    cardId: c.card.id, card: c.card.name, tracked: c.tracked, since: c.since, debt: round(Math.max(0, c.total)),
    statement: statementView(c), byPerson: byName(state, c.byPerson, personName),
  };
  if (c.credit > EPS) v.credit = round(c.credit);
  if (c.tracked) v.autoPay = !c.manual;
  if (c.manual) {
    Object.assign(v, {
      manualSince: c.manualFrom, unpaid: round(c.unpaid), overdue: round(c.overdue), overdueSince: c.overdueSince,
      statements: statementsView(c, today),
    });
  }
  const payments = cardPaysView(state, c.card);
  if (payments.length) v.payments = payments;
  return v;
}

// Ekstre takibi: track_statements false → takip dışı; true ya da track_since → takipte, track_since'tan (verilmezse
// bugünden; zaten takipteyse başlangıcı korunur). İkisi de verilmezse karttaki değerler kalır (buildCard yeniden kurar).
function trackingArgs(args, cur, today) {
  const on = args.track_statements, since = args.track_since;
  if (on !== undefined && typeof on !== "boolean") fail("track_statements must be true or false.");
  if (since !== undefined) {
    if (typeof since !== "string" || !validDate(since)) fail('track_since must be a valid date like "2026-10-01".');
    if (since > today) fail("track_since must not be after today.");
    if (on === false) fail("track_since needs tracking on: leave out track_statements or pass true.");
  }
  const keep = { ...(cur.trackSince && { trackSince: cur.trackSince }), ...(cur.trackOff === true && { trackOff: true }) };
  if (on === false) return { ...keep, trackOff: true };
  if (on === true || since !== undefined) return { trackSince: since ?? (B.tracked(cur) && cur.trackSince ? cur.trackSince : today) };
  return keep;
}

// Ödeme modu (auto_pay; verilmezse kartınki kalır). false → elle: manualSince bugün; aynı çağrıda takip açılıyor ya da
// track_since değişiyorsa takibin başladığı gün (o günden sonraki ekstreler Ödendi bekler). Kartta bugün tarihli ödeme
// varken bugünden elle moda geçilmez (o güne kadar ödenmiş sayılan ekstrelerde erimiş ödeme ikinci kez düşerdi; borc.js
// cardPaidToday). true → otomatik: manualSince silinir; kaydedilen ödemelerin bir kısmı sayılmaz olacaksa (önceki
// ekstrelerde eriyip bakiyeyi değiştirirdi; borc.js cardPrepaid, takibe girecek kartta) engellenir. Takip dışı kart elle
// modunu korur (uygulamadaki gibi): takip kapalıyken otomatiğe dönülmez, ön ödeme denetimi atlanmasın.
// v: diğer alanları işlenmiş yeni kart. → { trackSince?, manualSince? }
function payModeArgs(state, args, cur, v, today) {
  const auto = args.auto_pay;
  if (auto !== undefined && typeof auto !== "boolean") fail("auto_pay must be true or false.");
  const manual = B.manual(cur);
  if (auto === undefined || auto === !manual) return manual ? { manualSince: cur.manualSince } : {};
  if (auto === false) {
    if (!B.tracked(v)) fail("auto_pay false needs the card's statements tracked: leave out track_statements or pass true.");
    const restart = !B.tracked(cur) || v.trackSince !== cur.trackSince;
    const since = restart && v.trackSince ? v.trackSince : today;
    if (since === today && B.cardPaidToday(state, cur, today)) {
      fail(`A payment on ${cur.name} is dated today: switching to paid by hand today would count it twice (it already went against the statements counted as paid). Switch to paid by hand tomorrow.`);
    }
    return { ...(!v.trackSince && { trackSince: today }), manualSince: since };
  }
  if (!B.tracked(v)) {
    fail(`auto_pay true needs the card's statements tracked: ${cur.name} stays paid by hand while not tracked. Leave out auto_pay, or turn tracking on in the same call (track_statements true or track_since) to switch back to automatic.`);
  }
  const lost = B.cardPrepaid(state, { ...v, manualSince: cur.manualSince }, today);
  if (lost > EPS) {
    const payer = personName(state, state.people[0]?.id);
    fail(`${cur.name} can't go back to automatic yet: ${round(lost)} TRY of its recorded card payments would stop counting (on automatic, statements count as paid on their own and payments only count beyond them, so payments ahead of the statements due would go against statements already counted as paid), raising ${payer}'s lira balance by that much. Delete the payment made ahead first (delete_debt_payment; ids in list_cards / list_debts cards payments), or switch once the statements it pays are past their due day.`);
  }
  return {};
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

const REPEAT_FIELDS = {
  repeat: S.int("Repetition: 1 = once (default), N = N times, 0 = no end (e.g. rent, subscription, salary).", 0, 600),
  repeat_every: S.int("Repeat once every N units (default 1), e.g. 2 with repeat_unit week = every 2 weeks.", 1, 99),
  repeat_unit: { type: "string", enum: ["day", "week", "month"], description: 'Unit of repeat_every. Default "month" (same day of month as date; shorter months use their last day).' },
};
const PURCHASE_FIELDS = {
  description: S.str("What was bought (shown as the purchase title)."),
  amount: S.num("Amount in the purchase's asset (TRY unless asset is given). The purchase total, unless amount_type is per_installment."),
  amount_type: { type: "string", enum: ["total", "per_installment"], description: 'How to read amount. Default "total".' },
  installments: S.int("Number of installments (taksit), 1 = single payment (peşin).", 1, MAX_COUNT),
  date: S.date("Purchase date, YYYY-MM-DD. Decides which statement (ekstre) it falls into."),
  card: { type: ["string", "null"], description: 'Card id, name or last 4 digits; "nakit" (or null) for cash / debit card.' },
  person: S.str("Person id or name the purchase belongs to."),
  category: {
    type: ["string", "null"], enum: [...K.CATEGORIES.map(c => c.id), null],
    description: `Spending category: ${K.CATEGORIES.map(c => `${c.id} = ${c.name} (${c.hint})`).join("; ")}. null removes it. Omit on add to reuse the category the user gave the same merchant before.`,
  },
  asset: { type: "string", enum: ["TRY", "USD", "EUR", "GAU"], description: 'What the purchase is paid in: TRY (default), USD, EUR or GAU (grams of gold). Non-TRY purchases are paid at once in cash from that asset (card "nakit", installments 1).' },
  ...REPEAT_FIELDS,
};
const CARD_FIELDS = {
  name: S.str("Card name, e.g. bank name."),
  limit: S.num("Credit limit in TRY (0 = unknown)."),
  cutoff_day: S.int("Statement cutoff day of month (hesap kesim günü).", 1, 31),
  due_day: S.int("Payment due day of month (son ödeme günü).", 1, 31),
  last4: S.str('Last 4 digits of the card (used to match bank e-mails). "" removes it.'),
  auto_pay: S.bool("Payment mode of the tracked card's statements. true (default) = each statement counts as paid the day after its due day; false = paid by hand: a statement stays owed until marked paid with pay_debt card=… (Ödendi) and shows as overdue after its due day. Switching to false applies from today (from track_since when tracking starts or track_since changes in the same call: statements since then are unpaid until marked paid); it fails on a day a card payment is dated (switch the next day). Switching back to true counts unpaid past statements as paid; it fails while recorded card payments would stop counting (payments ahead of the statements due; delete them or wait for those due days) and while the card is not tracked (an untracked card keeps its mode)."),
};

const ASSET = { type: "string", enum: ["TRY", "USD", "EUR", "GAU"], description: "TRY (Turkish lira), USD, EUR or GAU (gold, in grams)." };
const ENTRY_FIELDS = {
  asset: ASSET,
  direction: { type: "string", enum: ["in", "out"], description: '"in" = money / gold received or bought (giriş), "out" = spent, sold or given (çıkış).' },
  amount: S.num("Positive amount in the asset's own unit (lira, dollars, euros or grams of gold)."),
  description: S.str("What it is, e.g. Maaş, altın alımı."),
  date: S.date("Date, YYYY-MM-DD. For a repeating entry, the date of the first time."),
  person: S.str("Person id or name."),
  ...REPEAT_FIELDS,
};
const DEBT_FIELDS = {
  type: { type: "string", description: '"borrowed" = the user borrowed money from someone (borç aldım), "lent" = the user lent money to someone (borç verdim; a receivable, alacak), "loan" = a bank loan (kredi). The Turkish names work too.' },
  party: S.str("Who: the one the money was borrowed from / lent to (free text, need not be one of the people); for a loan the bank (optional)."),
  amount: S.num("Amount in the debt's asset: the total to repay, unless amount_type is per_installment."),
  amount_type: { type: "string", enum: ["total", "per_installment"], description: 'How to read amount. Default "total", for a loan "per_installment" (the monthly installment).' },
  installments: S.int("Number of monthly installments, the first on due_date. Default 1 for borrowed / lent; required for a loan.", 1, MAX_DEBT_COUNT),
  due_date: S.date("Due date (vade) of a single repayment, or the first installment's date; later installments fall on the same day of the following months. Required for a loan and with installments; leave out for no due date."),
  auto_pay: S.bool("Payment mode. true = each installment counts as paid the day after its date (no pay_debt needed; borrowed / lent need due_date); false = paid only when recorded with pay_debt (Ödendi), unpaid installments past their date show as overdue. Default: true for a loan, false for borrowed / lent. It cannot change once a loan has an installment between its date and today, or a borrowed / lent debt has an installment before today."),
  principal: S.num("Money that changed hands on date, in the debt's asset: it enters the owner's balance (borrowed, loan) or leaves it (lent). 0 = no money moved now (an older debt already reflected in the balances). Default: amount for borrowed / lent; none for a loan — pass what the bank paid out for a new loan (amount minus principal is interest and fees)."),
  date: S.date("When the debt starts (money changed hands), YYYY-MM-DD. A later date than today = not started yet. Loan installments before it count as paid before."),
  asset: { ...ASSET, description: "What the debt is in: TRY (default), USD, EUR or GAU (grams of gold). Its payments are in the same asset." },
  person: S.str("Whose debt it is (person id or name): whose asset balance it affects."),
  description: S.str("Optional note, e.g. what the money was for."),
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
    description: "Dashboard summary like the app's Özet tab: amount due in the month, next month's total, remaining total, the next upcoming payments, per-person and per-card figures (card and cash purchases; in the month totals card statements count on their due day whatever the payment mode). upcomingPayments: on a card paid by hand (auto_pay false) only what is not paid yet of each statement (covered = the part already paid; statements paid or paid ahead are left out), and its unpaid statements past their due day come first with late: true; a card's nextPayment likewise. Debt and loan installments the user pays are separate, under debts (in TRY; upcoming in their own asset); debts.unpaidCardStatements lists cards paid by hand with statements past or at their due day not yet marked paid (pay_debt card=…).",
    inputSchema: obj({ month: S.month("Month to summarize, YYYY-MM. Default: current month.") }),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const today = ctx.today;
      const start = monthArg(args.month, "month", today);
      const last = lastPaymentIndex(state, today);
      const end = Math.min(last, start + MAX_MONTHS - 1);
      const months = end >= start ? T.buildCashflow(state.people, state.cards, state.installments, start, end) : [];
      const at = idx => months.find(m => m.idx === idx);
      const thisMonth = at(start);

      // Sıradaki ödemeler (app.js renderUpcoming gibi): elle ödenen kartın ekstreleri borc.js'ten (ödenmiş ya da önceden
      // ödenmiş olan düşer, kapanmamış kısmı; ödenmemiş geçmiş ekstre late ile en üstte), diğerleri akıştaki ödemeler
      const from = T.parseDate(today).idx, until = upcomingUntil(today);
      const events = last >= from
        ? T.buildCashflow(state.people, state.cards, state.installments, from, Math.min(last, from + 24)).flatMap(m => m.events)
        : [];
      const manual = new Map(state.cards.map(c => [c.id, manualStatements(state, c, today, until)]).filter(([, m]) => m));
      const upcoming = [
        ...events.filter(e => e.date >= today && !(manual.has(e.cardId) && e.date >= manual.get(e.cardId).manualFrom))
          .map(ev => ({ date: ev.date, view: eventView(state, ev, { items: false }) })),
        ...[...manual].flatMap(([id, m]) => m.due.map(x => ({ date: x.key, late: x.state === "late", view: cardDueView(state, cardById(state, id), x) }))),
      ].sort((a, b) => (b.late ? 1 : 0) - (a.late ? 1 : 0) || a.date.localeCompare(b.date)).slice(0, UPCOMING);
      return {
        today,
        month: T.monthKey(start),
        dueThisMonth: round(thisMonth?.total),
        dueThisMonthByPerson: byName(state, thisMonth?.byPerson ?? {}, personName),
        dueThisMonthByCard: byName(state, thisMonth?.byCard ?? {}, cardKeyName),
        nextMonth: { month: T.monthKey(start + 1), total: round(at(start + 1)?.total) },
        remainingTotal: round(months.reduce((s, m) => s + m.total, 0)),
        lastPaymentMonth: months.length ? T.monthKey(months[months.length - 1].idx) : null,
        upcomingPayments: upcoming.map(x => x.view),
        people: state.people.map(p => ({
          name: p.name,
          dueThisMonth: round(thisMonth?.byPerson[p.id]),
          remaining: round(months.reduce((s, m) => s + (m.byPerson[p.id] || 0), 0)),
        })),
        cards: state.cards.map(c => {
          const v = cardView(state, c, today);
          const t = v.tracking;
          return {
            name: v.name, used: v.used, available: v.available, nextPayment: v.nextPayment,
            ...(t && { autoPay: t.autoPay }), ...(t && !t.autoPay && { unpaid: t.unpaid, overdue: t.overdue }),
          };
        }),
        debts: await debtsDue(state, today, start, ctx),
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
      category: { ...PURCHASE_FIELDS.category, description: 'Only this category (id); null = purchases without a category.' },
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
      const category = args.category !== undefined ? categoryArg(args.category) : undefined;
      const all = knownPurchases(state)
        .filter(p => category === undefined || (category ? p.category === category : !K.valid(p.category)))
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
    description: "Add a single or installment purchase — also any spending paid in cash from the user's assets (lira, dollars, euros or gold). Payment dates are computed from the card's cutoff and due days: a purchase up to and including the cutoff day goes into that month's statement, installments fall into following statements one month apart; cash is paid on the purchase day and deducted from that asset's balance. With repeat it recurs (every N days / weeks / months), each time as its own purchase on that card. Use dry_run to preview the schedule first.",
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
    description: "Credit cards with limit, used limit (installments still to be paid, plus unpaid past statements on a card paid by hand), available limit, cutoff and due days, next payment (on a card paid by hand, what is not paid yet of the next statement due today or later) and where a purchase made today would fall. tracking (null = not tracked): since — statements due from that date leave the first person's lira balance; autoPay true — the day after the due day, false — when marked paid with pay_debt card=… (from manualSince; unpaid = statements due and not paid yet, overdue = the part past the due day, since overdueSince). statement: the next statement to pay, what is not paid of it (alreadyCut = cut, waiting for the due day). payments: recorded statement payments (delete_debt_payment).",
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
    description: "Add a credit card. cutoff_day and due_day are on the card statement (ekstre). The card's statements are tracked from today (see update_card track_statements) and count as paid the day after the due day, unless auto_pay is false (then each is marked paid with pay_debt card=…).",
    inputSchema: obj(CARD_FIELDS, ["name", "cutoff_day", "due_day"]),
    annotations: WRITE,
    async run(args, ctx) {
      if (args.auto_pay !== undefined && typeof args.auto_pay !== "boolean") fail("auto_pay must be true or false.");
      return ctx.mutate(state => {
        // Yeni kart bugünden takipte (app.js kart formu gibi); elle ödenecekse ekstreleri de bugünden
        const c = { id: uid(), ...buildCard(state, args), color: T.nextColor(state.cards), trackSince: ctx.today,
          ...(args.auto_pay === false && { manualSince: ctx.today }) };
        state.cards.push(c);
        return { saved: true, card: cardView(state, c, ctx.today) };
      });
    },
  },
  {
    name: "update_card",
    title: "Update card",
    description: "Change a card's name, limit, cutoff / due day, last 4 digits, statement tracking or payment mode (auto_pay); omitted fields stay as they are. When the cutoff or due day changes and it matters for the card's purchases, the call fails listing the options for the purchases in between (transition); ask the user which one and call again with it. balanceChangeTry: how much the first person's lira balance changes because statements are deducted from another date (or no longer, or as paid now); note explains a payment mode change.",
    inputSchema: obj({
      card: S.str("Card id, name or last 4 digits."),
      ...CARD_FIELDS,
      track_statements: S.bool("Only when the user asks. true = the card's statements leave the first person's lira balance the day after the due day (or when marked paid, with auto_pay false), from track_since (other people's purchases on it are owed to the user); false = not tracked (e.g. someone else pays this card): its statements return to the balance and its debt is not counted."),
      track_since: S.date("Date tracking starts, YYYY-MM-DD, not after today. Default when turning tracking on: today. Statements due from this date on are deducted."),
      transition: {
        type: "string", enum: ["old", "new", "fix"],
        description: 'Only when cutoff_day / due_day change, chosen by the user: "old" = the open statement is still cut on the old days, new days start from the next one; "new" = statements already cut stay, new days apply from today; "fix" = the current days were entered wrong, recompute every payment that used them, past ones too (earlier day changes stay).',
      },
    }, ["card"]),
    annotations: { ...WRITE, idempotentHint: true },
    async run(args, ctx) {
      return ctx.mutate(state => {
        const cur = findCard(state, args.card) ?? fail("Cash is not a card.");
        // buildCard kartı yeniden kurar: takip alanları verilmezse karttan taşınır
        const v = { id: cur.id, ...buildCard(state, args, cur), color: cur.color, ...trackingArgs(args, cur, ctx.today) };
        const change = T.termChoices(cur, { cutoffDay: v.cutoffDay, dueDay: v.dueDay }, state.installments, ctx.today);
        const transition = typeof args.transition === "string" && change.cards && Object.hasOwn(change.cards, args.transition) ? args.transition : undefined;
        if (change.choices.length && !transition) fail(transitionQuestion(change, args.transition));
        const chosen = transition ? change.cards[transition] : change.card;
        const built = chosen.history ? { ...v, history: chosen.history } : v;
        const next = { ...built, ...payModeArgs(state, args, cur, built, ctx.today) };
        // Takibi bugünden başlayan (takibe giren ya da başlangıcı bugüne alınan) kartta bugün tarihli ödeme, ödediği ekstre
        // takipten önce kaldığı için sonraki ekstreleri kapatırdı (borc.js cardPaidToday): o gün bugünden takibe alınmaz
        if (B.tracked(next) && next.trackSince === ctx.today && (!B.tracked(cur) || cur.trackSince !== ctx.today)
          && B.cardPaidToday(state, cur, ctx.today)) {
          fail(`A payment on ${cur.name} is dated today: tracking from today would apply it to later statements (the statement it paid falls before tracking). Turn tracking on tomorrow, or pass an earlier track_since.`);
        }
        // Bu kartın düşülen ekstreleri (borc.js cardPaid): takip, günler ya da ödeme modu değişince bakiye değişir
        const deducted = c => B.cardPaid({ ...state, cards: [c] }, ctx.today);
        const before = deducted(cur);
        const was = B.cardDebt(state, cur, ctx.today);
        state.cards = state.cards.map(c => (c.id === cur.id ? next : c));
        const balanceChange = round(before - deducted(next));
        const out = { saved: true, card: cardView(state, next, ctx.today) };
        if (balanceChange || args.track_statements !== undefined || args.track_since !== undefined || args.auto_pay !== undefined) {
          out.balanceChangeTry = balanceChange;
        }
        const payer = personName(state, state.people[0]?.id);
        if (B.manual(next) && !B.manual(cur)) {
          // Takibin başından elle moda geçince (takip açılıyor ya da track_since değişiyor) o günden beri ödenmiş sayılan
          // ekstreler ödenmemiş olur; yalnızca bugünden geçişte önceki ekstreler ödenmiş kalır
          const fresh = !B.tracked(cur) || next.trackSince !== cur.trackSince;
          const nd = B.cardDebt(state, next, ctx.today);
          const owed = nd.statements.filter(x => x.state === "late" || x.state === "due");
          const tail = !fresh ? " Earlier statements stay paid."
            : owed.length ? ` ${owed.length} statement(s) due since ${next.manualSince} (${round(nd.unpaid)} TRY) are now unpaid: they stay owed until marked paid${owed.some(x => x.state === "late") ? ` (overdue since ${nd.overdueSince})` : ""}.`
            : "";
          out.note = `From ${next.manualSince} ${next.name}'s statements stay owed until marked paid with pay_debt card="${next.name}" (amount defaults to what is due); unpaid ones past their due day show as overdue.${tail}`;
        } else if (B.manual(cur) && !B.manual(next)) {
          const late = was.statements.filter(x => x.state === "late");
          out.note = (late.length ? `${late.length} overdue statement(s) (${round(was.overdue)} TRY) now count as paid, deducted from ${payer}'s lira balance. ` : "")
            + `${next.name}'s statements count as paid the day after their due day again.`;
        }
        return out;
      });
    },
  },
  {
    name: "delete_card",
    title: "Delete card",
    description: "Permanently delete a card AND every purchase on it and every statement payment recorded for it (pay_debt card; as the app does). The card's statements already deducted from the first person's lira balance since tracking began (or paid with those payments) return to the balance (balanceChangeTry). Tell the user how many purchases and payments will go before calling.",
    inputSchema: obj({ card: S.str("Card id, name or last 4 digits.") }, ["card"]),
    annotations: DESTROY,
    async run(args, ctx) {
      return ctx.mutate(state => {
        const c = findCard(state, args.card) ?? fail("Cash is not a card.");
        const n = state.installments.filter(p => p.cardId === c.id).length;
        // Kartın ödemeleri de gider (kartı olmayan kart ödemesi kalmaz)
        const ofCard = x => x?.kind === "payment" && !x.debtId && x.cardId === c.id;
        const m = state.debts.filter(ofCard).length;
        const back = B.cardPaid({ ...state, cards: [c] }, ctx.today);
        state.cards = state.cards.filter(x => x.id !== c.id);
        state.installments = state.installments.filter(p => p.cardId !== c.id);
        state.debts = state.debts.filter(x => !ofCard(x));
        return { deleted: { id: c.id, name: c.name }, deletedPurchases: n, deletedPayments: m, ...(back ? { balanceChangeTry: round(back) } : {}) };
      });
    },
  },

  // ── Kişiler ──
  {
    name: "list_people",
    title: "List people (Kişiler)",
    description: "People purchases are tracked for, with their purchase count, amount due this month and remaining amount. For everyone but the first person, owesUser: what they owe the first person (the user, who pays the cards) for their purchases on tracked cards, minus what they paid back (pay_debt person); negative = paid too much.",
    inputSchema: obj(),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const start = T.parseDate(ctx.today).idx;
      const end = Math.min(lastPaymentIndex(state, ctx.today), start + MAX_MONTHS - 1);
      const months = end >= start ? T.buildCashflow(state.people, state.cards, state.installments, start, end) : [];
      const shares = B.shares(state, ctx.today);
      return {
        people: state.people.map(p => ({
          id: p.id,
          name: p.name,
          purchaseCount: state.installments.filter(i => i.personId === p.id).length,
          dueThisMonth: round(months[0]?.idx === start ? months[0].byPerson[p.id] : 0),
          remaining: round(months.reduce((s, m) => s + (m.byPerson[p.id] || 0), 0)),
          ...(p.id !== state.people[0].id && { owesUser: round(shares.get(p.id)?.remaining) }),
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
    description: "Permanently delete a person AND all of their purchases, asset entries and debts (with their payments) and their card share payments; deleting the first person also removes the card share payments made to them and the card statement payments they made (on a card paid by hand those statements are owed again). The result counts each: deletedPurchases, deletedEntries, deletedDebts, deletedCardPayments, deletedSharePayments. At least one person must remain.",
    inputSchema: obj({ person: S.str("Person id or name.") }, ["person"]),
    annotations: DESTROY,
    async run(args, ctx) {
      return ctx.mutate(state => {
        const p = findPerson(state, args.person);
        if (state.people.length === 1) fail("At least one person must remain.");
        const n = state.installments.filter(i => i.personId === p.id).length;
        const m = state.entries.filter(e => e.personId === p.id).length;
        // Borçları ve onların ödemeleri; ilk kişi (kartları ödeyen) silinirse ona yapılan kart payı ödemeleri de (kart
        // ödemeleri onundur, kişisiyle gider; debtId'siz ve kartsız ödeme kart payıdır)
        const payer = state.people[0].id === p.id;
        const gone = new Set(state.debts.filter(d => d?.kind !== "payment" && d?.personId === p.id).map(d => d.id));
        const keep = d => d && d.personId !== p.id
          && !(d.kind === "payment" && (gone.has(d.debtId) || (payer && !d.debtId && !d.cardId)));
        // Silinen kart ekstresi ödemeleri (elle ödenen kartta o ekstreler yeniden borç olur) ve kart payı ödemeleri
        const removed = state.debts.filter(d => d?.kind === "payment" && !d.debtId && !keep(d));
        state.people = state.people.filter(x => x.id !== p.id);
        state.installments = state.installments.filter(i => i.personId !== p.id);
        state.entries = state.entries.filter(e => e.personId !== p.id);
        state.debts = state.debts.filter(keep);
        return {
          deleted: { id: p.id, name: p.name }, deletedPurchases: n, deletedEntries: m, deletedDebts: gone.size,
          deletedCardPayments: removed.filter(d => d.cardId).length, deletedSharePayments: removed.filter(d => !d.cardId).length,
        };
      });
    },
  },

  // ── Varlıklar (TL, döviz, altın) ──
  {
    name: "get_assets",
    title: "Assets (Varlıklar)",
    description: "Balances of Turkish lira, US dollars, euros and grams of gold (sum of all entries minus cash purchases paid from them, plus borrowed / loan principal and collections on money lent, minus money lent, repayments and loan installments, minus tracked cards' statements paid since tracking began (the day after the due day, or when marked paid with pay_debt card=… on a card paid by hand), plus card share payments; repeating ones only up to today), each with its value in TRY at the current market rate, and the total in TRY (totalTry). Also, as in list_debts: receivablesTry (owed to the user), debtsTry, totalAssetsTry (= totalTry + receivablesTry = netWorthTry + debtsTry), netWorthTry, untrackedCardDebtTry (debt of cards whose statements are not tracked, not in debtsTry) and which cards are tracked since when.",
    inputSchema: obj({ person: S.str("Only this person's assets (id or name).") }),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const person = args.person !== undefined ? findPerson(state, args.person) : null;
      const rates = await ratesOrNull(ctx);
      // Bakiyeler borç etkileriyle (cashSpent → borc.js spent); Varlık = Özvarlık + Borç aynı hesaptan
      const t = B.totals(state, ctx.today, rates?.rates, person?.id);
      const bals = t.balances;
      const { cashTry, ...worth } = worthView(t);
      return {
        person: person?.name ?? "all",
        assets: V.ASSETS.map(a => {
          const value = V.toTry(bals[a.code] ?? 0, a.code, rates?.rates);
          return { asset: a.code, name: a.name, balance: bals[a.code] ?? 0, unit: a.code === "GAU" ? "gram" : a.code, tryValue: value == null ? null : round(value) };
        }),
        totalTry: cashTry,
        ...worth,
        cardTracking: state.cards.map(c => ({ card: c.name, cardId: c.id, since: B.tracked(c) ? B.since(c, ctx.today) : null })),
        ...(t.missing.length ? { notIncludedInTotal: t.missing } : {}),
        rates: rates ? { ...rates.rates, updatedAt: rates.updatedAt, source: rates.source } : null,
        ...(rates ? {} : { ratesError: "Current rates are unavailable; only TRY balances are counted in the total." }),
      };
    },
  },
  {
    name: "list_entries",
    title: "List asset entries",
    description: "Lira / foreign currency / gold inflows and outflows, newest first. A repeating entry is one item (amount per month) with its repeat details.",
    inputSchema: obj({
      person: S.str("Only this person's entries (id or name)."),
      asset: ASSET,
      from: S.date("Only entries on or after this date (repeating ones: still repeating on or after it)."),
      to: S.date("Only entries on or before this date (repeating ones: starting on or before it)."),
      search: S.str("Case-insensitive text to look for in the description."),
      limit: S.int("Maximum number of entries (default 100).", 1, 1000),
    }),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const person = args.person !== undefined ? findPerson(state, args.person) : null;
      const asset = args.asset !== undefined ? assetArg(args.asset) : null;
      for (const k of ["from", "to"]) if (args[k] !== undefined && !validDate(args[k])) fail(`${k} must be a date like 2026-10-19.`);
      const q = args.search ? T.normalize(args.search) : "";
      const order = new Map(state.entries.map((e, i) => [e.id, i]));
      const all = knownEntries(state)
        .filter(e => (!person || e.personId === person.id) && (!asset || e.asset === asset))
        .filter(e => entryInRange(e, args.from, args.to))
        .filter(e => !q || T.normalize(e.desc).includes(q))
        .sort((a, b) => b.date.localeCompare(a.date) || order.get(b.id) - order.get(a.id));
      const rates = all.some(e => e.asset !== "TRY") ? await ratesOrNull(ctx) : null;
      const limit = intArg(args.limit, "limit", 1, 1000, 100);
      return { count: all.length, entries: all.slice(0, limit).map(e => entryView(state, e, rates, ctx.today)) };
    },
  },
  {
    name: "add_entry",
    title: "Add asset entry",
    description: "Record lira, dollars, euros or grams of gold coming in (salary, buying gold / currency), once or repeating every N days / weeks / months. Spending (çıkış) — in cash from an asset or on a card — goes to add_purchase (with asset and card \"nakit\"); direction \"out\" here is kept for selling or giving away.",
    inputSchema: obj({
      ...ENTRY_FIELDS,
      date: S.date("Date, YYYY-MM-DD. Default: today."),
      person: S.str("Person id or name. Default: the first person."),
    }, ["asset", "direction", "amount", "description"]),
    annotations: WRITE,
    async run(args, ctx) {
      const rates = await ratesOrNull(ctx);
      return ctx.mutate(state => {
        const e = { id: uid(), ...buildEntry(state, args, ctx.today) };
        state.entries.push(e);
        const balance = V.balances(knownEntries(state).filter(x => x.personId === e.personId), ctx.today,
          cashSpent(state, ctx.today, e.personId))[e.asset] ?? 0;
        return { saved: true, entry: entryView(state, e, rates, ctx.today), balance };
      });
    },
  },
  {
    name: "update_entry",
    title: "Update asset entry",
    description: "Change fields of an asset entry; omitted fields stay as they are. To stop a repeating entry, set repeat to the number of times it has been processed (or 1 to keep only the first); if it has not been processed yet, delete it instead (repeat 0 means no end).",
    inputSchema: obj({ id: S.str("Entry id."), ...ENTRY_FIELDS }, ["id"]),
    annotations: { ...WRITE, idempotentHint: true },
    async run(args, ctx) {
      const rates = await ratesOrNull(ctx);
      return ctx.mutate(state => {
        const cur = findEntry(state, args.id);
        const next = { id: cur.id, ...buildEntry(state, args, ctx.today, cur) };
        state.entries = state.entries.map(x => (x.id === cur.id ? next : x));
        return { saved: true, entry: entryView(state, next, rates, ctx.today) };
      });
    },
  },
  {
    name: "delete_entry",
    title: "Delete asset entry",
    description: "Permanently delete an asset entry.",
    inputSchema: obj({ id: S.str("Entry id.") }, ["id"]),
    annotations: { ...DESTROY, idempotentHint: true },
    async run(args, ctx) {
      return ctx.mutate(state => {
        const e = findEntry(state, args.id);
        state.entries = state.entries.filter(x => x.id !== e.id);
        return { deleted: { id: e.id, description: e.desc } };
      });
    },
  },

  // ── Borçlar / alacaklar ──
  {
    name: "list_debts",
    title: "Debts and receivables (Borçlar)",
    description: "Like the app's Borçlar tab. totals (TRY at the current rate): cash on hand (asset balances), receivables (owed to the user; cardCredit = paid more than a card's debt), debts, total assets = cash + receivables = net worth + debts. cards: each card's debt (unpaid installments), its next statement and each person's part of that debt; autoPay is the tracked card's payment mode — for a card paid by hand also unpaid / overdue (since overdueSince), its statements (date, amount, covered = paid part, state paid / due (today) / late / open) and payments (pay_debt card=… marks a statement paid). cashInstallments: unpaid installments of cash purchases. shares: what other people owe the first person for their purchases on tracked cards (pay_debt person=… records their payment). cardCredit: tracked cards paid more than their debt (a credit on the card, part of receivables; with side receivable or all). debts: money borrowed or lent and bank loans recorded with add_debt, with what is paid and what is left (autoPay false = installments are paid by hand, overdue past their date).",
    inputSchema: obj({
      side: { type: "string", enum: ["debt", "receivable", "all"], description: '"debt" = what the user owes (borçlarım: cards, cash installments, borrowed, loans), "receivable" = what others owe the user (alacaklarım: card shares, lent, cardCredit). Default "all".' },
      status: { type: "string", enum: ["open", "closed", "all"], description: 'Which debts and card shares: "open" (default; also debts not started yet), "closed" (paid off or closed) or "all".' },
      person: S.str("Only this person's records (id or name): their debts, and for the first person the cards too. This person's card share is listed as well."),
      search: S.str("Case-insensitive text to look for in the other party, description, card or person name."),
    }),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const today = ctx.today;
      const side = args.side ?? "all";
      if (!["debt", "receivable", "all"].includes(side)) fail('side must be "debt", "receivable" or "all".');
      const status = args.status ?? "open";
      if (!["open", "closed", "all"].includes(status)) fail('status must be "open", "closed" or "all".');
      const person = args.person !== undefined ? findPerson(state, args.person) : null;
      const q = args.search ? T.normalize(args.search) : "";
      const has = (...texts) => !q || texts.some(x => T.normalize(x).includes(q));
      const wants = st => status === "all" || (status === "closed") === (st === "closed");
      const rates = (await ratesOrNull(ctx))?.rates;
      const t = B.totals(state, today, rates, person?.id);
      const payer = state.people[0].id;
      const debts = t.list
        .filter(x => (side === "all" || B.side(x.debt) === side) && has(x.debt.party, x.debt.desc))
        .map(x => debtView(state, x.debt, today, rates, { pays: x.pays }))
        .filter(v => wants(v.status))
        .sort((a, b) => (a.status === "closed") - (b.status === "closed")
          || (a.nextPayment?.date ?? "9").localeCompare(b.nextPayment?.date ?? "9")
          || b.date.localeCompare(a.date));
      const shares = [...B.shares(state, today)]
        .filter(([pid]) => !person || person.id === payer || person.id === pid)
        .map(([pid, s]) => shareView(state, pid, s, today))
        .filter(v => has(v.person) && wants(v.owed ? "open" : "closed"));
      // Kartlar ve nakit taksitler kapanmaz: yalnızca açıklarla (ya da hepsiyle) listelenir. Fazla ödenmiş kart (kartta artı
      // bakiye) alacaktır: alacaklarla da listelenir (uygulamadaki Alacaklarım → Kartlar gibi; receivablesTry'ye girer)
      const owes = side !== "receivable" && status !== "closed";
      const cardCredit = side !== "debt" && status !== "closed"
        ? t.cards.filter(c => c.tracked && c.credit > EPS && has(c.card.name)).map(c => ({ cardId: c.card.id, card: c.card.name, credit: round(c.credit) }))
        : [];
      const cash = B.cashDebt(state, today, person?.id);
      return {
        today,
        totals: {
          ...worthView(t),
          debtsByKind: {
            cards: round(t.debt.cards), cashInstallments: round(t.debt.cash), loans: round(t.debt.loans),
            people: round(t.debt.people), overpaidCardShares: round(t.debt.overpaid),
          },
          receivablesByKind: { cardShares: round(t.receivable.cards), people: round(t.receivable.people), cardCredit: round(t.receivable.cardCredit) },
          ...(t.missing.length ? { notIncluded: t.missing } : {}),
        },
        cards: owes ? t.cards.filter(c => has(c.card.name)).map(c => cardDebtView(state, c, today)) : [],
        cashInstallments: owes && !q
          ? { totalTry: round(t.debt.cash), byAsset: Object.fromEntries(Object.entries(cash).map(([code, v]) => [code, V.round(v, code)])) }
          : null,
        // Pay ödenmemişse alacak, fazla ödenmişse kullanıcının borcu (Borçlar'daki gibi)
        shares: shares.filter(v => side === "all" || (side === "debt" ? v.owed < 0 : v.owed >= 0)),
        cardCredit,
        debts,
        currency: "TRY",
      };
    },
  },
  {
    name: "get_debt",
    title: "Get debt",
    description: "One debt, receivable or loan with its payments and installment schedule (each installment's date, amount, how much of it is covered and its state: paid, due today, late or open).",
    inputSchema: obj({ id: S.str("Debt id.") }, ["id"]),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const d = findDebt(state, args.id);
      const rates = d.asset !== "TRY" ? (await ratesOrNull(ctx))?.rates : null;
      return { ...debtView(state, d, ctx.today, rates, { schedule: true }), preview: debtPreview(state, d) };
    },
  },
  {
    name: "add_debt",
    title: "Add debt / receivable / loan",
    description: "Record money the user borrowed from someone (borrowed), lent to someone (lent, a receivable) or a bank loan (loan), in TRY, USD, EUR or gold; repaid at once (optional due date) or in monthly installments from due_date. Payment mode (auto_pay): loan installments count as paid the day after their dates unless auto_pay is false; borrowed / lent are repaid when recorded with pay_debt (in parts too) unless auto_pay is true. Paid by hand, unpaid installments past their date show as overdue. By default the borrowed / lent money enters / leaves the owner's asset balance on date (principal; 0 for an older debt). Card and cash purchases are not added here (add_purchase). Use dry_run to preview first.",
    inputSchema: obj({
      ...DEBT_FIELDS,
      date: S.date("When the debt starts (money changed hands), YYYY-MM-DD. Default: today. A later date = not started yet; loan installments before it count as paid before."),
      person: S.str("Whose debt it is (person id or name): whose asset balance it affects. Default: the first person."),
      dry_run: S.bool("Only compute and return the preview, do not save."),
    }, ["type", "amount"]),
    annotations: WRITE,
    async run(args, ctx) {
      const today = ctx.today;
      const rates = (await ratesOrNull(ctx))?.rates;
      const make = state => {
        const d = { id: uid(), ...buildDebt(state, args, today) };
        return { d, before: balanceOf(state, d.personId, d.asset, today) };
      };
      const result = (state, d, before) => ({
        debt: debtView(state, d, today, rates, { schedule: true }),
        preview: debtPreview(state, d),
        balance: { person: personName(state, d.personId), asset: d.asset, before, after: balanceOf(state, d.personId, d.asset, today) },
      });
      if (args.dry_run) {
        const state = await ctx.load();
        const { d, before } = make(state);
        return { saved: false, ...result({ ...state, debts: [...state.debts, d] }, d, before) };
      }
      return ctx.mutate(state => {
        const { d, before } = make(state);
        state.debts.push(d);
        return { saved: true, ...result(state, d, before) };
      });
    },
  },
  {
    name: "update_debt",
    title: "Update debt",
    description: "Change fields of a debt, receivable or loan; omitted fields stay as they are (changing installments keeps the total unless amount is given too). closed: a date closes it (what is left is no longer owed or expected; a loan's later installments are dropped), null reopens it. Changing person moves its payments too. The payment mode (auto_pay) cannot change once a loan has an installment between its date and today, or a borrowed / lent debt has an installment before today.",
    inputSchema: obj({
      id: S.str("Debt id."),
      ...DEBT_FIELDS,
      due_date: { ...DEBT_FIELDS.due_date, type: ["string", "null"], description: DEBT_FIELDS.due_date.description + " null removes it." },
      closed: { type: ["string", "null"], description: 'Close date, YYYY-MM-DD, not after today; null or "" reopens it.' },
    }, ["id"]),
    annotations: { ...WRITE, idempotentHint: true },
    async run(args, ctx) {
      const rates = (await ratesOrNull(ctx))?.rates;
      return ctx.mutate(state => {
        const cur = findDebt(state, args.id);
        const next = { id: cur.id, ...buildDebt(state, args, ctx.today, cur) };
        // Ödeme modu geçmiş taksitler varken değişmez: ödenmiş sayılanlar gecikmiş olur ya da kaydedilen ödemeler ikinci
        // kez düşer (borc.js modeLocked)
        if (B.auto(next) !== B.auto(cur) && B.modeLocked(cur, ctx.today)) {
          // Kredide date'ten önceki taksitler takipten önce ödenmiştir (kilitlemez); kişisel borçta bugünden önceki her taksit
          const loan = cur.kind === "loan";
          const span = loan ? `installments between its date (${cur.date}) and today` : `an installment due before today (on ${B.schedule(cur)[0].key})`;
          const fresh = loan ? "a new one from today (date today: earlier installments count as paid before)" : "a new one for what is left, with its due date today or later";
          fail(`The payment mode can't change: this ${loan ? "loan" : "debt"} has ${span}, and switching would reinterpret them (paid ones turning overdue, or recorded payments counting twice). It stays ${B.auto(cur) ? "automatic" : "paid by hand"}${args.auto_pay === undefined ? `; pass auto_pay: ${B.auto(cur)} to keep it` : ""}. To start over, close it (closed) and add ${fresh}.`);
        }
        // Ödemeler borcun sahibinindir: sahibi değişince aynı kayıtta onlar da taşınır
        state.debts = state.debts.map(x => (x?.id === cur.id ? next
          : x?.kind === "payment" && x.debtId === cur.id && x.personId !== next.personId ? { ...x, personId: next.personId }
          : x));
        return { saved: true, debt: debtView(state, next, ctx.today, rates) };
      });
    },
  },
  {
    name: "delete_debt",
    title: "Delete debt",
    description: "Permanently delete a debt, receivable or loan AND its payments; its effect on the asset balances is undone. To record that it is paid off, use pay_debt (close) or update_debt (closed) instead.",
    inputSchema: obj({ id: S.str("Debt id.") }, ["id"]),
    annotations: { ...DESTROY, idempotentHint: true },
    async run(args, ctx) {
      return ctx.mutate(state => {
        const d = findDebt(state, args.id);
        const ofDebt = x => x?.kind === "payment" && x.debtId === d.id;
        const n = state.debts.filter(ofDebt).length;
        state.debts = state.debts.filter(x => x?.id !== d.id && !ofDebt(x));
        return { deleted: { id: d.id, type: typeOf(d), party: d.party ?? null, description: d.desc ?? "" }, deletedPayments: n };
      });
    },
  },
  {
    name: "pay_debt",
    title: "Record debt payment",
    description: "Record a payment on a debt (the user paid back: Ödedim), a collection on a receivable (the user was paid back: Ödedi), an installment of a loan paid by hand (Ödendi; it covers the earliest unpaid installment) or an extra / early payment on an automatic loan (it comes off the last installments), partial or full; the money leaves / enters the owner's asset balance on date. With person instead of debt: that person paid the user (the first person) back for their purchases on tracked cards (card share, TRY). With card instead: a statement of a card paid by hand (auto_pay false) was paid (Ödendi) from the first person's lira balance; it covers the oldest unpaid statement first, a partial payment leaves the rest owed (overdue past the due day), more than is due covers the next statements. Pass exactly one of debt, person or card. close: true also closes the debt (e.g. a loan paid off early).",
    inputSchema: obj({
      debt: S.str("Debt id (from list_debts)."),
      person: S.str("Instead of debt: who paid their card share (person id or name; not the first person)."),
      card: S.str("Instead of debt: the card (id, name or last 4 digits) whose statement was paid; only for a tracked card paid by hand (update_card auto_pay false)."),
      amount: S.num("Amount paid, in the debt's asset (TRY for a card share or card). Required, except for a card: default the statements due (late or due today), otherwise the statement already cut."),
      date: S.date("Payment date, YYYY-MM-DD, not after today (for a card not before it was switched to paying by hand). Default: today."),
      description: S.str("Optional note."),
      close: S.bool("Also close the debt on date: what is left is no longer owed or expected (a loan's later installments are dropped)."),
    }),
    annotations: WRITE,
    async run(args, ctx) {
      const today = ctx.today;
      const given = ["debt", "person", "card"].filter(k => args[k] !== undefined);
      if (!given.length) fail("Pass debt (a debt id from list_debts), person to record a card share payment, or card to mark a card statement paid.");
      if (given.length > 1) fail(`Pass only one of debt, person or card (got ${given.join(" and ")}).`);
      const date = args.date ?? today;
      if (typeof date !== "string" || !validDate(date)) fail('date must be a valid date like "2026-10-18".');
      if (date > today) fail("date must not be after today: record a payment once it is made.");
      const desc = args.description !== undefined ? text(args.description ?? "", "description") : "";
      if (args.close !== undefined && typeof args.close !== "boolean") fail("close must be true or false.");
      const rates = (await ratesOrNull(ctx))?.rates;
      return ctx.mutate(state => {
        if (args.card !== undefined) {
          // Kart ekstresi ödemesi (Ödendi): ilk kişinin TL varlığından; ödemeler en eski ödenmemiş ekstreden kapatır
          if (args.close !== undefined) fail("close is only for a debt; a card has nothing to close.");
          const card = findCard(state, args.card) ?? fail("Cash is not a card: pass a card id, name or last 4 digits.");
          if (!B.tracked(card)) fail(`${card.name}'s statements are not tracked, so they are not paid from the balances. Ask the user; update_card track_statements turns tracking on.`);
          if (!B.manual(card)) fail(`${card.name}'s statements are paid automatically (the day after the due day); there is nothing to mark paid. To mark them paid by hand, update_card auto_pay false first (ask the user).`);
          const cd = B.cardDebt(state, card, today);
          if (date < cd.manualFrom) fail(`date must not be before ${cd.manualFrom}: ${card.name}'s statements are paid by hand from then on (earlier ones counted as paid automatically).`);
          // Ödemesi gelen (gecikmiş ya da bugün) ekstreler, yoksa kesilmiş ekstre; fazlası ileriki ekstreleri önceden kapatır
          const cut = cd.next?.cut && cd.next.date > today ? cd.next.amount : 0;
          let amount;
          if (args.amount !== undefined) amount = amountArg(args.amount, "TRY");
          else if (cd.unpaid > EPS) amount = round(cd.unpaid);
          else if (cut > EPS) amount = round(cut);
          else fail(`amount is required: no statement of ${card.name} is due or cut yet${cd.next ? ` (next: ${round(cd.next.amount)} TRY so far, due ${cd.next.date})` : ""}.`);
          const payer = state.people[0];
          const x = { id: uid(), kind: "payment", personId: payer.id, cardId: card.id, amount, date, ...(desc && { desc }) };
          state.debts.push(x);
          const after = B.cardDebt(state, card, today);
          const out = { saved: true, payment: paymentView(x, "TRY"), card: cardDebtView(state, after, today) };
          if (amount > cd.unpaid + cut + EPS) {
            out.warning = `This payment is ${round(amount - cd.unpaid - cut)} TRY more than the statements due or already cut (${round(cd.unpaid + cut)} TRY); the rest covers later statements`
              + (after.credit > EPS ? `, and ${round(after.credit)} TRY is more than the card's whole debt (a credit on the card).` : ".");
          }
          return out;
        }
        if (args.person !== undefined) {
          // Kart payı: debtId'siz ödeme, ilk kişinin TL varlığına girer
          if (args.close !== undefined) fail("close is only for a debt; a card share has nothing to close.");
          const p = findPerson(state, args.person);
          const payer = state.people[0];
          if (p.id === payer.id) fail(`${p.name} pays the cards: card shares are what other people owe ${p.name}. Pass someone else, or a debt.`);
          if (!state.cards.some(c => B.tracked(c))) fail("No card's statements are tracked, so nobody owes a card share. Ask the user; update_card track_statements turns tracking on.");
          if (args.amount === undefined) fail("amount is required.");
          // Takip tarihi henüz yazılmamış kartlar bugünden takipte (uygulamadaki gibi); pay her gün kaymasın
          const cards = B.ensureTracking(state, today);
          if (cards) state.cards = cards;
          const x = { id: uid(), kind: "payment", personId: p.id, amount: amountArg(args.amount, "TRY"), date, ...(desc && { desc }) };
          state.debts.push(x);
          const s = B.shares(state, today).get(p.id);
          const out = { saved: true, payment: paymentView(x, "TRY"), share: shareView(state, p.id, s, today) };
          if (s.remaining < 0) out.warning = `${p.name} has now paid ${round(-s.remaining)} TRY more than their card share; it counts as owed back to them.`;
          return out;
        }
        const d = findDebt(state, args.debt);
        if (args.amount === undefined) fail("amount is required.");
        if (date < d.date) fail(`date must not be before the debt's date (${d.date}).`);
        const st = B.status(d, paymentsOfDebt(state, d), today);
        if (st.closed) fail(`This debt was closed on ${d.closed}; reopen it with update_debt (closed: null) first.`);
        const x = { id: uid(), kind: "payment", personId: d.personId, debtId: d.id, amount: amountArg(args.amount, d.asset), date, ...(desc && { desc }) };
        state.debts.push(x);
        // Kendiliğinden ödenen borç bugünle kapanır: geçmiş tarihli kapatma, o günden beri ödenmiş taksitleri silerdi
        if (args.close === true) d.closed = B.auto(d) ? today : date;
        const out = { saved: true, payment: paymentView(x, d.asset), debt: debtView(state, d, today, rates) };
        if (x.amount > st.remaining + 0.005) out.warning = `This payment is more than the ${V.round(st.remaining, d.asset)} ${d.asset} left on the debt.`;
        return out;
      });
    },
  },
  {
    name: "delete_debt_payment",
    title: "Delete debt payment",
    description: "Permanently delete a payment recorded with pay_debt (on a debt, a card share payment or a card statement payment); the debt, share or statement is owed again and the asset balance changes back. A closed debt is reopened (reopened: true), so what the payment covered is not silently written off.",
    inputSchema: obj({ id: S.str("Payment id (debt payments in get_debt / list_debts, card share payments in list_debts shares, card statement payments in list_cards / list_debts cards payments).") }, ["id"]),
    annotations: { ...DESTROY, idempotentHint: true },
    async run(args, ctx) {
      const rates = (await ratesOrNull(ctx))?.rates;
      return ctx.mutate(state => {
        const x = findDebtPayment(state, args.id);
        const d = x.debtId ? B.known(state).items.find(y => y.id === x.debtId) : null;
        state.debts = state.debts.filter(y => y?.id !== x.id);
        // Kapanmış borcun ödemesi silinince borç yeniden açılır (kapatan ödeme silinince kalan sessizce silinmesin)
        const reopened = !!d?.closed;
        if (reopened) delete d.closed;
        const asset = d?.asset ?? "TRY";
        const out = { deleted: { id: x.id, date: x.date, amount: V.round(x.amount, asset), asset }, ...(reopened && { reopened: true }) };
        const card = !x.debtId && x.cardId ? cardById(state, x.cardId) : null;
        if (d) out.debt = debtView(state, d, ctx.today, rates);
        else if (card) out.card = cardDebtView(state, B.cardDebt(state, card, ctx.today), ctx.today);
        else if (!x.debtId && !x.cardId) out.share = shareView(state, x.personId, B.shares(state, ctx.today).get(x.personId), ctx.today);
        return out;
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
              const p = withRemembered(fresh, { id: uid(), personId, ...emailPurchase(x.parsed, card) });
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

  // ── İçgörüler ──
  {
    name: "get_insights",
    title: "Insights (İçgörüler)",
    description: "The app's insight cards, most important first: free cash this month (income from asset entries minus card payments and outflows) or the first month that runs short, installment-to-income ratio for the next months, cards close to their limit, an upcoming jump in payments, a category spending more than usual, which card gives the latest first payment for a purchase made today, recurring payments (subscriptions, rent), debt and loan payments that are late or due within 7 days and statements of cards paid by hand that are past their due day unpaid (borc-vade), money owed to the user that is due — card shares and late receivables (alacak), other people's share this month (only when no card is tracked), the month installments end. Texts are Turkish; data has the numbers.",
    inputSchema: obj(),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const rates = await ratesOrNull(ctx);
      return { today: ctx.today, insights: I.insights(state, { today: ctx.today, rates: rates?.rates }), currency: "TRY" };
    },
  },
  {
    name: "spending_by_category",
    title: "Spending by category",
    description: "What was bought each month by category (by purchase date; an installment purchase counts fully in the month it was bought), with each category's share and its average over the previous 3 months. Purchases without a category are listed as category null.",
    inputSchema: obj({
      month: S.month("Last month, YYYY-MM. Default: current month."),
      months: S.int("How many months back to include (default 1).", 1, 24),
      person: S.str("Only this person's purchases (id or name)."),
    }),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const last = monthArg(args.month, "month", ctx.today);
      const count = intArg(args.months, "months", 1, 24, 1);
      const person = args.person !== undefined ? findPerson(state, args.person) : null;
      const scoped = person ? { ...state, people: [person] } : state;
      const rates = state.installments.some(p => T.assetOf(p) !== "TRY") ? (await ratesOrNull(ctx))?.rates : null;
      const months = [];
      for (let idx = last - count + 1; idx <= last; idx++) {
        const b = I.categoryBreakdown(scoped, idx, rates);
        months.push({
          month: T.monthKey(idx),
          total: round(b.total),
          categories: b.rows.map(r => ({
            category: r.id || null, name: r.name, amount: round(r.value), share: Math.round(r.share * 1000) / 1000,
            previous3MonthAverage: r.average == null ? null : round(r.average),
          })),
        });
      }
      return { months, currency: "TRY" };
    },
  },
  {
    name: "simulate_purchase",
    title: "Simulate purchase",
    description: "What a purchase would change, without saving it: its payment schedule, each affected month's total payments and free cash before and after (free cash = income minus card payments and outflows, from asset entries), and the card's used limit after. Also compares every card for a purchase on that date (first payment date). Use it to answer \"can I afford this?\" or \"which card should I use?\".",
    inputSchema: obj({
      ...PURCHASE_FIELDS,
      date: S.date("Purchase date, YYYY-MM-DD. Default: today."),
      card: { ...PURCHASE_FIELDS.card, description: PURCHASE_FIELDS.card.description + " Default: the card whose first payment comes latest." },
      person: S.str("Person id or name. Default: the first person."),
    }, ["amount"]),
    annotations: READ,
    async run(args, ctx) {
      const state = await ctx.load();
      const rates = (await ratesOrNull(ctx))?.rates;
      const date = args.date ?? ctx.today;
      if (!validDate(date)) fail('date must be a valid date like "2026-10-18".');
      const timing = I.cardTiming(state, date, ctx.today).filter(x => !x.full);
      const fields = { description: "Simülasyon", ...args, date };
      if (args.card === undefined) fields.card = args.asset === undefined || assetArg(args.asset) === "TRY" ? timing[0]?.card.id ?? null : null;
      const { personId, p } = buildPurchase(state, fields, ctx.today);
      const purchase = { id: "simulasyon", personId, ...p };
      const after = { ...state, installments: [...state.installments, purchase] };
      const pays = T.payments(purchase, cardById(state, purchase.cardId), ctx.today);
      const from = pays[0].idx, to = pays[pays.length - 1].idx;
      const flowsOf = s => T.buildCashflow(s.people, s.cards, s.installments, from, to);
      const before = flowsOf(state), next = flowsOf(after);
      const card = cardById(state, purchase.cardId);
      return {
        purchase: purchaseView(after, purchase, ctx.today, { schedule: true }),
        months: next.map((m, i) => {
          const a = I.monthFlows(state, m.idx, rates, before, ctx.today), b = I.monthFlows(after, m.idx, rates, next, ctx.today);
          return {
            month: T.monthKey(m.idx),
            paymentsBefore: round(before[i].total), paymentsAfter: round(m.total),
            freeCashBefore: round(a.net), freeCashAfter: round(b.net),
          };
        }),
        card: card ? { name: card.name, limit: round(card.limit), usedAfter: cardView(after, card, ctx.today).used, availableAfter: cardView(after, card, ctx.today).available } : null,
        cardsCompared: timing.map(x => ({ card: x.card.name, firstPayment: x.due, daysUntilFirstPayment: x.days, available: x.available == null ? null : round(x.available) })),
        currency: "TRY",
      };
    },
  },

  // ── Yedek ──
  {
    name: "export_data",
    title: "Export data",
    description: "The user's complete data as JSON (people, cards with their statement tracking, purchases, asset entries, debts with their payments) — the same backup as Ayarlar → Dışa aktar.",
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
    inputSchema: obj({ data: { type: "object", description: "Backup object with people, cards and installments arrays (entries and debts too, if any)." } }, ["data"]),
    annotations: DESTROY,
    async run(args, ctx) {
      const data = args.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) fail("data must be a backup object.");
      if (!Array.isArray(data.people) || !Array.isArray(data.installments)) fail("data must contain people and installments arrays.");
      return ctx.mutate(state => {
        const next = T.hydrate(data);
        for (const k of Object.keys(state)) delete state[k];
        Object.assign(state, next);
        return {
          imported: true, people: next.people.length, cards: next.cards.length, purchases: next.installments.length,
          entries: next.entries.length, debts: next.debts.length,
        };
      });
    },
  },
];

// Sunucunun initialize cevabında LLM'e verilen genel bilgi
export const INSTRUCTIONS = `CashFollow tracks credit card and cash purchases (single or in installments / taksit) for one or more people, and shows when each installment is paid.
- Amounts are Turkish lira (TRY). Dates are YYYY-MM-DD, months YYYY-MM, in Turkey time.
- A card has a statement cutoff day (hesap kesim günü) and a due day (son ödeme günü). A purchase on or before the cutoff day goes into that month's statement; the statement is paid on the due day (same month if the due day is after the cutoff, otherwise the next month). Installments fall into the following statements one month apart. Cash purchases are paid on the purchase day.
- When a card's cutoff / due day changes, statements already cut keep their dates; update_card asks (transition) what happens to the purchases in between — ask the user, don't pick yourself.
- A card's used limit is the sum of installments still to be paid (on a card paid by hand, also its unpaid past statements).
- Cards and people can be referred to by id or name, cards also by their last 4 digits. "nakit" means cash / debit card.
- Asset entries track lira (TRY), US dollars (USD), euros (EUR) and gold in grams (GAU) coming in or going out, once or repeating monthly; balances are their sums (repeating entries count only the times up to today). get_assets values them in TRY at the current Turkish market rate.
- Deleting a card or a person also deletes their purchases (a card also its statement payments, a person also their asset entries and debts); confirm destructive actions with the user.
- Purchases can have a spending category (market, yeme, ulasim, alisveris, elektronik, ev, fatura, saglik, egitim, eglence, seyahat, diger). Set one when you add a purchase if it is clear; the app learns from it. The app also suggests categories with an on-device model.
- get_insights gives the app's insight cards; simulate_purchase answers "can I afford it / which card" without saving.
- Debts and receivables (Borçlar): list_debts shows card debt per card (unpaid installments; the next statement and each person's part), unpaid cash installments, bank loans (each installment counts as paid the day after its date, unless paid by hand) and money borrowed from or lent to someone (add_debt; repaid when recorded with pay_debt, in parts too, or on the installment dates with auto_pay), in TRY/USD/EUR/GAU. Each card's statements are tracked from its trackSince (set automatically; update_card track_statements only when the user asks): from that date a statement leaves the first person's lira balance the day after its due day (on a card paid by hand, when marked paid), and other people's purchases on the card are owed to the user until recorded with pay_debt person=…. get_assets gives totalAssetsTry = netWorthTry + debtsTry.
- Payment mode (auto_pay), per card and per debt: automatic is the default for cards and loans — a statement counts as paid the day after its due day, a loan installment the day after its date. Paid by hand (update_card / add_card auto_pay false; add_debt / update_debt auto_pay false, the default for borrowed / lent) — a statement or installment stays owed until marked paid (Ödendi) with pay_debt (card=… for a card statement: amount defaults to what is due, a partial payment leaves the rest owed; debt=… for a loan or debt) and shows as overdue after its date (list_debts, get_overview debts.unpaidCardStatements, get_insights borc-vade). A loan's mode cannot change once it has an installment between its date and today, a borrowed / lent debt's once it has an installment before today; a card switched back to automatic counts its unpaid past statements as paid, and cannot switch while card payments made ahead of the statements due would stop counting; a card cannot switch to paid by hand on a day a card payment is dated. Don't change a mode unless the user asks.
- Reply to the user in their language (the app is Turkish).`;

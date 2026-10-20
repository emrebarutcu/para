// ---------- State + storage ----------
const T = window.Taksit;
const E = window.Eposta;
const V = window.Varlik;
const K = window.Kategori;
const I = window.Icgoru;
const YZ = window.YZ;
const STORAGE_KEY_BASE = "cashflow.v1";
function getStorageKey() {
  return window.CF_USER_ID ? `${STORAGE_KEY_BASE}.${window.CF_USER_ID}` : STORAGE_KEY_BASE;
}

const MAX_MONTHS = 60;           // akışta gösterilecek en fazla ay
const CHART_MONTHS = 12;         // özetteki grafikte gösterilecek ay
const CASH_COLOR = "var(--cash)";
const VIEWS = ["ozet", "akis", "harcamalar", "kartlar", "varliklar"];
const COUNT_PRESETS = [1, 2, 3, 4, 6, 9, 12];
const REPEAT_PRESETS = [[1, "Bir kez"], [0, "Her ay"], [3, "3 ay"], [6, "6 ay"], [12, "12 ay"]];   // varlık hareketi tekrarı
const WEEKDAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const CAL_WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];   // takvim pazartesiyle başlar
const PREF = { theme: "para.theme", chartBy: "para.chartBy", flowMode: "para.flowMode", timelineMode: "para.timelineMode", rates: "para.rates" };
const RATES_TTL = 10 * 60_000;   // kurlar bu kadar süre taze sayılır (/api/kur da bu kadar saklar)
const RATES_RETRY = 60_000;      // kur alınamazsa yeniden deneme aralığı
const INSIGHTS_SHOWN = 3;        // özette ilk görünen içgörü sayısı
const SUGGEST_DELAY = 450;       // açıklama yazılırken kategori önerisi için bekleme (ms)

const { SERIES_COUNT, defaultState, validDay, defaultCard, nextColor, hydrate } = T;

function readPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {}
}

let stateOwner = null;         // state'in ait olduğu kullanıcı (girişsizse null)
let state = loadState();
let view = viewFromHash();
let currentMonth = T.monthKey(todayIndex());   // özet ve akışın başladığı ay
let chartBy = readPref(PREF.chartBy) === "card" ? "card" : "person";
let flowMode = readPref(PREF.flowMode) === "table" ? "table" : "list";
let personFilter = "all";
let showDone = false;
let openEventKey = null;      // akışta açılan ödeme
let focusIdx = null;          // akışta vurgulanan ay (grafikten gelince)
let pendingScroll = null;     // render sonrası kaydırılacak öğe id'si
let editingId = null;         // düzenlenen harcama
let editingCardId = null;     // düzenlenen kart
let termChange = null;        // kartın günleri değişiyorsa arada kalanlar için seçenekler (T.termChoices)
let lastCardId = null;        // formda son seçilen kart ("" = nakit)
let lastPersonId = null;
let chartMonths = [];
let inbox = [];               // e-postadan gelen, kendiliğinden eklenemeyen kayıtlar
let inboxBusy = false;
let inboxDraftId = null;      // formda açılan e-posta kaydı
let inboxOpenId = null;       // içeriği gösterilen e-posta
let entryFilter = "all";      // varlıklarda seçili kişi
let timelineKind = "all";     // özetteki zaman çizelgesi: all | in | out
let timelineMode = readPref(PREF.timelineMode) === "calendar" ? "calendar" : "list";
let timelineDay = null;       // takvimde seçili gün
let editingEntryId = null;    // düzenlenen varlık hareketi
let lastAsset = "TRY";
let rates = readRates();      // son alınan kurlar: { rates: { TRY, USD, EUR, GAU }, updatedAt, fetchedAt }
let ratesFailed = false;
let ratesTriedAt = 0;
let ratesLoading = null;
let insightsOpen = false;     // özette bütün içgörüler açık
let categoryTouched = false;  // formda kategoriyi kullanıcı seçti
let categorySource = null;    // formdaki kategori kimden: "user" | "memory" (aynı işyerine önceki seçim) | "ai"
let suggestTimer = 0;
let suggestSeq = 0;
let backfillBusy = false;     // kategorisiz harcamalar ayrılıyor
const unsure = new Set();     // modelin emin olamadığı harcamalar (bu oturumda yeniden denenmez)

function loadState() {
  stateOwner = window.CF_USER_ID || null;
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return defaultState();
    return hydrate(JSON.parse(raw));
  } catch { return defaultState(); }
}

function saveState() {
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
  if (typeof window.syncSchedulePush === 'function') window.syncSchedulePush();
}

function resetView() {
  personFilter = "all";
  entryFilter = "all";
  openEventKey = null;
  focusIdx = null;
  lastCardId = null;
  lastPersonId = null;
  inbox = [];
  inboxDraftId = null;
  inboxOpenId = null;
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
}

// Auth callbacks — sync.js tarafından çağrılır
window.onAuthLogin = function (userId) {
  window.CF_USER_ID = userId;
  state = loadState();   // kullanıcıya özel local storage'a geç
  resetView();
  render();
  askOfflineData();
};
window.onAuthLogout = function () {
  window.CF_USER_ID = null;
  els.moveModal.hidden = true;
  stateOwner = null;
  state = defaultState();  // temiz slate — hesap verisi ekranda kalmasın
  resetView();
  render();
};

// Aynı cihazdaki başka sekme veriyi değiştirince bu sekme de onu kullansın (eşitleme ekrandaki veriye göre yazar)
window.addEventListener("storage", e => {
  if (e.key !== getStorageKey() || e.newValue == null || stateOwner !== (window.CF_USER_ID || null)) return;
  try { state = hydrate(JSON.parse(e.newValue)); } catch { return; }
  render();
});

// ---------- Helpers ----------
function todayIndex() {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth();
}

function viewFromHash() {
  const v = location.hash.slice(1);
  return VIEWS.includes(v) ? v : "ozet";
}

const moneyFmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmt(n) { return moneyFmt.format(n || 0); }
function fmtNum(n) { return numFmt.format(n || 0); }

function fmtShort(n) {
  const abs = Math.abs(n), s = n < 0 ? "-" : "";
  const f = v => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(v);
  if (abs >= 1e6) return s + f(abs / 1e6) + "M";
  if (abs >= 1e3) return s + f(abs / 1e3) + "K";
  return s + Math.round(abs).toLocaleString("tr-TR");
}

// "2026-10-22" → "22 Eki 2026" / "22 Eki"; ay indeksi → "Ekim 2026"
function fmtDay(key) {
  const d = T.parseDate(key);
  return `${d.day} ${T.monthShort(d.idx)} ${T.yearOf(d.idx)}`;
}
function fmtDayShort(key) {
  const d = T.parseDate(key);
  return `${d.day} ${T.monthShort(d.idx)}`;
}
function monthLong(idx) { return `${T.monthName(idx)} ${T.yearOf(idx)}`; }

function relDays(key, today) {
  const d = Math.round((T.toDate(key) - T.toDate(today)) / 864e5);
  if (d === 0) return "Bugün";
  if (d === 1) return "Yarın";
  if (d > 1) return `${d} gün sonra`;
  return d === -1 ? "Dün" : `${-d} gün önce`;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(name, className = "ic") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function personById(id) { return state.people.find(p => p.id === id); }
function cardById(id) { return state.cards.find(c => c.id === id); }
function cardName(id) { return cardById(id)?.name ?? "Nakit"; }
function seriesVar(entity) { return `var(--s${(entity.color % SERIES_COUNT) + 1})`; }
function cardColor(id) { const c = cardById(id); return c ? seriesVar(c) : CASH_COLOR; }
function paymentsOf(p) { return T.payments(p, cardById(p.cardId)); }

function dot(color) {
  const d = el("i", "dot");
  d.style.setProperty("--c", color);
  return d;
}

// Baş harfler: "Hilal Baba" → "HB"; aynı harfle başlayan başka kişi varsa iki harf ("Be", "Ba")
function initials(person) {
  const upper = s => s.toLocaleUpperCase("tr-TR");
  const words = person.name.trim().split(/\s+/);
  if (words.length > 1) return upper(words[0].charAt(0) + words[1].charAt(0));
  const first = upper(words[0].charAt(0));
  const clash = state.people.some(p => p.id !== person.id && upper(p.name.trim().charAt(0)) === first);
  return clash ? first + words[0].charAt(1).toLocaleLowerCase("tr-TR") : first;
}

function avatar(person, className = "avatar") {
  const a = el("span", className, initials(person));
  a.style.setProperty("--c", seriesVar(person));
  a.setAttribute("aria-hidden", "true");
  return a;
}

// "₺13.511,73" → para birimi ve kuruş küçük
function setMoney(node, n) {
  node.replaceChildren();
  for (const part of moneyFmt.formatToParts(n || 0)) {
    if (part.type === "currency") node.append(el("span", "cur", part.value));
    else if (part.type === "decimal" || part.type === "fraction") {
      const last = node.lastChild;
      if (last?.className === "dec") last.textContent += part.value;
      else node.append(el("span", "dec", part.value));
    } else if (part.type !== "literal") node.append(document.createTextNode(part.value));
  }
}

function knownPurchases() {
  const known = new Set(state.people.map(p => p.id));
  return state.installments.filter(p => known.has(p.personId));
}

function lastPaymentIndex() {
  let last = -Infinity;
  for (const p of knownPurchases()) {
    const list = paymentsOf(p);
    if (list.length) last = Math.max(last, list[list.length - 1].idx);
  }
  return last;
}

let toastTimer = 0;
function toast(message) {
  const t = els.toast;
  t.textContent = message;
  t.hidden = false;
  t.style.animation = "none";
  void t.offsetWidth;
  t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- Elements ----------
const $ = id => document.getElementById(id);
const els = {
  tabs: $("tabs"),
  heroLabel: $("heroLabel"), heroAmount: $("heroAmount"),
  nextLabel: $("nextLabel"), nextTotal: $("nextTotal"),
  remaining: $("remainingTotal"), endLabel: $("endLabel"),
  upcoming: $("upcomingList"), peopleSummary: $("peopleSummary"),
  timelineKind: $("timelineKind"), timelineMode: $("timelineMode"), timelineSum: $("timelineSum"),
  timelineCal: $("timelineCal"), timeline: $("timeline"),
  chartBy: $("chartBy"), legend: $("chartLegend"), chart: $("planChart"), chartEmpty: $("chartEmpty"),
  tooltip: $("chartTooltip"),
  flowMode: $("flowMode"), flowList: $("flowList"), flowTable: $("flowTable"), table: $("planTable"),
  personFilter: $("personFilter"), purchaseWrap: $("purchaseWrap"), managePeople: $("managePeople"),
  cardGrid: $("cardGrid"), addCard: $("addCard"),
  assetLabel: $("assetLabel"), assetTotal: $("assetTotal"), ratesNote: $("ratesNote"), rateStats: $("rateStats"),
  entryFilter: $("entryFilter"), assetGrid: $("assetGrid"), entryWrap: $("entryWrap"),
  entrySheet: $("entrySheet"), entryForm: $("entryForm"), entryTitle: $("entryTitle"), entryDelete: $("entryDelete"),
  entryUnit: $("entryUnit"), assetChips: $("assetChips"), entryPersonChips: $("entryPersonChips"), entryPreview: $("entryPreview"),
  repeatChips: $("repeatChips"), entryDateLabel: $("entryDateLabel"),
  addLabel: $("addLabel"), fab: document.querySelector(".fab"),
  purchaseSheet: $("purchaseSheet"), purchaseForm: $("purchaseForm"), purchaseTitle: $("purchaseTitle"),
  purchaseDelete: $("purchaseDelete"), purchasePreview: $("purchasePreview"),
  countChips: $("countChips"), cardChips: $("cardChips"), personChips: $("personChips"), personField: $("personField"),
  purchaseSum: $("purchaseSum"), purchaseStatus: $("purchaseStatus"), purchaseCopy: $("purchaseCopy"),
  dateChips: $("dateChips"), descList: $("descList"),
  cardSheet: $("cardSheet"), cardForm: $("cardForm"), cardTitle: $("cardTitle"),
  cardDelete: $("cardDelete"), cardPreview: $("cardPreview"), cardHint: $("cardHint"),
  termField: $("termField"), termNote: $("termNote"), termChoices: $("termChoices"),
  eventSheet: $("eventSheet"), eventTitle: $("eventTitle"), eventDate: $("eventDate"), eventSplit: $("eventSplit"),
  eventItems: $("eventItems"), eventToFlow: $("eventToFlow"),
  peopleSheet: $("peopleSheet"), peopleEdit: $("peopleEdit"), personAddForm: $("personAddForm"),
  settingsSheet: $("settingsSheet"), settingsBtn: $("settingsBtn"), themeSeg: $("themeSeg"),
  inboxBtn: $("inboxBtn"), inboxSheet: $("inboxSheet"), inboxLoginNote: $("inboxLoginNote"), inboxSetup: $("inboxSetup"),
  inboxAddress: $("inboxAddress"),
  aiBtn: $("aiBtn"), aiSheet: $("aiSheet"), mcpUrl: $("mcpUrl"), aiLoginNote: $("aiLoginNote"),
  aiAppsGroup: $("aiAppsGroup"), aiApps: $("aiApps"),
  aiLocalTitle: $("aiLocalTitle"), aiLocalSub: $("aiLocalSub"), aiLocalBtn: $("aiLocalBtn"), aiProgress: $("aiProgress"),
  aiBackfill: $("aiBackfill"), aiAddNote: $("aiAddNote"), aiOther: $("aiOther"),
  insightPanel: $("insightPanel"), insightList: $("insightList"), insightMore: $("insightMore"),
  catPanel: $("catPanel"), catList: $("catList"), catTotal: $("catTotal"), catNote: $("catNote"),
  categoryChips: $("categoryChips"), categoryHint: $("categoryHint"),
  inboxCheck: $("inboxCheck"), inboxRenew: $("inboxRenew"), inboxTry: $("inboxTry"), inboxTryResult: $("inboxTryResult"),
  moveModal: $("moveModal"), moveSummary: $("moveSummary"), moveKeepBtn: $("moveKeepBtn"), moveDropBtn: $("moveDropBtn"), moveMsg: $("moveMsg"),
  authBtn: $("authBtn"), exportBtn: $("exportBtn"), importInput: $("importInput"),
  toast: $("toast"),
};

// ---------- Render ----------
function render() {
  const start = T.monthIndex(currentMonth);
  const last = lastPaymentIndex();
  const end = Math.min(last, start + MAX_MONTHS - 1);
  const months = end >= start ? T.buildCashflow(state.people, state.cards, state.installments, start, end) : [];

  for (const n of document.querySelectorAll(".js-month-label")) n.textContent = monthLong(start);
  for (const s of document.querySelectorAll(".view")) s.hidden = s.dataset.view !== view;
  for (const a of els.tabs.querySelectorAll("a")) {
    a.classList.toggle("active", a.dataset.view === view);
    if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }

  if (view === "ozet") renderOverview(months, start, last);
  if (view === "akis") renderFlow(months);
  if (view === "harcamalar") renderPurchases();
  if (view === "kartlar") renderCards();
  if (view === "varliklar") { renderAssets(); loadRates(); }

  const adding = view === "varliklar" ? "Hareket" : "Harcama";
  els.addLabel.textContent = adding;
  els.fab.setAttribute("aria-label", `${adding} ekle`);

  if (pendingScroll) {
    const target = document.getElementById(pendingScroll);
    pendingScroll = null;
    target?.scrollIntoView({ block: "center" });
  }
}

// ---------- Özet ----------
function renderOverview(months, start, last) {
  const at = idx => months.find(m => m.idx === idx);
  els.heroLabel.textContent = start === todayIndex() ? "Bu ay ödenecek" : `${T.monthName(start)} ayında ödenecek`;
  setMoney(els.heroAmount, at(start)?.total || 0);
  els.nextLabel.textContent = T.monthName(start + 1);
  els.nextTotal.textContent = fmt(at(start + 1)?.total || 0);
  els.remaining.textContent = fmt(months.reduce((s, m) => s + m.total, 0));
  els.endLabel.textContent = months.length ? `${T.monthShort(months[months.length - 1].idx)} ${T.yearOf(months[months.length - 1].idx)}` : "—";

  renderInsights();
  renderUpcoming(last);
  renderPeopleSummary(months, start);
  renderTimeline(start);
  renderCategories(start);

  chartMonths = months.slice(0, CHART_MONTHS);
  renderLegend(chartMonths);
  renderChart(chartMonths);
}

// ---------- İçgörüler (icgoru.js) ----------
function renderInsights() {
  const list = I.insights(state, { today: T.todayKey(), rates: rates?.rates });
  els.insightPanel.hidden = !list.length;
  els.insightMore.hidden = list.length <= INSIGHTS_SHOWN;
  els.insightMore.textContent = insightsOpen ? "Daha az" : `Tümü (${list.length})`;
  els.insightList.replaceChildren(...(insightsOpen ? list : list.slice(0, INSIGHTS_SHOWN)).map(insightItem));
}

function insightItem(x) {
  const li = el("li", `insight ${x.tone}`);
  li.append(icon(x.tone === "warn" ? "alert" : x.tone === "good" ? "check" : "bulb"));
  const body = el("div", "insight-body");
  body.append(el("strong", "", x.title), el("p", "", x.text));
  li.append(body);
  if (x.action) {
    const b = el("button", "btn btn-ghost sm", x.action.label);
    b.type = "button";
    b.addEventListener("click", () => insightAction(x));
    li.append(b);
  }
  return li;
}

function insightAction(x) {
  if (x.action.kind === "entry") openEntrySheet(null, "TRY", { desc: "Maaş", repeat: 0 });
  else if (x.action.kind === "ai") openAiSheet();
  else if (x.action.kind === "share") {
    const person = x.data.length === 1 ? personById(x.data[0].personId) : null;
    if (person) sharePerson(person, T.monthIndex(currentMonth));
    else els.peopleSummary.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

els.insightMore.addEventListener("click", () => { insightsOpen = !insightsOpen; renderInsights(); });

// Ayın harcamaları kategoriye göre (harcama tarihine göre; taksitli alışveriş tamamıyla), önceki 3 ayın ortalamasıyla
function renderCategories(idx) {
  const b = I.categoryBreakdown(state, idx);
  els.catPanel.hidden = !b.total;
  if (!b.total) return;
  els.catTotal.textContent = fmt(b.total);
  const max = b.rows[0].value;
  els.catList.replaceChildren(...b.rows.map(r => {
    const li = el("li", "cat-row" + (r.id ? "" : " none"));
    const head = el("div", "cat-head");
    head.append(el("span", "cat-name", r.name), el("span", "cat-amt", fmt(r.value)));
    const bar = el("div", "cat-bar");
    const fill = el("span");
    fill.style.width = `${(r.value / max) * 100}%`;
    bar.append(fill);
    const meta = el("div", "cat-meta");
    meta.append(el("span", "", `%${Math.round(r.share * 100)}`));
    if (r.id && r.average > 0) {
      const d = r.value / r.average - 1;
      if (Math.abs(d) >= 0.1) meta.append(el("span", d > 0 ? "out-text" : "in-text", `${d > 0 ? "↑" : "↓"} 3 ay ortalamasından %${Math.round(Math.abs(d) * 100)} ${d > 0 ? "fazla" : "az"}`));
    }
    li.append(head, bar, meta);
    return li;
  }));
  const loose = b.rows.some(r => !r.id);
  els.catNote.textContent = "Taksitli alışveriş tamamıyla alındığı aya yazılır."
    + (loose && !YZ.enabled ? " Kategorisizleri cihazdaki yapay zekâ ayırabilir: Ayarlar → Yapay zekâ." : "");
}

function renderUpcoming(last) {
  const today = T.todayKey();
  const from = todayIndex();
  const events = last >= from
    ? T.buildCashflow(state.people, state.cards, state.installments, from, Math.min(last, from + 24))
      .flatMap(m => m.events).filter(e => e.date >= today).slice(0, 4)
    : [];
  els.upcoming.replaceChildren();
  if (!events.length) {
    els.upcoming.append(el("li", "empty", state.installments.length ? "Yaklaşan ödeme yok" : "Henüz harcama yok"));
    return;
  }
  for (const ev of events) {
    const li = payRow(ev, today, { relative: true });
    li.classList.add("clickable");
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-haspopup", "dialog");
    li.addEventListener("click", () => openEventSheet(ev));
    li.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEventSheet(ev); }
    });
    els.upcoming.append(li);
  }
}

// Ödemeyi akışta açık ve görünür göster
function openEvent(ev) {
  const idx = T.parseDate(ev.date).idx;
  if (idx < T.monthIndex(currentMonth)) currentMonth = T.monthKey(idx);
  openEventKey = ev.key;
  pendingScroll = `ev-${ev.key}`;
  location.hash = "#akis";
}

// Ayın girdi ve çıktıları gün gün: varlık hareketleri (giriş/çıkış) ve kart/nakit ödemeleri.
// Toplamlar TL'dir; döviz ve altın güncel kurla çevrilir, kuru bilinmeyen hareket toplama girmez.
function renderTimeline(start) {
  for (const b of els.timelineKind.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.kind === timelineKind);
    b.setAttribute("aria-pressed", String(b.dataset.kind === timelineKind));
  }
  for (const b of els.timelineMode.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.mode === timelineMode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === timelineMode));
  }
  const today = T.todayKey();
  const r = rates?.rates;
  // Tekrarlayan hareket bu aya düşen tekrarının tarihiyle gelir; varlığı bilinmeyen hareket (içe aktarma) atlanır
  const entries = [];
  for (const e of knownEntries()) {
    const date = V.asset(e.asset) ? V.occurrenceIn(e, start) : null;
    if (date) entries.push({ e, date });
  }
  const events = T.buildCashflow(state.people, state.cards, state.installments, start, start)[0].events;
  if (entries.some(x => x.e.asset !== "TRY")) loadRates();

  const order = new Map(state.entries.map((e, i) => [e.id, i]));
  const items = [
    ...entries.map(({ e, date }) => ({ kind: e.amount > 0 ? "in" : "out", date, entry: e, value: V.toTry(e.amount, e.asset, r), rank: order.get(e.id) })),
    ...events.map((ev, i) => ({ kind: "out", date: ev.date, event: ev, value: -ev.total, rank: state.entries.length + i })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank);

  let inSum = 0, outSum = 0, missing = false;
  for (const it of items) {
    if (it.value == null) missing = true;
    else if (it.value > 0) inSum += it.value;
    else outSum -= it.value;
  }
  const net = Math.round((inSum - outSum) * 100) / 100;   // kuruşu aşmayan fark −₺0,00 görünmesin
  const approx = missing ? "≈ " : "";
  const stat = (label, text, cls) => {
    const d = el("div");
    d.append(el("dt", "", label), el("dd", cls, text));
    return d;
  };
  els.timelineSum.replaceChildren(
    stat("Girdi", approx + "+" + fmt(inSum), "in-text"),
    stat("Çıktı", approx + "−" + fmt(outSum), "out-text"),
    stat("Net", approx + (net < 0 ? "−" : net > 0 ? "+" : "") + fmt(Math.abs(net)), net < 0 ? "out-text" : net > 0 ? "in-text" : ""));
  els.timelineSum.title = missing ? "Kuru alınamayan döviz/altın hareketleri toplama dahil değil" : "";

  els.timeline.replaceChildren();
  els.timelineCal.hidden = timelineMode !== "calendar";
  els.timelineCal.parentElement.classList.toggle("cal-mode", timelineMode === "calendar");
  const shown = items.filter(it => timelineKind === "all" || it.kind === timelineKind);
  if (timelineMode === "calendar") { renderCalendar(start, shown, today, r); return; }
  if (!shown.length) {
    const text = timelineKind === "in" ? "Bu ay girdi yok" : timelineKind === "out" ? "Bu ay çıktı yok" : "Bu ay hareket yok";
    els.timeline.append(el("li", "empty", text));
    return;
  }

  // Bugün bu ayın içindeyse bugünden sonraki ilk günün önüne "Bugün" çizgisi
  let nowPlaced = T.parseDate(today).idx !== start;
  const days = new Map();
  for (const it of shown) {
    if (!days.has(it.date)) days.set(it.date, []);
    days.get(it.date).push(it);
  }
  for (const [date, list] of days) {
    if (!nowPlaced && date > today) {
      els.timeline.append(timelineNow(today));
      nowPlaced = true;
    }
    if (date === today) nowPlaced = true;
    const day = el("li", "tl-day" + (date > today ? " planned" : ""));
    const head = el("div", "tl-date");
    head.append(el("span", "", `${fmtDayShort(date)} · ${WEEKDAYS[T.toDate(date).getDay()]}`));
    if (date === today) head.append(el("span", "tl-tag", "Bugün"));
    const ul = el("ul", "tl-items");
    for (const it of list) ul.append(timelineItem(it, today, r));
    day.append(head, ul);
    els.timeline.append(day);
  }
  if (!nowPlaced) els.timeline.append(timelineNow(today));
}

// Takvim: günlerde o günün girdi/çıktı toplamı; seçili günün hareketleri altta
function renderCalendar(start, shown, today, r) {
  const byDay = new Map();
  for (const it of shown) {
    if (!byDay.has(it.date)) byDay.set(it.date, []);
    byDay.get(it.date).push(it);
  }
  if (T.parseDate(timelineDay)?.idx !== start) {
    timelineDay = T.parseDate(today).idx === start ? today : shown[0]?.date ?? T.dateKey(start, 1);
  }

  const grid = el("div", "cal-grid");
  for (const w of CAL_WEEKDAYS) grid.append(el("span", "cal-wd", w));
  const offset = (T.toDate(T.dateKey(start, 1)).getDay() + 6) % 7;
  for (let i = 0; i < offset; i++) grid.append(el("span", "cal-pad"));
  for (let d = 1, n = T.daysInMonth(start); d <= n; d++) {
    const key = T.dateKey(start, d);
    const list = byDay.get(key) || [];
    let inSum = 0, outSum = 0, unknown = false;
    for (const it of list) {
      if (it.value == null) unknown = true;
      else if (it.value > 0) inSum += it.value;
      else outSum -= it.value;
    }
    const selected = key === timelineDay;
    const b = el("button", "cal-day" + (key === today ? " today" : "") + (selected ? " selected" : "") + (key > today ? " planned" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(selected));
    b.setAttribute("aria-label", `${fmtDayShort(key)}: ` + (list.length
      ? [inSum && `girdi ${fmt(inSum)}`, outSum && `çıktı ${fmt(outSum)}`, unknown && "kuru bilinmeyen hareket"].filter(Boolean).join(", ")
      : "hareket yok"));
    b.append(el("span", "cal-n", String(d)));
    if (inSum) b.append(el("span", "cal-v in-text", "+" + fmtShort(inSum)));
    if (outSum) b.append(el("span", "cal-v out-text", "−" + fmtShort(outSum)));
    if (unknown && !inSum && !outSum) b.append(el("span", "cal-v", "•"));
    b.addEventListener("click", () => { timelineDay = key; render(); els.timelineCal.querySelector(".cal-day.selected")?.focus(); });
    grid.append(b);
  }
  els.timelineCal.replaceChildren(grid);

  const list = byDay.get(timelineDay) || [];
  const day = el("li", "tl-day" + (timelineDay > today ? " planned" : ""));
  const head = el("div", "tl-date");
  head.append(el("span", "", `${fmtDayShort(timelineDay)} · ${WEEKDAYS[T.toDate(timelineDay).getDay()]}`));
  if (timelineDay === today) head.append(el("span", "tl-tag", "Bugün"));
  day.append(head);
  if (list.length) {
    const ul = el("ul", "tl-items");
    for (const it of list) ul.append(timelineItem(it, today, r));
    day.append(ul);
  } else {
    day.classList.add("tl-none");
    day.append(el("p", "tl-empty", timelineKind === "in" ? "Bu gün girdi yok" : timelineKind === "out" ? "Bu gün çıktı yok" : "Bu gün hareket yok"));
  }
  els.timeline.append(day);
}

function timelineNow(today) {
  const li = el("li", "tl-now");
  li.append(el("span", "", `Bugün · ${fmtDayShort(today)}`));
  return li;
}

function timelineItem(it, today, r) {
  const li = el("li", `tl-item ${it.kind}` + (it.date > today ? " planned" : ""));
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  const main = el("div", "tl-main");
  const title = el("div", "tl-title");
  const sub = el("div", "tl-sub");
  const side = el("div", "tl-amt");
  let open;

  if (it.entry) {
    const e = it.entry;
    const person = personById(e.personId);
    title.textContent = e.desc;
    if (state.people.length > 1) {
      const who = el("span", "who");
      who.append(dot(seriesVar(person)), document.createTextNode(person.name));
      sub.append(who);
    }
    sub.append(el("span", "", V.asset(e.asset).name));
    side.append(el("span", "amount", fmtAsset(e.amount, e.asset, true)));
    if (e.asset !== "TRY") side.append(el("small", "", it.value == null ? "kur yok" : `≈ ${fmt(Math.abs(it.value))}`));
    open = () => openEntrySheet(e);
  } else {
    const ev = it.event;
    title.textContent = ev.cardId ? `${cardName(ev.cardId)} ödemesi` : "Nakit";
    if (it.date > today) sub.append(el("span", "", relDays(it.date, today)));
    const names = [...new Set(ev.items.map(i => i.purchase.desc))];
    const what = el("span", "who");
    what.append(dot(cardColor(ev.cardId)), document.createTextNode(names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "")));
    sub.append(what);
    side.append(el("span", "amount", "−" + fmt(ev.total)));
    li.setAttribute("aria-haspopup", "dialog");
    open = () => openEventSheet(ev);
  }

  main.append(title, sub);
  li.append(el("span", "tl-mark"), main, side);
  li.addEventListener("click", open);
  li.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });
  return li;
}

// ---------- Ödeme ayrıntısı (zaman çizelgesinden) ----------
// Kişilere dağılım halka grafikte (renk kişinin rengi, sabit sıra) ve yanında tutar / yüzde listesi;
// altında ödenen taksitler kişi kişi. Dilime ya da listedeki kişiye gelince / dokununca ortada o kişinin payı yazar.
let sheetEvent = null;

function openEventSheet(ev) {
  sheetEvent = ev;
  const today = T.todayKey();
  els.eventTitle.replaceChildren(dot(cardColor(ev.cardId)), document.createTextNode(ev.cardId ? `${cardName(ev.cardId)} ödemesi` : "Nakit ödemeler"));
  els.eventDate.textContent = `${WEEKDAYS[T.toDate(ev.date).getDay()]}, ${fmtDay(ev.date)} · ${relDays(ev.date, today)}`;

  const parts = state.people.filter(p => ev.byPerson[p.id] > 0).map(p => ({ person: p, value: ev.byPerson[p.id] }));
  els.eventSplit.removeAttribute("data-active");
  els.eventSplit.replaceChildren(...eventSplit(parts, ev.total));
  els.eventItems.replaceChildren(...eventItemRows(ev));
  openSheet(els.eventSheet);
}

els.eventToFlow.addEventListener("click", () => {
  els.eventSheet.close();
  if (sheetEvent) openEvent(sheetEvent);
});

function eventSplit(parts, total) {
  const R = 66, W = 18, C = 2 * Math.PI * R;
  const gap = parts.length > 1 ? 3 : 0;   // dilimler arasında yüzey boşluğu
  const ns = "http://www.w3.org/2000/svg";
  const box = el("div", "donut");
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 168 168");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", parts.map(x => `${x.person.name} ${fmt(x.value)}`).join(", "));
  const circle = cls => {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "84"); c.setAttribute("cy", "84"); c.setAttribute("r", String(R));
    c.setAttribute("class", cls);
    return c;
  };
  svg.append(circle("track"));

  const center = el("div", "donut-center");
  const big = el("strong"), small = el("span");
  center.append(big, small);
  const pct = v => `%${Math.round((v / total) * 100)}`;

  const legend = el("ul", "ev-legend");
  const segs = new Map(), rows = new Map();
  let pinned = null;
  const show = id => {
    const x = parts.find(p => p.person.id === id);
    box.parentElement?.toggleAttribute("data-active", !!x);
    for (const [k, n] of segs) n.classList.toggle("on", k === id);
    for (const [k, n] of rows) n.classList.toggle("on", k === id);
    big.textContent = fmt(x ? x.value : total);
    small.textContent = x ? `${x.person.name} · ${pct(x.value)}` : parts.length > 1 ? `${parts.length} kişi` : "toplam";
  };
  const hook = (node, id) => {
    node.addEventListener("pointerenter", () => show(id));
    node.addEventListener("pointerleave", () => show(pinned));
    node.addEventListener("click", () => { pinned = pinned === id ? null : id; show(pinned); });
  };

  let start = 0;
  for (const { person, value } of parts) {
    const len = (value / total) * C;
    const seg = circle("seg");
    seg.style.stroke = seriesVar(person);
    seg.setAttribute("stroke-dasharray", `${Math.max(len - gap, 0.5)} ${C}`);
    seg.setAttribute("stroke-dashoffset", String(-start));
    start += len;
    hook(seg, person.id);
    segs.set(person.id, seg);
    svg.append(seg);

    const b = el("button", "ev-leg");
    b.type = "button";
    const name = el("span", "name");
    name.append(dot(seriesVar(person)), el("span", "", person.name));
    b.append(name, el("span", "pct", pct(value)), el("span", "amount", fmt(value)));
    b.addEventListener("focus", () => show(person.id));
    b.addEventListener("blur", () => show(pinned));
    hook(b, person.id);
    rows.set(person.id, b);
    const li = el("li");
    li.append(b);
    legend.append(li);
  }
  box.append(svg, center);
  show(null);
  return [box, legend];
}

// Ödenen taksitler: kişi sırasıyla, kişinin içinde büyükten küçüğe
function eventItemRows(ev) {
  const order = new Map(state.people.map((p, i) => [p.id, i]));
  const items = [...ev.items].sort((a, b) =>
    order.get(a.purchase.personId) - order.get(b.purchase.personId) || b.amount - a.amount);
  return items.map(({ purchase, no, amount }) => {
    const p = personById(purchase.personId);
    const plan = T.planLength(purchase);
    const li = el("li");
    li.style.setProperty("--c", seriesVar(p));
    const main = el("div", "ev-item-main");
    main.append(el("span", "desc", purchase.desc),
      el("span", "meta", `${p.name} · ${plan > 1 ? `${no}/${plan}. taksit` : "peşin"}`));
    li.append(main, el("span", "amount", fmt(amount)));
    return li;
  });
}

// İlk kişi uygulamayı kullanan; diğerlerine (aile üyesi ya da kartını kullanan) ayın ödeme özeti gönderilebilir
function renderPeopleSummary(months, start) {
  const thisMonth = months.find(m => m.idx === start);
  els.peopleSummary.replaceChildren();
  state.people.forEach((p, i) => {
    const remaining = months.reduce((s, m) => s + (m.byPerson[p.id] || 0), 0);
    const due = thisMonth?.byPerson[p.id] || 0;
    const li = el("li");
    const info = el("div");
    info.append(el("div", "name", p.name), el("div", "sub", remaining ? `kalan ${fmt(remaining)}` : "borç yok"));
    li.append(avatar(p), info, el("div", "amount", fmt(due)));
    if (i > 0 && due > 0) {
      const b = el("button", "icon-btn sm share-btn");
      b.type = "button";
      b.setAttribute("aria-label", `${p.name} için ${T.monthName(start)} ödeme özetini gönder`);
      b.title = "Ödeme özetini gönder";
      b.append(icon("share"));
      b.addEventListener("click", () => sharePerson(p, start));
      li.append(b);
    }
    els.peopleSummary.append(li);
  });
}

// "Merhaba Ali, Ekim 2026 ödemelerin: …" — taksit taksit, kart ve tarihle; kalan toplam
function shareText(person, idx) {
  const last = lastPaymentIndex();
  const months = T.buildCashflow(state.people, state.cards, state.installments, idx, Math.max(idx, last));
  const lines = [];
  for (const ev of months[0].events) {
    for (const it of ev.items) {
      if (it.purchase.personId !== person.id) continue;
      const plan = T.planLength(it.purchase);
      lines.push(`• ${it.purchase.desc}${plan > 1 ? ` (${it.no}/${plan}. taksit)` : ""}: ${fmt(it.amount)} — ${cardName(ev.cardId)}, ${fmtDayShort(ev.date)}`);
    }
  }
  const rest = months.slice(1).reduce((s, m) => s + (m.byPerson[person.id] || 0), 0);
  return [`Merhaba ${person.name}, ${monthLong(idx)} ödemelerin:`, ...lines, `Toplam: ${fmt(months[0].byPerson[person.id] || 0)}`,
    rest ? `Sonraki aylarda kalan: ${fmt(rest)}` : null].filter(Boolean).join("\n");
}

async function sharePerson(person, idx) {
  const text = shareText(person, idx);
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

// Ödeme satırı: tarih rozeti, kart, kişi dağılımı ya da kalan gün, tutar
function payRow(ev, today, { relative = false, expandable = false } = {}) {
  const li = el("li", "pay" + (ev.date < today ? " past" : ""));
  const d = T.parseDate(ev.date);
  const badge = el("div", "date-badge");
  badge.append(el("span", "d", String(d.day)), el("span", "w", WEEKDAYS[T.toDate(ev.date).getDay()]));

  const main = el("div", "pay-main");
  const title = el("div", "pay-title");
  title.append(dot(cardColor(ev.cardId)), document.createTextNode(cardName(ev.cardId)));
  const sub = el("div", "pay-sub");
  if (relative) {
    sub.append(el("span", "", `${relDays(ev.date, today)} · ${fmtDayShort(ev.date)}`));
  } else {
    for (const p of state.people) {
      const v = ev.byPerson[p.id];
      if (!v) continue;
      const who = el("span", "who");
      who.append(dot(seriesVar(p)), document.createTextNode(`${p.name} ${fmtNum(v)}`));
      sub.append(who);
    }
  }
  main.append(title, sub);

  const amt = el("div", "pay-amt", fmt(ev.total));
  if (expandable) amt.append(icon("down"));
  li.append(badge, main, amt);
  return li;
}

// ---------- Chart ----------
function chartSeries(months) {
  if (chartBy === "card") {
    const list = state.cards.map(c => ({ name: c.name, color: seriesVar(c), value: m => m.byCard[c.id] || 0 }));
    if (months.some(m => m.byCard[T.CASH])) {
      list.push({ name: "Nakit", color: CASH_COLOR, value: m => m.byCard[T.CASH] || 0 });
    }
    return list;
  }
  return state.people.map(p => ({ name: p.name, color: seriesVar(p), value: m => m.byPerson[p.id] || 0 }));
}

function renderLegend(months) {
  for (const b of els.chartBy.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.by === chartBy);
    b.setAttribute("aria-pressed", String(b.dataset.by === chartBy));
  }
  els.legend.replaceChildren();
  const series = chartSeries(months);
  if (series.length < 2) return;   // tek seri: başlık yeterli
  for (const s of series) {
    const item = el("span", "leg");
    const sw = el("i", "sw");
    sw.style.background = s.color;
    item.append(sw, document.createTextNode(s.name));
    els.legend.append(item);
  }
}

function niceScale(max, count) {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(s => s >= raw);
  return { step, top: Math.ceil(max / step - 1e-9) * step };
}

// Yalnızca üst köşeleri yuvarlatılmış sütun (taban düz)
function topRoundedBar(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h} Z`;
}

function renderChart(months) {
  const svg = els.chart;
  const hasData = months.some(m => m.total > 0);
  svg.style.display = hasData ? "" : "none";
  els.chartEmpty.hidden = hasData;
  hideTooltip();
  if (!hasData) {
    els.chartEmpty.textContent = state.installments.length
      ? "Bu aydan sonra ödenecek taksit yok."
      : "Harcama ekleyince aylık ödemelerin burada görünür.";
    svg.innerHTML = "";
    return;
  }

  const series = chartSeries(months);
  const W = Math.round(svg.getBoundingClientRect().width) || 880, H = 200;
  const PL = 42, PR = 4, PT = 22, PB = 26, GAP = 2, R = 4;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = months.length;
  const band = plotW / n;
  const barW = Math.min(24, band * 0.56);
  const { step, top } = niceScale(Math.max(...months.map(m => m.total)), 4);
  const toY = v => PT + plotH * (1 - v / top);
  const labelIdx = months[0].idx;

  let gridSvg = "", yLblSvg = "";
  for (let v = 0; v <= top + step * 0.01; v += step) {
    const y = toY(v).toFixed(1);
    gridSvg += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`;
    yLblSvg += `<text x="${PL - 10}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--text-3)">${fmtShort(v)}</text>`;
  }

  // Seriler sabit sırada alttan üste, aralarında 2px boşluk
  const every = Math.ceil(40 / band);
  let barsSvg = "", xLblSvg = "", capSvg = "";
  months.forEach((m, i) => {
    const cx = PL + band * (i + 0.5);
    const x = cx - barW / 2;
    const segs = series.map(s => ({ s, v: s.value(m) })).filter(x => x.v > 0);
    let cum = 0, parts = "";
    segs.forEach((seg, j) => {
      const yTop = toY(cum + seg.v);
      const yBot = toY(cum) - (j > 0 ? GAP : 0);
      cum += seg.v;
      const h = yBot - yTop;
      if (h <= 0.5) return;
      parts += j === segs.length - 1
        ? `<path d="${topRoundedBar(x, yTop, barW, h, R)}" fill="${seg.s.color}"/>`
        : `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${seg.s.color}"/>`;
    });
    barsSvg += `<g class="col" data-i="${i}">${parts}</g>`;

    // Değer etiketi yalnızca ilk (seçili) ayda
    if (m.idx === labelIdx && m.total > 0) {
      const label = band >= 72 ? fmtNum(m.total) : fmtShort(m.total);
      capSvg = `<text x="${cx.toFixed(1)}" y="${(toY(m.total) - 7).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text)">${label}</text>`;
    }
    if (i % every === 0) {
      const withYear = i === 0 || m.idx % 12 === 0;
      const label = T.monthShort(m.idx) + (withYear ? ` ’${String(T.yearOf(m.idx)).slice(2)}` : "");
      xLblSvg += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--text-3)">${label}</text>`;
    }
  });

  const hitsSvg = months.map((m, i) =>
    `<rect class="cf-hit" data-i="${i}" tabindex="0" role="button" aria-label="${monthLong(m.idx)}: ${fmt(m.total)}" x="${(PL + band * i).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${H}" fill="transparent"/>`
  ).join("");

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `${gridSvg}${barsSvg}${capSvg}${yLblSvg}${xLblSvg}${hitsSvg}`;

  svg.querySelectorAll(".cf-hit").forEach(hit => {
    const i = Number(hit.dataset.i);
    const m = months[i];
    const col = svg.querySelector(`.col[data-i="${i}"]`);
    // Sütuna tıklayınca akışta o aya git
    const go = () => {
      hideTooltip();
      focusIdx = m.idx;
      pendingScroll = `m-${m.idx}`;
      location.hash = "#akis";
    };
    hit.addEventListener("click", go);
    hit.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
    hit.addEventListener("pointermove", e => { col.classList.add("hover"); showTooltip(m, series, e.clientX, e.clientY); });
    hit.addEventListener("pointerleave", () => { col.classList.remove("hover"); hideTooltip(); });
    hit.addEventListener("focus", () => {
      const b = hit.getBoundingClientRect();
      col.classList.add("hover");
      showTooltip(m, series, b.left + b.width / 2, b.top + 50);
    });
    hit.addEventListener("blur", () => { col.classList.remove("hover"); hideTooltip(); });
  });
}

function showTooltip(m, series, x, y) {
  const tt = els.tooltip;
  tt.replaceChildren(el("span", "tt-date", monthLong(m.idx)));
  for (const s of series) {
    const v = s.value(m);
    if (!v) continue;
    const line = el("span", "tt-row");
    const key = el("i", "tt-key");
    key.style.background = s.color;
    line.append(key, el("strong", "", fmt(v)), el("span", "tt-name", s.name));
    tt.append(line);
  }
  if (series.length > 1) tt.append(el("span", "tt-total", "Toplam " + fmt(m.total)));
  tt.hidden = false;
  const w = tt.offsetWidth, h = tt.offsetHeight;
  const left = x + 14 + w > window.innerWidth - 8 ? x - 14 - w : x + 14;
  tt.style.left = Math.max(8, left) + "px";
  tt.style.top = Math.max(8, y - h - 12) + "px";
}

function hideTooltip() { els.tooltip.hidden = true; }

// ---------- Akış ----------
function renderFlow(months) {
  for (const b of els.flowMode.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.mode === flowMode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === flowMode));
  }
  els.flowList.replaceChildren();
  els.flowTable.hidden = true;

  if (!months.length) {
    els.flowList.hidden = false;
    els.flowList.append(emptyState("flow",
      state.installments.length ? "Bu aydan sonra ödeme yok" : "Henüz ödeme yok",
      state.installments.length ? "Önceki aylara bakmak için ay seçiciyi kullan." : "Harcama ekleyince ödeme tarihleri kartına göre burada sıralanır."));
    return;
  }

  if (flowMode === "table") {
    els.flowList.hidden = true;
    els.flowTable.hidden = false;
    renderTable(months);
    return;
  }

  els.flowList.hidden = false;
  const today = T.todayKey();
  for (const m of months) {
    const block = el("section", "month-block" + (m.idx === focusIdx ? " focus" : ""));
    block.id = `m-${m.idx}`;
    const head = el("div", "month-head");
    head.append(el("h3", "", monthLong(m.idx)), el("span", "total", fmt(m.total)));
    block.append(head);

    const split = el("div", "month-split");
    for (const p of state.people) {
      const v = m.byPerson[p.id];
      if (!v) continue;
      const s = el("span");
      s.append(dot(seriesVar(p)), document.createTextNode(`${p.name} ${fmt(v)}`));
      split.append(s);
    }
    if (split.childElementCount > 1) block.append(split);

    const panel = el("div", "panel");
    if (!m.events.length) {
      panel.append(el("p", "month-empty", "Bu ay ödeme yok"));
    } else {
      const ul = el("ul", "pay-list");
      for (const ev of m.events) {
        const open = ev.key === openEventKey;
        const li = payRow(ev, today, { expandable: true });
        li.id = `ev-${ev.key}`;
        li.classList.add("clickable");
        li.classList.toggle("open", open);
        li.tabIndex = 0;
        li.setAttribute("aria-expanded", String(open));
        if (open) li.append(eventItems(ev));
        const toggle = () => { openEventKey = open ? null : ev.key; render(); };
        li.addEventListener("click", toggle);
        li.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        });
        ul.append(li);
      }
      panel.append(ul);
    }
    block.append(panel);
    els.flowList.append(block);
  }
}

// Bir ödemede (tarih + kart) ödenen taksitler
function eventItems(ev) {
  const ul = el("ul", "items");
  const order = new Map(state.people.map((p, i) => [p.id, i]));
  const items = [...ev.items].sort((a, b) =>
    order.get(a.purchase.personId) - order.get(b.purchase.personId)
    || a.purchase.desc.localeCompare(b.purchase.desc, "tr"));
  for (const { purchase, no, amount } of items) {
    const p = personById(purchase.personId);
    const li = el("li");
    const who = el("span", "who");
    who.append(dot(seriesVar(p)), document.createTextNode(p.name));
    const plan = T.planLength(purchase);
    li.append(who, el("span", "", purchase.desc),
      el("span", "no", plan > 1 ? `${no}/${plan}` : "peşin"), el("span", "amount", fmt(amount)));
    ul.append(li);
  }
  return ul;
}

// Excel'deki özet sayfası: ay × kişi
function renderTable(months) {
  const table = els.table;
  table.replaceChildren();
  const people = state.people;

  const head = table.createTHead().insertRow();
  head.append(el("th", "", "Ay"));
  for (const p of people) {
    const th = el("th", "num");
    th.append(dot(seriesVar(p)), document.createTextNode(p.name));
    head.append(th);
  }
  head.append(el("th", "num", "Toplam"));

  const body = table.createTBody();
  const sums = Object.fromEntries(people.map(p => [p.id, 0]));
  for (const m of months) {
    const tr = body.insertRow();
    if (!m.total) tr.className = "zero";
    const td = tr.insertCell();
    td.append(el("span", "d-long", monthLong(m.idx)),
      el("span", "d-short", `${T.monthShort(m.idx)} ’${String(T.yearOf(m.idx)).slice(2)}`));
    for (const p of people) {
      const v = m.byPerson[p.id] || 0;
      sums[p.id] += v;
      tr.append(el("td", "num", v ? fmtNum(v) : "—"));
    }
    tr.append(el("td", "num total", m.total ? fmtNum(m.total) : "—"));
  }
  const foot = table.createTFoot().insertRow();
  foot.append(el("td", "", "Toplam"));
  for (const p of people) foot.append(el("td", "num", fmtNum(sums[p.id])));
  foot.append(el("td", "num total", fmtNum(months.reduce((s, m) => s + m.total, 0))));
}

// Kişiye göre süzgeç çipleri: "Tümü" ve her kişi; count(id) çipteki sayı (0 ise yazılmaz)
function renderPersonFilter(container, current, count, pick) {
  container.replaceChildren();
  const chip = (id, label, color) => {
    const b = el("button", "chip" + (current === id ? " active" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(current === id));
    if (color) b.append(dot(color));
    b.append(document.createTextNode(label));
    const n = count(id);
    if (n) b.append(el("span", "count", String(n)));
    b.addEventListener("click", () => { pick(id); render(); });
    return b;
  };
  container.append(chip("all", "Tümü"));
  for (const p of state.people) container.append(chip(p.id, p.name, seriesVar(p)));
}

function emptyState(iconName, title, text, action) {
  const box = el("div", "empty-state");
  box.append(icon(iconName), el("strong", "", title), el("p", "", text));
  if (action) box.append(action);
  return box;
}

// ---------- Harcamalar ----------
function renderPurchases() {
  const today = T.todayKey();
  if (personFilter !== "all" && !personById(personFilter)) personFilter = "all";

  const all = knownPurchases().map(p => {
    const pays = paymentsOf(p);
    const plan = T.planLength(p);
    const left = pays.filter(x => x.key >= today);
    return { p, pays, plan, left: left.length, paid: plan - left.length, next: left[0]?.key ?? null };
  });

  renderPersonFilter(els.personFilter, personFilter,
    id => all.filter(x => x.left && (id === "all" || x.p.personId === id)).length,
    id => { personFilter = id; });

  const mine = all.filter(x => personFilter === "all" || x.p.personId === personFilter);
  const active = mine.filter(x => x.left).sort((a, b) => a.next.localeCompare(b.next) || a.p.desc.localeCompare(b.p.desc, "tr"));
  const done = mine.filter(x => !x.left).sort((a, b) => b.pays[b.pays.length - 1].key.localeCompare(a.pays[a.pays.length - 1].key));

  els.purchaseWrap.replaceChildren();
  if (inbox.length) els.purchaseWrap.append(inboxPanel());
  if (!mine.length) {
    const btn = el("button", "btn btn-primary");
    btn.type = "button";
    btn.append(icon("plus"), document.createTextNode("Harcama ekle"));
    btn.addEventListener("click", () => openPurchaseSheet());
    els.purchaseWrap.append(emptyState("receipt", "Henüz harcama yok",
      "Peşin ya da taksitli harcamalarını ekle; ödeme tarihlerini kartının kesim ve son ödeme gününe göre hesaplarım.", btn));
    return;
  }

  const groups = el("div", "purchase-groups");
  if (active.length) groups.append(purchaseList(active, today));
  else groups.append(el("p", "empty", "Devam eden harcama yok"));

  if (done.length) {
    const toggle = el("button", "section-toggle" + (showDone ? " open" : ""));
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(showDone));
    toggle.append(document.createTextNode(`Biten harcamalar (${done.length})`), icon("down"));
    toggle.addEventListener("click", () => { showDone = !showDone; render(); });
    groups.append(toggle);
    if (showDone) groups.append(purchaseList(done, today));
  }
  els.purchaseWrap.append(groups);
}

function purchaseList(items, today) {
  const panel = el("div", "panel list-panel");
  for (const x of items) panel.append(purchaseRow(x, today));
  return panel;
}

function purchaseRow({ p, pays, plan, left, paid, next }, today) {
  const person = personById(p.personId);
  const per = T.perInstallment(p);
  const row = el("div", "purchase" + (left ? "" : " done"));
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const main = el("div", "p-main");
  main.append(el("div", "p-title", p.desc));
  const meta = el("div", "p-meta");
  const tag = el("span", "card-tag");
  tag.append(dot(cardColor(p.cardId)), document.createTextNode(cardName(p.cardId)));
  meta.append(tag);
  if (p.date) meta.append(el("span", "", fmtDayShort(p.date) + " " + T.yearOf(T.parseDate(p.date).idx)));
  meta.append(el("span", "", plan > 1 ? `${plan} taksit` : "Peşin"));
  if (K.valid(p.category)) meta.append(el("span", "cat-tag" + (p.categoryBy === "user" ? "" : " ai"), K.category(p.category).name));
  main.append(meta);
  if (plan > 1) {
    const prog = el("div", "progress");
    const bar = el("div", "bar");
    const fill = el("span");
    fill.style.width = `${(paid / plan) * 100}%`;
    bar.append(fill);
    prog.append(bar, el("span", "", `${paid}/${plan} ödendi`));
    main.append(prog);
  }

  const side = el("div", "p-side");
  if (plan > 1) {
    const amount = el("span", "amount", fmt(per));
    amount.append(el("small", "", "/ay"));
    side.append(amount, el("span", "sub", left ? `kalan ${fmt(left * per)}` : "bitti"));
  } else {
    side.append(el("span", "amount", fmt(p.total)), el("span", "sub", next ? `${relDays(next, today).toLocaleLowerCase("tr-TR")} ödenecek` : "ödendi"));
  }

  row.append(avatar(person), main, side);
  row.addEventListener("click", () => openPurchaseSheet(p));
  row.addEventListener("keydown", e => { if (e.key === "Enter") openPurchaseSheet(p); });
  return row;
}

// ---------- Kartlar ----------
function cardStats(c) {
  const today = T.todayKey();
  const known = new Set(state.people.map(p => p.id));
  const pays = state.installments
    .filter(p => p.cardId === c.id && known.has(p.personId))
    .flatMap(p => T.payments(p, c));
  const upcoming = pays.filter(x => x.key >= today);
  const next = upcoming.reduce((min, x) => (!min || x.key < min ? x.key : min), null);
  return {
    used: T.outstanding(pays, today),
    next,
    nextTotal: upcoming.filter(x => x.key === next).reduce((s, x) => s + x.amount, 0),
  };
}

function cardTile(c, stats, tag = "button") {
  const tile = el(tag, "cc");
  if (tag === "button") tile.type = "button";
  tile.style.setProperty("--c", seriesVar(c));

  const top = el("div", "cc-top");
  const left = el("div");
  left.append(el("div", "cc-name", c.name || "Kart adı"));
  const days = el("div", "cc-days");
  days.append(el("div", "", `Kesim ${c.cutoffDay || "—"}`), el("div", "", `Son ödeme ${c.dueDay || "—"}`));
  top.append(left, days);

  const mid = el("div", "cc-mid");
  const over = c.limit > 0 && stats.used > c.limit;
  if (c.limit > 0) {
    mid.append(el("div", "lbl", over ? "Limit aşımı" : "Kullanılabilir limit"),
      el("div", "val", fmt(Math.abs(c.limit - stats.used))));
  } else {
    mid.append(el("div", "lbl", "Bekleyen borç"), el("div", "val", fmt(stats.used)));
  }

  const bottom = el("div", "cc-bottom");
  if (c.limit > 0) {
    const bar = el("div", "cc-bar");
    const fill = el("span");
    fill.style.width = `${Math.min(100, (stats.used / c.limit) * 100)}%`;
    bar.append(fill);
    bottom.append(bar);
  }
  const foot = el("div", "cc-foot");
  foot.append(
    el("span", "", c.limit > 0 ? `${fmtShort(stats.used)} / ${fmtShort(c.limit)} kullanıldı` : "Limit girilmedi"),
    el("span", "", stats.next ? `${fmtDayShort(stats.next)} · ${fmt(stats.nextTotal)}` : "Bekleyen ödeme yok"));
  bottom.append(foot);

  const chipRow = el("div", "cc-chiprow");
  chipRow.append(el("div", "cc-chip"));
  if (c.last4) chipRow.append(el("span", "cc-num", `•••• ${c.last4}`));
  if (over) chipRow.append(el("span", "cc-alert", "Limit aşıldı"));
  tile.append(top, chipRow, mid, bottom);
  return tile;
}

function renderCards() {
  els.cardGrid.replaceChildren();
  for (const c of state.cards) {
    const tile = cardTile(c, cardStats(c));
    tile.setAttribute("aria-label", `${c.name} kartını düzenle`);
    tile.addEventListener("click", () => openCardSheet(c));
    els.cardGrid.append(tile);
  }
  const add = el("button", "cc-add");
  add.type = "button";
  add.append(icon("plus"), document.createTextNode(state.cards.length ? "Yeni kart" : "İlk kartını ekle"));
  add.addEventListener("click", () => openCardSheet());
  els.cardGrid.append(add);
}

// ---------- Varlıklar ----------
function readRates() {
  try {
    const r = JSON.parse(localStorage.getItem(PREF.rates));
    return r?.rates ? r : null;
  } catch { return null; }
}

// Kurlar sitenin Worker'ından (/api/kur); taze ise ya da az önce denendiyse istek atılmaz
function loadRates() {
  const now = Date.now();
  if (ratesLoading || (rates && now - rates.fetchedAt < RATES_TTL) || now - ratesTriedAt < RATES_RETRY) return ratesLoading;
  ratesTriedAt = now;
  ratesLoading = fetch("/api/kur")
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`kur ${res.status}`))))
    .then(data => {
      if (!data?.rates) throw new Error("kur yok");
      rates = { rates: data.rates, updatedAt: data.updatedAt, fetchedAt: Date.now() };
      ratesFailed = false;
      try { localStorage.setItem(PREF.rates, JSON.stringify(rates)); } catch {}
    })
    .catch(() => { ratesFailed = true; })
    .finally(() => { ratesLoading = null; if (view === "varliklar" || view === "ozet") render(); });
  return ratesLoading;
}

// Varlığın kendi biriminde: "₺1.250,00", "$100,00", "12,5 gr"
function fmtAsset(amount, code, signed = false) {
  const a = V.asset(code);
  const n = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: code === "GAU" ? 0 : 2, maximumFractionDigits: a.digits })
    .format(Math.abs(amount));
  const sign = amount < 0 ? "−" : signed && amount > 0 ? "+" : "";
  return code === "GAU" ? `${sign}${n} gr` : `${sign}${a.symbol}${n}`;
}

// "bugün 13:36" ya da "18 Eki 13:36"
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const time = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const key = T.dateKey(d.getFullYear() * 12 + d.getMonth(), d.getDate());
  return key === T.todayKey() ? `bugün ${time}` : `${fmtDayShort(key)} ${time}`;
}

function knownEntries() {
  const known = new Set(state.people.map(p => p.id));
  return state.entries.filter(e => known.has(e.personId));
}

function renderAssets() {
  if (entryFilter !== "all" && !personById(entryFilter)) entryFilter = "all";
  const all = knownEntries();
  const mine = all.filter(e => entryFilter === "all" || e.personId === entryFilter);
  const today = T.todayKey();
  const bals = V.balances(mine, today);
  const r = rates?.rates;
  const { total, missing } = V.totalTry(bals, r);

  els.assetLabel.textContent = entryFilter === "all" ? "Toplam varlık" : `${personById(entryFilter).name} · toplam varlık`;
  setMoney(els.assetTotal, total);
  const stale = !rates || ratesFailed || missing.length;
  els.ratesNote.classList.toggle("warn-text", !!stale);
  els.ratesNote.textContent = !rates ? (ratesLoading ? "Kurlar alınıyor…" : "Kur alınamadı · yalnızca TL")
    : `Kur ${fmtTime(rates.updatedAt)}${ratesFailed ? " · güncellenemedi" : ""}`;
  els.rateStats.replaceChildren(...V.ASSETS.filter(a => a.code !== "TRY").map(a => {
    const d = el("div");
    d.append(el("dt", "", a.name), el("dd", "", r?.[a.code] ? fmt(r[a.code]) : "—"));
    return d;
  }));

  renderPersonFilter(els.entryFilter, entryFilter, id => all.filter(e => id === "all" || e.personId === id).length, id => { entryFilter = id; });
  els.entryFilter.hidden = state.people.length < 2;

  els.assetGrid.replaceChildren(...V.ASSETS.map(a => {
    const bal = bals[a.code] ?? 0;
    const tile = el("button", "asset" + (a.code in bals ? "" : " empty-asset"));
    tile.type = "button";
    tile.setAttribute("aria-label", `${a.name} hareketi ekle`);
    const name = el("div", "asset-name");
    name.append(el("span", "asset-sym", a.symbol), document.createTextNode(a.name));
    const value = V.toTry(bal, a.code, r);
    tile.append(name, el("div", "asset-bal" + (bal < 0 ? " neg" : ""), fmtAsset(bal, a.code)),
      el("div", "asset-try", a.code === "TRY" ? "\u00a0" : value == null ? "kur yok" : `≈ ${fmt(value)}`));
    tile.addEventListener("click", () => openEntrySheet(null, a.code));
    return tile;
  }));

  els.entryWrap.replaceChildren();
  if (!mine.length) {
    const btn = el("button", "btn btn-primary");
    btn.type = "button";
    btn.append(icon("plus"), document.createTextNode("Hareket ekle"));
    btn.addEventListener("click", () => openEntrySheet());
    els.entryWrap.append(emptyState("coins", "Henüz hareket yok",
      "TL, dolar, euro ya da gram altın girişlerini ve çıkışlarını ekle; bakiyeni güncel kurla TL olarak gösteririm.", btn));
    return;
  }
  // Tekrarlayan hareket son işlenen tekrarının tarihiyle sıralanır (henüz işlenmediyse başlangıcıyla)
  const order = new Map(state.entries.map((e, i) => [e.id, i]));
  const shown = e => V.occurrenceDate(e, Math.max(V.processedCount(e, today) - 1, 0));
  const sorted = mine.map(e => ({ e, at: shown(e) }))
    .sort((a, b) => b.at.localeCompare(a.at) || order.get(b.e.id) - order.get(a.e.id));
  const panel = el("div", "panel list-panel");
  for (const { e } of sorted) panel.append(entryRow(e, r, today));
  const head = el("header", "panel-head");
  head.append(el("h2", "", "Hareketler"));
  els.entryWrap.append(head, panel);
}

function entryRow(e, r, today) {
  const a = V.asset(e.asset);
  const n = V.repeatOf(e);
  const next = V.nextDate(e, today);
  const row = el("div", "purchase" + (n != null && !next ? " done" : ""));
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const main = el("div", "p-main");
  main.append(el("div", "p-title", e.desc));
  const meta = el("div", "p-meta");
  meta.append(el("span", "card-tag", a.name), el("span", "", fmtDay(e.date)));
  if (n != null) meta.append(el("span", "", n ? `Her ay · ${n} kez` : "Her ay"));
  main.append(meta);
  if (n) {
    const done = V.processedCount(e, today);
    const prog = el("div", "progress");
    const bar = el("div", "bar");
    const fill = el("span");
    fill.style.width = `${(done / n) * 100}%`;
    bar.append(fill);
    prog.append(bar, el("span", "", `${done}/${n} işlendi`));
    main.append(prog);
  }

  const side = el("div", "p-side");
  const amount = el("span", "amount " + (e.amount > 0 ? "in" : "out"), fmtAsset(e.amount, e.asset, true));
  if (n != null) amount.append(el("small", "", "/ay"));
  side.append(amount);
  const value = V.toTry(e.amount, e.asset, r);
  if (e.asset !== "TRY") side.append(el("span", "sub", value == null ? "kur yok" : `≈ ${fmt(Math.abs(value))}`));
  if (n != null) side.append(el("span", "sub", next ? `sonraki ${fmtDayShort(next)}` : "bitti"));

  row.append(avatar(personById(e.personId)), main, side);
  row.addEventListener("click", () => openEntrySheet(e));
  row.addEventListener("keydown", ev => { if (ev.key === "Enter") openEntrySheet(e); });
  return row;
}

// ---------- Sheets ----------
function openSheet(dialog) {
  hideTooltip();
  if (!dialog.open) dialog.showModal();
}

document.addEventListener("click", e => {
  const close = e.target.closest("[data-close]");
  if (close) close.closest("dialog")?.close();
});
for (const d of document.querySelectorAll("dialog.sheet")) {
  d.addEventListener("click", e => { if (e.target === d) d.close(); });   // arka plana tıklama
}

// Seçili radyo etiketleri sınıfla işaretlenir (:has(:checked) her tarayıcıda güncellenmiyor)
function syncChecked(root) {
  for (const input of root.querySelectorAll("label > input[type=radio]")) {
    input.parentElement.classList.toggle("on", input.checked);
  }
}

function radioChip(name, value, label, checked, color) {
  const chip = el("label", "chip");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  input.checked = checked;
  chip.append(input);
  if (color) chip.append(dot(color));
  chip.append(document.createTextNode(label));
  return chip;
}

// ---------- Harcama formu ----------
// Sıra: tutar (odakta), ne alındığı (önceki açıklamalardan öneri), kategori, taksit, kart (her kartta ilk ödeme tarihi),
// tarih, kişi. Altta sabit özet. Düzenlemede ödeme durumu ve planı; "Kopyala" aynısından yeni harcama açar.
// draft: kayıtlı olmayan, önceden doldurulmuş harcama (e-postadan gelen ya da kopyalanan)
let planOpen = false;         // önizlemedeki ödeme planı açık
let categoryFor = null;       // kullanıcı seçmediyse formdaki kategorinin hangi açıklamaya göre verildiği
let aiNudged = false;         // kategorisiz kayıtta yapay zekâyı açma önerisi bu oturumda gösterildi

// "1.250,50", "1250,5", "1250.50", "1.250" → sayı (Türkçe yazımda nokta binlik, virgül ondalık)
function parseAmount(v) {
  const t = String(v ?? "").replace(/[₺\s]/g, "");
  if (!t) return NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return Number(t);
}
const amountText = n => String(Math.round(n * 100) / 100).replace(".", ",");

function openPurchaseSheet(p, draft) {
  if (!state.people.length) { openPeopleSheet(); toast("Önce bir kişi ekle"); return; }
  editingId = p?.id ?? null;
  inboxDraftId = draft?.inboxId ?? null;
  const src = p || draft;
  const f = els.purchaseForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  els.purchaseTitle.textContent = p ? "Harcamayı düzenle" : draft?.inboxId != null ? "E-postadan harcama" : "Yeni harcama";
  els.purchaseDelete.hidden = !p;
  els.purchaseCopy.hidden = !p;
  planOpen = false;

  const count = src?.count ?? 1;
  els.countChips.replaceChildren(...COUNT_PRESETS.map(n =>
    radioChip("countPreset", String(n), n === 1 ? "Peşin" : `${n} taksit`, n === count)));
  f.elements.count.value = count;

  const cardId = p ? (p.cardId && cardById(p.cardId) ? p.cardId : "")
    : draft?.cardId && cardById(draft.cardId) ? draft.cardId
    : draft ? ""
    : (lastCardId != null && (lastCardId === "" || cardById(lastCardId)) ? lastCardId : state.cards[0]?.id ?? "");

  const personId = src?.personId && personById(src.personId) ? src.personId
    : personFilter !== "all" ? personFilter
    : personById(lastPersonId) ? lastPersonId : state.people[0].id;
  els.personChips.replaceChildren(...state.people.map(x =>
    radioChip("person", x.id, x.name, x.id === personId, seriesVar(x))));
  els.personField.hidden = state.people.length < 2;

  f.elements.desc.value = src?.desc ?? "";
  f.elements.amount.value = src?.total ? amountText(src.total) : "";
  f.elements.date.value = p ? p.date || "" : draft?.date || T.todayKey();
  renderCardChips(cardId);
  renderDescList();

  YZ.warm();
  categoryTouched = false;
  categorySource = K.valid(src?.category) ? (src.categoryBy === "user" ? "user" : "ai") : null;
  categoryFor = categorySource === "ai" ? src.desc : null;
  els.categoryChips.replaceChildren(...K.CATEGORIES.map(c => radioChip("category", c.id, c.name, c.id === src?.category)));
  setCategoryHint(categorySource === "ai" ? "öneri" : "");
  renderPurchaseStatus(p);
  syncChecked(f);
  updatePurchasePreview();
  openSheet(els.purchaseSheet);
  showPicked(els.countChips);
  showPickedCategory();
  if (!p) f.elements.amount.focus();
  if (src?.desc && !categorySource) suggestCategory();   // düzenlenen ya da e-postadan gelen kategorisiz harcama
}

// Kart çipleri: her kartta bu tarihli harcamanın ilk ödemesi; ilk ödemesi belirgin biçimde en geç olan işaretli
function renderCardChips(selected) {
  const date = T.parseDate(els.purchaseForm.elements.date.value) ? els.purchaseForm.elements.date.value : null;
  const timing = date ? I.cardTiming(state, date) : [];
  const usable = timing.filter(x => !x.full);
  const best = usable.length > 1 && usable[0].days - usable[usable.length - 1].days >= 10 ? usable[0].card.id : null;
  const chip = (id, name, color, sub, tag) => {
    const c = radioChip("card", id, name, id === selected, color);
    if (sub) c.append(el("small", "chip-sub", sub));
    if (tag) c.append(el("span", "chip-tag", tag));
    return c;
  };
  els.cardChips.replaceChildren(
    ...state.cards.map(c => {
      const t = timing.find(x => x.card.id === c.id);
      return chip(c.id, c.name, seriesVar(c), t && fmtDayShort(t.due), t?.full ? "limit dolu" : c.id === best ? "en geç" : null);
    }),
    chip("", "Nakit / banka kartı", CASH_COLOR, date && "aynı gün"));
  syncChecked(els.cardChips);
}

// Önceki harcamaların açıklamaları (en yeniler önce): yazarken öneri
function renderDescList() {
  const seen = new Set(), out = [];
  for (let i = state.installments.length - 1; i >= 0 && out.length < 60; i--) {
    const d = state.installments[i].desc?.trim();
    const k = K.keyOf(d);
    if (!d || !k || seen.has(k)) continue;
    seen.add(k);
    out.push(Object.assign(document.createElement("option"), { value: d }));
  }
  els.descList.replaceChildren(...out);
}

// Düzenlenen harcamanın durumu: kaç taksit ödendi, kalan, sonraki ödeme
function renderPurchaseStatus(p) {
  els.purchaseStatus.hidden = !p;
  if (!p) return;
  const today = T.todayKey();
  const pays = paymentsOf(p), plan = T.planLength(p);
  const left = pays.filter(x => x.key >= today);
  const parts = plan > 1
    ? [`${plan - left.length}/${plan} taksit ödendi`, left.length ? `kalan ${fmt(left.reduce((s, x) => s + x.amount, 0))}` : "bitti"]
    : [left.length ? "Ödenmedi" : "Ödendi"];
  if (left[0]) parts.push(`sonraki ${fmtDay(left[0].key)}`);
  els.purchaseStatus.textContent = parts.join(" · ");
}

// Kayan çip satırlarında seçili çip görünsün (dikey kaydırmadan)
function showPicked(row) {
  const chip = row.querySelector(".on");
  if (chip) row.scrollLeft = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
}
const showPickedCategory = () => showPicked(els.categoryChips);

// ---------- Kategori önerisi ----------
// Önce kullanıcının aynı işyerine verdiği kategori (kategori.js), yoksa cihazdaki model (yz.js). Kullanıcı bir
// kategori seçince öneri durur; seçtiği kategori öğrenilir (categoryBy: "user").
function setCategoryHint(text, action) {
  const h = els.categoryHint;
  h.replaceChildren();
  if (text) h.append(document.createTextNode(text));
  if (action) {
    const b = el("button", "link", action.label);
    b.type = "button";
    b.addEventListener("click", action.run);
    h.append(b);
  }
}

function pickCategory(id, source, desc = null) {
  for (const r of els.categoryChips.querySelectorAll("input")) r.checked = r.value === id;
  categorySource = source;
  categoryFor = id ? desc : null;
  syncChecked(els.categoryChips);
  showPickedCategory();
}

// Önerilen kategoriyi kullanıcı seçti (öneriye dokundu): kendi seçimi sayılır, öğrenilir
function chooseCategory(id) {
  pickCategory(id, "user");
  categoryTouched = true;
  suggestSeq++;
  setCategoryHint("");
  updatePurchasePreview();
}

// Açıklamanın kategorisi: kullanıcının aynı işyerine verdiği (hemen) ya da cihazdaki modelin (açıksa) önerisi.
// → { category, confidence, from: "memory" | "ai" } ya da null
async function guessCategory(desc) {
  const memory = K.learned(state.installments);
  const known = K.remembered(desc, memory);
  if (known) return { category: known, confidence: 1, from: "memory" };
  const r = YZ.enabled ? await YZ.suggest(desc, memory) : null;
  return r && { ...r, from: "ai" };
}

async function suggestCategory() {
  const seq = ++suggestSeq;
  const desc = els.purchaseForm.elements.desc.value.trim();
  if (categoryTouched || categorySource === "user") return;
  if (!desc) { pickCategory(null, null); setCategoryHint(""); return; }
  const known = K.remembered(desc, K.learned(state.installments));
  if (known) { pickCategory(known, "memory", desc); setCategoryHint("önceki seçimin"); return; }
  if (!YZ.enabled) {
    pickCategory(null, null);
    setCategoryHint("", YZ.supported() ? { label: "Yapay zekâ önersin", run: openAiSheet } : null);
    return;
  }
  setCategoryHint("öneriliyor…");
  try {
    const r = await guessCategory(desc);
    if (seq !== suggestSeq || categoryTouched || !els.purchaseSheet.open) return;
    if (!r) { setCategoryHint(""); return; }
    if (r.confidence < K.SURE) {
      pickCategory(null, null);
      setCategoryHint("emin değilim · ", { label: `${K.category(r.category).name} olabilir`, run: () => chooseCategory(r.category) });
      return;
    }
    pickCategory(r.category, "ai", desc);
    setCategoryHint("öneri");
  } catch {
    if (seq === suggestSeq) setCategoryHint("öneri alınamadı");
  }
}

// Kaydedilen harcamaya, kullanıcı kategori seçmediyse kategori verilir (öneri gelmeden kaydedildiyse ya da açıklama
// değiştiyse). Model yüklenirken form beklemesin diye kayıttan sonra; bu arada harcama değiştiyse dokunulmaz.
async function classifyAfterSave(id) {
  const p = state.installments.find(x => x.id === id);
  if (!p || K.valid(p.category) || !p.desc?.trim() || !YZ.enabled) return;
  const owner = stateOwner;
  let r = null;
  try { r = await guessCategory(p.desc); } catch {}
  const cur = state.installments.find(x => x.id === id);
  if (!r || r.confidence < K.SURE || stateOwner !== owner || !cur || K.valid(cur.category) || cur.desc !== p.desc) return;
  state.installments = state.installments.map(x => (x.id === id ? { ...x, category: r.category, categoryBy: "ai" } : x));
  saveState();
  render();
  toast(`${cur.desc} · ${K.category(r.category).name}`);
}

function collectPurchase() {
  const f = els.purchaseForm.elements;
  const editing = editingId ? state.installments.find(x => x.id === editingId) : null;
  const desc = f.desc.value.trim();
  const amount = parseAmount(f.amount.value);
  const count = Math.round(Number(f.count.value || 1));
  const date = T.parseDate(f.date.value) ? f.date.value : "";
  const errors = [];
  if (!(amount > 0)) errors.push("amount");
  if (!desc) errors.push("desc");
  if (!(count >= 1 && count <= 60)) errors.push("count");
  if (!date && !editing?.firstDue) errors.push("date");
  if (!personById(f.person.value)) errors.push("person");

  const total = f.mode.value === "per" ? Math.round(amount * count * 100) / 100 : amount;
  const p = { desc, cardId: f.card.value || null, count, total };
  if (K.valid(f.category.value)) Object.assign(p, { category: f.category.value, categoryBy: categorySource === "user" ? "user" : "ai" });
  if (date) {
    p.date = date;
  } else if (editing?.firstDue) {
    // Excel'den gelen tarihsiz kayıt: ödeme ayı ve plan korunur
    p.firstDue = editing.firstDue;
    if (editing.planCount) p.planCount = editing.planCount;
  }
  return { p, personId: f.person.value, errors };
}

function updatePurchasePreview() {
  const { p, errors } = collectPurchase();
  const box = els.purchasePreview;
  box.replaceChildren();
  els.purchaseSum.replaceChildren();
  const today = T.todayKey();
  for (const b of els.dateChips.querySelectorAll("[data-day]")) {
    b.classList.toggle("on", els.purchaseForm.elements.date.value === T.addDays(today, Number(b.dataset.day)));
  }
  if (errors.some(e => e === "amount" || e === "count" || e === "date")) return;

  const card = cardById(p.cardId);
  const pays = T.payments(p, card);
  const first = pays[0].key, last = pays[pays.length - 1].key;
  els.purchaseSum.append(el("strong", "", p.count > 1 ? `${p.count} × ${fmt(T.perInstallment(p))}` : fmt(p.total)),
    el("span", "", `${p.count > 1 ? "ilk ödeme" : "ödeme"} ${fmtDayShort(first)} · ${relDays(first, today).toLocaleLowerCase("tr-TR")}`));

  if (p.count > 1) box.append(el("div", "", `Toplam ${fmt(p.total)} · son taksit ${fmtDay(last)}`));
  if (card && p.date) {
    box.append(el("div", "", `${card.name} · ${fmtDay(T.statementOf(card, p.date).cut)} kesimli ekstreye girer, ${fmtDay(first)} ödenir`));
  } else if (!card) {
    box.append(el("div", "", p.count > 1 ? "Nakit — her ay harcama gününde ödenir" : "Nakit — harcama gününde ödenir"));
  } else {
    box.append(el("div", "", "Excel'den aktarılan kayıt — tarih girmezsen ödeme ayı korunur"));
  }
  const t = card && p.date ? I.cardTiming(state, p.date).find(x => x.card.id === card.id) : null;
  if (t?.available != null) {
    const own = editingId ? state.installments.find(x => x.id === editingId) : null;
    const before = own && own.cardId === card.id ? T.outstanding(paymentsOf(own), today) : 0;
    const after = t.available + before - T.outstanding(pays, today);
    box.append(el("div", after < 0 ? "warn" : "", after < 0 ? `${card.name} limiti ${fmt(-after)} aşılır` : `${card.name} kullanılabilir limit sonra ${fmt(after)}`));
  }
  if (pays.length > 1) {
    const details = el("details", "plan");
    details.open = planOpen;
    details.addEventListener("toggle", () => { planOpen = details.open; });
    details.append(el("summary", "", `Ödeme planı (${pays.length} taksit)`));
    const ol = el("ol", "plan-list");
    for (const x of pays) {
      const li = el("li", x.key < today ? "paid" : "");
      li.append(el("span", "", `${x.no}. ${fmtDay(x.key)}`), el("span", "amount", fmt(x.amount)));
      ol.append(li);
    }
    details.append(ol);
    box.append(details);
  }
}

els.purchaseForm.addEventListener("input", e => {
  e.target.classList?.remove("invalid");
  const f = els.purchaseForm.elements;
  if (e.target.name === "countPreset") f.count.value = e.target.value;
  if (e.target.name === "count") {
    for (const r of els.countChips.querySelectorAll("input")) r.checked = r.value === String(Math.round(Number(f.count.value)));
  }
  if (e.target.name === "date") renderCardChips(f.card.value);
  if (e.target.name === "category") {
    categoryTouched = true;
    categorySource = "user";
    suggestSeq++;
    setCategoryHint("");
  }
  if (e.target.name === "desc") {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(suggestCategory, SUGGEST_DELAY);
  }
  syncChecked(els.purchaseForm);
  updatePurchasePreview();
});

els.dateChips.addEventListener("click", e => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  const input = els.purchaseForm.elements.date;
  input.value = T.addDays(T.todayKey(), Number(b.dataset.day));
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

els.purchaseForm.addEventListener("submit", e => {
  e.preventDefault();
  const { p, personId, errors } = collectPurchase();
  const f = els.purchaseForm.elements;
  for (const name of ["desc", "amount", "count", "date"]) f[name].classList.toggle("invalid", errors.includes(name));
  if (errors.length) {
    const msg = { desc: "Ne aldığını yaz.", amount: "Tutarı gir.", count: "Taksit sayısı 1–60 arası olmalı.", date: "Harcama tarihini gir.", person: "Kişi seç." }[errors[0]];
    els.purchasePreview.replaceChildren(el("div", "warn", msg));
    f[errors[0]]?.focus?.();
    return;
  }
  // Kullanıcı seçmediyse: başka bir açıklamaya göre verilmiş kategori düşer; aynı işyerine önceki seçimi hemen,
  // modelin önerisi kayıttan sonra gelir
  if (p.categoryBy !== "user") {
    if (categoryFor !== p.desc) { delete p.category; delete p.categoryBy; }
    const known = !p.category && K.remembered(p.desc, K.learned(state.installments));
    if (known) Object.assign(p, { category: known, categoryBy: "ai" });
  }
  const id = editingId ?? uid();
  if (editingId) {
    state.installments = state.installments.map(x => (x.id === editingId ? { id: x.id, personId, ...p } : x));
  } else {
    state.installments.push({ id, personId, ...p });
  }
  if (inboxDraftId != null) {
    const inboxId = inboxDraftId;
    inbox = inbox.filter(x => x.row.id !== inboxId);
    window.syncInboxClaim?.([inboxId]);
  }
  inboxDraftId = null;
  if (p.categoryBy === "user") unsure.clear();   // yeni örnekle emin olunamayanlar yeniden denenebilir
  lastCardId = p.cardId || "";
  lastPersonId = personId;
  saveState();
  els.purchaseSheet.close();
  const nudge = !p.category && !YZ.enabled && YZ.supported() && !aiNudged;
  if (nudge) aiNudged = true;
  toast((editingId ? "Harcama güncellendi" : "Harcama eklendi")
    + (p.category ? ` · ${K.category(p.category).name}` : nudge ? " · kategori için Ayarlar → Yapay zekâ'yı aç" : ""));
  editingId = null;
  render();
  classifyAfterSave(id);
});

els.purchaseCopy.addEventListener("click", () => {
  const p = state.installments.find(x => x.id === editingId);
  if (!p) return;
  const { id, date, firstDue, planCount, ...rest } = p;
  els.purchaseSheet.close();
  openPurchaseSheet(null, { ...rest, count: T.planLength(p), total: T.originalTotal(p), date: T.todayKey() });
});

els.purchaseDelete.addEventListener("click", () => {
  const p = state.installments.find(x => x.id === editingId);
  if (!p || !confirm(`“${p.desc}” silinsin mi?`)) return;
  state.installments = state.installments.filter(x => x.id !== p.id);
  editingId = null;
  saveState();
  els.purchaseSheet.close();
  toast("Harcama silindi");
  render();
});

for (const b of document.querySelectorAll("[data-add-purchase]")) {
  b.addEventListener("click", () => (view === "varliklar" ? openEntrySheet() : openPurchaseSheet()));
}

// ---------- Kart formu ----------
function readCardForm() {
  const f = els.cardForm.elements;
  return {
    name: f.name.value.trim(),
    limit: Number(f.limit.value) || 0,
    cutoffDay: validDay(f.cutoffDay.value),
    dueDay: validDay(f.dueDay.value),
    last4: f.last4.value.replace(/\D/g, ""),
  };
}

function openCardSheet(c) {
  editingCardId = c?.id ?? null;
  const f = els.cardForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  els.cardTitle.textContent = c ? "Kartı düzenle" : "Yeni kart";
  els.cardDelete.hidden = !c;
  if (c) {
    f.elements.name.value = c.name;
    f.elements.limit.value = c.limit || "";
    f.elements.cutoffDay.value = c.cutoffDay;
    f.elements.dueDay.value = c.dueDay;
    f.elements.last4.value = c.last4 || "";
  }
  termChange = null;
  updateCardPreview();
  openSheet(els.cardSheet);
  if (!c) f.elements.name.focus();
}

function updateCardPreview() {
  const v = readCardForm();
  const existing = cardById(editingCardId);
  const card = { ...v, color: existing ? existing.color : nextColor(state.cards) };
  const stats = existing ? cardStats(existing) : { used: 0, next: null, nextTotal: 0 };
  const tile = cardTile(card, stats, "div");
  els.cardPreview.replaceWith(tile);
  tile.classList.add("cc-preview");
  tile.id = "cardPreview";
  tile.setAttribute("aria-hidden", "true");
  els.cardPreview = tile;

  updateTermChoices(existing, v);
  if (v.cutoffDay && v.dueDay) {
    const s = T.statementOf(withTerms(existing, v) || card, T.todayKey());
    els.cardHint.textContent = `Bugün yapılan bir harcama ${fmtDay(s.cut)} kesimli ekstreye girer ve ${fmtDay(s.due)} tarihinde ödenir.`;
  } else {
    els.cardHint.textContent = "Kesim ve son ödeme gününü kart ekstrende bulabilirsin.";
  }
}

// Kesim / son ödeme günü değişince arada kalan harcamaların ne olacağı sorulur; yalnızca sonucu farklı seçenekler gösterilir
function updateTermChoices(existing, v) {
  const terms = { cutoffDay: v.cutoffDay, dueDay: v.dueDay };
  const key = `${terms.cutoffDay}|${terms.dueDay}`;
  if (termChange?.key === key) return;
  const r = existing && terms.cutoffDay && terms.dueDay ? T.termChoices(existing, terms, state.installments, T.todayKey()) : null;
  termChange = r?.choices.length ? { ...r, key, selected: null } : null;
  els.termField.hidden = !termChange;
  els.termChoices.classList.remove("invalid");
  if (!termChange) { els.termChoices.replaceChildren(); return; }

  const { open, next } = r;
  els.termNote.textContent = open.count
    ? `${fmtDay(open.cut)} kesimli ekstreye düşecek ${open.count} ödeme (${fmt(open.total)}) henüz kesilmedi. Günler değişince ne olsun?`
    : "Bu karttaki harcamaların ödeme tarihleri değişecek. Nasıl hesaplansın?";
  const text = {
    old: ["Bu ekstre eski günlerle kesilsin",
      `${fmtDay(open.cut)} kesilir, ${fmtDay(open.due)} tarihinde ödenir; sonraki ekstreler yeni günlerle`],
    new: ["Yeni günler hemen başlasın", open.count
      ? `Kesilmiş ekstreler kalır; açık ekstredekiler ${fmtDay(next.cut)} kesimli ekstreye girer, ${fmtDay(next.due)} tarihinde ödenir`
      : "Kesilmiş ekstreler olduğu gibi kalır; bundan sonrakiler yeni günlerle"],
    fix: ["Günleri yanlış girmiştim", "Şimdiki günlerle hesaplanan bütün ödemeler, geçmiş ekstreler dahil, yeni günlere göre yeniden hesaplanır; daha önceki gün değişiklikleri korunur"],
  };
  els.termChoices.replaceChildren(...r.choices.map(k => {
    const label = el("label", "choice");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "termChoice";
    input.value = k;
    label.append(input, el("span", "choice-title", text[k][0]), el("span", "choice-sub", text[k][1]));
    return label;
  }));
}

// Formdaki günlerle kart: arada kalanlar için seçilen düzen, seçilmediyse kartın eski günleri korunarak
function withTerms(existing, v) {
  if (!existing) return null;
  const history = termChange?.selected ? termChange.cards[termChange.selected].history : existing.history;
  return { ...existing, ...v, history };
}

els.cardForm.addEventListener("input", e => {
  e.target.classList?.remove("invalid");
  if (e.target.name === "termChoice") {
    termChange.selected = e.target.value;
    els.termChoices.classList.remove("invalid");
    syncChecked(els.termChoices);
  }
  updateCardPreview();
});

els.cardForm.addEventListener("submit", e => {
  e.preventDefault();
  const v = readCardForm();
  const f = els.cardForm.elements;
  const last4Taken = v.last4 && state.cards.some(c => c.id !== editingCardId && c.last4 === v.last4);
  const bad = {
    name: !v.name, limit: v.limit < 0,
    last4: (v.last4 !== "" && v.last4.length !== 4) || last4Taken,
    cutoffDay: !v.cutoffDay, dueDay: !v.dueDay,
  };
  for (const [k, isBad] of Object.entries(bad)) f[k].classList.toggle("invalid", isBad);
  const firstBad = Object.keys(bad).find(k => bad[k]);
  if (firstBad) {
    f[firstBad].focus();
    if (firstBad === "last4") toast(last4Taken ? "Bu son 4 hane başka bir kartta kayıtlı" : "Son 4 hane 4 rakam olmalı");
    return;
  }
  if (termChange && !termChange.selected) {
    els.termChoices.classList.add("invalid");
    els.termChoices.querySelector("input")?.focus();
    toast("Arada kalan harcamalar ne olsun? Bir seçenek seç.");
    return;
  }
  if (!v.last4) delete v.last4;

  if (editingCardId) {
    state.cards = state.cards.map(c => {
      if (c.id !== editingCardId) return c;
      const { last4, history, ...rest } = withTerms(c, v);
      return { ...rest, ...(v.last4 && { last4 }), ...(history && { history }) };
    });
  } else {
    state.cards.push({ id: uid(), ...v, color: nextColor(state.cards) });
  }
  saveState();
  els.cardSheet.close();
  toast(editingCardId ? "Kart güncellendi" : "Kart eklendi");
  editingCardId = null;
  render();
});

els.cardDelete.addEventListener("click", () => {
  const c = cardById(editingCardId);
  if (!c) return;
  const n = state.installments.filter(p => p.cardId === c.id).length;
  if (!confirm(n ? `“${c.name}” kartı ve bu karttaki ${n} harcama silinsin mi?` : `“${c.name}” kartı silinsin mi?`)) return;
  state.cards = state.cards.filter(x => x.id !== c.id);
  state.installments = state.installments.filter(p => p.cardId !== c.id);
  if (lastCardId === c.id) lastCardId = null;
  editingCardId = null;
  saveState();
  els.cardSheet.close();
  toast("Kart silindi");
  render();
});

els.addCard.addEventListener("click", () => openCardSheet());

// ---------- Varlık hareketi formu ----------
// draft: kayıtlı olmayan, önceden doldurulmuş hareket ({ desc, repeat }; içgörüdeki "Gelir ekle")
function openEntrySheet(e, asset, draft) {
  if (!state.people.length) { openPeopleSheet(); toast("Önce bir kişi ekle"); return; }
  editingEntryId = e?.id ?? null;
  const f = els.entryForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  els.entryTitle.textContent = e ? "Hareketi düzenle" : "Yeni hareket";
  els.entryDelete.hidden = !e;

  const code = e?.asset ?? asset ?? lastAsset;
  els.assetChips.replaceChildren(...V.ASSETS.map(a => radioChip("asset", a.code, a.name, a.code === code)));
  const personId = e ? e.personId
    : entryFilter !== "all" ? entryFilter
    : personById(lastPersonId) ? lastPersonId : state.people[0].id;
  els.entryPersonChips.replaceChildren(...state.people.map(x =>
    radioChip("person", x.id, x.name, x.id === personId, seriesVar(x))));

  f.elements.dir.value = e && e.amount < 0 ? "out" : "in";
  f.elements.amount.value = e ? Math.abs(e.amount) : "";
  f.elements.desc.value = e?.desc ?? draft?.desc ?? "";
  f.elements.date.value = e?.date ?? T.todayKey();
  const repeat = V.repeatOf(e ?? draft) ?? 1;
  els.repeatChips.replaceChildren(...REPEAT_PRESETS.map(([n, label]) => radioChip("repeatPreset", String(n), label, n === repeat)));
  f.elements.repeat.value = repeat >= 2 ? repeat : "";
  syncChecked(f);
  updateEntryForm();
  openSheet(els.entrySheet);
  if (!e) f.elements.amount.focus();
}

function collectEntry() {
  const f = els.entryForm.elements;
  const asset = f.asset.value;
  const amount = V.round(Number(f.amount.value), asset);
  const desc = f.desc.value.trim();
  const date = T.parseDate(f.date.value) ? f.date.value : "";
  // "Diğer"e yazılan ay sayısı çiplerden önce gelir; 1 = tek seferlik, 0 = süresiz
  const repeat = f.repeat.value !== "" ? Number(f.repeat.value) : Number(f.repeatPreset.value || 1);
  const errors = [];
  if (!(amount > 0)) errors.push("amount");
  if (!desc) errors.push("desc");
  if (!date) errors.push("date");
  if (!(repeat === 1 || V.repeatOf({ repeat }) != null)) errors.push("repeat");
  if (!personById(f.person.value)) errors.push("person");
  const e = { personId: f.person.value, asset, amount: f.dir.value === "out" ? -amount : amount, desc, date };
  if (repeat !== 1) e.repeat = repeat;
  return { e, errors };
}

function updateEntryForm() {
  const { e, errors } = collectEntry();
  const a = V.asset(e.asset);
  els.entryUnit.textContent = a.symbol;
  els.entryForm.elements.amount.step = e.asset === "GAU" ? "0.001" : "0.01";

  const n = V.repeatOf(e);
  els.entryDateLabel.textContent = n != null ? "İlk tarih" : "Tarih";

  const box = els.entryPreview;
  box.replaceChildren();
  if (errors.includes("amount")) return;
  const r = rates?.rates;
  const today = T.todayKey();
  box.append(el("div", "big", fmtAsset(e.amount, e.asset, true) + (n != null ? " / ay" : "")));
  if (e.asset !== "TRY") {
    const value = V.toTry(Math.abs(e.amount), e.asset, r);
    box.append(el("div", "", value == null ? "Kur alınamadı — TL karşılığı sonra hesaplanır"
      : `≈ ${fmt(value)} · ${a.code === "GAU" ? "1 gr" : `1 ${a.symbol}`} = ${fmt(r[e.asset])}`));
  }
  if (n != null && e.date && !errors.includes("repeat")) {
    const done = V.processedCount(e, today), next = V.nextDate(e, today);
    box.append(el("div", "", n ? `Her ay ${n} kez · son ${fmtDay(V.lastDate(e))}` : "Her ay, bitiş tarihi yok"));
    box.append(el("div", "", [done && `Bugüne kadar ${done} kez işlendi`, next && `${done ? "sonraki" : "İlki"} ${fmtDay(next)}`]
      .filter(Boolean).join(" · ")));
  }
  const person = personById(e.personId);
  if (person && !errors.includes("repeat")) {
    const before = V.balances(state.entries.filter(x => x.personId === person.id && x.id !== editingEntryId), today)[e.asset] ?? 0;
    const after = V.round(before + e.amount * (e.date ? V.processedCount(e, today) : 1), e.asset);
    box.append(el("div", after < 0 ? "warn" : "", `${person.name} · ${a.name.toLocaleLowerCase("tr-TR")} bakiyesi ${fmtAsset(before, e.asset)} → ${fmtAsset(after, e.asset)}`));
  }
}

els.entryForm.addEventListener("input", e => {
  e.target.classList?.remove("invalid");
  const f = els.entryForm.elements;
  if (e.target.name === "repeatPreset") {
    f.repeat.value = Number(e.target.value) >= 2 ? e.target.value : "";
    f.repeat.classList.remove("invalid");
  }
  if (e.target.name === "repeat") {
    const v = String(Math.round(Number(f.repeat.value)));
    for (const r of els.repeatChips.querySelectorAll("input")) r.checked = f.repeat.value !== "" && r.value === v;
  }
  syncChecked(els.entryForm);
  updateEntryForm();
});

els.entryForm.addEventListener("submit", ev => {
  ev.preventDefault();
  const { e, errors } = collectEntry();
  const f = els.entryForm.elements;
  for (const name of ["amount", "desc", "date", "repeat"]) f[name].classList.toggle("invalid", errors.includes(name));
  if (errors.length) {
    const msg = { amount: "Miktarı gir.", desc: "Açıklama yaz.", date: "Tarihi gir.", repeat: `Tekrar 2–${V.MAX_REPEAT} ay arası olmalı.`, person: "Kişi seç." }[errors[0]];
    els.entryPreview.replaceChildren(el("div", "warn", msg));
    f[errors[0]]?.focus?.();
    return;
  }
  if (editingEntryId) {
    state.entries = state.entries.map(x => (x.id === editingEntryId ? { id: x.id, ...e } : x));
  } else {
    state.entries.push({ id: uid(), ...e });
  }
  lastAsset = e.asset;
  lastPersonId = e.personId;
  saveState();
  els.entrySheet.close();
  toast(editingEntryId ? "Hareket güncellendi" : "Hareket eklendi");
  editingEntryId = null;
  render();
});

els.entryDelete.addEventListener("click", () => {
  const e = state.entries.find(x => x.id === editingEntryId);
  if (!e || !confirm(`“${e.desc}” silinsin mi?`)) return;
  state.entries = state.entries.filter(x => x.id !== e.id);
  editingEntryId = null;
  saveState();
  els.entrySheet.close();
  toast("Hareket silindi");
  render();
});

// ---------- Kişiler ----------
function openPeopleSheet() {
  renderPeopleSheet();
  openSheet(els.peopleSheet);
}

function renderPeopleSheet() {
  els.peopleEdit.replaceChildren();
  for (const p of state.people) {
    const n = state.installments.filter(i => i.personId === p.id).length;
    const m = state.entries.filter(x => x.personId === p.id).length;
    const li = el("li");
    const input = document.createElement("input");
    input.type = "text";
    input.value = p.name;
    input.setAttribute("aria-label", `${p.name} adı`);
    input.addEventListener("change", () => {
      const name = input.value.trim();
      const clash = state.people.some(x => x.id !== p.id && T.normalize(x.name) === T.normalize(name));
      if (!name || clash) { input.value = p.name; if (clash) toast("Bu adda bir kişi var"); return; }
      p.name = name;
      saveState(); render(); toast("Ad güncellendi");
    });
    const del = el("button", "icon-btn");
    del.type = "button";
    del.setAttribute("aria-label", `${p.name} sil`);
    del.append(icon("x"));
    del.addEventListener("click", () => {
      if (state.people.length === 1) { toast("En az bir kişi olmalı"); return; }
      const owned = [n && `${n} harcaması`, m && `${m} varlık hareketi`].filter(Boolean).join(" ve ");
      if (!confirm(owned ? `“${p.name}” ve ${owned} silinsin mi?` : `“${p.name}” silinsin mi?`)) return;
      state.people = state.people.filter(x => x.id !== p.id);
      state.installments = state.installments.filter(i => i.personId !== p.id);
      state.entries = state.entries.filter(x => x.personId !== p.id);
      saveState(); renderPeopleSheet(); render();
    });
    li.append(avatar(p), input, del, el("span", "sub", [n && `${n} harcama`, m && `${m} hareket`].filter(Boolean).join(" · ") || "kayıt yok"));
    els.peopleEdit.append(li);
  }
}

els.personAddForm.addEventListener("submit", e => {
  e.preventDefault();
  const input = els.personAddForm.elements.name;
  const name = input.value.trim();
  if (!name) return;
  if (state.people.some(p => T.normalize(p.name) === T.normalize(name))) { toast("Bu adda bir kişi var"); return; }
  state.people.push({ id: uid(), name, color: nextColor(state.people) });
  input.value = "";
  saveState(); renderPeopleSheet(); render();
  toast(`${name} eklendi`);
});

els.managePeople.addEventListener("click", openPeopleSheet);

// ---------- E-postadan harcama ----------
// Kullanıcıya özel adrese gelen e-postaları workers/eposta Supabase'e yazar (supabase/eposta.sql);
// burada okunup kartına eklenir.
// Okunamayan ya da kartı bulunamayan e-postalar Harcamalar sekmesinde onaya bekler.
function emailCard(parsed) {
  if (parsed.last4) return state.cards.find(c => c.last4 === parsed.last4) ?? null;
  return state.cards.length === 1 ? state.cards[0] : null;
}

function emailPurchase(parsed, card) {
  return { desc: parsed.merchant || "Kart harcaması", cardId: card?.id ?? null, count: parsed.count, total: parsed.amount, date: parsed.date };
}

function emailItem(row) {
  const parsed = E.parse({ body: row.body, subject: row.subject, receivedAt: row.received_at });
  const card = emailCard(parsed);
  const reason = parsed.reason
    || (card ? null : parsed.last4 ? `•••• ${parsed.last4} ile biten kart tanımlı değil` : "Kart okunamadı");
  return { row, parsed, card, reason };
}

async function checkInbox({ quiet = true } = {}) {
  if (inboxBusy || typeof window.syncInboxFetch !== "function") return;
  // Kullanıcıya özel veri yüklenmeden harcama eklenmesin (giriş olayından önce çağrılırsa)
  if (!window.CF_USER_ID || window.CF_USER_ID !== window.syncGetUser?.()?.id) return;
  inboxBusy = true;
  try {
    const rows = await window.syncInboxFetch();
    if (!rows) { if (!quiet) toast("E-postalar okunamadı"); return; }
    const items = rows.map(emailItem);
    const ready = items.filter(x => !x.reason);
    const seen = new Set(inbox.map(x => x.row.id));
    inbox = items.filter(x => x.reason);
    const fresh = inbox.filter(x => !seen.has(x.row.id)).length;

    // Önce işaretlenir: başka bir cihaz aynı anda okuduysa harcama iki kez eklenmez
    const claimed = new Set(await window.syncInboxClaim(ready.map(x => x.row.id)));
    const added = ready.filter(x => claimed.has(x.row.id));
    if (added.length) {
      const personId = state.people[0].id;
      for (const x of added) state.installments.push({ id: uid(), personId, ...emailPurchase(x.parsed, x.card) });
      saveState();
      if (typeof window.syncPushNow === "function") await window.syncPushNow();
      backfillCategories();
    }
    if (added.length === 1) {
      const p = emailPurchase(added[0].parsed, added[0].card);
      toast(`E-postadan eklendi: ${p.desc} · ${fmt(p.total)}`);
    } else if (added.length) {
      toast(`E-postadan ${added.length} harcama eklendi`);
    } else if (fresh || (!quiet && inbox.length)) {
      toast(`${inbox.length} e-posta onay bekliyor · Harcamalar`);
    } else if (!quiet) {
      toast("Yeni e-posta yok");
    }
    render();
  } finally { inboxBusy = false; }
}

function inboxPanel() {
  const panel = el("section", "panel inbox-panel");
  const head = el("header", "panel-head");
  head.append(el("h2", "", "E-postadan gelenler"), el("span", "panel-note", `${inbox.length} onay bekliyor`));
  const list = el("ul", "inbox-list");
  for (const x of inbox) {
    const { parsed, row } = x;
    const li = el("li", "inbox-item");
    const main = el("div", "p-main");
    main.append(el("div", "p-title", parsed.merchant || row.subject || "Banka e-postası"));
    const meta = el("div", "p-meta");
    if (parsed.amount != null) {
      meta.append(el("span", "", parsed.currency === "TRY" ? fmt(parsed.amount) : `${fmtNum(parsed.amount)} ${parsed.currency}`));
    }
    if (parsed.date) meta.append(el("span", "", fmtDayShort(parsed.date)));
    if (parsed.count > 1) meta.append(el("span", "", `${parsed.count} taksit`));
    if (meta.childElementCount) main.append(meta);
    main.append(el("div", "inbox-reason", x.reason));
    if (row.sender) main.append(el("div", "inbox-from", row.sender));

    const actions = el("div", "inbox-actions");
    const add = el("button", "btn btn-primary sm", "Ekle");
    add.type = "button";
    add.addEventListener("click", () => openPurchaseSheet(null, { inboxId: row.id, ...emailPurchase(parsed, x.card) }));
    const skip = el("button", "btn btn-ghost sm", "Yok say");
    skip.type = "button";
    skip.addEventListener("click", async () => {
      skip.disabled = true;
      await window.syncInboxClaim?.([row.id]);
      inbox = inbox.filter(y => y.row.id !== row.id);
      render();
    });
    const open = inboxOpenId === row.id;
    const show = el("button", "btn btn-ghost sm", open ? "Gizle" : "Göster");
    show.type = "button";
    show.setAttribute("aria-expanded", String(open));
    show.addEventListener("click", () => { inboxOpenId = open ? null : row.id; render(); });
    actions.append(add, show, skip);
    li.append(main, actions);
    if (open) li.append(emailBody(row.body));
    list.append(li);
  }
  panel.append(head, list);
  return panel;
}

// E-posta metni; bağlantılar tıklanabilir (banka doğrulama e-postaları için)
function emailBody(body) {
  const pre = el("div", "inbox-body");
  const text = E.plainText(body);
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    pre.append(document.createTextNode(text.slice(last, m.index)));
    const a = el("a", "", m[0]);
    a.href = m[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    pre.append(a);
    last = m.index + m[0].length;
  }
  pre.append(document.createTextNode(text.slice(last)));
  return pre;
}

async function openInboxSheet() {
  const loggedIn = !!window.syncGetUser?.();
  els.inboxLoginNote.hidden = loggedIn;
  els.inboxSetup.hidden = !loggedIn;
  openSheet(els.inboxSheet);
  if (!loggedIn) return;
  await showInboxAddress(false);
}

async function showInboxAddress(renew) {
  els.inboxAddress.textContent = "…";
  try {
    const address = await window.syncInboxAddress(renew);
    if (!window.INBOX_DOMAIN) {
      els.inboxAddress.textContent = "—";
      toast("Alan adı ayarlanmamış (config.js → INBOX_DOMAIN)");
      return;
    }
    els.inboxAddress.textContent = `${address}@${window.INBOX_DOMAIN}`;
    if (renew) toast("Yeni adres oluşturuldu");
  } catch {
    els.inboxAddress.textContent = "—";
    toast("Adres alınamadı — supabase/eposta.sql çalıştırıldı mı?");
  }
}

function renderInboxTry() {
  const text = els.inboxTry.value.trim();
  const box = els.inboxTryResult;
  box.replaceChildren();
  if (!text) return;
  const parsed = E.parse({ body: text, receivedAt: new Date() });
  const card = emailCard(parsed);
  const line = (label, value) => el("div", "", `${label}: ${value ?? "okunamadı"}`);
  box.append(
    el("div", "big", parsed.amount != null ? (parsed.currency === "TRY" ? fmt(parsed.amount) : `${fmtNum(parsed.amount)} ${parsed.currency}`) : "Tutar okunamadı"),
    line("İşyeri", parsed.merchant),
    line("Tarih", parsed.date && fmtDay(parsed.date)),
    line("Taksit", parsed.count > 1 ? `${parsed.count} taksit` : "Peşin"),
    line("Kart", parsed.last4 && `•••• ${parsed.last4}${card ? ` → ${card.name}` : " (tanımlı kart yok)"}`));
  const reason = parsed.reason || (card ? null : "Kart eşleşmedi; harcama onaya düşer");
  box.append(reason ? el("div", "warn", reason) : el("div", "", `${card.name} kartına kendiliğinden eklenir`));
}

els.inboxBtn.addEventListener("click", () => { els.settingsSheet.close(); openInboxSheet(); });
els.inboxCheck.addEventListener("click", () => checkInbox({ quiet: false }));
els.inboxRenew.addEventListener("click", () => {
  if (confirm("Eski adrese gelen e-postalar artık alınmaz; bankadaki adresi de yenisiyle değiştirmen gerekir. Devam edelim mi?")) showInboxAddress(true);
});
els.inboxTry.addEventListener("input", renderInboxTry);
async function copyFrom(e) {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try {
    await navigator.clipboard.writeText($(b.dataset.copy).textContent);
    toast("Kopyalandı");
  } catch { toast("Kopyalanamadı"); }
}
els.inboxSheet.addEventListener("click", copyFrom);

// ---------- Kategorisiz harcamaları ayırma ----------
// Önce kullanıcının aynı işyerine verdiği kategori (model gerekmez, her zaman), sonra cihazdaki model (açıksa), en
// yeni harcamadan başlayarak. Modelin verdiği kategori "ai" işaretlidir; kullanıcı düzeltirse öğrenilir.
// manual: kullanıcı düğmeye bastı (emin olunamayanlar da söylenir)
async function backfillCategories({ manual = false } = {}) {
  if (backfillBusy) return;
  backfillBusy = true;
  const owner = stateOwner;
  const update = (id, category) => {
    state.installments = state.installments.map(x => (x.id === id ? { ...x, category, categoryBy: "ai" } : x));
  };
  try {
    const memory = K.learned(state.installments);
    let changed = 0;
    for (const p of state.installments) {
      if (K.valid(p.category)) continue;
      const c = K.remembered(p.desc, memory);
      if (c) { update(p.id, c); changed++; }
    }
    if (changed) { saveState(); render(); }
    if (!YZ.enabled) return;

    const todo = state.installments.filter(p => !K.valid(p.category) && p.desc?.trim() && !unsure.has(p.id))
      .sort((a, b) => (b.date ?? b.firstDue ?? "").localeCompare(a.date ?? a.firstDue ?? "")).map(p => p.id);
    let done = 0, skipped = 0;
    for (const id of todo) {
      if (stateOwner !== owner || !YZ.enabled) break;
      const p = state.installments.find(x => x.id === id);
      if (!p || K.valid(p.category)) continue;
      const r = await YZ.suggest(p.desc, memory);
      if (!r) break;
      const cur = state.installments.find(x => x.id === id);
      if (stateOwner !== owner || !cur || K.valid(cur.category)) continue;
      if (r.confidence < K.SURE) { unsure.add(id); skipped++; continue; }
      update(id, r.category);
      if (++done % 5 === 0) { saveState(); render(); }
      if (els.aiSheet.open) renderAiStatus();
    }
    if (done) { saveState(); render(); }
    if (done || (manual && skipped)) {
      toast([done && `${done} harcama kategorilere ayrıldı`, skipped && `${skipped} harcamada emin olamadım`].filter(Boolean).join(" · "));
    }
  } catch {
    // model açılamadı: durum yapay zekâ penceresinde görünür
  } finally {
    backfillBusy = false;
    if (els.aiSheet.open) renderAiStatus();
  }
}

// ---------- Yapay zekâ: cihazdaki model ve asistanlar (MCP) ----------
// Cihazdaki model: yz.js. Asistanlar /mcp'ye (mcp/worker.js) bağlanır; kullanıcı oauth/consent.html'de izin verir.
const mb = n => Math.round((n || 0) / 1e6);

function renderAiStatus() {
  const i = YZ.info, on = YZ.enabled;
  const loose = knownPurchases().filter(p => !K.valid(p.category) && !unsure.has(p.id)).length;
  const left = knownPurchases().filter(p => !K.valid(p.category) && unsure.has(p.id)).length;
  els.aiProgress.hidden = true;
  els.aiBackfill.hidden = true;
  if (!YZ.supported()) {
    els.aiLocalTitle.textContent = "Bu tarayıcıda çalışmıyor";
    els.aiLocalSub.textContent = "Güncel Chrome, Edge, Safari ya da Firefox gerekir.";
    els.aiLocalBtn.hidden = true;
    return;
  }
  els.aiLocalBtn.hidden = false;
  els.aiLocalBtn.textContent = on ? "Kapat ve sil" : "İndir ve aç";
  els.aiLocalBtn.className = on ? "btn btn-ghost sm" : "btn btn-primary sm";
  if (!on) {
    els.aiLocalTitle.textContent = "Kapalı";
    els.aiLocalSub.textContent = `Model bir kez indirilir: yaklaşık ${YZ.SIZE_MB} MB. Wi-Fi önerilir.`;
    return;
  }
  if (i.status === "loading") {
    els.aiLocalTitle.textContent = i.total && i.loaded < i.total ? "İndiriliyor…" : "Yükleniyor…";
    els.aiLocalSub.textContent = i.total ? `${mb(i.loaded)} / ${mb(i.total)} MB` : "Hazırlanıyor";
    els.aiProgress.hidden = !i.total;
    els.aiProgress.firstElementChild.style.width = `${i.total ? Math.min(100, (i.loaded / i.total) * 100) : 0}%`;
  } else if (i.status === "error") {
    els.aiLocalTitle.textContent = "Açılamadı";
    els.aiLocalSub.textContent = `${i.error} — kapatıp yeniden dene.`;
  } else {
    els.aiLocalTitle.textContent = "Açık";
    els.aiLocalSub.textContent = (i.status === "ready" ? "Hazır" : "Gerektiğinde yüklenir")
      + (left ? ` · ${left} harcamada emin olamadı; kategorisini Harcamalar'dan seçebilirsin` : "");
  }
  if (loose && i.status !== "error") {
    els.aiBackfill.hidden = false;
    els.aiBackfill.disabled = backfillBusy;
    els.aiBackfill.textContent = backfillBusy ? `Ayrılıyor… ${loose} kaldı` : `${loose} kategorisiz harcamayı ayır`;
  }
}

YZ.onChange(() => { if (els.aiSheet.open) renderAiStatus(); });

els.aiLocalBtn.addEventListener("click", async () => {
  if (YZ.enabled) {
    if (!confirm("Cihazdaki yapay zekâ kapatılsın ve indirilen model silinsin mi? Verilen kategoriler kalır.")) return;
    await YZ.disable();
    renderAiStatus();
    render();
    return;
  }
  const ok = await YZ.enable();
  renderAiStatus();
  render();
  if (ok) { toast("Cihazdaki yapay zekâ hazır"); backfillCategories(); }
  else toast("Model yüklenemedi");
});

els.aiBackfill.addEventListener("click", () => { backfillCategories({ manual: true }); renderAiStatus(); });

// Asistana tek tıkla ekleme. Claude'un resmi kurulum bağlantısı "Özel bağlayıcı ekle" penceresini adı ve adresi dolu
// açar, kullanıcı onaylar. ChatGPT ve Gemini'de adresi dolduran bir bağlantı yok: adres panoya kopyalanır, eklendiği
// sayfa açılır. Bağlanınca asistan CashFollow izin sayfasını açar (oauth/consent.html).
const mcpAddress = () => `${location.origin}/mcp`;
const AI_CLIENTS = {
  claude: {
    url: mcp => `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=CashFollow&connectorUrl=${encodeURIComponent(mcp)}`,
    note: "Claude'da açılan pencerede adres hazır: Ekle'ye dokun, sonra CashFollow sayfasında giriş yapıp İzin ver'e dokun.",
  },
  chatgpt: {
    url: () => "https://chatgpt.com/plugins",
    copy: true,
    note: "Adres kopyalandı. ChatGPT'de + → Add custom MCP server: ad olarak CashFollow yaz, adresi yapıştır, kimlik doğrulamada OAuth seç ve Create as a plugin'e dokun. Sonra CashFollow sayfasında İzin ver.",
  },
  gemini: {
    url: () => "https://gemini.google.com/apps",
    copy: true,
    note: "Adres kopyalandı. Gemini'de Custom apps → Add a custom app: adresi yapıştır, Next'e dokun, sonra CashFollow sayfasında İzin ver. Gemini'de özel uygulamalar şimdilik ABD'de, kişisel Google hesabıyla ve İngilizce arayüzde açık.",
  },
};

els.aiSheet.addEventListener("click", e => {
  const b = e.target.closest("[data-ai-add]");
  if (!b) return;
  const client = AI_CLIENTS[b.dataset.aiAdd], mcp = mcpAddress();
  let note = client.note;
  // Pano, yeni sekme açılmadan (sayfa odaktayken) yazılır; sekme dokunuşun içinde açılır ki engellenmesin
  if (client.copy) {
    navigator.clipboard?.writeText(mcp).catch(() => {
      els.aiAddNote.textContent = note.replace("Adres kopyalandı.", `Adres kopyalanamadı, elle kopyala: ${mcp}`);
      els.aiOther.open = true;
    });
  }
  window.open(client.url(mcp), "_blank", "noopener");
  els.aiAddNote.textContent = note;
  els.aiAddNote.hidden = false;
});

async function openAiSheet() {
  renderAiStatus();
  els.aiAddNote.hidden = true;
  els.mcpUrl.textContent = mcpAddress();
  const loggedIn = !!window.syncGetUser?.();
  els.aiLoginNote.hidden = loggedIn;
  els.aiAppsGroup.hidden = true;
  openSheet(els.aiSheet);
  if (loggedIn) await renderAiApps();
}

async function renderAiApps() {
  const grants = await window.syncOAuthGrants?.();
  els.aiApps.replaceChildren();
  els.aiAppsGroup.hidden = !grants;
  if (!grants) return;
  if (!grants.length) { els.aiApps.append(el("li", "hint", "Henüz bağlı uygulama yok")); return; }
  for (const g of grants) {
    const li = el("li");
    const info = el("span", "row-text");
    info.append(el("strong", "", g.client?.name || "Uygulama"), el("small", "", `${fmtDay(g.granted_at.slice(0, 10))} tarihinden beri`));
    const del = el("button", "btn btn-ghost sm", "Kaldır");
    del.type = "button";
    del.addEventListener("click", async () => {
      if (!confirm(`“${g.client?.name || "Uygulama"}” artık CashFollow verilerine erişemesin mi?`)) return;
      del.disabled = true;
      try {
        await window.syncOAuthRevoke(g.client.id);
        toast("Erişim kaldırıldı");
      } catch { toast("Kaldırılamadı"); }
      renderAiApps();
    });
    li.append(icon("spark"), info, del);
    els.aiApps.append(li);
  }
}

els.aiBtn.addEventListener("click", () => { els.settingsSheet.close(); openAiSheet(); });
els.aiSheet.addEventListener("click", copyFrom);

// ---------- Ayarlar ----------
function currentTheme() { return document.documentElement.dataset.theme || ""; }

function renderThemeSeg() {
  for (const b of els.themeSeg.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.theme === currentTheme());
    b.setAttribute("aria-pressed", String(b.dataset.theme === currentTheme()));
  }
}

els.themeSeg.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  const theme = b.dataset.theme;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  writePref(PREF.theme, theme);
  renderThemeSeg();
});

els.settingsBtn.addEventListener("click", () => { renderThemeSeg(); openSheet(els.settingsSheet); });
if (window.APP_VERSION) $("appVersion").textContent = `CashFollow v${window.APP_VERSION}`;
// Giriş penceresi (sync.js) ayarların üstünde açılsın diye önce ayarları kapat
els.authBtn.addEventListener("click", () => els.settingsSheet.close());

els.exportBtn.addEventListener("click", () => {
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" })),
    download: `cashfollow-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click(); URL.revokeObjectURL(a.href);
});

els.importInput.addEventListener("change", async e => {
  const file = e.target.files?.[0]; if (!file) return;
  const isExcel = /\.xlsx$/i.test(file.name);
  try {
    if (isExcel) {
      if (!(await importExcel(file))) return;
    } else {
      const data = JSON.parse(await file.text());
      if (!confirm("Mevcut verilerin üzerine yazılacak. Devam edelim mi?")) return;
      state = hydrate(data);
    }
    resetView();
    saveState();
    render();
    toast("İçe aktarıldı");
  } catch (err) {
    alert(err.userMessage || (isExcel ? "Excel dosyası okunamadı." : "Geçersiz dosya."));
    return;
  } finally { els.importInput.value = ""; }
  if (typeof window.syncPushNow === 'function') await window.syncPushNow();
});

// ---------- Girişten önce bu cihaza girilen veri ----------
// Girişsiz kullanımda veri STORAGE_KEY_BASE'de durur. Giriş yapınca kullanıcı onu hesaba taşımayı ya da silmeyi seçer;
// seçene kadar olduğu gibi kalır (pencere her girişte yeniden sorar).
function offlineData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BASE);
    if (!raw) return null;
    const s = hydrate(JSON.parse(raw));
    const people = s.people.filter(p => !(p.id === "ben" && p.name === "Ben"));
    if (!people.length && !s.cards.length && !s.installments.length && !s.entries.length) {
      localStorage.removeItem(STORAGE_KEY_BASE);   // yalnızca varsayılan kişi: sorulacak bir şey yok
      return null;
    }
    return s;
  } catch { return null; }
}

function askOfflineData() {
  const local = offlineData();
  if (!local) return;
  const people = local.people.filter(p => !(p.id === "ben" && p.name === "Ben")).length;
  els.moveSummary.textContent = [[local.installments.length, "harcama"], [local.cards.length, "kart"],
    [local.entries.length, "varlık hareketi"], [people, "kişi"]].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(", ");
  els.moveMsg.textContent = "";
  els.moveModal.hidden = false;
}

function setMoveBusy(busy) {
  els.moveKeepBtn.disabled = els.moveDropBtn.disabled = busy;
}

els.moveKeepBtn.addEventListener("click", async () => {
  const userId = window.CF_USER_ID;
  setMoveBusy(true);
  els.moveMsg.textContent = "";
  // Önce hesaptaki veri gelsin: hiç eşitlenmemiş cihazda buluttaki veri ekrandakinin yerine geçer, eklenen kaybolurdu
  await window.syncRefresh?.();
  setMoveBusy(false);
  if (!userId || stateOwner !== userId || window.CF_USER_ID !== userId) return;   // bu arada çıkış yapıldı
  if (!window.syncPulled?.()) {
    els.moveMsg.textContent = "⚠ Hesabındaki veriler alınamadı. İnternet bağlantını kontrol edip yeniden dene.";
    els.moveMsg.style.color = "var(--expense)";
    return;
  }
  const local = offlineData();
  if (local) state = hydrate(window.Tablo.combine(state, local));
  localStorage.removeItem(STORAGE_KEY_BASE);
  els.moveModal.hidden = true;
  saveState();
  render();
  toast("Veriler hesabına taşındı");
  await window.syncPushNow?.();
});

els.moveDropBtn.addEventListener("click", () => {
  if (!confirm("Bu cihaza girdiğin veriler silinecek. Devam edelim mi?")) return;
  localStorage.removeItem(STORAGE_KEY_BASE);
  els.moveModal.hidden = true;
  toast("Cihazdaki veriler silindi");
});

// ---------- Excel import ----------
// SheetJS yalnızca Excel içe aktarılırken yüklenir
const XLSX_SRC = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
const XLSX_SRI = "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT";

function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), {
      src: XLSX_SRC, integrity: XLSX_SRI, crossOrigin: "anonymous",
    });
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => {
      s.remove();
      reject(Object.assign(new Error("xlsx load failed"), {
        userMessage: "Excel okuyucu yüklenemedi. İnternet bağlantını kontrol et.",
      }));
    };
    document.head.append(s);
  });
}

// Her sayfa bir kişi. Excel'de tarih olmadığı için kayıtlar ilk karta (yoksa yeni karta) ödeme ayıyla
// eklenir; aynı kişinin daha önce Excel'den gelen (tarihsiz) kayıtları değiştirilir, diğerlerine dokunulmaz.
async function importExcel(file) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheets = wb.SheetNames.map(name => ({
    name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }),
  }));
  const result = T.parseWorkbook(sheets);
  if (!result.people.length) {
    throw Object.assign(new Error("no sheets"), { userMessage: "Excel'de “Ürün” sütunu olan bir sayfa bulunamadı." });
  }

  let card = state.cards[0];
  const newCard = card ? null : defaultCard(result.dueDay, "kart", nextColor(state.cards));
  const total = result.people.reduce((s, p) => s + p.installments.length, 0);
  const summary = result.people.map(p => `${p.name} (${p.installments.length})`).join(", ");
  let msg = `${total} taksit içe aktarılacak: ${summary}.`;
  msg += card
    ? `\nKart: ${card.name}.`
    : `\nYeni kart: “${newCard.name}” (son ödeme ${newCard.dueDay}, kesim ${newCard.cutoffDay} — sonra düzenleyebilirsin).`;
  msg += "\nBu kişilerin daha önce Excel'den aktarılan taksitleri yenileriyle değiştirilecek.";
  if (result.skipped) msg += `\n${result.skipped} satır eksik bilgi nedeniyle atlanacak.`;
  if (!confirm(msg + "\nDevam edelim mi?")) return false;

  if (!card) { card = newCard; state.cards.push(card); }
  for (const p of result.people) {
    let person = state.people.find(x => T.normalize(x.name) === T.normalize(p.name));
    if (!person) {
      person = { id: uid(), name: p.name, color: nextColor(state.people) };
      state.people.push(person);
    }
    state.installments = state.installments
      .filter(i => i.personId !== person.id || i.date)
      .concat(p.installments.map(i => ({ id: uid(), personId: person.id, cardId: card.id, ...i })));
  }
  return true;
}

// ---------- Navigation ----------
window.addEventListener("hashchange", () => {
  const next = viewFromHash();
  if (next !== view) {
    view = next;
    if (view !== "akis") focusIdx = null;
    if (!pendingScroll) window.scrollTo(0, 0);
  }
  render();
});

document.addEventListener("click", e => {
  const shift = e.target.closest("[data-month-shift]");
  if (shift) {
    currentMonth = T.monthKey(T.monthIndex(currentMonth) + Number(shift.dataset.monthShift));
    focusIdx = null;
    render();
    return;
  }
  if (e.target.closest("[data-month-reset]")) {
    currentMonth = T.monthKey(todayIndex());
    focusIdx = null;
    render();
  }
});

els.chartBy.addEventListener("click", e => {
  const by = e.target.closest("button")?.dataset.by;
  if (!by || by === chartBy) return;
  chartBy = by;
  writePref(PREF.chartBy, by);
  render();
});

els.timelineKind.addEventListener("click", e => {
  const kind = e.target.closest("button")?.dataset.kind;
  if (!kind || kind === timelineKind) return;
  timelineKind = kind;
  render();
});

els.timelineMode.addEventListener("click", e => {
  const mode = e.target.closest("button")?.dataset.mode;
  if (!mode || mode === timelineMode) return;
  timelineMode = mode;
  writePref(PREF.timelineMode, mode);
  render();
});

els.flowMode.addEventListener("click", e => {
  const mode = e.target.closest("button")?.dataset.mode;
  if (!mode || mode === flowMode) return;
  flowMode = mode;
  writePref(PREF.flowMode, mode);
  render();
});

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { if (view === "ozet") renderChart(chartMonths); });
});

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------- Boot ----------
if (typeof window.syncInit === 'function') {
  window.syncInit({
    getState: userId => (stateOwner === userId ? state : null),
    onRemoteData(next) {
      state = hydrate(next);
      localStorage.setItem(getStorageKey(), JSON.stringify(state));
      render();
    },
    onSynced() { checkInbox(); backfillCategories(); },
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") window.syncRefresh?.();
});

render();
// Açılışta: kullanıcının daha önce verdiği kategoriler ve (açıksa) cihazdaki modelle kategorisizler
setTimeout(() => backfillCategories(), 4000);

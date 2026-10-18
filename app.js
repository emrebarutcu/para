// ---------- State + storage ----------
const T = window.Taksit;
const E = window.Eposta;
const STORAGE_KEY_BASE = "cashflow.v1";
function getStorageKey() {
  return window.CF_USER_ID ? `${STORAGE_KEY_BASE}.${window.CF_USER_ID}` : STORAGE_KEY_BASE;
}

const SERIES_COUNT = 8;          // styles.css'teki --s1…--s8
const MAX_MONTHS = 60;           // akışta gösterilecek en fazla ay
const CHART_MONTHS = 12;         // özetteki grafikte gösterilecek ay
const CASH_COLOR = "var(--cash)";
const VIEWS = ["ozet", "akis", "harcamalar", "kartlar"];
const COUNT_PRESETS = [1, 2, 3, 4, 6, 9, 12];
const WEEKDAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const PREF = { theme: "para.theme", chartBy: "para.chartBy", flowMode: "para.flowMode" };

const defaultState = () => ({
  people: [{ id: "ben", name: "Ben", color: 0 }],
  cards: [],              // { id, name, limit, cutoffDay, dueDay, color, last4? }
  installments: [],       // harcamalar — biçimi taksit.js'de
  _v: 0, // version timestamp — used for sync conflict resolution
});

function validDay(v) {
  const d = Math.round(Number(v));
  return d >= 1 && d <= 31 ? d : null;
}

// Son ödeme günü bilinen ama kesimi bilinmeyen kart: kesim, yasal 10 günlük aralıkla tahmin edilir
function defaultCard(dueDay, id, color) {
  const due = validDay(dueDay) || 22;
  return { id, name: "Kredi kartı", limit: 0, cutoffDay: ((due - 11 + 31) % 31) + 1, dueDay: due, color };
}

// Eski sürümlerden gelen veriyi bugünkü biçime taşır. Nakit akışı sürümünden kalan alanlar
// (entriesByDate, recurring…) olduğu gibi kalır; senkronizasyon tüm nesneyi yazdığı için silinmezler.
function hydrate(data) {
  const s = { ...defaultState(), ...data };
  if (!Array.isArray(s.people)) s.people = defaultState().people;
  if (!Array.isArray(s.cards)) s.cards = [];
  if (!Array.isArray(s.installments)) s.installments = [];

  // İlk taksit sürümü: tek kart (dueDay) ve "Ekstre" ayı → varsayılan kart + ilk ödeme ayı
  if (s.installments.some(i => i.statement)) {
    let card = s.cards[0];
    if (!card) { card = defaultCard(s.dueDay, "kart", 0); s.cards = [card]; }
    s.installments = s.installments.map(i => {
      if (!i.statement) return i;
      const { statement, planCount, ...rest } = i;
      return { ...rest, cardId: i.cardId || card.id, ...T.fromStatement({ statement, count: i.count, total: i.total, planCount }) };
    });
  }
  delete s.dueDay;
  return s;
}

function readPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {}
}

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
let lastCardId = null;        // formda son seçilen kart ("" = nakit)
let lastPersonId = null;
let chartMonths = [];
let inbox = [];               // e-postadan gelen, kendiliğinden eklenemeyen kayıtlar
let inboxBusy = false;
let inboxDraftId = null;      // formda açılan e-posta kaydı
let inboxOpenId = null;       // içeriği gösterilen e-posta

function loadState() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return defaultState();
    return hydrate(JSON.parse(raw));
  } catch { return defaultState(); }
}

function saveState() {
  state._v = Date.now();
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
  if (typeof window.syncSchedulePush === 'function') window.syncSchedulePush(state);
}

function resetView() {
  personFilter = "all";
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
};
window.onAuthLogout = function () {
  window.CF_USER_ID = null;
  state = defaultState();  // temiz slate — hesap verisi ekranda kalmasın
  resetView();
  render();
};

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

// Renk kişiye / karta bağlıdır, sırasına değil: yeni kayıt boştaki ilk rengi alır
function nextColor(list) {
  const used = new Set(list.map(x => x.color));
  for (let c = 0; c < SERIES_COUNT; c++) if (!used.has(c)) return c;
  return list.length % SERIES_COUNT;
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
  chartBy: $("chartBy"), legend: $("chartLegend"), chart: $("planChart"), chartEmpty: $("chartEmpty"),
  tooltip: $("chartTooltip"),
  flowMode: $("flowMode"), flowList: $("flowList"), flowTable: $("flowTable"), table: $("planTable"),
  personFilter: $("personFilter"), purchaseWrap: $("purchaseWrap"), managePeople: $("managePeople"),
  cardGrid: $("cardGrid"), addCard: $("addCard"),
  purchaseSheet: $("purchaseSheet"), purchaseForm: $("purchaseForm"), purchaseTitle: $("purchaseTitle"),
  purchaseDelete: $("purchaseDelete"), purchasePreview: $("purchasePreview"),
  countChips: $("countChips"), cardChips: $("cardChips"), personChips: $("personChips"),
  cardSheet: $("cardSheet"), cardForm: $("cardForm"), cardTitle: $("cardTitle"),
  cardDelete: $("cardDelete"), cardPreview: $("cardPreview"), cardHint: $("cardHint"),
  peopleSheet: $("peopleSheet"), peopleEdit: $("peopleEdit"), personAddForm: $("personAddForm"),
  settingsSheet: $("settingsSheet"), settingsBtn: $("settingsBtn"), themeSeg: $("themeSeg"),
  inboxBtn: $("inboxBtn"), inboxSheet: $("inboxSheet"), inboxLoginNote: $("inboxLoginNote"), inboxSetup: $("inboxSetup"),
  inboxAddress: $("inboxAddress"),
  inboxCheck: $("inboxCheck"), inboxRenew: $("inboxRenew"), inboxTry: $("inboxTry"), inboxTryResult: $("inboxTryResult"),
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

  renderUpcoming(last);
  renderPeopleSummary(months, start);

  chartMonths = months.slice(0, CHART_MONTHS);
  renderLegend(chartMonths);
  renderChart(chartMonths);
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
    const open = () => {
      const idx = T.parseDate(ev.date).idx;
      if (idx < T.monthIndex(currentMonth)) currentMonth = T.monthKey(idx);
      openEventKey = ev.key;
      pendingScroll = `ev-${ev.key}`;
      location.hash = "#akis";
    };
    li.addEventListener("click", open);
    li.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
    els.upcoming.append(li);
  }
}

function renderPeopleSummary(months, start) {
  const thisMonth = months.find(m => m.idx === start);
  els.peopleSummary.replaceChildren();
  for (const p of state.people) {
    const remaining = months.reduce((s, m) => s + (m.byPerson[p.id] || 0), 0);
    const li = el("li");
    const info = el("div");
    info.append(el("div", "name", p.name), el("div", "sub", remaining ? `kalan ${fmt(remaining)}` : "borç yok"));
    li.append(avatar(p), info, el("div", "amount", fmt(thisMonth?.byPerson[p.id] || 0)));
    els.peopleSummary.append(li);
  }
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

  // Süzgeç çipleri
  els.personFilter.replaceChildren();
  const filterChip = (id, label, count, color) => {
    const b = el("button", "chip" + (personFilter === id ? " active" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(personFilter === id));
    if (color) b.append(dot(color));
    b.append(document.createTextNode(label));
    if (count) b.append(el("span", "count", String(count)));
    b.addEventListener("click", () => { personFilter = id; render(); });
    return b;
  };
  els.personFilter.append(filterChip("all", "Tümü", all.filter(x => x.left).length));
  for (const p of state.people) {
    els.personFilter.append(filterChip(p.id, p.name, all.filter(x => x.left && x.p.personId === p.id).length, seriesVar(p)));
  }

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
// draft: kayıtlı olmayan, önceden doldurulmuş harcama (e-postadan gelen)
function openPurchaseSheet(p, draft) {
  if (!state.people.length) { openPeopleSheet(); toast("Önce bir kişi ekle"); return; }
  editingId = p?.id ?? null;
  inboxDraftId = draft?.inboxId ?? null;
  const src = p || draft;
  const f = els.purchaseForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  els.purchaseTitle.textContent = p ? "Harcamayı düzenle" : draft ? "E-postadan harcama" : "Yeni harcama";
  els.purchaseDelete.hidden = !p;

  const count = src?.count ?? 1;
  els.countChips.replaceChildren(...COUNT_PRESETS.map(n =>
    radioChip("countPreset", String(n), n === 1 ? "Peşin" : `${n} taksit`, n === count)));
  f.elements.count.value = count;

  const cardId = p ? (p.cardId && cardById(p.cardId) ? p.cardId : "")
    : draft?.cardId && cardById(draft.cardId) ? draft.cardId
    : (lastCardId != null && (lastCardId === "" || cardById(lastCardId)) ? lastCardId : state.cards[0]?.id ?? "");
  els.cardChips.replaceChildren(
    ...state.cards.map(c => radioChip("card", c.id, c.name, c.id === cardId, seriesVar(c))),
    radioChip("card", "", "Nakit / banka kartı", cardId === "", CASH_COLOR));

  const personId = p ? p.personId
    : personFilter !== "all" ? personFilter
    : personById(lastPersonId) ? lastPersonId : state.people[0].id;
  els.personChips.replaceChildren(...state.people.map(x =>
    radioChip("person", x.id, x.name, x.id === personId, seriesVar(x))));

  f.elements.desc.value = src?.desc ?? "";
  f.elements.amount.value = src?.total ? Math.round(src.total * 100) / 100 : "";
  f.elements.date.value = p ? p.date || "" : draft?.date || T.todayKey();
  syncChecked(f);
  updatePurchasePreview();
  openSheet(els.purchaseSheet);
  if (!p) f.elements.desc.focus();
}

function collectPurchase() {
  const f = els.purchaseForm.elements;
  const editing = editingId ? state.installments.find(x => x.id === editingId) : null;
  const desc = f.desc.value.trim();
  const amount = Number(f.amount.value);
  const count = Math.round(Number(f.count.value || 1));
  const date = T.parseDate(f.date.value) ? f.date.value : "";
  const errors = [];
  if (!desc) errors.push("desc");
  if (!(amount > 0)) errors.push("amount");
  if (!(count >= 1 && count <= 60)) errors.push("count");
  if (!date && !editing?.firstDue) errors.push("date");
  if (!personById(f.person.value)) errors.push("person");

  const total = f.mode.value === "per" ? Math.round(amount * count * 100) / 100 : amount;
  const p = { desc, cardId: f.card.value || null, count, total };
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
  if (errors.some(e => e === "amount" || e === "count" || e === "date")) return;

  const card = cardById(p.cardId);
  const pays = T.payments(p, card);
  const first = pays[0].key, last = pays[pays.length - 1].key;
  if (p.count > 1) {
    box.append(el("div", "big", `${p.count} × ${fmt(T.perInstallment(p))}`),
      el("div", "", `Toplam ${fmt(p.total)} · ilk ödeme ${fmtDay(first)}, son ${fmtDay(last)}`));
  } else {
    box.append(el("div", "big", fmt(p.total)), el("div", "", `Ödeme ${fmtDay(first)}`));
  }
  if (card && p.date) {
    const cut = T.dateKey(T.statementIndex(card, p.date), card.cutoffDay);
    box.append(el("div", "", `${card.name} · ${fmtDay(cut)} kesimli ekstreye girer`));
  } else if (!card) {
    box.append(el("div", "", p.count > 1 ? "Nakit — her ay harcama gününde ödenir" : "Nakit — harcama gününde ödenir"));
  } else {
    box.append(el("div", "", "Excel'den aktarılan kayıt — tarih girmezsen ödeme ayı korunur"));
  }
}

els.purchaseForm.addEventListener("input", e => {
  e.target.classList?.remove("invalid");
  const f = els.purchaseForm.elements;
  if (e.target.name === "countPreset") f.count.value = e.target.value;
  if (e.target.name === "count") {
    for (const r of els.countChips.querySelectorAll("input")) r.checked = r.value === String(Math.round(Number(f.count.value)));
  }
  syncChecked(els.purchaseForm);
  updatePurchasePreview();
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
  if (editingId) {
    state.installments = state.installments.map(x => (x.id === editingId ? { id: x.id, personId, ...p } : x));
  } else {
    state.installments.push({ id: uid(), personId, ...p });
  }
  if (inboxDraftId != null) {
    const id = inboxDraftId;
    inbox = inbox.filter(x => x.row.id !== id);
    window.syncInboxClaim?.([id]);
  }
  inboxDraftId = null;
  lastCardId = p.cardId || "";
  lastPersonId = personId;
  saveState();
  els.purchaseSheet.close();
  toast(editingId ? "Harcama güncellendi" : "Harcama eklendi");
  editingId = null;
  render();
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
  b.addEventListener("click", () => openPurchaseSheet());
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

  if (v.cutoffDay && v.dueDay) {
    const today = T.todayKey();
    const s = T.statementIndex(card, today);
    const due = T.dueIndex(card, s);
    els.cardHint.textContent = `Bugün yapılan bir harcama ${fmtDay(T.dateKey(s, v.cutoffDay))} kesimli ekstreye girer ve ${fmtDay(T.dateKey(due, v.dueDay))} tarihinde ödenir.`;
  } else {
    els.cardHint.textContent = "Kesim ve son ödeme gününü kart ekstrende bulabilirsin.";
  }
}

els.cardForm.addEventListener("input", e => { e.target.classList?.remove("invalid"); updateCardPreview(); });

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
  if (!v.last4) delete v.last4;

  if (editingCardId) {
    state.cards = state.cards.map(c => {
      if (c.id !== editingCardId) return c;
      const { last4, ...rest } = { ...c, ...v };
      return v.last4 ? { ...rest, last4 } : rest;
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

// ---------- Kişiler ----------
function openPeopleSheet() {
  renderPeopleSheet();
  openSheet(els.peopleSheet);
}

function renderPeopleSheet() {
  els.peopleEdit.replaceChildren();
  for (const p of state.people) {
    const n = state.installments.filter(i => i.personId === p.id).length;
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
      if (!confirm(n ? `“${p.name}” ve ${n} harcaması silinsin mi?` : `“${p.name}” silinsin mi?`)) return;
      state.people = state.people.filter(x => x.id !== p.id);
      state.installments = state.installments.filter(i => i.personId !== p.id);
      saveState(); renderPeopleSheet(); render();
    });
    li.append(avatar(p), input, del, el("span", "sub", n ? `${n} harcama` : "harcama yok"));
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
      if (typeof window.syncPushNow === "function") await window.syncPushNow(state);
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
els.inboxSheet.addEventListener("click", async e => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try {
    await navigator.clipboard.writeText($(b.dataset.copy).textContent);
    toast("Kopyalandı");
  } catch { toast("Kopyalanamadı"); }
});

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
  if (typeof window.syncPushNow === 'function') await window.syncPushNow(state);
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
    onRemoteData(remote) {
      if (!remote || typeof remote._v !== 'number') return;
      const local = JSON.parse(localStorage.getItem(getStorageKey()) || '{}');
      if (remote._v > (local._v || 0)) {
        state = hydrate(remote);
        localStorage.setItem(getStorageKey(), JSON.stringify(state));
        render();
      }
    },
    onSynced() { checkInbox(); },
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") window.syncRefresh?.();
});

render();

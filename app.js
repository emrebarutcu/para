// ---------- Theme ----------
(function () {
  const THEME_KEY = "para.theme";
  const html = document.documentElement;

  function applyTheme(theme) {
    html.classList.remove("light-theme", "dark-theme");
    if (theme === "light") html.classList.add("light-theme");
    if (theme === "dark")  html.classList.add("dark-theme");
    const btn = document.getElementById("themeBtn");
    if (btn) btn.textContent = theme === "light" ? "☽" : "☀";
  }

  // Apply saved preference immediately (before first paint)
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || "");

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("themeBtn");
    if (!btn) return;

    // Resolve effective theme (may be from system pref)
    function effectiveTheme() {
      if (html.classList.contains("light-theme")) return "light";
      if (html.classList.contains("dark-theme"))  return "dark";
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }

    // Set initial icon
    btn.textContent = effectiveTheme() === "light" ? "☽" : "☀";

    btn.addEventListener("click", () => {
      const next = effectiveTheme() === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
  });
})();

// ---------- State + storage ----------
const T = window.Taksit;
const STORAGE_KEY_BASE = "cashflow.v1";
function getStorageKey() {
  return window.CF_USER_ID ? `${STORAGE_KEY_BASE}.${window.CF_USER_ID}` : STORAGE_KEY_BASE;
}

const SERIES_COUNT = 8;          // styles.css'teki --s1…--s8
const MAX_MONTHS = 60;           // tablo/grafikte gösterilecek en fazla ay
const CASH_COLOR = "var(--mute)";
const CHART_BY_KEY = "para.chartBy";

const defaultState = () => ({
  people: [{ id: "ben", name: "Ben", color: 0 }],
  cards: [],              // { id, name, limit, cutoffDay, dueDay, color }
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

let state = loadState();
let currentMonth = T.monthKey(todayIndex());  // planın başladığı ay
let selectedIdx = null;      // grafikte vurgulanan ay
let openEventKey = null;     // tabloda açılan ödeme
let selectedPersonId = null;
let editingId = null;        // düzenlenen harcama
let editingCardId = null;    // düzenlenen kart
let formCardId = null;       // harcama formunda seçili kart ("" = nakit)
let chartBy = readPref(CHART_BY_KEY) === "card" ? "card" : "person";
let lastMonths = [];

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

function readPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function resetView() {
  selectedIdx = null;
  openEventKey = null;
  selectedPersonId = null;
  formCardId = null;
  resetForm();
  resetCardForm();
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

function fmt(n) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency", currency: "TRY", maximumFractionDigits: 2,
  }).format(n || 0);
}

function fmtNum(n) {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n || 0);
}

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

function uid() { return Math.random().toString(36).slice(2, 10); }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function personById(id) { return state.people.find(p => p.id === id); }
function cardById(id) { return state.cards.find(c => c.id === id); }
function cardName(id) { return cardById(id)?.name ?? "Nakit"; }
function seriesVar(entity) { return `var(--s${(entity.color % SERIES_COUNT) + 1})`; }
function cardColor(id) { const c = cardById(id); return c ? seriesVar(c) : CASH_COLOR; }
function paymentsOf(p) { return T.payments(p, cardById(p.cardId)); }

function swatch(color) {
  const i = el("i", "swatch");
  i.style.background = color;
  return i;
}

// Renk kişiye / karta bağlıdır, sırasına değil: yeni kayıt boştaki ilk rengi alır
function nextColor(list) {
  const used = new Set(list.map(x => x.color));
  for (let c = 0; c < SERIES_COUNT; c++) if (!used.has(c)) return c;
  return list.length % SERIES_COUNT;
}

// ---------- Render ----------
const els = {
  monthPicker:   document.getElementById("monthPicker"),
  prev:          document.getElementById("prevMonth"),
  next:          document.getElementById("nextMonth"),
  dueLabel:      document.getElementById("dueLabel"),
  dueTotal:      document.getElementById("dueTotal"),
  nextLabel:     document.getElementById("nextLabel"),
  nextTotal:     document.getElementById("nextTotal"),
  remaining:     document.getElementById("remainingTotal"),
  endLabel:      document.getElementById("endLabel"),
  chartBy:       document.getElementById("chartBy"),
  legend:        document.getElementById("chartLegend"),
  chart:         document.getElementById("planChart"),
  chartEmpty:    document.getElementById("chartEmpty"),
  tooltip:       document.getElementById("chartTooltip"),
  table:         document.getElementById("planTable"),
  cardList:      document.getElementById("cardList"),
  cardForm:      document.getElementById("cardForm"),
  cardSubmit:    document.getElementById("cardSubmit"),
  cardCancel:    document.getElementById("cardCancel"),
  personTabs:    document.getElementById("personTabs"),
  personBar:     document.getElementById("personBar"),
  personStats:   document.getElementById("personStats"),
  addPerson:     document.getElementById("addPerson"),
  renamePerson:  document.getElementById("renamePerson"),
  deletePerson:  document.getElementById("deletePerson"),
  instList:      document.getElementById("instList"),
  instForm:      document.getElementById("instForm"),
  instSubmit:    document.getElementById("instSubmit"),
  instCancel:    document.getElementById("instCancel"),
  instPreview:   document.getElementById("instPreview"),
  exportBtn:     document.getElementById("exportBtn"),
  importInput:   document.getElementById("importInput"),
};

function render() {
  els.monthPicker.value = currentMonth;

  const start = T.monthIndex(currentMonth);
  const end = Math.min(lastPaymentIndex(), start + MAX_MONTHS - 1);
  const months = end >= start ? T.buildCashflow(state.people, state.cards, state.installments, start, end) : [];
  lastMonths = months;
  if (selectedIdx != null && !months.some(m => m.idx === selectedIdx)) selectedIdx = null;

  renderSummary(months, start);
  renderLegend(months);
  renderChart(months);
  renderTable(months);
  renderCards();
  renderPurchases(start);
}

function lastPaymentIndex() {
  const known = new Set(state.people.map(p => p.id));
  let last = -Infinity;
  for (const p of state.installments) {
    if (!known.has(p.personId)) continue;
    const list = paymentsOf(p);
    if (list.length) last = Math.max(last, list[list.length - 1].idx);
  }
  return last;
}

function renderSummary(months, start) {
  const totalAt = idx => months.find(m => m.idx === idx)?.total || 0;
  els.dueLabel.textContent  = `${T.monthName(start)} ödemeleri`;
  els.dueTotal.textContent  = fmt(totalAt(start));
  els.nextLabel.textContent = `${T.monthName(start + 1)} ödemeleri`;
  els.nextTotal.textContent = fmt(totalAt(start + 1));
  els.remaining.textContent = fmt(months.reduce((s, m) => s + m.total, 0));
  els.endLabel.textContent  = months.length ? monthLong(months[months.length - 1].idx) : "—";
}

// Grafiğin serileri: kişiler ya da kartlar (+ nakit)
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
    item.append(swatch(s.color), document.createTextNode(s.name));
    els.legend.append(item);
  }
}

// ---------- Cash-flow table (tarih + kart bazında; Excel'deki özet sayfası) ----------
function renderTable(months) {
  const table = els.table;
  table.replaceChildren();
  const people = state.people;
  const cols = people.length + 2;

  const head = table.createTHead().insertRow();
  head.append(el("th", "", "Ödeme"));
  for (const p of people) {
    const th = el("th", "num");
    th.append(swatch(seriesVar(p)), document.createTextNode(p.name));
    head.append(th);
  }
  head.append(el("th", "num", "Toplam"));

  const body = table.createTBody();
  if (!months.length) {
    const td = el("td", "empty", state.installments.length
      ? `${monthLong(T.monthIndex(currentMonth))} ve sonrasında ödeme yok.`
      : "Henüz harcama yok.");
    td.colSpan = cols;
    body.insertRow().append(td);
    return;
  }

  const today = T.todayKey();
  const amountCells = (tr, byPerson, total) => {
    for (const p of people) tr.append(el("td", "num", byPerson[p.id] ? fmtNum(byPerson[p.id]) : "—"));
    tr.append(el("td", "num total", total ? fmtNum(total) : "—"));
  };

  for (const m of months) {
    const focus = m.idx === selectedIdx ? " focus" : "";
    if (!m.events.length) {
      const tr = body.insertRow();
      tr.className = "zero" + focus;
      tr.append(el("td", "", monthLong(m.idx)));
      amountCells(tr, {}, 0);
      continue;
    }

    for (const ev of m.events) {
      const open = ev.key === openEventKey;
      const tr = body.insertRow();
      tr.className = "event-row" + focus + (open ? " open" : "") + (ev.date < today ? " past" : "");
      tr.tabIndex = 0;
      tr.setAttribute("aria-expanded", String(open));

      const when = el("div", "when");
      const date = el("span", "when-date");
      date.append(el("span", "d-long", fmtDay(ev.date)), el("span", "d-short", fmtDayShort(ev.date)));
      const card = el("span", "when-card");
      card.append(swatch(cardColor(ev.cardId)), document.createTextNode(cardName(ev.cardId)));
      when.append(date, card);
      tr.insertCell().append(when);
      amountCells(tr, ev.byPerson, ev.total);

      const toggle = () => { openEventKey = open ? null : ev.key; render(); };
      tr.addEventListener("click", toggle);
      tr.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });

      if (open) {
        const detail = body.insertRow();
        detail.className = "detail-row";
        const td = el("td");
        td.colSpan = cols;
        td.append(eventDetail(ev));
        detail.append(td);
      }
    }

    // Ayda birden fazla ödeme varsa ay toplamı (Excel'deki satır)
    if (m.events.length > 1) {
      const tr = body.insertRow();
      tr.className = "subtotal" + focus;
      tr.append(el("td", "", `${monthLong(m.idx)} toplamı`));
      amountCells(tr, m.byPerson, m.total);
    }
  }

  const sums = Object.fromEntries(people.map(p => [p.id, 0]));
  for (const m of months) for (const p of people) sums[p.id] += m.byPerson[p.id] || 0;
  const foot = table.createTFoot().insertRow();
  foot.append(el("td", "", "Toplam"));
  amountCells(foot, sums, months.reduce((s, m) => s + m.total, 0));
}

// Bir ödemede (tarih + kart) ödenen taksitler
function eventDetail(ev) {
  const ul = el("ul", "month-items");
  const order = new Map(state.people.map((p, i) => [p.id, i]));
  const items = [...ev.items].sort((a, b) =>
    order.get(a.purchase.personId) - order.get(b.purchase.personId)
    || a.purchase.desc.localeCompare(b.purchase.desc, "tr"));
  for (const { purchase, no, amount } of items) {
    const p = personById(purchase.personId);
    const li = el("li");
    const who = el("span", "who");
    who.append(swatch(seriesVar(p)), document.createTextNode(p.name));
    const plan = T.planLength(purchase);
    li.append(who, el("span", "desc", purchase.desc),
      el("span", "no", plan > 1 ? `${no}/${plan}` : "peşin"), el("span", "amount", fmt(amount)));
    ul.append(li);
  }
  return ul;
}

// ---------- Cards ----------
function renderCards() {
  els.cardList.replaceChildren();
  if (!state.cards.length) {
    els.cardList.append(el("li", "dp-empty",
      "Henüz kart yok. Kart eklersen kartlı harcamaların ödeme tarihi kesim ve son ödeme gününe göre hesaplanır."));
    return;
  }

  const today = T.todayKey();
  const known = new Set(state.people.map(p => p.id));
  for (const c of state.cards) {
    const pays = state.installments
      .filter(p => p.cardId === c.id && known.has(p.personId))
      .flatMap(p => T.payments(p, c));
    const used = T.outstanding(pays, today);
    const upcoming = pays.filter(x => x.key >= today);
    const nextKey = upcoming.reduce((min, x) => (!min || x.key < min ? x.key : min), null);
    const nextTotal = upcoming.filter(x => x.key === nextKey).reduce((s, x) => s + x.amount, 0);

    const li = el("li", "card-item" + (c.id === editingCardId ? " editing" : ""));
    li.tabIndex = 0;
    li.title = "Düzenlemek için tıkla";

    const main = el("div", "ci-main");
    const name = el("strong");
    name.append(swatch(seriesVar(c)), document.createTextNode(c.name));
    main.append(name, el("span", "meta", `Kesim ${c.cutoffDay} · son ödeme ${c.dueDay}`));
    main.append(el("span", "meta", nextKey
      ? `Sonraki ödeme ${fmtDay(nextKey)}: ${fmt(nextTotal)}`
      : "Bekleyen ödeme yok"));

    const side = el("div", "ci-limit");
    if (c.limit > 0) {
      const ratio = used / c.limit;
      const meter = el("div", "meter" + (ratio > 1 ? " over" : ratio >= 0.9 ? " warn" : ""));
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-label", `${c.name} limit kullanımı`);
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", String(c.limit));
      meter.setAttribute("aria-valuenow", String(Math.round(used)));
      const fill = el("span", "meter-fill");
      fill.style.width = `${Math.min(100, ratio * 100)}%`;
      meter.append(fill);
      side.append(meter,
        el("span", "meta", `${fmt(used)} / ${fmt(c.limit)}`),
        el("span", "meta", ratio > 1 ? `limit ${fmt(used - c.limit)} aşıldı` : `kullanılabilir ${fmt(c.limit - used)}`));
    } else {
      side.append(el("span", "meta", `Bekleyen borç ${fmt(used)}`));
    }

    const del = el("button", "del", "✕");
    del.type = "button";
    del.setAttribute("aria-label", `${c.name} kartını sil`);
    del.addEventListener("click", e => {
      e.stopPropagation();
      const n = state.installments.filter(p => p.cardId === c.id).length;
      if (!confirm(n ? `“${c.name}” kartı ve bu karttaki ${n} harcama silinsin mi?` : `“${c.name}” kartı silinsin mi?`)) return;
      state.cards = state.cards.filter(x => x.id !== c.id);
      state.installments = state.installments.filter(p => p.cardId !== c.id);
      if (editingCardId === c.id) resetCardForm();
      if (formCardId === c.id) formCardId = null;
      saveState(); render();
    });

    li.append(main, side, del);
    li.addEventListener("click", () => startCardEdit(c));
    li.addEventListener("keydown", e => { if (e.key === "Enter") startCardEdit(c); });
    els.cardList.append(li);
  }
}

function resetCardForm() {
  editingCardId = null;
  els.cardForm.reset();
  els.cardSubmit.textContent = "Kart ekle";
  els.cardCancel.hidden = true;
}

function startCardEdit(c) {
  editingCardId = c.id;
  const f = els.cardForm.elements;
  f.name.value = c.name;
  f.limit.value = c.limit || "";
  f.cutoffDay.value = c.cutoffDay;
  f.dueDay.value = c.dueDay;
  els.cardSubmit.textContent = "Kaydet";
  els.cardCancel.hidden = false;
  render();
  els.cardForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  f.name.focus({ preventScroll: true });
}

els.cardForm.addEventListener("submit", e => {
  e.preventDefault();
  const f = els.cardForm.elements;
  const name = f.name.value.trim();
  const limit = Number(f.limit.value) || 0;
  const cutoffDay = validDay(f.cutoffDay.value);
  const dueDay = validDay(f.dueDay.value);
  if (!name || !cutoffDay || !dueDay || limit < 0) return;
  if (editingCardId) {
    state.cards = state.cards.map(c => (c.id === editingCardId ? { ...c, name, limit, cutoffDay, dueDay } : c));
  } else {
    const card = { id: uid(), name, limit, cutoffDay, dueDay, color: nextColor(state.cards) };
    state.cards.push(card);
    if (state.cards.length === 1) formCardId = card.id;   // ilk kart: formda nakit yerine seçili gelsin
  }
  resetCardForm();
  saveState(); render();
});

els.cardCancel.addEventListener("click", () => { resetCardForm(); render(); });

// ---------- Purchases (Excel'deki kişi sayfaları) ----------
function renderPurchases(start) {
  if (!personById(selectedPersonId)) selectedPersonId = state.people[0]?.id ?? null;
  const person = personById(selectedPersonId);
  renderCardOptions();

  els.personTabs.replaceChildren(...state.people.map(p => {
    const b = el("button", "ptab" + (p.id === selectedPersonId ? " active" : ""));
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(p.id === selectedPersonId));
    b.append(swatch(seriesVar(p)), document.createTextNode(p.name));
    b.addEventListener("click", () => {
      if (p.id === selectedPersonId) return;
      selectedPersonId = p.id;
      resetForm();
      render();
    });
    return b;
  }));

  els.personBar.hidden = !person;
  els.instForm.hidden = !person;
  els.instPreview.hidden = !person;
  els.instList.replaceChildren();
  if (!person) {
    els.instList.append(el("li", "dp-empty", "Harcama eklemek için önce bir kişi ekle."));
    return;
  }

  const mine = state.installments
    .filter(p => p.personId === person.id)
    .map(p => ({ p, pays: paymentsOf(p) }));
  let monthly = 0, remaining = 0;
  for (const { p, pays } of mine) {
    monthly += pays.filter(x => x.idx === start).reduce((s, x) => s + x.amount, 0);
    remaining += T.remainingFrom(pays, start) * T.perInstallment(p);
  }
  els.personStats.textContent = `${T.monthName(start)}: ${fmt(monthly)} · kalan ${fmt(remaining)}`;

  if (!mine.length) {
    els.instList.append(el("li", "dp-empty", `${person.name} için harcama yok`));
    return;
  }

  const sorted = mine
    .map(x => ({ ...x, left: T.remainingFrom(x.pays, start) }))
    .sort((a, b) => (b.left > 0) - (a.left > 0)
      || a.pays[0].key.localeCompare(b.pays[0].key)
      || a.p.desc.localeCompare(b.p.desc, "tr"));

  for (const { p, pays, left } of sorted) {
    const per = T.perInstallment(p);
    const plan = T.planLength(p);
    const li = el("li", "inst" + (left ? "" : " done") + (p.id === editingId ? " editing" : ""));
    li.tabIndex = 0;
    li.title = "Düzenlemek için tıkla";

    const main = el("div", "inst-main");
    main.append(el("strong", "", p.desc));
    const card = el("span", "meta inst-card");
    card.append(swatch(cardColor(p.cardId)), document.createTextNode(cardName(p.cardId)));
    let meta = p.date ? ` · ${fmtDay(p.date)}` : "";
    meta += p.count > 1 ? ` · ${p.count} × ${fmt(per)}` : " · peşin";
    if (plan > p.count) meta += ` · ${plan} taksitlik plan, orijinal ${fmt(T.originalTotal(p))}`;
    card.append(document.createTextNode(meta));
    main.append(card);
    const first = pays[0].key, last = pays[pays.length - 1].key;
    main.append(el("span", "meta", first === last ? `ödeme ${fmtDay(first)}` : `${fmtDay(first)} → ${fmtDay(last)}`));

    const side = el("div", "inst-side");
    side.append(el("span", "amount", fmt(per)));
    side.append(el("span", "meta", left ? `kalan ${left}/${plan} · ${fmt(left * per)}` : "bitti"));

    const del = el("button", "del", "✕");
    del.type = "button";
    del.setAttribute("aria-label", `${p.desc} sil`);
    del.addEventListener("click", e => {
      e.stopPropagation();
      if (!confirm(`“${p.desc}” silinsin mi?`)) return;
      state.installments = state.installments.filter(x => x.id !== p.id);
      if (editingId === p.id) resetForm();
      saveState(); render();
    });

    li.append(main, side, del);
    li.addEventListener("click", () => startEdit(p));
    li.addEventListener("keydown", e => { if (e.key === "Enter") startEdit(p); });
    els.instList.append(li);
  }
}

// Kart seçenekleri; formCardId geçersizse ilk kart (yoksa nakit)
function renderCardOptions() {
  const sel = els.instForm.elements.card;
  sel.replaceChildren(
    ...state.cards.map(c => new Option(c.name, c.id)),
    new Option("Nakit / banka kartı", ""),
  );
  if (formCardId == null || (formCardId && !cardById(formCardId))) formCardId = state.cards[0]?.id ?? "";
  sel.value = formCardId;
}

// ---------- Purchase form ----------
function readForm() {
  const f = els.instForm.elements;
  const desc = f.desc.value.trim();
  const count = Math.round(Number(f.count.value || 1));
  const amount = Number(f.amount.value);
  const date = T.parseDate(f.date.value) ? f.date.value : "";
  const editing = editingId ? state.installments.find(x => x.id === editingId) : null;
  if (!desc || !(count >= 1) || !(amount > 0)) return null;
  if (!date && !editing?.firstDue) return null;

  const total = f.mode.value === "per" ? Math.round(amount * count * 100) / 100 : amount;
  const p = { desc, cardId: f.card.value || null, count, total };
  if (date) {
    p.date = date;
  } else {
    // Excel'den gelen tarihsiz kayıt: ödeme ayı ve plan korunur
    p.firstDue = editing.firstDue;
    if (editing.planCount) p.planCount = editing.planCount;
  }
  return p;
}

function updatePreview() {
  const p = readForm();
  if (!p) { els.instPreview.textContent = ""; return; }
  const card = cardById(p.cardId);
  const pays = T.payments(p, card);
  let text = `${card ? card.name : "Nakit"} · `;
  text += p.count > 1 ? `${p.count} × ${fmt(T.perInstallment(p))} = ${fmt(p.total)}` : fmt(p.total);
  if (card && p.date) {
    text += ` · ${fmtDay(T.dateKey(T.statementIndex(card, p.date), card.cutoffDay))} kesimli ekstreye girer`;
  }
  text += p.count > 1
    ? ` · ilk ödeme ${fmtDay(pays[0].key)}, son ${fmtDay(pays[pays.length - 1].key)}`
    : ` · ödeme ${fmtDay(pays[0].key)}`;
  els.instPreview.textContent = text;
}

function resetForm() {
  editingId = null;
  els.instForm.reset();
  els.instForm.elements.date.value = T.todayKey();
  els.instSubmit.textContent = "Ekle";
  els.instCancel.hidden = true;
  els.instPreview.textContent = "";
  renderCardOptions();
}

function startEdit(p) {
  editingId = p.id;
  formCardId = p.cardId || "";
  const f = els.instForm.elements;
  f.desc.value = p.desc;
  f.date.value = p.date || "";
  f.count.value = p.count;
  f.amount.value = Math.round(p.total * 100) / 100;
  f.mode.value = "total";
  els.instSubmit.textContent = "Kaydet";
  els.instCancel.hidden = false;
  render();
  updatePreview();
  els.instForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  f.desc.focus({ preventScroll: true });
}

els.instForm.addEventListener("input", updatePreview);
els.instForm.elements.card.addEventListener("change", e => { formCardId = e.target.value; updatePreview(); });

els.instForm.addEventListener("submit", e => {
  e.preventDefault();
  const p = readForm();
  if (!selectedPersonId) return;
  if (!p) { els.instPreview.textContent = "Harcama tarihini gir."; return; }
  if (editingId) {
    state.installments = state.installments.map(x =>
      x.id === editingId ? { id: x.id, personId: x.personId, ...p } : x);
  } else {
    state.installments.push({ id: uid(), personId: selectedPersonId, ...p });
  }
  resetForm();
  saveState(); render();
});

els.instCancel.addEventListener("click", () => { resetForm(); render(); });

// ---------- People ----------
els.addPerson.addEventListener("click", () => {
  const name = (prompt("Kişi adı") || "").trim();
  if (!name) return;
  const existing = state.people.find(p => T.normalize(p.name) === T.normalize(name));
  if (existing) {
    selectedPersonId = existing.id;
  } else {
    const person = { id: uid(), name, color: nextColor(state.people) };
    state.people.push(person);
    selectedPersonId = person.id;
    saveState();
  }
  resetForm();
  render();
});

els.renamePerson.addEventListener("click", () => {
  const person = personById(selectedPersonId);
  if (!person) return;
  const name = (prompt("Yeni ad", person.name) || "").trim();
  if (!name || name === person.name) return;
  person.name = name;
  saveState(); render();
});

els.deletePerson.addEventListener("click", () => {
  const person = personById(selectedPersonId);
  if (!person) return;
  const n = state.installments.filter(i => i.personId === person.id).length;
  if (!confirm(n ? `“${person.name}” ve ${n} harcaması silinsin mi?` : `“${person.name}” silinsin mi?`)) return;
  state.people = state.people.filter(p => p.id !== person.id);
  state.installments = state.installments.filter(i => i.personId !== person.id);
  resetView();
  saveState(); render();
});

// ---------- Events ----------
els.prev.addEventListener("click", () => shiftMonth(-1));
els.next.addEventListener("click", () => shiftMonth(1));
els.monthPicker.addEventListener("change", () => {
  if (els.monthPicker.value) { currentMonth = els.monthPicker.value; selectedIdx = null; render(); }
});

function shiftMonth(delta) {
  currentMonth = T.monthKey(T.monthIndex(currentMonth) + delta);
  selectedIdx = null;
  render();
}

els.chartBy.addEventListener("click", e => {
  const by = e.target.closest("button")?.dataset.by;
  if (!by || by === chartBy) return;
  chartBy = by;
  try { localStorage.setItem(CHART_BY_KEY, by); } catch {}
  render();
});

els.exportBtn.addEventListener("click", () => {
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" })),
    download: `para-${new Date().toISOString().slice(0, 10)}.json`,
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

// ---------- Chart ----------
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
      : "Henüz harcama yok — aşağıdan ekle ya da Taksitler Excel dosyanı içe aktar.";
    svg.innerHTML = "";
    return;
  }

  const series = chartSeries(months);
  const W = Math.round(svg.getBoundingClientRect().width) || 880, H = 180;
  const PL = 44, PR = 8, PT = 22, PB = 24, GAP = 2, R = 4;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = months.length;
  const band = plotW / n;
  const barW = Math.min(24, band * 0.6);
  const { step, top } = niceScale(Math.max(...months.map(m => m.total)), 4);
  const toY = v => PT + plotH * (1 - v / top);
  const focusIdx = selectedIdx ?? months[0].idx;

  // Y grid
  let gridSvg = "", yLblSvg = "";
  for (let v = 0; v <= top + step * 0.01; v += step) {
    const y = toY(v).toFixed(1);
    gridSvg += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`;
    yLblSvg += `<text x="${PL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--mute)">${fmtShort(v)}</text>`;
  }

  // Columns: seriler sabit sırada alttan üste, aralarında 2px boşluk
  const every = Math.ceil(44 / band);
  let barsSvg = "", xLblSvg = "", capSvg = "", selSvg = "";
  months.forEach((m, i) => {
    const cx = PL + band * (i + 0.5);
    const x = cx - barW / 2;
    if (m.idx === selectedIdx) {
      selSvg = `<rect x="${(PL + band * i).toFixed(1)}" y="${PT}" width="${band.toFixed(1)}" height="${plotH}" fill="var(--accent)" opacity="0.08" rx="4"/>`;
    }

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

    // Değer etiketi yalnızca odaktaki ayda
    if (m.idx === focusIdx && m.total > 0) {
      const label = band >= 72 ? fmtNum(m.total) : fmtShort(m.total);
      capSvg = `<text x="${cx.toFixed(1)}" y="${(toY(m.total) - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text)">${label}</text>`;
    }

    if (i % every === 0) {
      const withYear = i === 0 || m.idx % 12 === 0;
      const label = T.monthShort(m.idx) + (withYear ? ` ’${String(T.yearOf(m.idx)).slice(2)}` : "");
      xLblSvg += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="${m.idx === selectedIdx ? "var(--text)" : "var(--mute)"}">${label}</text>`;
    }
  });

  // Hit areas — sütunun tamamı (etiketler dahil)
  const hitsSvg = months.map((m, i) =>
    `<rect class="cf-hit" data-i="${i}" tabindex="0" role="button" aria-label="${monthLong(m.idx)}: ${fmt(m.total)}" x="${(PL + band * i).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${H}" fill="transparent"/>`
  ).join("");

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `${gridSvg}${selSvg}${barsSvg}${capSvg}${yLblSvg}${xLblSvg}${hitsSvg}`;

  svg.querySelectorAll(".cf-hit").forEach(hit => {
    const i = Number(hit.dataset.i);
    const m = months[i];
    const col = svg.querySelector(`.col[data-i="${i}"]`);
    const select = () => { selectedIdx = selectedIdx === m.idx ? null : m.idx; render(); };
    hit.addEventListener("click", select);
    hit.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
    });
    hit.addEventListener("pointermove", e => { col.classList.add("hover"); showTooltip(m, series, e.clientX, e.clientY); });
    hit.addEventListener("pointerleave", () => { col.classList.remove("hover"); hideTooltip(); });
    hit.addEventListener("focus", () => {
      const b = hit.getBoundingClientRect();
      col.classList.add("hover");
      showTooltip(m, series, b.left + b.width / 2, b.top + 40);
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
  tt.removeAttribute("hidden");
  const w = tt.offsetWidth, h = tt.offsetHeight;
  const left = x + 14 + w > window.innerWidth - 8 ? x - 14 - w : x + 14;
  tt.style.left = Math.max(8, left) + "px";
  tt.style.top = Math.max(8, y - h - 12) + "px";
}

function hideTooltip() { els.tooltip.setAttribute("hidden", ""); }

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => renderChart(lastMonths));
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
  });
}

resetForm();
resetCardForm();
render();

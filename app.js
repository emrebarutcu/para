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

const SERIES_COUNT = 8;   // styles.css'teki --s1…--s8
const MAX_MONTHS = 60;    // tablo/grafikte gösterilecek en fazla ay

const defaultState = () => ({
  people: [{ id: "ben", name: "Ben", color: 0 }],
  installments: [],       // { id, personId, desc, statement: "YYYY-MM", count, total, planCount? }
  dueDay: 22,             // kartın son ödeme günü
  _v: 0, // version timestamp — used for sync conflict resolution
});

// Eski nakit akışı sürümünden kalan alanlar (entriesByDate, recurring…) olduğu gibi
// taşınır; senkronizasyon tüm nesneyi yazdığı için böylece silinmezler.
function hydrate(data) {
  const s = { ...defaultState(), ...data };
  if (!Array.isArray(s.people)) s.people = defaultState().people;
  if (!Array.isArray(s.installments)) s.installments = [];
  const day = Math.round(Number(s.dueDay));
  s.dueDay = day >= 1 && day <= 31 ? day : 22;
  return s;
}

let state = loadState();
let currentMonth = defaultMonth();  // planın başladığı ay
let selectedIdx = null;             // tabloda açılan / grafikte vurgulanan ay
let selectedPersonId = null;
let editingId = null;
let lastRows = [];

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
  selectedIdx = null;
  selectedPersonId = null;
  resetForm();
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

// Bu ayın son ödeme günü geçtiyse plan bir sonraki aydan başlar
function defaultMonth() {
  const late = new Date().getDate() > state.dueDay;
  return T.monthKey(todayIndex() + (late ? 1 : 0));
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

// "22 Ekim 2026" / "22 Eki 2026" / "Ekim 2026"
function dueLong(idx)  { return `${T.dueDate(idx, state.dueDay).getDate()} ${T.monthName(idx)} ${T.yearOf(idx)}`; }
function dueShort(idx) { return `${T.dueDate(idx, state.dueDay).getDate()} ${T.monthShort(idx)} ${T.yearOf(idx)}`; }
function monthLong(idx) { return `${T.monthName(idx)} ${T.yearOf(idx)}`; }

function uid() { return Math.random().toString(36).slice(2, 10); }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function personById(id) { return state.people.find(p => p.id === id); }
function seriesVar(person) { return `var(--s${(person.color % SERIES_COUNT) + 1})`; }

function swatch(person) {
  const i = el("i", "swatch");
  i.style.background = seriesVar(person);
  return i;
}

// Renk kişiye bağlıdır, sırasına değil: yeni kişi boştaki ilk rengi alır
function nextColor() {
  const used = new Set(state.people.map(p => p.color));
  for (let c = 0; c < SERIES_COUNT; c++) if (!used.has(c)) return c;
  return state.people.length % SERIES_COUNT;
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
  legend:        document.getElementById("chartLegend"),
  chart:         document.getElementById("planChart"),
  chartEmpty:    document.getElementById("chartEmpty"),
  tooltip:       document.getElementById("chartTooltip"),
  dueDay:        document.getElementById("dueDay"),
  table:         document.getElementById("planTable"),
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
  els.dueDay.value = state.dueDay;

  const start = T.monthIndex(currentMonth);
  const known = new Set(state.people.map(p => p.id));
  const lastDue = state.installments
    .filter(i => known.has(i.personId))
    .reduce((m, i) => Math.max(m, T.lastDueIndex(i)), -Infinity);
  const end = Math.min(lastDue, start + MAX_MONTHS - 1);
  const rows = end >= start ? T.buildSchedule(state.people, state.installments, start, end) : [];
  lastRows = rows;
  if (selectedIdx != null && !rows.some(r => r.idx === selectedIdx)) selectedIdx = null;

  renderSummary(rows, start, lastDue);
  renderLegend();
  renderChart(rows);
  renderTable(rows);
  renderInstallments(start);
}

function renderSummary(rows, start, lastDue) {
  const totalAt = idx => rows.find(r => r.idx === idx)?.total || 0;
  const day = idx => `${T.dueDate(idx, state.dueDay).getDate()} ${T.monthName(idx)}`;
  els.dueLabel.textContent  = day(start) + " ödemesi";
  els.dueTotal.textContent  = fmt(totalAt(start));
  els.nextLabel.textContent = day(start + 1);
  els.nextTotal.textContent = fmt(totalAt(start + 1));
  els.remaining.textContent = fmt(rows.reduce((s, r) => s + r.total, 0));
  els.endLabel.textContent  = lastDue >= start ? monthLong(lastDue) : "—";
}

function renderLegend() {
  els.legend.replaceChildren();
  if (state.people.length < 2) return;   // tek seri: başlık yeterli
  for (const p of state.people) {
    const item = el("span", "leg");
    item.append(swatch(p), document.createTextNode(p.name));
    els.legend.append(item);
  }
}

// ---------- Payment table (Excel'deki özet sayfası) ----------
function renderTable(rows) {
  const table = els.table;
  table.replaceChildren();
  const people = state.people;
  const cols = people.length + 2;

  const head = table.createTHead().insertRow();
  head.append(el("th", "", "Son ödeme"));
  for (const p of people) {
    const th = el("th", "num");
    th.append(swatch(p), document.createTextNode(p.name));
    head.append(th);
  }
  head.append(el("th", "num", "Toplam"));

  const body = table.createTBody();
  if (!rows.length) {
    const td = el("td", "empty", state.installments.length
      ? `${dueLong(T.monthIndex(currentMonth))} ve sonrasında ödeme yok.`
      : "Henüz taksit yok.");
    td.colSpan = cols;
    body.insertRow().append(td);
    return;
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sums = Object.fromEntries(people.map(p => [p.id, 0]));
  let grand = 0;

  for (const r of rows) {
    const tr = body.insertRow();
    const open = r.idx === selectedIdx;
    tr.className = "month-row" + (open ? " selected" : "") + (r.total ? "" : " zero")
      + (T.dueDate(r.idx, state.dueDay) < today ? " past" : "");
    tr.tabIndex = 0;
    tr.setAttribute("aria-expanded", String(open));
    const date = el("td");
    date.append(el("span", "d-long", dueShort(r.idx)),
      el("span", "d-short", `${T.monthShort(r.idx)} ’${String(T.yearOf(r.idx)).slice(2)}`));
    tr.append(date);
    for (const p of people) {
      const v = r.byPerson[p.id];
      tr.append(el("td", "num", v ? fmtNum(v) : "—"));
      sums[p.id] += v;
    }
    tr.append(el("td", "num total", r.total ? fmtNum(r.total) : "—"));
    grand += r.total;

    const toggle = () => { selectedIdx = open ? null : r.idx; render(); };
    tr.addEventListener("click", toggle);
    tr.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    if (open) {
      const detail = body.insertRow();
      detail.className = "detail-row";
      const td = el("td");
      td.colSpan = cols;
      td.append(monthDetail(r));
      detail.append(td);
    }
  }

  const foot = table.createTFoot().insertRow();
  foot.append(el("td", "", "Toplam"));
  for (const p of people) foot.append(el("td", "num", fmtNum(sums[p.id])));
  foot.append(el("td", "num total", fmtNum(grand)));
}

// Seçili ayda ödenen taksitler
function monthDetail(row) {
  const ul = el("ul", "month-items");
  if (!row.items.length) {
    ul.append(el("li", "dp-empty", "Bu ay ödeme yok"));
    return ul;
  }
  const order = new Map(state.people.map((p, i) => [p.id, i]));
  const items = [...row.items].sort((a, b) =>
    order.get(a.inst.personId) - order.get(b.inst.personId) || a.inst.desc.localeCompare(b.inst.desc, "tr"));
  for (const { inst, no, amount } of items) {
    const p = personById(inst.personId);
    const li = el("li");
    const who = el("span", "who");
    who.append(swatch(p), document.createTextNode(p.name));
    li.append(who, el("span", "desc", inst.desc), el("span", "no", `${no}/${T.planLength(inst)}`), el("span", "amount", fmt(amount)));
    ul.append(li);
  }
  return ul;
}

// ---------- Installments (Excel'deki kişi sayfaları) ----------
function renderInstallments(start) {
  if (!personById(selectedPersonId)) selectedPersonId = state.people[0]?.id ?? null;
  const person = personById(selectedPersonId);

  els.personTabs.replaceChildren(...state.people.map(p => {
    const b = el("button", "ptab" + (p.id === selectedPersonId ? " active" : ""));
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(p.id === selectedPersonId));
    b.append(swatch(p), document.createTextNode(p.name));
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
    els.instList.append(el("li", "dp-empty", "Taksit eklemek için önce bir kişi ekle."));
    return;
  }

  const mine = state.installments.filter(i => i.personId === person.id);
  let monthly = 0, remaining = 0;
  for (const inst of mine) {
    if (T.installmentNo(inst, start)) monthly += T.perInstallment(inst);
    remaining += T.remainingFrom(inst, start) * T.perInstallment(inst);
  }
  els.personStats.textContent =
    `${T.dueDate(start, state.dueDay).getDate()} ${T.monthName(start)}: ${fmt(monthly)} · kalan ${fmt(remaining)}`;

  if (!mine.length) {
    els.instList.append(el("li", "dp-empty", `${person.name} için taksit yok`));
    return;
  }

  const sorted = mine
    .map(inst => ({ inst, left: T.remainingFrom(inst, start) }))
    .sort((a, b) => (b.left > 0) - (a.left > 0)
      || T.firstDueIndex(a.inst) - T.firstDueIndex(b.inst)
      || a.inst.desc.localeCompare(b.inst.desc, "tr"));

  for (const { inst, left } of sorted) {
    const per = T.perInstallment(inst);
    const plan = T.planLength(inst);
    const li = el("li", "inst" + (left ? "" : " done") + (inst.id === editingId ? " editing" : ""));
    li.tabIndex = 0;
    li.title = "Düzenlemek için tıkla";

    const main = el("div", "inst-main");
    main.append(el("strong", "", inst.desc));
    let meta = `${monthLong(T.monthIndex(inst.statement))} ekstresi · ${inst.count} × ${fmt(per)}`;
    if (plan > inst.count) meta += ` · ${plan} taksitlik plan, orijinal ${fmt(T.originalTotal(inst))}`;
    main.append(el("span", "meta", meta));
    main.append(el("span", "meta", `${dueShort(T.firstDueIndex(inst))} → ${dueShort(T.lastDueIndex(inst))}`));

    const side = el("div", "inst-side");
    side.append(el("span", "amount", fmt(per)));
    side.append(el("span", "meta", left ? `kalan ${left}/${plan} · ${fmt(left * per)}` : "bitti"));

    const del = el("button", "del", "✕");
    del.type = "button";
    del.setAttribute("aria-label", `${inst.desc} sil`);
    del.addEventListener("click", e => {
      e.stopPropagation();
      if (!confirm(`“${inst.desc}” silinsin mi?`)) return;
      state.installments = state.installments.filter(x => x.id !== inst.id);
      if (editingId === inst.id) resetForm();
      saveState(); render();
    });

    li.append(main, side, del);
    li.addEventListener("click", () => startEdit(inst));
    li.addEventListener("keydown", e => { if (e.key === "Enter") startEdit(inst); });
    els.instList.append(li);
  }
}

// ---------- Installment form ----------
function readForm() {
  const f = els.instForm.elements;
  const count = Math.round(Number(f.count.value));
  const amount = Number(f.amount.value);
  const planCount = Math.round(Number(f.planCount.value)) || 0;
  const statement = T.parseStatement(f.statement.value);
  const desc = f.desc.value.trim();
  if (!desc || !statement || !(count >= 1) || !(amount > 0)) return null;
  const total = f.mode.value === "per" ? Math.round(amount * count * 100) / 100 : amount;
  const inst = { desc, statement, count, total };
  if (planCount > count) inst.planCount = planCount;
  return inst;
}

function updatePreview() {
  const inst = readForm();
  if (!inst) { els.instPreview.textContent = ""; return; }
  let text = `${inst.count} × ${fmt(T.perInstallment(inst))} = ${fmt(inst.total)}`
    + ` · ilk ödeme ${dueLong(T.firstDueIndex(inst))}`;
  if (inst.count > 1) text += `, son ${dueLong(T.lastDueIndex(inst))}`;
  if (inst.planCount) text += ` · orijinal ${fmt(T.originalTotal(inst))}`;
  els.instPreview.textContent = text;
}

function resetForm() {
  editingId = null;
  els.instForm.reset();
  els.instForm.elements.statement.value = T.monthKey(todayIndex());
  els.instSubmit.textContent = "Ekle";
  els.instCancel.hidden = true;
  els.instPreview.textContent = "";
}

function startEdit(inst) {
  editingId = inst.id;
  const f = els.instForm.elements;
  f.desc.value = inst.desc;
  f.statement.value = inst.statement;
  f.count.value = inst.count;
  f.amount.value = Math.round(inst.total * 100) / 100;
  f.mode.value = "total";
  f.planCount.value = inst.planCount || "";
  els.instSubmit.textContent = "Kaydet";
  els.instCancel.hidden = false;
  render();
  updatePreview();
  els.instForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  f.desc.focus({ preventScroll: true });
}

els.instForm.addEventListener("input", updatePreview);

els.instForm.addEventListener("submit", e => {
  e.preventDefault();
  const inst = readForm();
  if (!inst || !selectedPersonId) return;
  if (editingId) {
    state.installments = state.installments.map(x =>
      x.id === editingId ? { id: x.id, personId: x.personId, ...inst } : x);
  } else {
    state.installments.push({ id: uid(), personId: selectedPersonId, ...inst });
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
    const person = { id: uid(), name, color: nextColor() };
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
  if (!confirm(n ? `“${person.name}” ve ${n} taksiti silinsin mi?` : `“${person.name}” silinsin mi?`)) return;
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

els.dueDay.addEventListener("change", () => {
  const v = Math.round(Number(els.dueDay.value));
  if (v >= 1 && v <= 31 && v !== state.dueDay) { state.dueDay = v; saveState(); }
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

// Her sayfa bir kişi; o kişinin taksitleri Excel'dekilerle değiştirilir, diğer kişilere dokunulmaz
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

  const total = result.people.reduce((s, p) => s + p.installments.length, 0);
  const summary = result.people.map(p => `${p.name} (${p.installments.length})`).join(", ");
  let msg = `${total} taksit içe aktarılacak: ${summary}.\nBu kişilerin mevcut taksitleri Excel'dekilerle değiştirilecek.`;
  if (result.skipped) msg += `\n${result.skipped} satır eksik bilgi nedeniyle atlanacak.`;
  if (!confirm(msg + "\nDevam edelim mi?")) return false;

  for (const p of result.people) {
    let person = state.people.find(x => T.normalize(x.name) === T.normalize(p.name));
    if (!person) {
      person = { id: uid(), name: p.name, color: nextColor() };
      state.people.push(person);
    }
    state.installments = state.installments
      .filter(i => i.personId !== person.id)
      .concat(p.installments.map(i => ({ id: uid(), personId: person.id, ...i })));
  }
  if (result.dueDay) state.dueDay = result.dueDay;
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

function renderChart(rows) {
  const svg = els.chart;
  const hasData = rows.some(r => r.total > 0);
  svg.style.display = hasData ? "" : "none";
  els.chartEmpty.hidden = hasData;
  els.tooltip.setAttribute("hidden", "");
  if (!hasData) {
    els.chartEmpty.textContent = state.installments.length
      ? "Bu aydan sonra ödenecek taksit yok."
      : "Henüz taksit yok — aşağıdan ekle ya da Taksitler Excel dosyanı içe aktar.";
    svg.innerHTML = "";
    return;
  }

  const W = Math.round(svg.getBoundingClientRect().width) || 880, H = 180;
  const PL = 44, PR = 8, PT = 22, PB = 24, GAP = 2, R = 4;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = rows.length;
  const band = plotW / n;
  const barW = Math.min(24, band * 0.6);
  const { step, top } = niceScale(Math.max(...rows.map(r => r.total)), 4);
  const toY = v => PT + plotH * (1 - v / top);
  const focusIdx = selectedIdx ?? rows[0].idx;

  // Y grid
  let gridSvg = "", yLblSvg = "";
  for (let v = 0; v <= top + step * 0.01; v += step) {
    const y = toY(v).toFixed(1);
    gridSvg += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`;
    yLblSvg += `<text x="${PL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--mute)">${fmtShort(v)}</text>`;
  }

  // Columns: kişiler sabit sırada alttan üste, aralarında 2px boşluk
  const every = Math.ceil(44 / band);
  let barsSvg = "", xLblSvg = "", capSvg = "", selSvg = "";
  rows.forEach((row, i) => {
    const cx = PL + band * (i + 0.5);
    const x = cx - barW / 2;
    if (row.idx === selectedIdx) {
      selSvg = `<rect x="${(PL + band * i).toFixed(1)}" y="${PT}" width="${band.toFixed(1)}" height="${plotH}" fill="var(--accent)" opacity="0.08" rx="4"/>`;
    }

    const segs = state.people
      .map(p => ({ p, v: row.byPerson[p.id] }))
      .filter(s => s.v > 0);
    let cum = 0, parts = "";
    segs.forEach((s, j) => {
      const yTop = toY(cum + s.v);
      const yBot = toY(cum) - (j > 0 ? GAP : 0);
      cum += s.v;
      const h = yBot - yTop;
      if (h <= 0.5) return;
      parts += j === segs.length - 1
        ? `<path d="${topRoundedBar(x, yTop, barW, h, R)}" fill="${seriesVar(s.p)}"/>`
        : `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${seriesVar(s.p)}"/>`;
    });
    barsSvg += `<g class="col" data-i="${i}">${parts}</g>`;

    // Değer etiketi yalnızca odaktaki ayda
    if (row.idx === focusIdx && row.total > 0) {
      const label = band >= 72 ? fmtNum(row.total) : fmtShort(row.total);
      capSvg = `<text x="${cx.toFixed(1)}" y="${(toY(row.total) - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text)">${label}</text>`;
    }

    if (i % every === 0) {
      const withYear = i === 0 || row.idx % 12 === 0;
      const label = T.monthShort(row.idx) + (withYear ? ` ’${String(T.yearOf(row.idx)).slice(2)}` : "");
      xLblSvg += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="${row.idx === selectedIdx ? "var(--text)" : "var(--mute)"}">${label}</text>`;
    }
  });

  // Hit areas — sütunun tamamı (etiketler dahil)
  const hitsSvg = rows.map((row, i) =>
    `<rect class="cf-hit" data-i="${i}" tabindex="0" role="button" aria-label="${dueLong(row.idx)}: ${fmt(row.total)}" x="${(PL + band * i).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${H}" fill="transparent"/>`
  ).join("");

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `${gridSvg}${selSvg}${barsSvg}${capSvg}${yLblSvg}${xLblSvg}${hitsSvg}`;

  svg.querySelectorAll(".cf-hit").forEach(hit => {
    const i = Number(hit.dataset.i);
    const row = rows[i];
    const col = svg.querySelector(`.col[data-i="${i}"]`);
    const select = () => { selectedIdx = selectedIdx === row.idx ? null : row.idx; render(); };
    hit.addEventListener("click", select);
    hit.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
    });
    hit.addEventListener("pointermove", e => { col.classList.add("hover"); showTooltip(row, e.clientX, e.clientY); });
    hit.addEventListener("pointerleave", () => { col.classList.remove("hover"); hideTooltip(); });
    hit.addEventListener("focus", () => {
      const b = hit.getBoundingClientRect();
      col.classList.add("hover");
      showTooltip(row, b.left + b.width / 2, b.top + 40);
    });
    hit.addEventListener("blur", () => { col.classList.remove("hover"); hideTooltip(); });
  });
}

function showTooltip(row, x, y) {
  const tt = els.tooltip;
  tt.replaceChildren(el("span", "tt-date", dueLong(row.idx)));
  for (const p of state.people) {
    const v = row.byPerson[p.id];
    if (!v) continue;
    const line = el("span", "tt-row");
    const key = el("i", "tt-key");
    key.style.background = seriesVar(p);
    line.append(key, el("strong", "", fmt(v)), el("span", "tt-name", p.name));
    tt.append(line);
  }
  if (state.people.length > 1) tt.append(el("span", "tt-total", "Toplam " + fmt(row.total)));
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
  resizeFrame = requestAnimationFrame(() => renderChart(lastRows));
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
render();

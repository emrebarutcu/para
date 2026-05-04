// ---------- State + storage ----------
const STORAGE_KEY = "cashflow.v1";

const defaultState = () => ({
  openingBalanceByMonth: {},
  entriesByDate: {},
  recurring: [],
  _v: 0, // version timestamp — used for sync conflict resolution
});

let state = loadState();
let currentMonth = todayMonth();
let selectedDay = new Date().getDate();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch { return defaultState(); }
}

function saveState() {
  state._v = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (typeof window.syncSchedulePush === 'function') window.syncSchedulePush(state);
}

// ---------- Helpers ----------
function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function fmt(n) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency", currency: "TRY", maximumFractionDigits: 2,
  }).format(n || 0);
}

const DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const DAY_NAMES_FULL = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

function uid() { return Math.random().toString(36).slice(2, 10); }

function recurringForMonth(year, month) {
  const last = daysInMonth(year, month);
  const out = {};
  for (const r of state.recurring) {
    const d = Math.min(r.day, last);
    const key = dateKey(year, month, d);
    if (!out[key]) out[key] = [];
    out[key].push({ id: `r-${r.id}`, desc: r.desc, amount: r.amount, type: r.type, fixed: true, recurringId: r.id });
  }
  return out;
}

function entriesFor(dateKeyStr, recurringMap) {
  return [...(recurringMap[dateKeyStr] || []), ...(state.entriesByDate[dateKeyStr] || [])];
}

// ---------- Render ----------
const els = {
  monthPicker: document.getElementById("monthPicker"),
  prev:         document.getElementById("prevMonth"),
  next:         document.getElementById("nextMonth"),
  opening:      document.getElementById("openingBalance"),
  totalIncome:  document.getElementById("totalIncome"),
  totalExpense: document.getElementById("totalExpense"),
  endingBalance:document.getElementById("endingBalance"),
  recurringForm:document.getElementById("recurringForm"),
  recurringList:document.getElementById("recurringList"),
  recurringBody:document.getElementById("recurringBody"),
  toggleRecurring: document.getElementById("toggleRecurring"),
  exportBtn:    document.getElementById("exportBtn"),
  importInput:  document.getElementById("importInput"),
};

function render() {
  els.monthPicker.value = currentMonth;
  const [y, m] = currentMonth.split("-").map(Number);
  const last = daysInMonth(y, m);
  const recMap = recurringForMonth(y, m);

  els.opening.value = state.openingBalanceByMonth[currentMonth] ?? "";
  const opening = Number(state.openingBalanceByMonth[currentMonth] || 0);

  // Clamp selectedDay
  if (selectedDay > last) selectedDay = last;
  if (selectedDay < 1)    selectedDay = 1;

  // Data collection loop (no DOM cards)
  let running = opening;
  let totalIncome = 0, totalExpense = 0;
  const runningBalances = [];
  const dailyNets = [];

  for (let d = 1; d <= last; d++) {
    const key = dateKey(y, m, d);
    const entries = entriesFor(key, recMap);
    let delta = 0;
    for (const e of entries) {
      if (e.type === "income") { delta += Number(e.amount); totalIncome += Number(e.amount); }
      else                     { delta -= Number(e.amount); totalExpense += Number(e.amount); }
    }
    running += delta;
    runningBalances.push(running);
    dailyNets.push(delta);
  }

  els.totalIncome.textContent  = fmt(totalIncome);
  els.totalExpense.textContent = fmt(totalExpense);
  els.endingBalance.textContent = fmt(opening + totalIncome - totalExpense);

  renderChart(runningBalances, dailyNets, opening, y, m);

  const selKey = dateKey(y, m, selectedDay);
  renderDayPanel(selectedDay, y, m, entriesFor(selKey, recMap), runningBalances[selectedDay - 1] ?? opening);

  renderRecurring();
}

// ---------- Day panel ----------
function renderDayPanel(day, year, month, entries, balance) {
  const panel = document.getElementById("dayPanel");
  if (!panel) return;

  const date = new Date(year, month - 1, day);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const key = dateKey(year, month, day);

  // Head
  const numEl = panel.querySelector(".dp-day-num");
  numEl.textContent = day;
  numEl.style.color = isWeekend ? "var(--warn)" : "";

  panel.querySelector(".dp-day-name").textContent =
    DAY_NAMES_FULL[date.getDay()] + " · " +
    date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

  const balEl = panel.querySelector(".dp-balance");
  balEl.textContent = fmt(balance);
  balEl.className = "dp-balance" + (balance < 0 ? " negative" : "");

  // Entries list
  const ul = panel.querySelector(".dp-entries");
  ul.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "dp-empty";
    empty.textContent = "Bu gün için hareket yok";
    ul.append(empty);
  } else {
    for (const e of entries) {
      const li = document.createElement("li");

      const desc = document.createElement("span");
      desc.className = "desc";
      desc.textContent = e.desc;

      const right = document.createElement("span");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "8px";

      if (e.fixed) {
        const tag = document.createElement("span");
        tag.className = "fixed-tag";
        tag.textContent = "sabit";
        right.append(tag);
      }

      const amt = document.createElement("span");
      amt.className = `amount ${e.type}`;
      amt.textContent = (e.type === "income" ? "+" : "−") + fmt(Math.abs(Number(e.amount)));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        if (e.fixed) {
          if (confirm("Bu sabit hareketi tüm aylardan kaldırmak istiyor musun?")) {
            state.recurring = state.recurring.filter(r => r.id !== e.recurringId);
            saveState(); render();
          }
        } else {
          state.entriesByDate[key] = (state.entriesByDate[key] || []).filter(x => x.id !== e.id);
          if (!state.entriesByDate[key].length) delete state.entriesByDate[key];
          saveState(); render();
        }
      });

      right.append(amt, del);
      li.append(desc, right);
      ul.append(li);
    }
  }

  // Add-entry form — replace to clear old listeners
  const oldForm = panel.querySelector(".dp-add");
  const form = oldForm.cloneNode(true);
  oldForm.replaceWith(form);

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const fd = new FormData(form);
    const entry = {
      id: uid(),
      desc: String(fd.get("desc") || "").trim(),
      amount: Number(fd.get("amount")),
      type: String(fd.get("type")),
    };
    if (!entry.desc || !Number.isFinite(entry.amount) || entry.amount <= 0) return;
    if (!state.entriesByDate[key]) state.entriesByDate[key] = [];
    state.entriesByDate[key].push(entry);
    saveState();
    form.reset();
    render();
  });
}

// ---------- Recurring ----------
function renderRecurring() {
  els.recurringList.innerHTML = "";
  for (const r of [...state.recurring].sort((a, b) => a.day - b.day)) {
    const li = document.createElement("li");
    const left = document.createElement("div");
    left.innerHTML = `<strong>${escapeHtml(r.desc)}</strong> <span class="meta">· her ayın ${r.day}. günü</span>`;
    const right = document.createElement("div");
    right.style.cssText = "display:flex;align-items:center;gap:10px";
    const amt = document.createElement("span");
    amt.className = `amount ${r.type}`;
    amt.textContent = (r.type === "income" ? "+" : "−") + fmt(r.amount);
    const del = document.createElement("button");
    del.className = "ghost small";
    del.textContent = "Sil";
    del.addEventListener("click", () => { state.recurring = state.recurring.filter(x => x.id !== r.id); saveState(); render(); });
    right.append(amt, del);
    li.append(left, right);
    els.recurringList.append(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ---------- Events ----------
els.prev.addEventListener("click", () => shiftMonth(-1));
els.next.addEventListener("click", () => shiftMonth(1));
els.monthPicker.addEventListener("change", () => {
  if (els.monthPicker.value) { currentMonth = els.monthPicker.value; render(); }
});

function shiftMonth(delta) {
  const [y, m] = currentMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  render();
}

els.opening.addEventListener("input", () => {
  const v = els.opening.value;
  if (v === "") delete state.openingBalanceByMonth[currentMonth];
  else state.openingBalanceByMonth[currentMonth] = Number(v);
  saveState(); render();
});

els.toggleRecurring.addEventListener("click", () => {
  const hidden = els.recurringBody.hasAttribute("hidden");
  hidden ? els.recurringBody.removeAttribute("hidden") : els.recurringBody.setAttribute("hidden", "");
  els.toggleRecurring.textContent = hidden ? "Gizle" : "Göster";
});

els.recurringForm.addEventListener("submit", e => {
  e.preventDefault();
  const desc = document.getElementById("rDesc").value.trim();
  const amount = Number(document.getElementById("rAmount").value);
  const type = document.getElementById("rType").value;
  const day = Math.max(1, Math.min(31, Number(document.getElementById("rDay").value)));
  if (!desc || !Number.isFinite(amount) || amount <= 0 || !day) return;
  state.recurring.push({ id: uid(), desc, amount, type, day });
  saveState(); els.recurringForm.reset(); render();
});

els.exportBtn.addEventListener("click", () => {
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" })),
    download: `cashflow-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click(); URL.revokeObjectURL(a.href);
});

els.importInput.addEventListener("change", async e => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm("Mevcut verilerin üzerine yazılacak. Devam edelim mi?")) return;
    state = { ...defaultState(), ...data };
    saveState();
    if (typeof window.syncPushNow === 'function') await window.syncPushNow(state);
    render();
  } catch { alert("Geçersiz dosya."); }
  finally { els.importInput.value = ""; }
});

// ---------- Chart ----------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fmtShort(n) {
  const abs = Math.abs(n), s = n < 0 ? "-" : "";
  if (abs >= 1e6) return s + (abs / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return s + (abs / 1e3).toFixed(0) + "K";
  return s + Math.round(abs).toLocaleString("tr-TR");
}

function niceYTicks(lo, hi, count) {
  const range = hi - lo || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(range / count)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(s => range / s <= count * 1.5) || mag * 10;
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 0.01; t = Math.round((t + step) * 1e9) / 1e9)
    ticks.push(t);
  return ticks;
}

function renderChart(runningBalances, dailyNets, opening, year, month) {
  const svg = document.getElementById("cashflowChart");
  if (!svg) return;
  const n = runningBalances.length;
  svg.innerHTML = "";
  if (n === 0) return;

  const W = 880, H = 170, PL = 58, PR = 12, PT = 14, PB = 28;
  const plotW = W - PL - PR, plotH = H - PT - PB;

  const allVals = [opening, ...runningBalances];
  let lo = Math.min(0, ...allVals), hi = Math.max(0, ...allVals);
  if (lo === hi) { lo -= 1000; hi += 1000; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const rng = hi - lo;

  const toY = v => PT + plotH * (1 - (v - lo) / rng);
  const toX = d => PL + (d / n) * plotW;

  const pts = [[toX(0), toY(opening)], ...runningBalances.map((b, i) => [toX(i + 1), toY(b)])];
  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const zy = clamp(toY(0), PT, PT + plotH);
  const areaD = lineD + ` L${pts[n][0].toFixed(1)},${zy} L${PL},${zy} Z`;
  const colW = (plotW / n).toFixed(1);

  // Y grid
  let gridSvg = "", yLblSvg = "";
  for (const v of niceYTicks(lo, hi, 4)) {
    const y = toY(v).toFixed(1);
    gridSvg  += `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`;
    yLblSvg  += `<text x="${PL-6}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--muted)">${fmtShort(v)}</text>`;
  }

  // X labels
  const shown = new Set([1, n]);
  for (let d = 5; d < n; d += 5) shown.add(d);
  const xLblSvg = [...shown].sort((a,b)=>a-b).map(d =>
    `<text x="${(PL + (d-0.5)/n*plotW).toFixed(1)}" y="${H-4}" text-anchor="middle" font-size="11" fill="var(--muted)">${d}</text>`
  ).join("");

  // Zero + today lines
  const zeroSvg = `<line x1="${PL}" y1="${zy}" x2="${W-PR}" y2="${zy}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3,4" opacity="0.4"/>`;
  let todaySvg = "";
  const td = new Date();
  if (td.getFullYear() === year && td.getMonth() + 1 === month) {
    const tx = toX(td.getDate()).toFixed(1);
    todaySvg = `<line x1="${tx}" y1="${PT}" x2="${tx}" y2="${PT+plotH}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/>`;
  }

  // Selected day highlight
  const selX = toX(selectedDay - 1).toFixed(1);
  const selHighlight = `<rect x="${selX}" y="${PT}" width="${colW}" height="${plotH}" fill="var(--accent)" opacity="0.10" rx="2"/>`;

  // Dots
  const dotsSvg = runningBalances.map((_, i) => {
    const [cx, cy] = pts[i + 1];
    const col = dailyNets[i] > 0 ? "var(--income)" : dailyNets[i] < 0 ? "var(--expense)" : "var(--muted)";
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5" fill="${col}" stroke="var(--panel)" stroke-width="1.5"/>`;
  }).join("");

  // Hit rects (hover + click)
  const hitsSvg = Array.from({length: n}, (_, i) =>
    `<rect class="cf-hit" data-d="${i+1}" x="${toX(i).toFixed(1)}" y="${PT}" width="${colW}" height="${plotH}" fill="transparent" style="cursor:pointer"/>`
  ).join("");

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<defs>
    <linearGradient id="cfGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  ${gridSvg}${zeroSvg}${todaySvg}${selHighlight}
  <path d="${areaD}" fill="url(#cfGrad)"/>
  <path d="${lineD}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${dotsSvg}${yLblSvg}${xLblSvg}${hitsSvg}`;

  const tt = document.getElementById("chartTooltip");
  svg.querySelectorAll(".cf-hit").forEach(r => {
    r.addEventListener("click", () => {
      selectedDay = Number(r.dataset.d);
      render();
    });
    r.addEventListener("mousemove", e => {
      const d = Number(r.dataset.d);
      const net = dailyNets[d - 1];
      tt.querySelector(".tt-date").textContent =
        new Date(year, month-1, d).toLocaleDateString("tr-TR", { weekday:"short", day:"numeric", month:"short" });
      tt.querySelector(".tt-balance").textContent = "Bakiye: " + fmt(runningBalances[d - 1]);
      const ttNet = tt.querySelector(".tt-net");
      ttNet.textContent = "Günlük: " + (net >= 0 ? "+" : "") + fmt(net);
      ttNet.style.color = net > 0 ? "var(--income)" : net < 0 ? "var(--expense)" : "var(--muted)";
      tt.removeAttribute("hidden");
      tt.style.left = (e.clientX + 14) + "px";
      tt.style.top  = (e.clientY - 60) + "px";
    });
    r.addEventListener("mouseleave", () => tt.setAttribute("hidden", ""));
  });
}

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------- Boot ----------
if (typeof window.syncInit === 'function') {
  window.syncInit({
    onRemoteData(remote) {
      if (!remote || typeof remote._v !== 'number') return;
      const local = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (remote._v > (local._v || 0)) {
        state = { ...defaultState(), ...remote };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
      }
    },
  });
}

render();

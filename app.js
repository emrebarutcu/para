// ---------- State + storage ----------
const T = window.Taksit;
const E = window.Eposta;
const V = window.Varlik;
const R = window.Tekrar;
const K = window.Kategori;
const I = window.Icgoru;
const YZ = window.YZ;
const B = window.Borc;
const STORAGE_KEY_BASE = "cashflow.v1";
function getStorageKey() {
  return window.CF_USER_ID ? `${STORAGE_KEY_BASE}.${window.CF_USER_ID}` : STORAGE_KEY_BASE;
}

const MAX_MONTHS = 60;           // akışta gösterilecek en fazla ay
const CHART_MONTHS = 12;         // özetteki grafikte gösterilecek ay
const CASH_COLOR = "var(--cash)";
const VIEWS = ["ozet", "akis", "harcamalar", "kartlar", "borclar", "varliklar"];
const COUNT_PRESETS = [1, 2, 3, 4, 6, 9, 12];
const FREQ_PRESETS = [["", "Bir kez"], ["day", "Günde bir"], ["week", "Haftada bir"], ["month", "Ayda bir"], ["other", "Diğer"]];   // tekrar sıklığı
const TIMES_PRESETS = [[0, "Süresiz"], [3, "3 kez"], [6, "6 kez"], [12, "12 kez"]];   // kaç kez tekrarlar
const WEEKDAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const CAL_WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];   // takvim pazartesiyle başlar
const PREF = { theme: "para.theme", chartBy: "para.chartBy", flowMode: "para.flowMode", timelineMode: "para.timelineMode", rates: "para.rates",
  cashStart: "para.cashStart", cashMode: "para.cashMode", timelineStart: "para.timelineStart", trackNotice: "para.trackNotice",
  purchaseSort: "para.purchaseSort", prices: "para.prices", settle: "para.settle", cashDef: "para.cashDef",
  assetRange: "para.assetRange", history: "para.history" };
const PURCHASE_SORTS = ["next", "new", "amount", "name"];   // Harcamalar sıralaması (index.html #purchaseSort)
const RATES_TTL = 10 * 60_000;   // kurlar bu kadar süre taze sayılır (/api/kur da bu kadar saklar)
const RATES_RETRY = 60_000;      // kur alınamazsa yeniden deneme aralığı
const PRICES_TTL = 2 * 60_000;   // fon ve hisse fiyatları bu kadar süre taze sayılır (/api/fiyat da bu kadar saklar)
const INSIGHTS_SHOWN = 3;        // özette ilk görünen içgörü sayısı
const SUGGEST_DELAY = 450;       // açıklama yazılırken kategori önerisi için bekleme (ms)

const { SERIES_COUNT, defaultState, validDay, defaultCard, nextColor, hydrate } = T;

function readPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {}
}
function readCashDef() {
  try { return V.cashDef(JSON.parse(readPref(PREF.cashDef))); } catch { return [...V.CASH_DEFAULT]; }
}

let stateOwner = null;         // state'in ait olduğu kullanıcı (girişsizse null)
let state = loadState();
let view = viewFromHash();
let currentMonth = T.monthKey(todayIndex());   // özet ve akışın başladığı ay
let chartBy = readPref(PREF.chartBy) === "card" ? "card" : "person";
let flowMode = readPref(PREF.flowMode) === "table" ? "table" : "list";
let personFilter = "all";
let showDone = false;
let purchaseSort = PURCHASE_SORTS.includes(readPref(PREF.purchaseSort)) ? readPref(PREF.purchaseSort) : "next";
let openEventKey = null;      // akışta açılan ödeme
let focusIdx = null;          // akışta vurgulanan ay (grafikten gelince)
let pendingScroll = null;     // render sonrası kaydırılacak öğe id'si
let editingId = null;         // düzenlenen harcama
let convertingEntryId = null; // harcama formunda açılan eski varlık çıkışı (kaydedilince harcamaya dönüşür)
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
let timelineStart = /^([1-9]|[12]\d|3[01])$/.test(readPref(PREF.timelineStart) ?? "") ? readPref(PREF.timelineStart) : "1";   // takvim dönemi: ayın günü
let cashStart = /^([1-9]|[12]\d|3[01])$/.test(readPref(PREF.cashStart) ?? "") ? readPref(PREF.cashStart) : "today";   // nakit dönemi: "today" | ayın günü
let cashMode = readPref(PREF.cashMode) === "net" ? "net" : "balance";
let cashDef = readCashDef();  // nakit sayılan varlıklar (varlik.js cashDef; varsayılan TL ve para piyasası fonları)
let cashShift = 0;            // nakit grafiğinde bugünün döneminden kaç dönem uzakta
let editingEntryId = null;    // düzenlenen varlık hareketi
let debtSide = "debt";        // Borçlar'da gösterilen: debt (Borçlarım) | receivable (Alacaklarım)
let debtClosedOpen = false;   // Borçlar'da kapananlar açık
let editingDebtId = null;     // düzenlenen borç / alacak / kredi
let payTarget = null;         // ödeme formunun hedefi: { debtId } ya da kart payı için { personId }
let editingPayId = null;      // ödeme formunda düzenlenen ödeme
let sharePid = null;          // kart payı penceresindeki kişi
let lastAsset = "TRY";
let rates = readRates();      // son alınan kurlar: { rates: { TRY, USD, EUR, GAU }, updatedAt, fetchedAt }
let ratesFailed = false;
let ratesTriedAt = 0;
let ratesLoading = null;
let prices = readPrices();    // elde tutulan fon ve hisselerin son fiyatları: { prices: { "BIST:THYAO": { price, prev?, date, at?, name?, kind? } }, missing, fetchedAt }
let pricesFailed = false;
let pricesTriedAt = 0;
let pricesLoading = null;
const lookups = new Map();    // formda sorulan, elde olmayan kod → "loading" | "missing" | "error"
let fundList = null;          // TEFAS fon listesi (formdaki arama): [{ code: "AFT", name, kind, price, date }]
let fundListPartial = false;  // listede bir fon türü eksik (alınamadı): bulunamayan fon "yok" sayılmaz
let fundListLoading = null;
let lastSettle = readPref(PREF.settle) !== "0";   // fon / hisse alışı TL bakiyesine işlensin (formda son seçilen)
let priceTouched = false;     // formdaki birim fiyatı kullanıcı yazdı (güncel fiyatla doldurulmaz)
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
  debtSide = "debt";
  debtClosedOpen = false;
  editingDebtId = null;
  payTarget = null;
  editingPayId = null;
  sharePid = null;
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
function paymentsOf(p, until) { return T.payments(p, cardById(p.cardId), until); }
// Tekrarlayan harcamada sıradaki tekrarın ödemeleri de (henüz gelmemiş olsa da) sayılır: liste ve durum için
function upcomingPayments(p, today) { return paymentsOf(p, T.repeats(p) ? R.nextDate(p, today) ?? today : undefined); }
// Tutar harcamanın / hareketin varlığında: TL ise "₺1.250,00", değilse "$100,00", "12,5 gr"
function money(n, code = "TRY") { return code === "TRY" ? fmt(n) : fmtAsset(n, code); }

function dot(color) {
  const d = el("i", "dot");
  d.style.setProperty("--c", color);
  return d;
}

// Kartın renginde küçük, çizgi kart simgesi; nakitte nakit renginde banknot (kişiler nokta ile gösterilir)
function cardMark(id) {
  const m = icon(cardById(id) ? "card" : "cash", "cmark");
  m.style.setProperty("--c", cardColor(id));
  return m;
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

// Son ödemenin ayı; süresiz tekrarlayan TL harcaması varsa en az bir yıl ileri bakılır
function lastPaymentIndex() {
  let last = -Infinity;
  for (const p of knownPurchases()) {
    if (T.assetOf(p) !== "TRY") continue;
    const card = cardById(p.cardId);
    if (card && !B.tracked(card)) continue;   // hesaba katılmayan kart ödeme penceresini uzatmaz
    const list = paymentsOf(p);
    if (list.length) last = Math.max(last, list[list.length - 1].idx);
    if (T.endless(p)) last = Math.max(last, todayIndex() + 11);
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
  heroLabel: $("heroLabel"), heroAmount: $("heroAmount"), heroDebt: $("heroDebt"),
  nextLabel: $("nextLabel"), nextTotal: $("nextTotal"),
  remaining: $("remainingTotal"), endLabel: $("endLabel"),
  upcoming: $("upcomingList"), peopleSummary: $("peopleSummary"),
  timelineKind: $("timelineKind"), timelineMode: $("timelineMode"), timelineSum: $("timelineSum"),
  timelineRange: $("timelineRange"), timelineStart: $("timelineStart"),
  timelineCal: $("timelineCal"), timeline: $("timeline"),
  chartBy: $("chartBy"), legend: $("chartLegend"), chart: $("planChart"), chartEmpty: $("chartEmpty"),
  tooltip: $("chartTooltip"),
  cashRange: $("cashRange"), cashStart: $("cashStart"), cashMode: $("cashMode"), cashSum: $("cashSum"), cashChart: $("cashChart"), cashEmpty: $("cashEmpty"), cashNote: $("cashNote"),
  flowMode: $("flowMode"), flowList: $("flowList"), flowTable: $("flowTable"), table: $("planTable"),
  personFilter: $("personFilter"), purchaseWrap: $("purchaseWrap"), managePeople: $("managePeople"),
  purchaseTools: $("purchaseTools"), purchaseSort: $("purchaseSort"), inboxWrap: $("inboxWrap"),
  cardGrid: $("cardGrid"), addCard: $("addCard"),
  assetLabel: $("assetLabel"), assetTotal: $("assetTotal"), ratesNote: $("ratesNote"), rateStats: $("rateStats"),
  assetEqLine: $("assetEqLine"), assetEq: $("assetEq"), assetIncl: $("assetIncl"),
  entryFilter: $("entryFilter"), assetGrid: $("assetGrid"), holdWrap: $("holdWrap"), entryWrap: $("entryWrap"),
  assetPanel: $("assetPanel"), assetRange: $("assetRange"), assetSum: $("assetSum"), assetChart: $("assetChart"), assetNote: $("assetNote"),
  entrySheet: $("entrySheet"), entryForm: $("entryForm"), entryTitle: $("entryTitle"), entryDelete: $("entryDelete"),
  entryUnit: $("entryUnit"), assetChips: $("assetChips"), entryPersonChips: $("entryPersonChips"), entryPreview: $("entryPreview"),
  entryRepeat: $("entryRepeat"), entryDateLabel: $("entryDateLabel"), entryRepeatField: $("entryRepeatField"),
  entryInText: $("entryInText"), entryOutText: $("entryOutText"), entryTickerField: $("entryTickerField"),
  entryTickerLabel: $("entryTickerLabel"), entryTicker: $("entryTicker"), entryTickerList: $("entryTickerList"),
  entryTickerInfo: $("entryTickerInfo"), entryAmountLabel: $("entryAmountLabel"), entryPriceField: $("entryPriceField"),
  entrySettleText: $("entrySettleText"), entrySellOpt: $("entrySellOpt"), entryPriceLabel: $("entryPriceLabel"),
  debtTotal: $("debtTotal"), debtNote: $("debtNote"), debtEq: $("debtEq"), debtStats: $("debtStats"),
  trackNote: $("trackNote"), trackNoteText: $("trackNoteText"), trackNoteOk: $("trackNoteOk"),
  balanceHint: $("balanceHint"), balanceHintText: $("balanceHintText"), balanceHintBtn: $("balanceHintBtn"),
  debtSideSeg: $("debtSide"), debtWrap: $("debtWrap"), debtFoot: $("debtFoot"),
  debtSheet: $("debtSheet"), debtForm: $("debtForm"), debtTitle: $("debtTitle"), debtStatus: $("debtStatus"), debtStatusText: $("debtStatusText"),
  debtUnit: $("debtUnit"), debtAmountLabel: $("debtAmountLabel"), partyList: $("partyList"),
  debtPlanRow: $("debtPlanRow"), debtPlanVal: $("debtPlanVal"), debtMode: $("debtMode"), debtOnce: $("debtOnce"),
  debtPlan: $("debtPlan"), debtDueChips: $("debtDueChips"), debtCountChips: $("debtCountChips"), debtCountOther: $("debtCountOther"),
  debtAutoRow: $("debtAutoRow"), debtAutoText: $("debtAutoText"), debtAutoNote: $("debtAutoNote"),
  debtEffectRow: $("debtEffectRow"), debtEffectVal: $("debtEffectVal"), debtDateChips: $("debtDateChips"),
  debtMovedRow: $("debtMovedRow"), debtMovedText: $("debtMovedText"), debtPrincipalField: $("debtPrincipalField"),
  debtPrincipalUnit: $("debtPrincipalUnit"), debtAssetRow: $("debtAssetRow"), debtAssetVal: $("debtAssetVal"),
  debtAssetChips: $("debtAssetChips"), debtPersonRow: $("debtPersonRow"), debtPersonVal: $("debtPersonVal"),
  debtPersonChips: $("debtPersonChips"), debtNoteRow: $("debtNoteRow"), debtNoteVal: $("debtNoteVal"), debtPreview: $("debtPreview"),
  debtPays: $("debtPays"), debtPayList: $("debtPayList"), debtSum: $("debtSum"),
  debtDelete: $("debtDelete"), debtCloseBtn: $("debtCloseBtn"), debtPayBtn: $("debtPayBtn"),
  paySheet: $("paySheet"), payForm: $("payForm"), payTitle: $("payTitle"), payStatus: $("payStatus"), payUnit: $("payUnit"),
  payChips: $("payChips"), payDateChips: $("payDateChips"), payDueChip: $("payDueChip"),
  payHint: $("payHint"), payPreview: $("payPreview"),
  payHistory: $("payHistory"), payList: $("payList"),
  shareSheet: $("shareSheet"), shareHead: $("shareHead"), shareStats: $("shareStats"), shareItems: $("shareItems"),
  sharePaysBox: $("sharePaysBox"), sharePays: $("sharePays"), shareRemind: $("shareRemind"), sharePaid: $("sharePaid"),
  addLabel: $("addLabel"), fab: document.querySelector(".fab"),
  purchaseSheet: $("purchaseSheet"), purchaseForm: $("purchaseForm"), purchaseTitle: $("purchaseTitle"),
  purchaseDelete: $("purchaseDelete"), purchasePreview: $("purchasePreview"),
  countChips: $("countChips"), cardChips: $("cardChips"), personChips: $("personChips"), personField: $("personField"),
  purchaseSum: $("purchaseSum"), purchaseStatus: $("purchaseStatus"), purchaseCopy: $("purchaseCopy"),
  dateChips: $("dateChips"), descList: $("descList"), countOther: $("countOther"), perRow: $("perRow"), cardTip: $("cardTip"),
  dateRow: $("dateRow"), dateVal: $("dateVal"), categoryRow: $("categoryRow"), categoryVal: $("categoryVal"), personVal: $("personVal"),
  repeatRow: $("repeatRow"), repeatVal: $("repeatVal"), purchaseRepeat: $("purchaseRepeat"), assetRow: $("assetRow"), assetVal: $("assetVal"),
  purchaseAssetChips: $("purchaseAssetChips"), countField: $("countField"), cardField: $("cardField"),
  cardSheet: $("cardSheet"), cardForm: $("cardForm"), cardTitle: $("cardTitle"),
  cardDelete: $("cardDelete"), cardPreview: $("cardPreview"), cardHint: $("cardHint"), cardColors: $("cardColors"),
  cardDebt: $("cardDebt"), cardPayMode: $("cardPayMode"), trackPreview: $("trackPreview"),
  cardDebtLink: $("cardDebtLink"), cardPaysLink: $("cardPaysLink"),
  termField: $("termField"), termNote: $("termNote"), termChoices: $("termChoices"),
  eventSheet: $("eventSheet"), eventTitle: $("eventTitle"), eventDate: $("eventDate"), eventSplit: $("eventSplit"),
  eventItems: $("eventItems"), eventToFlow: $("eventToFlow"), eventState: $("eventState"), eventOk: $("eventOk"), eventPay: $("eventPay"),
  peopleSheet: $("peopleSheet"), peopleEdit: $("peopleEdit"), personAddForm: $("personAddForm"),
  settingsSheet: $("settingsSheet"), settingsBtn: $("settingsBtn"), themeSeg: $("themeSeg"),
  cashDefBtn: $("cashDefBtn"), cashDefText: $("cashDefText"), cashDefSheet: $("cashDefSheet"), cashDefList: $("cashDefList"),
  cashDefReset: $("cashDefReset"),
  inboxBtn: $("inboxBtn"), inboxSheet: $("inboxSheet"), inboxLoginNote: $("inboxLoginNote"), inboxSetup: $("inboxSetup"),
  inboxAddress: $("inboxAddress"),
  aiBtn: $("aiBtn"), aiSheet: $("aiSheet"), mcpUrl: $("mcpUrl"), aiLoginNote: $("aiLoginNote"),
  aiAppsGroup: $("aiAppsGroup"), aiApps: $("aiApps"),
  aiLocalTitle: $("aiLocalTitle"), aiLocalSub: $("aiLocalSub"), aiModeSeg: $("aiModeSeg"), aiProgress: $("aiProgress"),
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
// Kart ve nakit ödemeleri aylara göre (taksit.js buildCashflow). Hesaba katılmayan kartın (borc.js) ekstreleri ödeme
// toplamlarına girmez: ay, kişi ve kart toplamlarından çıkarılır, olay listede kalır (ignored: soluk, "hesaba katılmıyor")
function cashflow(fromIdx, toIdx) {
  const months = T.buildCashflow(state.people, state.cards, state.installments, fromIdx, toIdx);
  const off = new Set(state.cards.filter(c => !B.tracked(c)).map(c => c.id));
  if (!off.size) return months;
  // Etkilenen ayda toplamlar sayılan olaylardan yeniden toplanır (çıkarma yuvarlama kaydırırdı)
  return months.map(m => {
    if (!m.events.some(ev => off.has(ev.cardId))) return m;
    const out = { ...m, total: 0, byPerson: {}, byCard: { ...m.byCard } };
    out.events = m.events.map(ev => {
      if (off.has(ev.cardId)) { delete out.byCard[ev.cardId]; return { ...ev, ignored: true }; }
      out.total += ev.total;
      for (const [pid, v] of Object.entries(ev.byPerson)) out.byPerson[pid] = (out.byPerson[pid] || 0) + v;
      return ev;
    });
    return out;
  });
}

function render() {
  const start = T.monthIndex(currentMonth);
  const last = lastPaymentIndex();
  const end = Math.min(last, start + MAX_MONTHS - 1);
  const months = end >= start ? cashflow(start, end) : [];

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
  if (view === "borclar") { renderDebts(); loadRates(); }
  if (view === "varliklar") { renderAssets(); loadRates(); }

  const adding = view === "varliklar" ? "Hareket" : view === "borclar" ? (debtSide === "debt" ? "Borç" : "Alacak") : "Harcama";
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
  // Son taksit: ödenecek bir şey kalan son ay; süresiz tekrarlayan (hesaba katılan) harcama varsa bitmez
  const endless = knownPurchases().some(p => T.assetOf(p) === "TRY" && T.endless(p) && !(cardById(p.cardId) && !B.tracked(cardById(p.cardId))));
  const lastDue = [...months].reverse().find(m => m.total > EPS);
  els.endLabel.textContent = endless ? "Süresiz" : lastDue ? `${T.monthShort(lastDue.idx)} ${T.yearOf(lastDue.idx)}` : "—";
  // Ayın borç ve kredi ödemeleri ayrı satırda (yukarıdaki tutar yalnızca kart ve nakit ödemeleri); dokununca Borçlar
  const debtDue = dueSum(B.paymentsDue(state, T.todayKey(), T.dateKey(start, 1), T.dateKey(start, 31)), curRates());
  els.heroDebt.hidden = !(debtDue > EPS);
  els.heroDebt.textContent = `+ ${fmt(debtDue)} borç ödemesi ›`;

  renderInsights();
  renderCash();
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
  const list = I.insights(state, { today: T.todayKey(), rates: curRates(), cash: isCashCode });
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
  } else if (x.action.kind === "debt") {
    // borc-vade → Borçlarım, alacak → Alacaklarım
    debtSide = x.id === "alacak" ? "receivable" : "debt";
    debtClosedOpen = false;
    location.hash = "#borclar";
  }
}

els.insightMore.addEventListener("click", () => { insightsOpen = !insightsOpen; renderInsights(); });

// Ayın harcamaları kategoriye göre (harcama tarihine göre; taksitli alışveriş tamamıyla), önceki 3 ayın ortalamasıyla
function renderCategories(idx) {
  const b = I.categoryBreakdown(state, idx, curRates());
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
    + (loose && !YZ.enabled ? " Kategorisizleri yapay zekâ ayırabilir: Ayarlar → Yapay zekâ." : "");
}

// Kart / nakit ödemeleri ve borç / kredi ödemeleri tarih sırasıyla, ilk 4'ü; gecikmişler en üstte. Elle ödenen kartın
// ekstreleri borc.js'ten: ödenmiş ya da önceden ödenmiş olan düşer, ödenmemiş geçmiş ekstre "gecikti" ile kalır, ileriki
// ekstrenin kapanmamış kısmı (süresiz tekrarların ileriki tekrarları dahil: until ufku)
function renderUpcoming(last) {
  const today = T.todayKey();
  const from = todayIndex();
  const until = T.dateKey(from + 24, 31);
  const all = last >= from
    ? cashflow(from, Math.min(last, from + 24)).flatMap(m => m.events).filter(e => !e.ignored)   // hesaba katılmayan kart yok
    : [];
  const manual = new Map(state.cards.filter(c => manualCard(c, today)).map(c => [c.id, { card: c, cs: B.cardState(state, c, today, undefined, until) }]));
  const events = all.filter(e => e.date >= today && !(manual.has(e.cardId) && e.date >= manual.get(e.cardId).cs.manualFrom));
  const cards = [];
  for (const { card: c, cs } of manual.values()) {
    for (const x of cs.statements) {
      const open = x.amount - x.covered;
      if (x.auto || x.state === "paid" || open <= EPS || x.key > until) continue;
      const ev = all.find(e => e.cardId === c.id && e.date === x.key);
      cards.push({ date: x.key, late: x.state === "late", card: { card: c, x, open, ev } });
    }
  }
  const debts = B.paymentsDue(state, today, today, until).filter(f => !f.paid);
  const rows = [...events.map(ev => ({ date: ev.date, ev })), ...cards, ...debts.map(f => ({ date: f.date, late: !!f.late, f }))]
    .sort((a, b) => (b.late ? 1 : 0) - (a.late ? 1 : 0) || a.date.localeCompare(b.date)).slice(0, 4);
  els.upcoming.replaceChildren();
  if (!rows.length) {
    els.upcoming.append(el("li", "empty", state.installments.length || state.debts.length ? "Yaklaşan ödeme yok" : "Henüz harcama yok"));
    return;
  }
  for (const { ev, f, card } of rows) {
    if (f) { els.upcoming.append(debtPayRow(f, today, { relative: true })); continue; }
    if (card) { els.upcoming.append(cardDueRow(card, today)); continue; }
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

// Elle ödenen kartın ekstresi (Sıradaki ödemeler, ödeme satırı düzeninde): kapanmamış tutar; ödemesi gelmişse (gecikmiş ya
// da bugün) dokununca kartın ödeme formu, ileriki ekstrede ekstrenin ayrıntısı
function cardDueRow({ card: c, x, open, ev }, today) {
  const li = el("li", "pay clickable");
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.setAttribute("aria-haspopup", "dialog");
  const d = T.parseDate(x.key);
  const badge = el("div", "date-badge");
  badge.append(el("span", "d", String(d.day)), el("span", "w", WEEKDAYS[T.toDate(x.key).getDay()]));
  const main = el("div", "pay-main");
  const title = el("div", "pay-title");
  title.append(cardMark(c.id), document.createTextNode(c.name));
  const sub = el("div", "pay-sub");
  sub.append(el("span", "", x.state === "late" ? `son ödeme ${fmtDayShort(x.key)}` : x.state === "due" ? "Son gün bugün"
    : `${relDays(x.key, today)} · ${fmtDayShort(x.key)}`));
  if (x.state === "late") sub.append(el("span", "out-text", `${lateDays(x.key, today)} gün gecikti`));
  if (x.covered > EPS) sub.append(el("span", "", "kısmen ödendi · kalan"));
  main.append(title, sub);
  li.append(badge, main, el("div", "pay-amt", fmt(open)));
  const due = x.state === "late" || x.state === "due";
  const run = () => (due || !ev ? openPaySheet({ cardId: c.id, key: x.key }) : openEventSheet(ev));
  li.addEventListener("click", run);
  li.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); }
  });
  return li;
}

// Ödemeyi akışta açık ve görünür göster
function openEvent(ev) {
  const idx = T.parseDate(ev.date).idx;
  if (idx < T.monthIndex(currentMonth)) currentMonth = T.monthKey(idx);
  openEventKey = ev.key;
  pendingScroll = `ev-${ev.key}`;
  location.hash = "#akis";
}

// Girdi ve çıktıların dönemi (liste ve takvim): seçilen günden bir ay sonrasının bir gün öncesine; 1'i seçiliyse ayın
// tamamı. Bu ay seçiliyken bugünü içeren dönem, diğer aylarda ondan o kadar ay uzaktaki dönem.
function timelinePeriod(start, today) {
  const day = Number(timelineStart);
  if (day === 1) return { from: T.dateKey(start, 1), to: T.dateKey(start, 31), whole: true };
  const t = T.parseDate(today);
  const idx = start - (t.day < T.dayOf(t.idx, day) ? 1 : 0);
  return { from: T.dateKey(idx, day), to: T.addDays(T.dateKey(idx + 1, day), -1), whole: false };
}

// Dönemin (ayın ya da takvimde seçilen günden başlayan dönemin) girdi ve çıktıları gün gün: varlık hareketleri
// (giriş/çıkış) ve harcamalar alındıkları gün (taksitlisi tamamıyla, tekrarlayanın her tekrarı kendi gününde). Kart
// ödemeleri satır değil, ödeme gününün başlığında işarettir (dokununca ödemenin ayrıntısı); toplamlara girmez, harcamalar
// zaten sayılır. Borç akışları (alınan / verilen, ödeme, tahsilat, kredi taksiti, kart payı ödemesi) da işarettir ve
// toplama girmez: özvarlığı değiştirmezler. Toplama giren tek borç kalemi kredinin (borcun) faiz ve masrafıdır, çekildiği
// gün. Toplamlar TL'dir; döviz ve altın güncel kurla çevrilir, kuru bilinmeyen hareket toplama girmez.
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
  const r = curRates();
  const { from, to, whole } = timelinePeriod(start, today);
  const inPeriod = date => date >= from && date <= to;
  renderDayOptions(els.timelineStart, timelineStart);
  els.timelineRange.textContent = whole ? monthLong(start) : `${fmtDayShort(from)} – ${fmtDayShort(to)}`;
  // Tekrarlayan hareket döneme düşen tekrarlarının tarihiyle gelir; varlığı bilinmeyen hareket (içe aktarma) atlanır.
  // TL bakiyesine işlenen alış / satış (fon, hisse, döviz, altın) aktarımdır: borç hareketleri gibi para el değiştirir,
  // gelir ya da gider değildir; satır olarak görünür, toplama girmez. TL'ye işlenmeyen fon / hisse hareketi yoktur.
  const entries = [];
  for (const e of knownEntries()) {
    if (!V.asset(e.asset) || (V.market(e.asset) && !V.settled(e))) continue;
    for (const { date } of R.between(e, from, to)) entries.push({ e, date });
  }
  // Tarihi bilinmeyen (içe aktarılmış) harcama yalnızca kart ödemesinin içinde görünür
  const spends = [];
  for (const p of knownPurchases()) {
    if (!T.parseDate(p.date)) continue;
    const dates = T.repeats(p) ? R.between(p, from, to).map(x => x.date) : inPeriod(p.date) ? [p.date] : [];
    for (const date of dates) spends.push({ p, date });
  }
  const payDays = new Map();   // gün → o günün işaretleri: kart ekstreleri ({ ev, st }) ve borç akışları ({ flow })
  const mark = (date, x) => {
    if (!payDays.has(date)) payDays.set(date, []);
    payDays.get(date).push(x);
  };
  const statements = manualStatements(today, to);   // elle ödenen kartta ekstrenin durumu (işarette ödendi / ödenmedi)
  for (const m of cashflow(T.parseDate(from).idx, T.parseDate(to).idx)) {
    for (const ev of m.events) if (ev.cardId && inPeriod(ev.date)) mark(ev.date, { ev, st: statements.get(`${ev.cardId}|${ev.date}`) });
  }
  const flows = B.allFlows(state, today, from, to);
  for (const f of flows) mark(f.date, { flow: f });
  // Faiz ve masraf: çekilen tutarla geri ödenecek arasındaki fark (borçta çıktı, alacakta girdi)
  const costs = B.known(state).items.filter(d => d.principal > 0 && Math.abs(d.amount - d.principal) > EPS && inPeriod(d.date));
  if (entries.some(x => x.e.asset !== "TRY") || spends.some(x => T.assetOf(x.p) !== "TRY")
    || flows.some(f => f.asset !== "TRY") || costs.some(d => d.asset !== "TRY")) loadRates();

  const entryRank = new Map(state.entries.map((e, i) => [e.id, i]));
  const spendRank = new Map(state.installments.map((p, i) => [p.id, state.entries.length + i]));
  const items = [
    ...entries.map(({ e, date }) => (V.settled(e)
      ? { kind: "move", date, entry: e, value: 0, rank: entryRank.get(e.id) }
      : { kind: e.amount > 0 ? "in" : "out", date, entry: e, value: V.toTry(e.amount, e.asset, r), rank: entryRank.get(e.id) })),
    ...spends.map(({ p, date }) => {
      const amount = T.originalTotal(p);
      return { kind: "out", date, purchase: p, amount, value: V.toTry(-amount, T.assetOf(p), r), rank: spendRank.get(p.id) };
    }),
    ...costs.map((d, i) => {
      const amount = -B.sign(d) * (d.amount - d.principal);   // işaretli, borcun varlığında
      return { kind: amount < 0 ? "out" : "in", date: d.date, debt: d, amount, value: V.toTry(amount, d.asset, r),
        rank: state.entries.length + state.installments.length + i };
    }),
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
  // Süzgeçte kart ödemesi çıktıdır; borç akışı yönüne göre (alınan borç, tahsilat girdi; ödeme, verilen borç çıktı)
  const pays = new Map();
  for (const [date, list] of payDays) {
    const keep = list.filter(x => timelineKind === "all" || (x.ev ? "out" : x.flow.amount > 0 ? "in" : "out") === timelineKind);
    if (keep.length) pays.set(date, keep);
  }
  if (timelineMode === "calendar") { renderCalendar(from, to, whole, shown, pays, today, r); return; }
  if (!shown.length && !pays.size) {
    const when = whole ? "Bu ay" : "Bu dönemde";
    const text = `${when} ${timelineKind === "in" ? "girdi" : timelineKind === "out" ? "çıktı" : "hareket"} yok`;
    els.timeline.append(el("li", "empty", text));
    return;
  }

  // Bugün bu dönemin içindeyse bugünden sonraki ilk günün önüne "Bugün" çizgisi
  let nowPlaced = !inPeriod(today);
  const days = new Map();
  for (const it of shown) {
    if (!days.has(it.date)) days.set(it.date, []);
    days.get(it.date).push(it);
  }
  for (const date of [...new Set([...days.keys(), ...pays.keys()])].sort()) {
    if (!nowPlaced && date > today) {
      els.timeline.append(timelineNow(today));
      nowPlaced = true;
    }
    if (date === today) nowPlaced = true;
    const list = days.get(date) || [];
    const day = el("li", "tl-day" + (date > today ? " planned" : "") + (list.length ? "" : " tl-none"));
    day.append(timelineDayHead(date, today, pays.get(date)));
    if (list.length) {
      const ul = el("ul", "tl-items");
      for (const it of list) ul.append(timelineItem(it, today, r));
      day.append(ul);
    }
    els.timeline.append(day);
  }
  if (!nowPlaced) els.timeline.append(timelineNow(today));
}

// Başlangıç günü seçenekleri: ayın her günü
function renderDayOptions(select, value) {
  if (select.options.length !== 31) {
    select.replaceChildren(...Array.from({ length: 31 }, (_, i) => {
      const o = el("option", "", `Ayın ${dayWithSuffix(i + 1)}`);
      o.value = String(i + 1);
      return o;
    }));
  }
  select.value = value;
}

// Takvim: günlerde o günün girdi/çıktı toplamı; seçili günün hareketleri altta. Dönem iki aya yayılıyorsa yeni ayın
// ilk gününde ayın adı yazar.
function renderCalendar(from, to, whole, shown, pays, today, r) {
  const byDay = new Map();
  for (const it of shown) {
    if (!byDay.has(it.date)) byDay.set(it.date, []);
    byDay.get(it.date).push(it);
  }
  if (!(timelineDay >= from && timelineDay <= to)) {
    timelineDay = today >= from && today <= to ? today : shown[0]?.date ?? from;
  }

  const grid = el("div", "cal-grid");
  for (const w of CAL_WEEKDAYS) grid.append(el("span", "cal-wd", w));
  const offset = (T.toDate(from).getDay() + 6) % 7;
  for (let i = 0; i < offset; i++) grid.append(el("span", "cal-pad"));
  for (let key = from; key <= to; key = T.addDays(key, 1)) {
    const { idx, day: d } = T.parseDate(key);
    const list = byDay.get(key) || [];
    let inSum = 0, outSum = 0, unknown = false;
    for (const it of list) {
      if (it.value == null) unknown = true;
      else if (it.value > 0) inSum += it.value;
      else outSum -= it.value;
    }
    const paid = pays.get(key) || [];
    const selected = key === timelineDay;
    const b = el("button", "cal-day" + (key === today ? " today" : "") + (selected ? " selected" : "") + (key > today ? " planned" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(selected));
    const payText = paid.map(({ ev, st, flow }) => (ev ? `${cardName(ev.cardId)} ekstresi ${fmt(ev.total)}`
        + (ev.ignored ? " (hesaba katılmıyor)" : stateTag(st) ? ` (${stateTag(st)})` : "")
      : `${flowLabel(flow)} ${flowMoney(flow)}`));
    b.setAttribute("aria-label", `${fmtDayShort(key)}: ` + (list.length || paid.length
      ? [inSum && `girdi ${fmt(inSum)}`, outSum && `çıktı ${fmt(outSum)}`, unknown && "kuru bilinmeyen hareket", ...payText].filter(Boolean).join(", ")
      : "hareket yok"));
    if (paid.length) b.title = payText.join("\n");   // üzerine gelince o günün kart ödemeleri ve borç akışları
    const n = el("span", "cal-n", !whole && (key === from || d === 1) ? `${d} ${T.monthShort(idx)}` : String(d));
    b.append(n);
    if (paid.length) {
      const marks = el("span", "cal-pay");
      for (const { ev, flow } of paid) marks.append(ev ? cardMark(ev.cardId) : flowMark(flow));
      b.append(marks);
    }
    if (inSum) b.append(el("span", "cal-v in-text", "+" + fmtShort(inSum)));
    if (outSum) b.append(el("span", "cal-v out-text", "−" + fmtShort(outSum)));
    if (unknown && !inSum && !outSum) b.append(el("span", "cal-v", "•"));
    b.addEventListener("click", () => { timelineDay = key; render(); els.timelineCal.querySelector(".cal-day.selected")?.focus(); });
    grid.append(b);
  }
  els.timelineCal.replaceChildren(grid);

  const list = byDay.get(timelineDay) || [];
  const day = el("li", "tl-day" + (timelineDay > today ? " planned" : ""));
  day.append(timelineDayHead(timelineDay, today, pays.get(timelineDay)));
  if (list.length) {
    const ul = el("ul", "tl-items");
    for (const it of list) ul.append(timelineItem(it, today, r));
    day.append(ul);
  } else {
    day.classList.add("tl-none");
    if (!pays.has(timelineDay)) day.append(el("p", "tl-empty", timelineKind === "in" ? "Bu gün girdi yok" : timelineKind === "out" ? "Bu gün çıktı yok" : "Bu gün hareket yok"));
  }
  els.timeline.append(day);
}

// Günün başlığı: tarih, bugünse etiket; o gün ödenen kart ekstreleri işaret olarak (dokununca ödemenin ayrıntısı:
// kime ne kadar düştüğü ve içindeki harcamalar; elle ödenen kartta ödendi / ödenmedi rozeti) ve borç akışları (dokununca
// borcun ya da kart payının penceresi)
function timelineDayHead(date, today, pays = []) {
  const head = el("div", "tl-date");
  head.append(el("span", "", `${fmtDayShort(date)} · ${WEEKDAYS[T.toDate(date).getDay()]}`));
  if (date === today) head.append(el("span", "tl-tag", "Bugün"));
  for (const { ev, st, flow: f } of pays) {
    const b = el("button", "tl-pay");
    b.type = "button";
    b.setAttribute("aria-haspopup", "dialog");
    if (ev) {
      b.title = [...new Set(ev.items.map(i => i.purchase.desc))].join(", ");
      if (ev.ignored) b.classList.add("ignored");
      // Durum: ödendi / son gün bugün / gecikti; yalnızca gecikti kırmızı. Hesaba katılmayan kartta etiket. Etiket varken
      // ad yalın kart adı (dar ekranda ad kırpılmasın; tam adı ipucunda)
      const tag = ev.ignored ? "hesaba katılmıyor" : stateTag(st);
      b.title = `${cardName(ev.cardId)} ekstresi — ${b.title}`;
      b.append(cardMark(ev.cardId), el("span", "tl-pay-name", tag ? cardName(ev.cardId) : `${cardName(ev.cardId)} ekstresi`));
      if (tag) b.append(el("span", "tl-state" + (ev.ignored ? "" : st.state === "paid" ? " paid" : st.state === "late" ? " late" : ""), tag));
      b.append(el("span", "amount", fmt(ev.total)));
      b.addEventListener("click", () => openEventSheet(ev));
    } else {
      b.append(flowMark(f), el("span", "tl-pay-name", flowLabel(f)), el("span", "amount" + (f.amount > 0 ? " in" : ""), flowMoney(f)));
      b.addEventListener("click", () => openFlow(f));
    }
    head.append(b);
  }
  return head;
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
    const m = V.market(e.asset);
    title.textContent = entryTitle(e);
    if (state.people.length > 1) {
      const who = el("span", "who");
      who.append(dot(seriesVar(person)), document.createTextNode(person.name));
      sub.append(who);
    }
    sub.append(el("span", "", m ? V.MARKETS[m.market].name : V.asset(e.asset).name));
    if (V.settled(e)) {
      // Aktarım (TL bakiyesine işlenen alış / satış): miktar ve TL tutarı, toplama girmez
      side.append(el("span", "amount", m ? `${fmtAsset(e.amount, e.asset, true)} ${m.ticker}` : fmtAsset(e.amount, e.asset, true)));
      side.append(el("small", "", `aktarım · ${fmt(Math.abs(V.settled(e)))} ${e.amount > 0 ? "TL'den" : "TL'ye"}`));
    } else {
      side.append(el("span", "amount", fmtAsset(e.amount, e.asset, true)));
      if (e.asset !== "TRY") side.append(el("small", "", it.value == null ? "kur yok" : `≈ ${fmt(Math.abs(it.value))}`));
    }
    open = () => openEntrySheet(e);
  } else if (it.debt) {
    // Kredinin (borcun) faiz ve masrafı: çekildiği gün özvarlıktan bir kez düşer; alacakta faiz girdidir
    const d = it.debt;
    const person = personById(d.personId);
    title.textContent = d.kind === "loan" ? (d.party ? `${d.party} kredisi` : "Kredi") : debtName(d);
    if (state.people.length > 1) {
      const who = el("span", "who");
      who.append(dot(seriesVar(person)), document.createTextNode(person.name));
      sub.append(who);
    }
    sub.append(el("span", "", B.side(d) === "debt" ? "faiz ve masraf" : "faiz"));
    side.append(el("span", "amount", (it.amount < 0 ? "−" : "+") + money(Math.abs(it.amount), d.asset)));
    if (d.asset !== "TRY") side.append(el("small", "", it.value == null ? "kur yok" : `≈ ${fmt(Math.abs(it.value))}`));
    open = () => openDebtSheet(d);
  } else {
    // Harcama alındığı gün: kartı (ya da nakit / döviz / altın), taksitliyse taksit sayısı
    const p = it.purchase;
    const code = T.assetOf(p);
    const person = personById(p.personId);
    title.textContent = p.desc;
    if (state.people.length > 1) {
      const who = el("span", "who");
      who.append(dot(seriesVar(person)), document.createTextNode(person.name));
      sub.append(who);
    }
    const card = cardById(p.cardId);
    const how = el("span", "who");
    how.append(cardMark(p.cardId), document.createTextNode(card ? card.name : code === "TRY" ? "Nakit" : V.asset(code).name));
    sub.append(how);
    if (T.planLength(p) > 1) sub.append(el("span", "", `${T.planLength(p)} taksit`));
    side.append(el("span", "amount", "−" + money(it.amount, code)));
    if (code !== "TRY") side.append(el("small", "", it.value == null ? "kur yok" : `≈ ${fmt(Math.abs(it.value))}`));
    open = () => openPurchaseSheet(p);
  }

  main.append(title, sub);
  li.append(el("span", "tl-mark"), main, side);
  li.addEventListener("click", open);
  onTap(li, open);
  li.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });
  return li;
}

// Dokunmatikte kısa dokunuş: iOS Safari çizelge satırlarında dokunuşa click üretmeyebiliyor (ancak basılı tutunca
// açılıyordu). Parmak kıpırdamadan kısa sürede kalkınca run çalışır; touchend önlendiği için ardından click gelmez.
// Sayfa kayarken (ya da kaymayı durdurmak için) yapılan dokunuş sayılmaz.
let lastScroll = 0;
document.addEventListener("scroll", () => { lastScroll = performance.now(); }, { passive: true, capture: true });

function onTap(node, run) {
  let start = null;
  node.addEventListener("touchstart", e => {
    const t = e.touches[0];
    start = e.touches.length === 1 && performance.now() - lastScroll > 150
      ? { x: t.clientX, y: t.clientY, at: performance.now() } : null;
  }, { passive: true });
  node.addEventListener("touchmove", e => {
    const t = e.touches[0];
    if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) start = null;
  }, { passive: true });
  node.addEventListener("touchcancel", () => { start = null; });
  node.addEventListener("touchend", e => {
    const s = start;
    start = null;
    if (!s || performance.now() - s.at > 600 || s.at < lastScroll) return;
    const t = e.changedTouches[0];
    if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) return;
    e.preventDefault();
    run();
  });
}

// ---------- Ödeme ayrıntısı (zaman çizelgesinden) ----------
// Kişilere dağılım halka grafikte (renk kişinin rengi, sabit sıra) ve yanında tutar / yüzde listesi;
// altında ödenen taksitler kişi kişi. Dilime ya da listedeki kişiye gelince / dokununca ortada o kişinin payı yazar.
// Ekstrenin durumu üstte (eventStatus); "Ben işaretlerim" kartında kapanmamış, kesilmiş ekstrede Ödendi.
let sheetEvent = null;

// Ekstrenin durumu, kartın ekstre ödemesine göre { text, x? }: "Ben işaretlerim"de borc.js'in tutarlarıyla (ödendi,
// kısmen, gecikti, son gün bugün; günü gelmemişte kesildi / kesilmedi ve ne yapılacağı), otomatikte ne zaman ödenmiş
// sayıldığı ya da sayılacağı, hesaba katılmayan kartta ve takipten önceki ekstrede bakiyeyi etkilemediği. Nakitte boş.
function eventStatus(card, ev, today) {
  if (!card) return { text: "" };
  if (!B.tracked(card)) return { text: "Bu kart hesaba katılmıyor: ekstre TL bakiyeni etkilemez." };
  if (ev.date < B.since(card, today)) return { text: "Kart hesaba katılmadan önceki ekstre: TL bakiyeni etkilemez." };
  const x = manualCard(card, today)
    ? B.cardState(state, card, today, undefined, ev.date).statements.find(y => y.key === ev.date && !y.auto) : null;
  if (x) {
    const open = T.statementOf(card, today);
    return { x, text: statementText(x, today) || (x.key < open.due
      ? `Ekstre kesildi · son ödeme ${fmtDayShort(x.key)}. Ödeyince “Ödendi”ye dokun.`
      : `Ekstre henüz kesilmedi${x.key === open.due ? ` · kesim ${fmtDayShort(open.cut)}` : ""} · son ödeme ${fmtDayShort(x.key)}.`) };
  }
  // "Ben işaretlerim" ileride başlıyorsa (bugün ödeme varken geçildi, startDay) o günden sonraki ekstreler Ödendi bekler
  const since = B.since(card, today);
  const from = B.manual(card) ? (card.manualSince > since ? card.manualSince : since) : null;
  if (from && from > today && ev.date >= from) {
    return { text: `“Ben işaretlerim” ${from === T.addDays(today, 1) ? "yarın" : `${fmtDayShort(from)} günü`} başlar · `
      + `son ödeme ${fmtDayShort(ev.date)}. Ödeyince “Ödendi”ye dokun.` };
  }
  const paidOn = T.addDays(ev.date, 1);
  return { text: ev.date < today ? `Ödenmiş sayıldı: ${fmtDayShort(paidOn)} günü TL bakiyenden düştü.`
    : ev.date === today ? "Son gün bugün. Yarın ödenmiş sayılır ve TL bakiyenden düşer."
    : `Son ödeme ${fmtDayShort(ev.date)}. ${fmtDayShort(paidOn)} günü ödenmiş sayılır ve TL bakiyenden düşer.` };
}

function openEventSheet(ev) {
  sheetEvent = ev;
  const today = T.todayKey();
  els.eventTitle.replaceChildren(cardMark(ev.cardId), document.createTextNode(ev.cardId ? `${cardName(ev.cardId)} ekstresi` : "Nakit ödemeler"));
  els.eventDate.textContent = `${WEEKDAYS[T.toDate(ev.date).getDay()]}, ${fmtDay(ev.date)} · ${relDays(ev.date, today)}`;
  const card = cardById(ev.cardId);
  const { text, x } = eventStatus(card, ev, today);
  els.eventState.hidden = !text;
  els.eventState.textContent = text;
  els.eventState.className = "p-status" + (x?.state === "late" ? " late" : x?.state === "paid" ? " paid" : "");
  const pay = !!x && x.amount - x.covered > EPS && x.key < T.statementOf(card, today).due;
  els.eventPay.hidden = !pay;
  els.eventPay.setAttribute("aria-label", `${card?.name ?? ""} ekstresini ödendi olarak işaretle`);
  els.eventOk.classList.toggle("btn-primary", !pay);
  els.eventOk.classList.toggle("btn-ghost", pay);

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
els.eventPay.addEventListener("click", () => {
  els.eventSheet.close();
  if (sheetEvent?.cardId) openPaySheet({ cardId: sheetEvent.cardId, key: sheetEvent.date });
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
    li.append(main, el("span", "amount", fmt(amount)), icon("right"));
    editsPurchase(li, purchase, () => els.eventSheet.close());
    return li;
  });
}

// İlk kişi uygulamayı kullanan; diğerlerine (aile üyesi ya da kartını kullanan) ayın ödeme özeti gönderilebilir.
// Takipteki kartta payı olan kişide alt satır alacaktır (ödemesi gelen ya da geciken kısmıyla); dokununca kart payı
// penceresi açılır.
function renderPeopleSummary(months, start) {
  const thisMonth = months.find(m => m.idx === start);
  const today = T.todayKey();
  const shares = B.shares(state, today);
  els.peopleSummary.replaceChildren();
  state.people.forEach((p, i) => {
    const remaining = months.reduce((s, m) => s + (m.byPerson[p.id] || 0), 0);
    const due = thisMonth?.byPerson[p.id] || 0;
    const s = i > 0 ? shares.get(p.id) : null;
    const li = el("li");
    const info = el("div");
    info.append(el("div", "name", p.name), el("div", "sub", s ? shareSub(s, today) : remaining ? `kalan ${fmt(remaining)}` : "kalan yok"));
    li.append(avatar(p), info, el("div", "amount", fmt(due)));
    if (i > 0 && due > 0) {
      const b = el("button", "icon-btn sm share-btn");
      b.type = "button";
      b.setAttribute("aria-label", `${p.name} için ${T.monthName(start)} ödeme özetini gönder`);
      b.title = "Ödeme özetini gönder";
      b.append(icon("share"));
      b.addEventListener("click", e => { e.stopPropagation(); sharePerson(p, start); });
      li.append(b);
    }
    if (s) {
      li.classList.add("clickable");
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-haspopup", "dialog");
      li.addEventListener("click", () => openShareSheet(p.id));
      li.addEventListener("keydown", e => {
        if (e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openShareSheet(p.id); }
      });
    }
    els.peopleSummary.append(li);
  });
}

// Kart payının özeti: "alacak ₺3.000,00 · ₺1.000,00 gecikti" (ödeme günü geçmiş, ödenmemiş) ya da "· ödemesi gelen
// ₺1.000,00" (bugün); fazla ödediyse ne kadar
function shareSub(s, today) {
  if (s.remaining < -EPS) return `sana ${fmt(-s.remaining)} fazla ödedi`;
  if (s.remaining <= EPS) return "sana borcu yok";
  const late = shareLate(s, today);
  const tail = late > EPS ? ` · ${fmt(late)} gecikti` : s.dueNow > EPS ? ` · günü bugün ${fmt(s.dueNow)}` : "";
  return `sana borcu ${fmt(s.remaining)}${tail}`;
}

// Kişinin kartındaki harcamalarından son ödeme günü geçmiş, sana ödenmemiş kısmı (borc.js shares)
function shareLate(s, today) {
  return s.lines.filter(x => x.key < today).reduce((t, x) => t + x.amount, 0) - s.settled;
}

// "Merhaba Ali, Ekim 2026 ödemelerin: …" — taksit taksit, kart ve tarihle; kalan toplam
function shareText(person, idx) {
  const last = lastPaymentIndex();
  const months = cashflow(idx, Math.max(idx, last));
  const lines = [];
  for (const ev of months[0].events) {
    if (ev.ignored) continue;   // hesaba katılmayan kart
    for (const it of ev.items) {
      if (it.purchase.personId !== person.id) continue;
      const plan = T.planLength(it.purchase);
      lines.push(`• ${it.purchase.desc}${plan > 1 ? ` (${it.no}/${plan}. taksit)` : ""}: ${fmt(it.amount)} — ${cardName(ev.cardId)}, ${fmtDayShort(ev.date)}`);
    }
  }
  const rest = months.slice(1).reduce((s, m) => s + (m.byPerson[person.id] || 0), 0);
  // Hesaba katılan kartlardaki harcamalarından bana ödediği ve kalan
  const share = B.shares(state, T.todayKey()).get(person.id);
  const left = fmt(Math.max(share?.remaining ?? 0, 0));
  return [`Merhaba ${person.name}, ${monthLong(idx)} ödemelerin:`, ...lines, `Bu ay toplam: ${fmt(months[0].byPerson[person.id] || 0)}`,
    rest ? `Sonraki aylarda: ${fmt(rest)}` : null,
    share ? (share.settled > EPS ? `Kartımdaki harcamalarından bana ödediğin: ${fmt(share.settled)} · Kalan borcun: ${left}`
      : `Kartımdaki harcamalarından kalan borcun: ${left}`) : null].filter(Boolean).join("\n");
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
  const li = el("li", "pay" + (ev.date < today ? " past" : "") + (ev.ignored ? " ignored" : ""));
  const d = T.parseDate(ev.date);
  const badge = el("div", "date-badge");
  badge.append(el("span", "d", String(d.day)), el("span", "w", WEEKDAYS[T.toDate(ev.date).getDay()]));

  const main = el("div", "pay-main");
  const title = el("div", "pay-title");
  title.append(cardMark(ev.cardId), document.createTextNode(cardName(ev.cardId)));
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
  if (ev.ignored) sub.append(el("span", "", "hesaba katılmıyor"));
  main.append(title, sub);

  const amt = el("div", "pay-amt", fmt(ev.total));
  if (expandable) amt.append(icon("down"));
  li.append(badge, main, amt);
  return li;
}

// ---------- Chart ----------
function chartSeries(months) {
  if (chartBy === "card") {
    const list = state.cards.filter(B.tracked).map(c => ({ name: c.name, color: seriesVar(c), value: m => m.byCard[c.id] || 0 }));
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

// ---------- Nakit (dönem dönem) ----------
// Dönem başlangıç gününden (bugün ya da ayın seçilen günü, ör. maaş günü) bir ay sonrasının bir gün öncesine kadar sürer.
// Hareketler: bütün varlık hareketleri (tekrarlayanın her tekrarı kendi gününde; döviz ve altın güncel kurla TL; fon ve
// hisse nakit sayılmaz, yalnızca TL bakiyesine işlenen alış / satış tutarı), kart /
// nakit ödemeleri, döviz / altın harcamaları ve borç akışları (borç alma / verme, ödeme, tahsilat, kredi taksiti, kart payı
// ödemesi; borc.js). Takipteki kartlarda takipten sonraki ekstreler borc.js'in kart hareketleridir (cardMoves:
// kendiliğinden ödenen ekstre, Ödendi ile kaydedilen kart ödemesi, ön ödeme, bugünde ödenmemiş ekstreler, ileriki ekstrenin
// kapanmamış kısmı); takip dışı kartlar ve takipten önceki ekstreler ekstre günündeki ödemedir. Varlık bugüne bağlanır:
// bugünün sonu = bugüne kadarki toplam varlık (bugün ödenen kartsız harcamalar, borç etkileri ve takipteki kartların
// ödenen ekstreleri düşülmüş; Varlıklar'daki bakiyeler, fon ve hisse hariç) − bugün ödenecek ya da ödenmemiş kart ekstreleri, kredi taksitleri
// ve beklenen borç ödemeleri (henüz ödenmedi sayılır). Sonraki günler
// hareketlerle ileri, önceki günler geri taşınır; tarihi gelmemiş tek seferlik hareket de kendi gününde girer. Kuru
// bilinmeyen varlık hiç sayılmaz (missing). Dönem net'i dönem başından o güne hareketlerin toplamıdır.

// Seçili başlangıçla bugünün dönemi; shift dönem kaydırır
function cashPeriod(today, start, shift) {
  const t = T.parseDate(today);
  let idx = t.idx, day = t.day;
  if (start !== "today") {
    day = Number(start);
    if (t.day < T.dayOf(idx, day)) idx--;
  }
  idx += shift;
  return { from: T.dateKey(idx, day), to: T.addDays(T.dateKey(idx + 1, day), -1) };
}

function cashSeries(from, to, today) {
  const lo = from < today ? from : today, hi = to > today ? to : today;
  const loIdx = T.parseDate(lo).idx, hiIdx = T.parseDate(hi).idx;
  const moves = new Map();   // tarih → [{ desc, value }]
  const add = (date, m) => {
    if (!moves.has(date)) moves.set(date, []);
    moves.get(date).push(m);
  };

  const r = curRates();
  const missing = new Set();
  const toTry = (amount, code) => {
    const v = V.toTry(amount, code, r);
    if (v == null) missing.add(code);
    return v;
  };
  // Yalnızca nakit sayılan varlıklar (Ayarlar → Nakit: varsayılan TL ve para piyasası fonları); kart ekstreleri ve
  // nakit taksitler TL'dir
  const cash = code => isCashCode(code);
  const lira = cash("TRY");
  let anchor = 0, any = false;   // anchor: bugüne kadarki nakit, TL (bugünkü hareketler dahil)
  for (const e of knownEntries()) {
    if (!V.asset(e.asset) || !Number.isFinite(e.amount)) continue;
    // TL bakiyesine işlenen fon / hisse alışı ya da satışı TL hareketidir. Fon da nakitse (para piyasası fonu) ikisi tek
    // harekettir: TL'den nakit fona geçiş nakdi yalnızca bugünkü fiyatla alış fiyatı arasındaki fark kadar değiştirir.
    const settled = lira ? -V.settled(e) : 0;
    const own = cash(e.asset);
    if (!own && !settled) continue;
    any = true;
    const value = own ? toTry(e.amount, e.asset) : 0;
    if (value == null && !settled) continue;
    const v = (value ?? 0) + settled;
    // Nakitten nakde alış / satışta kalan bugünkü değerle işlem tutarı arasındaki farktır
    const desc = settled && own ? `${entryTitle(e)} (fiyat farkı)` : entryTitle(e);
    if (V.repeatOf(e) == null) {
      if (e.date <= today) anchor += v;
      if (e.date >= lo && e.date <= hi && Math.abs(v) > EPS) add(e.date, { desc, value: v });
      continue;
    }
    anchor += v * V.processedCount(e, today);
    for (const { date } of R.between(e, lo, hi)) add(date, { desc: e.desc, value: v });
  }
  // Kartsız harcamalar ödendikçe varlıktan düşmüştür (bugünkü dahil); kart ödemesi bugün henüz ödenmedi sayılır
  for (const [code, amount] of Object.entries(T.cashSpent(knownPurchases(), state.cards, today))) if (cash(code)) anchor -= toTry(amount, code) ?? 0;
  // Borç etkileri de düşmüştür (takipteki kartların ödenen ekstreleri dahil: aşağıdaki kart hareketleri o günlerin
  // hareketidir, ikinci kez düşülmez)
  for (const [code, amount] of Object.entries(B.debtSpent(state, today))) if (cash(code)) anchor -= toTry(amount, code) ?? 0;
  const since = new Map(state.cards.filter(B.tracked).map(c => [c.id, B.since(c, today)]));
  for (const m of lira ? cashflow(loIdx, hiIdx) : []) {
    for (const ev of m.events) {
      // Hesaba katılmayan kartın ekstresi TL bakiyesinden düşmez
      if (ev.ignored || ev.date < lo || ev.date > hi || (since.has(ev.cardId) && ev.date >= since.get(ev.cardId))) continue;
      if (ev.date === today && ev.cardId) anchor -= ev.total;
      add(ev.date, { desc: ev.cardId ? `${cardName(ev.cardId)} ekstresi` : "Nakit ödemeler", value: -ev.total });
    }
  }
  // Bugünkü planlı kart hareketi (bugün ödenecek ya da ödenmemiş ekstre) henüz düşmedi: gün sonunda düşer
  for (const mv of lira ? B.cardMoves(state, today, lo, hi, hi) : []) {
    const c = cardById(mv.cardId);
    if (mv.planned && mv.date === today) anchor += mv.amount;
    const desc = mv.type === "payment" ? `${c.name} · kart ödemen` : mv.type === "prepay" ? `${c.name} · erken ödeme`
      : mv.type === "unpaid" && manualCard(c, today)
        ? `${c.name} · ödenmemiş ekstre${B.cardDebt(state, c, today).overdue > EPS ? " (gecikti)" : ""}` : `${c.name} ekstresi`;
    add(mv.date, { desc, value: mv.amount });
  }
  // Borç akışları kendi günlerinde; bugünkü kredi taksiti ve beklenen ödemeler kart ekstresi gibi gün sonunda düşer
  for (const f of B.allFlows(state, today, lo, hi)) {
    if (!cash(f.asset)) continue;
    any = true;
    if (f.type === "plan" && !f.paid && f.date === today && f.amount > 0) continue;   // gecikmiş / bugünkü tahsilat henüz yok
    const value = toTry(f.amount, f.asset);
    if (value == null) continue;
    if (f.date === today && !f.paid) anchor += value;
    add(f.date, { desc: flowLabel(f), value });
  }
  // Döviz / altın harcamaları TL akışında yok: kendi varlıklarından düşer
  for (const p of knownPurchases()) {
    const code = T.assetOf(p);
    if (code === "TRY" || !cash(code)) continue;
    for (const x of paymentsOf(p, hi)) {
      if (x.key < lo || x.key > hi) continue;
      const value = toTry(-x.amount, code);
      if (value != null) add(x.key, { desc: p.desc, value });
    }
  }
  if (missing.size || knownEntries().some(e => e.asset !== "TRY")) loadRates();   // fon bilgisi de (para piyasası fonu mu)

  const sum = date => (moves.get(date) || []).reduce((s, m) => s + m.value, 0);
  const r2 = v => Math.round(v * 100) / 100;
  const end = new Map([[today, anchor]]);   // gün sonu bakiyeleri
  for (let d = T.addDays(today, 1), v = anchor; d <= hi; d = T.addDays(d, 1)) end.set(d, v += sum(d));
  for (let d = today, v = anchor; d > lo; d = T.addDays(d, -1)) end.set(T.addDays(d, -1), v -= sum(d));

  const days = [];
  let net = 0, inSum = 0, outSum = 0;
  for (let d = from; d <= to; d = T.addDays(d, 1)) {
    const list = moves.get(d) || [];
    for (const m of list) {
      net += m.value;
      if (m.value > 0) inSum += m.value; else outSum -= m.value;
    }
    days.push({ date: d, balance: r2(end.get(d)), net: r2(net), moves: list });
  }
  const before = r2(end.get(from) - sum(from));   // dönem başlamadan önceki bakiye
  return { days, before, inSum: r2(inSum), outSum: r2(outSum), any: any || inSum > 0 || outSum > 0, missing: [...missing] };
}

// Ayın günü iyelik ekiyle: 1'i, 6'sı, 15'i, 20'si, 30'u
function dayWithSuffix(n) {
  const last = n % 10;
  const suffix = last ? ["i", "si", "ü", "ü", "i", "sı", "si", "i", "u"][last - 1] : n === 20 ? "si" : "u";
  return `${n}'${suffix}`;
}

// Başlangıç seçenekleri: bugün, süren tekrarlayan TL girişlerinin günleri (en büyük 3), ayın her günü
function renderCashStart(today) {
  const incomes = knownEntries()
    .filter(e => e.asset === "TRY" && e.amount > 0 && V.repeatOf(e) != null && R.unit(e) === "month" && V.nextDate(e, today))
    .sort((a, b) => b.amount - a.amount);
  const seen = new Set(), opts = [];
  for (const e of incomes) {
    const day = T.parseDate(e.date)?.day;
    if (!day || seen.has(day)) continue;
    seen.add(day);
    opts.push([String(day), `${e.desc} · ${dayWithSuffix(day)}`]);
    if (opts.length === 3) break;
  }
  const option = ([value, text]) => {
    const o = el("option", "", text);
    o.value = value;
    return o;
  };
  const group = (label, list) => {
    const g = el("optgroup");
    g.label = label;
    g.append(...list.map(option));
    return g;
  };
  const days = Array.from({ length: 31 }, (_, i) => [String(i + 1), `Ayın ${dayWithSuffix(i + 1)}`]);
  els.cashStart.replaceChildren(option(["today", "Bugün"]), ...(opts.length ? [group("Gelir günü", opts)] : []), group("Ayın günü", days));
  els.cashStart.value = cashStart;
}

let cashHover = null;   // klavyeyle / işaretçiyle seçili gün

function renderCash() {
  for (const b of els.cashMode.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.mode === cashMode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === cashMode));
  }
  const today = T.todayKey();
  renderCashStart(today);
  const { from, to } = cashPeriod(today, cashStart, cashShift);
  const data = cashSeries(from, to, today);
  const { days } = data;
  const net = cashMode === "net";
  const value = x => (net ? x.net : x.balance);
  const initial = net ? 0 : data.before;
  const lastDay = days[days.length - 1];
  const todayAt = days.findIndex(x => x.date === today);
  els.cashRange.textContent = `${fmtDayShort(from)} – ${fmtDayShort(to)}`;

  const signed = (n, plus) => (n < 0 ? "−" : plus && n > 0 ? "+" : "") + fmt(Math.abs(n));
  const tone = n => (n < 0 ? "out-text" : net && n > 0 ? "in-text" : "");
  const stat = (label, text, cls) => {
    const d = el("div");
    d.append(el("dt", "", label), el("dd", cls, text));
    return d;
  };
  const low = days.reduce((a, b) => (value(b) < value(a) ? b : a));
  els.cashSum.replaceChildren(...(net
    ? [stat("Girdi", "+" + fmt(data.inSum), "in-text"),
       stat("Çıktı", "−" + fmt(data.outSum), "out-text"),
       stat("Net", signed(lastDay.net, true), tone(lastDay.net))]
    : [todayAt >= 0 ? stat("Bugün", signed(days[todayAt].balance), tone(days[todayAt].balance))
                    : stat("Dönem başı", signed(data.before), tone(data.before)),
       stat(`${fmtDayShort(to)} sonunda`, signed(lastDay.balance), tone(lastDay.balance)),
       stat(`En düşük · ${fmtDayShort(low.date)}`, signed(low.balance), tone(low.balance))]));
  els.cashSum.hidden = !data.any;

  const svg = els.cashChart;
  hideTooltip();
  els.cashEmpty.hidden = data.any;
  els.cashNote.hidden = !data.any;
  const change = el("button", "link", "Değiştir");
  change.type = "button";
  change.addEventListener("click", openCashDefSheet);
  els.cashNote.replaceChildren(`Nakit: ${cashDefText()}. `, change, " · Grafikte nakdin girdileri ve çıktıları (tekrarlayanlar "
    + "dahil), kart ekstreleri, nakit taksitler, borç ve alacak ödemeleri var. Ekstreler son ödeme gününde görünür; ödemediğin "
    + "geçmiş ekstreler bugünde gösterilir. Hesaba katılmayan kartlar grafikte yok."
    + (cashDef.some(c => c !== "TRY") ? " Döviz, altın ve fonlar bugünkü kur ve fiyatla TL'ye çevrilir." : "")
    + (data.missing.length ? ` Kuru ya da fiyatı alınamayan ${data.missing.map(c => V.asset(c).name.toLocaleLowerCase("tr-TR")).join(", ")} dahil değil.` : ""));
  svg.style.display = data.any ? "" : "none";
  svg.setAttribute("aria-label", `${fmtDayShort(from)} – ${fmtDayShort(to)} ${net ? "dönem net nakit hareketi" : "nakit bakiyesi"}`);
  if (!data.any) {
    els.cashEmpty.textContent = "Varlıklar'a giriş ve çıkış ekleyince nakdinin dönem dönem seyri burada görünür.";
    svg.innerHTML = "";
    return;
  }

  const W = Math.round(svg.getBoundingClientRect().width) || 880, H = 200;
  const PL = 46, PR = 8, PT = 22, PB = 26;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = days.length;
  const toX = d => PL + plotW * d / n;   // d. gün [d, d+1) aralığını kaplar
  const values = [initial, ...days.map(value)];
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const { step } = niceScale(hi - lo || 1000, 4);
  const bottom = Math.floor(lo / step + 1e-9) * step, top = Math.max(Math.ceil(hi / step - 1e-9) * step, bottom + step);
  const toY = v => PT + plotH * (top - v) / (top - bottom);
  const y0 = toY(0);

  let gridSvg = "", yLblSvg = "", xLblSvg = "";
  for (let v = bottom; v <= top + step * 0.01; v += step) {
    const y = toY(v).toFixed(1);
    gridSvg += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="${Math.abs(v) < step * 1e-6 ? "var(--line-2)" : "var(--line)"}" stroke-width="1"/>`;
    yLblSvg += `<text x="${PL - 10}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--text-3)">${fmtShort(v)}</text>`;
  }
  const every = 7 * Math.max(1, Math.ceil(70 / (plotW / n * 7)));   // haftalık; dar ekranda iki haftada bir
  for (let d = 0; d < n; d += every) {
    const x = toX(d + 0.5);
    const label = days[d].date === today ? "Bugün" : fmtDayShort(days[d].date);
    xLblSvg += `<text x="${(d ? x : toX(0)).toFixed(1)}" y="${H - 6}" text-anchor="${d ? "middle" : "start"}" font-size="11" fill="var(--text-3)">${label}</text>`;
  }
  // Dönemin içindeki bugün: dikey çizgi ve üstte etiket (ilk gün değilse)
  let nowSvg = "";
  if (todayAt > 0) {
    const x = toX(todayAt + 0.5).toFixed(1);
    nowSvg = `<line x1="${x}" y1="${PT - 4}" x2="${x}" y2="${PT + plotH}" stroke="var(--text-3)" stroke-width="1"/>
      <text x="${x}" y="${PT - 9}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text-2)">Bugün</text>`;
  }

  // Basamaklı çizgi: değer gün başında değişir, gün boyunca sabit kalır
  let line = `M${toX(0).toFixed(1)},${toY(initial).toFixed(1)}`;
  days.forEach((x, d) => { line += ` H${toX(d).toFixed(1)} V${toY(value(x)).toFixed(1)}`; });
  line += ` H${toX(n).toFixed(1)}`;
  const area = `${line} V${y0.toFixed(1)} H${toX(0).toFixed(1)} Z`;

  const dotAt = d => `<circle cx="${toX(d + 0.5).toFixed(1)}" cy="${toY(value(days[d])).toFixed(1)}" r="4" fill="${value(days[d]) < 0 ? "var(--danger)" : "var(--text)"}" stroke="var(--surface)" stroke-width="2"/>`;
  const lowIdx = days.indexOf(low);
  let marks = dotAt(n - 1);
  const endV = value(lastDay), endY = toY(endV);
  if (value(low) < initial && value(low) < endV) marks += dotAt(lowIdx);
  const endLbl = `<text x="${(W - PR).toFixed(1)}" y="${(endY < PT + 14 ? endY + 18 : endY - 9).toFixed(1)}" text-anchor="end" font-size="11" font-weight="600" fill="var(--text)">${net && endV > 0 ? "+" : ""}${fmtShort(endV)}</text>`;

  // Sıfırın üstü mürekkep, altı tehlike rengi (aynı çizgi iki kırpmayla)
  const id = "cash-clip";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<defs>
      <clipPath id="${id}-pos"><rect x="0" y="0" width="${W}" height="${y0.toFixed(1)}"/></clipPath>
      <clipPath id="${id}-neg"><rect x="0" y="${y0.toFixed(1)}" width="${W}" height="${(H - y0).toFixed(1)}"/></clipPath>
    </defs>${gridSvg}${nowSvg}
    <path d="${area}" class="cash-area" clip-path="url(#${id}-pos)"/>
    <path d="${area}" class="cash-area neg" clip-path="url(#${id}-neg)"/>
    <path d="${line}" class="cash-line" clip-path="url(#${id}-pos)"/>
    <path d="${line}" class="cash-line neg" clip-path="url(#${id}-neg)"/>
    ${marks}${endLbl}${yLblSvg}${xLblSvg}
    <g class="cash-cross" visibility="hidden"><line x1="0" y1="${PT}" x2="0" y2="${PT + plotH}" stroke="var(--line-2)" stroke-width="1"/><circle r="4" stroke="var(--surface)" stroke-width="2"/></g>`;

  const cross = svg.querySelector(".cash-cross");
  const show = (d, x, y) => {
    cashHover = d;
    const v = value(days[d]);
    const cx = toX(d + 0.5).toFixed(1), cy = toY(v).toFixed(1);
    cross.setAttribute("visibility", "visible");
    cross.querySelector("line").setAttribute("x1", cx);
    cross.querySelector("line").setAttribute("x2", cx);
    const c = cross.querySelector("circle");
    c.setAttribute("cx", cx);
    c.setAttribute("cy", cy);
    c.setAttribute("fill", v < 0 ? "var(--danger)" : "var(--text)");
    if (x == null) {
      const b = svg.getBoundingClientRect();
      x = b.left + b.width * cx / W;
      y = b.top + b.height * cy / H;
    }
    showCashTooltip(days[d], net, x, y);
  };
  const hide = () => { cashHover = null; cross.setAttribute("visibility", "hidden"); hideTooltip(); };
  const dayAt = clientX => {
    const b = svg.getBoundingClientRect();
    const x = (clientX - b.left) * W / b.width;
    return Math.min(n - 1, Math.max(0, Math.floor((x - PL) / plotW * n)));
  };
  svg.onpointermove = e => show(dayAt(e.clientX), e.clientX, e.clientY);
  svg.onpointerleave = hide;
  svg.onblur = hide;
  svg.onfocus = () => show(Math.min(cashHover ?? Math.max(todayAt, 0), n - 1));
  svg.onkeydown = e => {
    const move = { ArrowRight: 1, ArrowLeft: -1, End: n, Home: -n }[e.key];
    if (!move) { if (e.key === "Escape") hide(); return; }
    e.preventDefault();
    show(Math.min(n - 1, Math.max(0, (cashHover ?? 0) + move)));
  };
}

function showCashTooltip(day, net, x, y) {
  const tt = els.tooltip;
  const today = T.todayKey();
  tt.replaceChildren(el("span", "tt-date", `${fmtDayShort(day.date)} · ${WEEKDAYS[T.toDate(day.date).getDay()]} · ${relDays(day.date, today)}`));
  const shown = day.moves.slice(0, 4);
  for (const m of shown) {
    const line = el("span", "tt-row");
    const key = el("i", "tt-key");
    key.style.background = m.value > 0 ? "var(--income)" : "var(--expense)";
    line.append(key, el("strong", "", (m.value > 0 ? "+" : "−") + fmt(Math.abs(m.value))), el("span", "tt-name", m.desc));
    tt.append(line);
  }
  if (day.moves.length > shown.length) tt.append(el("span", "tt-name", `+${day.moves.length - shown.length} hareket daha`));
  if (!day.moves.length) tt.append(el("span", "tt-name", "Hareket yok"));
  const v = net ? day.net : day.balance;
  tt.append(el("span", "tt-total", `${net ? "Dönem net" : "Gün sonu"} ${v < 0 ? "−" : net && v > 0 ? "+" : ""}${fmt(Math.abs(v))}`));
  tt.hidden = false;
  const w = tt.offsetWidth, h = tt.offsetHeight;
  const left = x + 14 + w > window.innerWidth - 8 ? x - 14 - w : x + 14;
  tt.style.left = Math.max(8, left) + "px";
  tt.style.top = Math.max(8, y - h - 12) + "px";
}

// ---------- Akış ----------
function renderFlow(months) {
  for (const b of els.flowMode.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.mode === flowMode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === flowMode));
  }
  els.flowList.replaceChildren();
  els.flowTable.hidden = true;

  // Liste borç ve kredi ödemelerinin son ayına kadar uzar (tablo yalnızca kart ve nakit ödemeleri)
  const today = T.todayKey();
  const start = T.monthIndex(currentMonth);
  const due = B.paymentsDue(state, today, T.dateKey(start, 1), "9999-12-31");
  const lastDue = due.length ? T.parseDate(due[due.length - 1].date).idx : -Infinity;
  const lastIdx = months.length ? months[months.length - 1].idx : start - 1;
  const list = flowMode === "list" && lastDue > lastIdx
    ? cashflow(start, Math.min(lastDue, start + MAX_MONTHS - 1))
    : months;

  if (!list.length) {
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
  const r = curRates();
  for (const m of list) {
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

    const debts = due.filter(f => T.parseDate(f.date).idx === m.idx);
    const panel = el("div", "panel");
    if (!m.events.length) {
      if (!debts.length) panel.append(el("p", "month-empty", "Bu ay ödeme yok"));
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
    if (panel.childElementCount) block.append(panel);
    // Ayın borç ve kredi ödemeleri ayrı (ay toplamına girmez)
    if (debts.length) {
      const box = el("div", "panel debt-due");
      const head = el("div", "debt-due-head");
      head.append(el("span", "", "Borç ödemeleri"), el("span", "amount", fmt(dueSum(debts, r))));
      const ul = el("ul", "pay-list");
      ul.append(...debts.map(f => debtPayRow(f, today)));
      box.append(head, ul);
      block.append(box);
    }
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
    editsPurchase(li, purchase);
    ul.append(li);
  }
  return ul;
}

// Harcamayı gösteren satır: dokununca ya da Enter'la harcama düzenlenir; dokunuş üstteki ödeme satırına geçmez.
// before: düzenleme açılmadan önce (ör. içinde bulunulan pencereyi kapatmak için)
function editsPurchase(li, purchase, before) {
  li.classList.add("editable");
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.setAttribute("aria-haspopup", "dialog");
  li.title = "Harcamayı düzenle";
  const open = e => {
    e.stopPropagation();
    const p = state.installments.find(x => x.id === purchase.id);
    if (!p) return;
    before?.();
    openPurchaseSheet(p);
  };
  li.addEventListener("click", open);
  li.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); }
  });
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
    const pays = upcomingPayments(p, today);
    const plan = T.planLength(p);
    const left = pays.filter(x => x.key >= today);
    return { p, pays, plan, left: left.length, paid: plan - left.length, next: left[0]?.key ?? null };
  });

  renderPersonFilter(els.personFilter, personFilter,
    id => all.filter(x => x.left && (id === "all" || x.p.personId === id)).length,
    id => { personFilter = id; });

  const mine = all.filter(x => personFilter === "all" || x.p.personId === personFilter);
  // Sıralama: "next" devam edenlerde sıradaki ödeme, bitenlerde son ödeme (yeniden eskiye); diğerleri ikisinde de aynı.
  // Tutar harcamanın TL karşılığıdır (taksitlide toplamı, tekrarlayanda bir seferliği); kuru bilinmeyen sona düşer.
  const byName = (a, b) => a.p.desc.localeCompare(b.p.desc, "tr");
  const byDate = (a, b) => (b.p.date ?? "").localeCompare(a.p.date ?? "");
  const value = x => V.toTry(T.originalTotal(x.p), T.assetOf(x.p), curRates()) ?? -Infinity;
  const order = {
    new: (a, b) => byDate(a, b) || byName(a, b),
    amount: (a, b) => value(b) - value(a) || byName(a, b),
    name: (a, b) => byName(a, b) || byDate(a, b),
  }[purchaseSort];
  if (purchaseSort === "amount" && mine.some(x => T.assetOf(x.p) !== "TRY")) loadRates();
  const active = mine.filter(x => x.left).sort(order ?? ((a, b) => a.next.localeCompare(b.next) || byName(a, b)));
  const done = mine.filter(x => !x.left).sort(order ?? ((a, b) => b.pays[b.pays.length - 1].key.localeCompare(a.pays[a.pays.length - 1].key)));

  // E-postadan gelenler sıralamanın üstünde: Sırala yalnızca altındaki listeyi dizer
  els.inboxWrap.replaceChildren(...(inbox.length ? [inboxPanel()] : []));
  els.inboxWrap.hidden = !inbox.length;
  els.purchaseSort.value = purchaseSort;
  els.purchaseTools.hidden = mine.length < 2;
  els.purchaseWrap.replaceChildren();
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
  const code = T.assetOf(p);
  const rule = T.repeats(p) ? R.rule(p) : null;
  const row = el("div", "purchase" + (left ? "" : " done"));
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const main = el("div", "p-main");
  main.append(el("div", "p-title", p.desc));
  const meta = el("div", "p-meta");
  const tag = el("span", "card-tag");
  tag.append(cardMark(p.cardId), document.createTextNode(cardName(p.cardId)));
  meta.append(tag);
  if (p.date) meta.append(el("span", "", fmtDayShort(p.date) + " " + T.yearOf(T.parseDate(p.date).idx)));
  if (code !== "TRY") meta.append(el("span", "", V.asset(code).name));
  if (plan > 1 || !rule) meta.append(el("span", "", plan > 1 ? `${plan} taksit` : "Peşin"));
  if (rule) meta.append(el("span", "", R.label(p) + (rule.n ? ` · ${rule.n} kez` : "")));
  if (K.valid(p.category)) meta.append(el("span", "cat-tag" + (p.categoryBy === "user" ? "" : " ai"), K.category(p.category).name));
  main.append(meta);
  if (rule?.n) {
    const done = R.countUntil(p, today);
    const prog = el("div", "progress");
    const bar = el("div", "bar");
    const fill = el("span");
    fill.style.width = `${(done / rule.n) * 100}%`;
    bar.append(fill);
    prog.append(bar, el("span", "", `${done}/${rule.n} tekrar`));
    main.append(prog);
  } else if (plan > 1 && !rule) {
    const prog = el("div", "progress");
    const bar = el("div", "bar");
    const fill = el("span");
    fill.style.width = `${(paid / plan) * 100}%`;
    bar.append(fill);
    prog.append(bar, el("span", "", `${paid}/${plan} ödendi`));
    main.append(prog);
  }

  const side = el("div", "p-side");
  if (rule) {
    const amount = el("span", "amount", money(T.originalTotal(p), code));
    amount.append(el("small", "", R.per(p)));
    side.append(amount, el("span", "sub", next ? `sonraki ${fmtDayShort(next)}` : "bitti"));
  } else if (plan > 1) {
    const amount = el("span", "amount", fmt(per));
    amount.append(el("small", "", "/ay"));
    side.append(amount, el("span", "sub", left ? `kalan ${fmt(left * per)}` : "bitti"));
  } else if (code !== "TRY") {
    side.append(el("span", "amount", money(p.total, code)), el("span", "sub", next ? relDays(next, today).toLocaleLowerCase("tr-TR") : "ödendi"));
  } else {
    side.append(el("span", "amount", fmt(p.total)), el("span", "sub", next ? `${relDays(next, today).toLocaleLowerCase("tr-TR")} ödenecek` : "ödendi"));
  }

  row.append(avatar(person), main, side);
  row.addEventListener("click", () => openPurchaseSheet(p));
  row.addEventListener("keydown", e => { if (e.key === "Enter") openPurchaseSheet(p); });
  return row;
}

// ---------- Kartlar ----------
// Limitten kullanılan (borc.js cardUsed: takipteki kartta ödenmemiş geçmiş ekstreler dahil, ön ödeme düşülmüş) ve sıradaki
// ödeme; elle ödenen kartta ödenmemiş ekstreler varsa onlar (late: gecikmiş var; overdue: gecikmiş kısım, kutuda yalnızca
// o yazar), yoksa sıradaki ekstrenin kapanmamış kısmı
function cardStats(c) {
  const today = T.todayKey();
  if (manualCard(c)) {
    const cd = B.cardDebt(state, c, today);
    const due = cd.unpaid > EPS;
    return { used: B.cardUsed(state, c, today), next: due ? cd.overdueSince ?? today : cd.next?.date ?? null,
      nextTotal: due ? cd.unpaid : cd.next?.amount ?? 0, late: cd.overdue > EPS, overdue: cd.overdue };
  }
  const known = new Set(state.people.map(p => p.id));
  const pays = state.installments
    .filter(p => p.cardId === c.id && known.has(p.personId))
    .flatMap(p => T.payments(p, c));
  const upcoming = pays.filter(x => x.key >= today);
  const next = upcoming.reduce((min, x) => (!min || x.key < min ? x.key : min), null);
  return {
    used: B.cardUsed(state, c, today),
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
    mid.append(el("div", "lbl", "Kart borcu"), el("div", "val", fmt(stats.used)));
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
    el("span", "", stats.late ? `${fmt(stats.overdue)} gecikti`   // yalnızca gecikmiş kısım; bugün ödenecek satırlarda ayrı
      : stats.next ? `Son ödeme ${fmtDayShort(stats.next)} · ${fmt(stats.nextTotal)}` : "Ödenecek ekstre yok"));
  bottom.append(foot);

  const chipRow = el("div", "cc-chiprow");
  chipRow.append(el("div", "cc-chip"));
  if (c.last4) chipRow.append(el("span", "cc-num", `•••• ${c.last4}`));
  if (over) chipRow.append(el("span", "cc-alert", "Limit aşıldı"));
  else if (c.id && !B.tracked(c)) chipRow.append(el("span", "cc-alert cc-off", "Hesaba katılmıyor"));
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

// Kurlar sitenin Worker'ından (/api/kur); taze ise ya da az önce denendiyse istek atılmaz. Elde fon ya da hisse varsa
// fiyatları da yenilenir.
function loadRates() {
  loadPrices();
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
    .finally(() => { ratesLoading = null; if (["varliklar", "ozet", "borclar", "harcamalar"].includes(view)) render(); });
  return ratesLoading;
}

// ---------- Fon ve hisse fiyatları ----------
function readPrices() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF.prices));
    return p?.prices ? p : null;
  } catch { return null; }
}

function savePrices() {
  try { localStorage.setItem(PREF.prices, JSON.stringify(prices)); } catch {}
}

// Kurlar ve fon / hisse fiyatları tek tabloda (V.toTry): { TRY, USD, EUR, GAU, "BIST:THYAO": 246.7, … }
function curRates() {
  const list = Object.entries(prices?.prices || {});
  if (!list.length) return rates && rates.rates;
  const out = { TRY: 1, ...(rates && rates.rates) };
  for (const [code, x] of list) out[code] = x.price;
  return out;
}

// Hareketlerdeki fon ve hisse kodları
function marketCodes() {
  return [...new Set(knownEntries().map(e => e.asset).filter(c => V.market(c)))].sort();
}

// Elde tutulan fon ve hisselerin fiyatları (/api/fiyat). Taze ise istek atılmaz; alınamazsa son fiyatlar kalır ve bir
// dakika sonra yeniden denenir. Artık tutulmayan kodların fiyatı atılır.
function loadPrices() {
  const codes = marketCodes();
  const now = Date.now();
  const fresh = prices && now - prices.fetchedAt < PRICES_TTL && codes.every(c => prices.prices[c] || prices.missing?.includes(c));
  if (!codes.length || pricesLoading || fresh || (pricesFailed && now - pricesTriedAt < RATES_RETRY)) return pricesLoading;
  pricesTriedAt = now;
  pricesLoading = fetch(`/api/fiyat?kod=${codes.join(",")}`)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`fiyat ${res.status}`))))
    .then(data => {
      if (!data?.prices) throw new Error("fiyat yok");
      const kept = {};
      for (const c of codes) {
        const x = data.prices[c] ?? (data.failed?.includes(V.market(c).market) ? prices?.prices?.[c] : null);
        if (x) kept[c] = { ...x, name: x.name ?? prices?.prices?.[c]?.name };
      }
      prices = { prices: kept, missing: data.missing || [], fetchedAt: Date.now() };
      pricesFailed = !!data.failed?.length;
      savePrices();
    })
    .catch(() => { pricesFailed = true; })
    .finally(() => { pricesLoading = null; if (["varliklar", "ozet", "borclar"].includes(view)) render(); if (els.entrySheet.open) updateEntryForm(); });
  return pricesLoading;
}

function setPrice(code, x) {
  prices = { prices: { ...prices?.prices, [code]: x }, missing: (prices?.missing || []).filter(c => c !== code), fetchedAt: prices?.fetchedAt ?? 0 };
  savePrices();
}

// Formda yazılan, elde olmayan kodun fiyatı (fonlarda fon listesinden, hissede /api/fiyat'tan)
function lookupPrice(code) {
  const m = V.market(code);
  if (!m || prices?.prices?.[code] || lookups.has(code)) return;
  if (m.market === "FON") {
    const x = fundList?.find(f => f.code === m.ticker);
    if (x) { setPrice(code, { price: x.price, date: x.date, name: x.name, kind: x.kind }); return; }
    if (fundList && !fundListPartial) { lookups.set(code, "missing"); return; }
    if (fundListLoading) return;   // liste gelince yeniden bakılır; alınamadıysa tek tek sorulur
  }
  lookups.set(code, "loading");
  fetch(`/api/fiyat?kod=${code}`)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`fiyat ${res.status}`))))
    .then(data => {
      if (data.prices?.[code]) { setPrice(code, data.prices[code]); lookups.delete(code); }
      else lookups.set(code, data.failed?.length ? "error" : "missing");
    })
    .catch(() => lookups.set(code, "error"))
    .finally(() => { if (lookups.get(code) === "error") setTimeout(() => lookups.delete(code), RATES_RETRY); if (els.entrySheet.open) updateEntryForm(); });
}

// TEFAS fon listesi (arama için, bir kez)
function loadFundList() {
  if (fundList || fundListLoading) return;
  fundListLoading = fetch("/api/fonlar")
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`fonlar ${res.status}`))))
    .then(data => { if (Array.isArray(data?.funds)) { fundList = data.funds; fundListPartial = !!data.partial?.length; } })
    .catch(() => {})
    .finally(() => {
      fundListLoading = null;
      for (const [code, st] of lookups) if (st === "missing" && V.market(code).market === "FON") lookups.delete(code);
      if (els.entrySheet.open) updateEntryForm();
    });
}

// TEFAS'taki büyük harfli fon adı okunur biçimde: "AK PORTFÖY … (TL) FONU" → "Ak Portföy … (TL) Fonu"
const KEEP_UPPER = new Set(["TL", "BIST", "ABD", "A.Ş", "OKS", "BES", "USD", "EUR", "ETF", "BYF", "KKM", "S&P", "ESG", "TEFAS"]);
const KEEP_LOWER = new Set(["ve", "ile", "veya"]);
function fundName(s) {
  return String(s ?? "").split(/(\s+)/).map((w, at) => {
    const core = w.replace(/^[(\[]+|[)\],.]+$/g, "");
    if (!core || KEEP_UPPER.has(core) || /\d/.test(core)) return w;
    const lower = w.toLocaleLowerCase("tr-TR");
    if (at > 0 && KEEP_LOWER.has(lower)) return lower;
    const i = lower.search(/\p{L}/u);
    return i < 0 ? lower : lower.slice(0, i) + lower.charAt(i).toLocaleUpperCase("tr-TR") + lower.slice(i + 1);
  }).join("");
}

// Fon / hissenin okunur adı: fonda TEFAS'taki adı, hissede "Hisse" (bilinmiyorsa pazarın adı)
function marketName(code) {
  const m = V.market(code);
  const name = prices?.prices?.[code]?.name ?? fundList?.find(f => m?.market === "FON" && f.code === m.ticker)?.name;
  return name ? fundName(name) : V.MARKETS[m?.market]?.name ?? "";
}

// Varlık nakit mi (ayarlardaki nakit tanımı); para piyasası fonu olduğu fonun fiyatla gelen bilgisinden anlaşılır
function isCashCode(code) {
  const m = V.market(code);
  const fund = m?.market === "FON" ? prices?.prices?.[code] ?? fundList?.find(f => f.code === m.ticker) : null;
  return V.isCash(code, cashDef, fund);
}

// Nakit tanımı metinle: "TL ve para piyasası fonları"
const CASH_NAMES = { TRY: "TL", USD: "dolar", EUR: "euro", GAU: "gram altın", [V.MMF]: "para piyasası fonları" };
function cashDefText() {
  const names = cashDef.map(c => CASH_NAMES[c] ?? V.market(c)?.ticker ?? c);
  if (!names.length) return "hiçbiri";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} ve ${names[names.length - 1]}`;
}

const unitFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 });
// Birim fiyat ya da kur: fonda TEFAS gibi 6 hane, hissede 2, döviz ve altında 4
function fmtPrice(p, code) {
  const m = V.market(code)?.market;
  const digits = m === "FON" ? 6 : m === "BIST" ? 2 : 4;
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: digits }).format(p);
}
// "%2,3"
function fmtPct(r) {
  return "%" + new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(Math.abs(r * 100));
}

// Varlığın kendi biriminde: "₺1.250,00", "$100,00", "12,5 gr", fon ve hissede "1.000 adet"
function fmtAsset(amount, code, signed = false) {
  const a = V.asset(code);
  const sign = amount < 0 ? "−" : signed && amount > 0 ? "+" : "";
  if (a.market) return `${sign}${unitFmt.format(Math.abs(amount))} adet`;
  const n = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: code === "GAU" ? 0 : 2, maximumFractionDigits: a.digits })
    .format(Math.abs(amount));
  return code === "GAU" ? `${sign}${n} gr` : `${sign}${a.symbol}${n}`;
}

// Hareketin başlığı: açıklaması; boşsa fon / hissede "THYAO alışı", TL'yle alınan / bozdurulan dövizde "Dolar alışı"
function entryTitle(e) {
  const m = V.market(e.asset);
  if (e.desc) return e.desc;
  if (m) return `${m.ticker} ${e.amount > 0 ? "alışı" : "satışı"}`;
  return V.settled(e) ? `${V.asset(e.asset).name} ${e.amount > 0 ? "alışı" : "bozdurma"}` : "";
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

// Varlıktan ödenen (kartsız) harcamalar: varlık bakiyesinden düşer, Varlıklar'da çıkış olarak görünür
function cashPurchases() {
  const ids = new Set(state.cards.map(c => c.id));
  return knownPurchases().filter(p => !ids.has(p.cardId));
}

// Varlık = eldeki (varlık bakiyeleri) + alacak = Özvarlık + Borç (borc.js; kişi seçiliyse onunkiler). Bakiyelere borç
// etkileri de girer: borç akışları, takipteki kartların ödenen ekstreleri (ilk kişiden) ve kart payı ödemeleri.
function renderAssets() {
  if (entryFilter !== "all" && !personById(entryFilter)) entryFilter = "all";
  const all = knownEntries(), spends = cashPurchases();
  const ofPerson = id => x => id === "all" || x.personId === id;
  const mine = all.filter(ofPerson(entryFilter)), mineSpends = spends.filter(ofPerson(entryFilter));
  const today = T.todayKey();
  const r = curRates();
  const t = B.totals(state, today, r, entryFilter);
  const bals = t.balances;

  els.assetLabel.textContent = entryFilter === "all" ? "Varlık" : `${personById(entryFilter).name} · varlık`;
  setMoney(els.assetTotal, t.assets);
  // Eşitlik satırı yalnızca borç ya da alacak varsa (dokununca Borçlar)
  els.assetEqLine.hidden = !(t.debt.total > EPS || t.receivable.total > EPS);
  const A = Math.round(t.assets), D = Math.round(t.debt.total);   // Borçlar'daki gibi: Özvarlık farkıdır
  els.assetEq.textContent = `= Özvarlık ${fmtWhole(A - D)} + Borç ${fmtWhole(D)} ›`;
  els.assetIncl.textContent = t.receivable.total > EPS ? `${fmtWhole(t.receivable.total)} alacak dahil` : "";
  const stale = !rates || ratesFailed || t.missing.length;
  const noPrice = t.missing.some(c => V.market(c));   // fiyatı alınamayan fon / hisse toplamda yok
  els.ratesNote.classList.toggle("warn-text", !!stale);
  els.ratesNote.textContent = !rates ? (ratesLoading ? "Kurlar alınıyor…" : "Kur alınamadı · yalnızca TL")
    : `Kur ${fmtTime(rates.updatedAt)}${ratesFailed ? " · güncellenemedi" : ""}`
      + (noPrice ? (pricesLoading ? " · fiyatlar alınıyor…" : " · fiyatı alınamayan var") : "");
  els.rateStats.replaceChildren(...V.ASSETS.filter(a => a.code !== "TRY").map(a => {
    const d = el("div");
    d.append(el("dt", "", a.name), el("dd", "", r?.[a.code] ? fmt(r[a.code]) : "—"));
    return d;
  }));

  renderPersonFilter(els.entryFilter, entryFilter, id => all.filter(ofPerson(id)).length + spends.filter(ofPerson(id)).length,
    id => { entryFilter = id; });
  els.entryFilter.hidden = state.people.length < 2;
  renderAssetChart(entryFilter);

  els.assetGrid.replaceChildren(...V.ASSETS.map(a => {
    const bal = bals[a.code] ?? 0;
    const tile = el("button", "asset" + (a.code in bals ? "" : " empty-asset"));
    tile.type = "button";
    tile.setAttribute("aria-label", `${a.name} girişi ekle`);
    const name = el("div", "asset-name");
    name.append(el("span", "asset-sym", a.symbol), document.createTextNode(a.name));
    const value = V.toTry(bal, a.code, r);
    tile.append(name, el("div", "asset-bal" + (bal < 0 ? " neg" : ""), fmtAsset(bal, a.code)),
      el("div", "asset-try", a.code === "TRY" ? "\u00a0" : value == null ? "kur yok" : `≈ ${fmt(value)}`));
    tile.addEventListener("click", () => openEntrySheet(null, a.code));
    return tile;
  }));
  // Alacak: kart payları, kişilerden alacaklar ve fazla ödenmiş kartlar; dokununca Borçlar → Alacaklarım
  if (t.receivable.total > EPS) {
    const tile = el("button", "asset receivable");
    tile.type = "button";
    tile.setAttribute("aria-label", `Alacak ${fmt(t.receivable.total)}, Alacaklarım'da gör`);
    const name = el("div", "asset-name");
    const sym = el("span", "asset-sym");
    sym.append(icon("swap"));
    name.append(sym, document.createTextNode("Alacak"));
    tile.append(name, el("div", "asset-bal", fmt(t.receivable.total)),
      el("div", "asset-try", [t.receivable.cards > EPS && "kartını kullananlar", t.receivable.people > EPS && "borç verdiğin kişiler",
        t.receivable.cardCredit > EPS && "karta fazla ödediğin"].filter(Boolean).join(" · ")));
    tile.addEventListener("click", () => { debtSide = "receivable"; debtClosedOpen = false; location.hash = "#borclar"; });
    els.assetGrid.append(tile);
  }

  renderHoldings(mine, bals, r);

  els.entryWrap.replaceChildren();
  if (!mine.length && !mineSpends.length) {
    const btn = el("button", "btn btn-primary");
    btn.type = "button";
    btn.append(icon("plus"), document.createTextNode("Hareket ekle"));
    btn.addEventListener("click", () => openEntrySheet());
    els.entryWrap.append(emptyState("coins", "Henüz hareket yok",
      "TL, dolar, euro ya da gram altın girişlerini ve çıkışlarını, fon ve hisse alışlarını ekle; bakiyeni güncel kur ve fiyatla TL olarak gösteririm.", btn));
    return;
  }
  // Tekrarlayan hareket son işlenen tekrarının tarihiyle sıralanır (henüz işlenmediyse başlangıcıyla); nakit
  // harcamalar hareketlerle birlikte, tarihi olmayan (Excel'den gelen) en sonda
  const order = new Map([...state.entries, ...state.installments].map((x, i) => [x.id, i]));
  const shown = x => (T.parseDate(x.date) ? R.dateAt(x, Math.max(R.countUntil(x, today) - 1, 0)) : "");
  const sorted = [...mine.map(e => ({ e, at: shown(e) })), ...mineSpends.map(p => ({ p, at: shown(p) }))]
    .sort((a, b) => b.at.localeCompare(a.at) || order.get((b.e ?? b.p).id) - order.get((a.e ?? a.p).id));
  const panel = el("div", "panel list-panel");
  for (const x of sorted) panel.append(x.e ? entryRow(x.e, r, today) : spendRow(x.p, r, today));
  const head = el("header", "panel-head");
  head.append(el("h2", "", "Hareketler"));
  els.entryWrap.append(head, panel);
}

// ---------- Varlığın seyri ----------
// Varlıklar'daki Varlık (eldeki + alacak, B.totals) gün gün: her gün o güne kadarki kayıtlarla ve o günün kur ve
// fiyatlarıyla (/api/gecmis: dolar, euro, gram altın ve hisseler İş Yatırım'ın, fonlar TEFAS'ın günlük kapanışları;
// kapanışı olmayan gün öncekiyle). Bugün güncel kur ve fiyatla, üstteki toplamla aynıdır. Geçmişi alınamayan varlık
// bugünkü fiyatla sayılır (notta yazar). Uzun dönemde birkaç günde bir nokta (en fazla ~180). Özet'teki Nakit
// grafiğinden ayrıdır: o yalnızca nakdi gösterir.
const ASSET_RANGES = { "1m": 30, "3m": 91, "6m": 182, "1y": 365, all: null };
const HISTORY_TTL = 60 * 60_000;   // geçmiş fiyatlar bu kadar süre taze sayılır (/api/gecmis de bu kadar saklar)
const MAX_HISTORY_DAYS = 1830;     // en uzun dönem (5 yıl)
const ASSET_POINTS = 180;
let assetRange = Object.hasOwn(ASSET_RANGES, readPref(PREF.assetRange) ?? "") ? readPref(PREF.assetRange) : "3m";
const histories = new Map();       // gün sayısı → { days, to, series: { kod: [["YYYY-MM-DD", fiyat], …] }, failed, fetchedAt }
let historyLoading = null;
let historyFailed = false;
let historyTriedAt = 0;
let assetMemo = null;              // son hesaplanan seyir ve girdileri
let assetHover = null;             // grafikte seçili nokta

try {
  const h = JSON.parse(localStorage.getItem(PREF.history));
  if (h?.series && h.days) histories.set(h.days, h);
} catch {}

// Geçmişi istenen varlıklar: kayıtlarda geçen dolar, euro, altın, fon ve hisseler
function historyCodes() {
  const codes = new Set();
  for (const e of knownEntries()) if (e.asset !== "TRY" && V.asset(e.asset)) codes.add(e.asset);
  for (const p of knownPurchases()) if (T.assetOf(p) !== "TRY") codes.add(T.assetOf(p));
  for (const d of state.debts) if (d.asset && d.asset !== "TRY" && V.asset(d.asset)) codes.add(d.asset);
  return [...codes].sort();
}

function loadHistory(codes, days) {
  const h = histories.get(days), now = Date.now();
  const fresh = h && h.to === T.todayKey() && codes.every(c => c in h.series || h.failed.includes(c)) && now - h.fetchedAt < HISTORY_TTL;
  if (!codes.length || fresh || historyLoading || (historyFailed && now - historyTriedAt < RATES_RETRY)) return;
  historyTriedAt = now;
  historyLoading = fetch(`/api/gecmis?kod=${codes.join(",")}&gun=${days}`)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`geçmiş ${res.status}`))))
    .then(data => {
      if (!data?.series) throw new Error("geçmiş yok");
      const value = { days, to: data.to, series: data.series, failed: data.failed || [], fetchedAt: Date.now() };
      histories.set(days, value);
      historyFailed = false;
      try { localStorage.setItem(PREF.history, JSON.stringify(value)); } catch {}
    })
    .catch(() => { historyFailed = true; })
    .finally(() => { historyLoading = null; if (view === "varliklar") render(); });
}

// Kodların geçmişi: istenen dönemin verisi, yoksa elde olan en uzun dönemin
function historyFor(days, codes) {
  const pick = [histories.get(days), ...[...histories.values()].sort((a, b) => b.days - a.days)].filter(Boolean);
  const series = {};
  for (const c of codes) series[c] = pick.find(h => h.series[c]?.length)?.series[c] ?? null;
  return { series, stamp: pick.map(h => h.fetchedAt).join() };
}

// Günün (ya da öncesinin son) kapanışı; dönem başından önceyse ilk kapanış; dizi boşsa null
function priceAt(list, day) {
  if (!list?.length) return null;
  if (day < list[0][0]) return list[0][1];
  let lo = 0, hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid][0] <= day) lo = mid; else hi = mid - 1;
  }
  return list[lo][1];
}

// Verinin day günü sonundaki hali: o güne kadarki hareketler, harcamalar ve borç kayıtları (tarihsiz harcama ilk ödeme
// ayından)
function stateAt(day) {
  const month = day.slice(0, 7);
  return {
    ...state,
    entries: state.entries.filter(e => e.date <= day),
    installments: state.installments.filter(p => (p.date ? p.date <= day : !p.firstDue || p.firstDue <= month)),
    debts: state.debts.filter(d => d.date <= day),
  };
}

function firstRecordDate() {
  const dates = [...knownEntries().map(e => e.date), ...knownPurchases().map(p => p.date), ...state.debts.map(d => d.date)]
    .filter(d => T.parseDate(d));
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

// → { span, codes, points: [{ date, value, parts: { lira, fx, market, receivable } }], approx, missing } ya da kayıt yoksa null
function assetSeries(range, pid) {
  const today = T.todayKey();
  const first = firstRecordDate();
  if (!first) return null;
  const all = Math.round((T.toDate(today) - T.toDate(first)) / 864e5);
  const span = ASSET_RANGES[range] ?? Math.min(MAX_HISTORY_DAYS, Math.max(7, all));
  const codes = historyCodes();
  const hist = historyFor(span, codes);
  const cur = curRates() ?? { TRY: 1 };
  const key = [range, pid, today, state.entries, state.entries.length, state.installments, state.installments.length, state.debts,
    state.debts.length, state.cards, state.people, rates, prices, hist.stamp];
  if (assetMemo && key.every((x, i) => x === assetMemo.key[i])) return assetMemo.value;

  const step = Math.max(1, Math.ceil(span / ASSET_POINTS));
  const days = [];
  for (let i = span; i > 0; i -= step) days.push(T.addDays(today, -i));
  days.push(today);
  const approx = new Set();
  let missing = [];
  const points = days.map(day => {
    const r = { TRY: 1 };
    for (const c of codes) {
      const past = day === today ? null : priceAt(hist.series[c], day);
      if (day !== today && past == null && cur[c] != null) approx.add(c);
      const v = past ?? cur[c];
      if (v != null) r[c] = v;
    }
    const t = B.totals(stateAt(day), day, r, pid);
    if (day === today) missing = t.missing;
    const parts = { lira: 0, fx: 0, market: 0, receivable: t.receivable.total };
    for (const [c, amount] of Object.entries(t.balances)) {
      const v = V.toTry(amount, c, r);
      if (v == null) continue;
      if (c === "TRY") parts.lira += v; else if (V.market(c)) parts.market += v; else parts.fx += v;
    }
    return { date: day, value: t.assets, parts };
  });
  const value = { span, codes, points, approx: [...approx], missing };
  assetMemo = { key, value };
  return value;
}

function renderAssetChart(pid) {
  for (const b of els.assetRange.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.range === assetRange);
    b.setAttribute("aria-pressed", String(b.dataset.range === assetRange));
  }
  const data = assetSeries(assetRange, pid);
  els.assetPanel.hidden = !data;
  if (!data) return;
  loadHistory(data.codes, data.span);
  const { points } = data;
  const today = T.todayKey();
  const start = points[0], end = points[points.length - 1];
  const diff = end.value - start.value;
  const sign = n => (n < -EPS ? "−" : n > EPS ? "+" : "");
  const stat = (label, text, cls) => {
    const d = el("div");
    d.append(el("dt", "", label), el("dd", cls, text));
    return d;
  };
  const dayLabel = d => (d.slice(0, 4) === today.slice(0, 4) ? fmtDayShort(d) : fmtDay(d));
  els.assetSum.replaceChildren(
    stat(dayLabel(start.date), (start.value < 0 ? "−" : "") + fmt(Math.abs(start.value))),
    stat("Bugün", (end.value < 0 ? "−" : "") + fmt(Math.abs(end.value))),
    stat("Değişim", sign(diff) + fmt(Math.abs(diff)) + (start.value > EPS ? ` · ${fmtPct(diff / start.value)}` : ""),
      diff > EPS ? "in-text" : diff < -EPS ? "out-text" : ""),
  );
  const names = list => list.map(c => V.asset(c)?.name.toLocaleLowerCase("tr-TR") ?? c).join(", ");
  els.assetNote.textContent = "Her gün o güne kadarki kayıtlarla ve o günün kur ve fiyatlarıyla: dolar, euro, gram altın ve "
    + "hisseler günlük kapanışla (İş Yatırım), fonlar TEFAS fiyatıyla; bugün güncel kur ve fiyatla. Alacaklar dahil. Nakdin "
    + "seyri Özet'teki Nakit grafiğinde."
    + (historyLoading && data.codes.length ? " Geçmiş fiyatlar alınıyor…" : "")
    + (!historyLoading && data.approx.length ? ` Geçmiş fiyatı alınamayan ${names(data.approx)} bugünkü fiyatla sayıldı.` : "")
    + (data.missing.length ? ` Kuru ya da fiyatı alınamayan ${names(data.missing)} dahil değil.` : "");

  const svg = els.assetChart;
  const W = Math.round(svg.getBoundingClientRect().width) || 880, H = 200;
  const PL = 46, PR = 8, PT = 22, PB = 26;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = points.length;
  const toX = i => PL + (n > 1 ? plotW * i / (n - 1) : plotW / 2);
  const vals = points.map(p => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo < 0 && hi < 0) hi = 0;
  const { step } = niceScale(hi - lo || Math.abs(hi) || 1000, 4);
  const bottom = Math.floor(lo / step + 1e-9) * step, top = Math.max(Math.ceil(hi / step - 1e-9) * step, bottom + step);
  const toY = v => PT + plotH * (top - v) / (top - bottom);

  let gridSvg = "", yLblSvg = "", xLblSvg = "";
  for (let v = bottom; v <= top + step * 0.01; v += step) {
    const y = toY(v).toFixed(1);
    gridSvg += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="${Math.abs(v) < step * 1e-6 ? "var(--line-2)" : "var(--line)"}" stroke-width="1"/>`;
    yLblSvg += `<text x="${PL - 10}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="var(--text-3)">${fmtShort(v)}</text>`;
  }
  // Tarih etiketleri: aralığa göre gün ya da ay; dar ekranda daha seyrek
  const long = data.span > 200;
  const count = Math.max(2, Math.min(5, Math.floor(plotW / 80)));
  for (let k = 0; k < count; k++) {
    const i = Math.round((n - 1) * k / (count - 1));
    const d = T.parseDate(points[i].date);
    const label = points[i].date === today ? "Bugün" : long ? `${T.monthShort(d.idx)} ${String(T.yearOf(d.idx)).slice(2)}` : fmtDayShort(points[i].date);
    const anchor = k === 0 ? "start" : k === count - 1 ? "end" : "middle";
    xLblSvg += `<text x="${toX(i).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" font-size="11" fill="var(--text-3)">${label}</text>`;
  }
  const line = points.map((p, i) => `${i ? "L" : "M"}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ");
  const endY = toY(end.value);
  const endDot = `<circle cx="${toX(n - 1).toFixed(1)}" cy="${endY.toFixed(1)}" r="4" fill="var(--text)" stroke="var(--surface)" stroke-width="2"/>`;
  const endLbl = `<text x="${(W - PR).toFixed(1)}" y="${(endY < PT + 14 ? endY + 18 : endY - 9).toFixed(1)}" text-anchor="end" font-size="11" font-weight="600" fill="var(--text)">${fmtShort(end.value)}</text>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-label", `Varlığın seyri: ${dayLabel(start.date)} ${fmt(start.value)}, bugün ${fmt(end.value)}`);
  svg.innerHTML = `${gridSvg}<path d="${line}" class="cash-line"/>${endDot}${endLbl}${yLblSvg}${xLblSvg}
    <g class="cash-cross" visibility="hidden"><line x1="0" y1="${PT}" x2="0" y2="${PT + plotH}" stroke="var(--line-2)" stroke-width="1"/><circle r="4" fill="var(--text)" stroke="var(--surface)" stroke-width="2"/></g>`;

  const cross = svg.querySelector(".cash-cross");
  const show = (i, x, y) => {
    assetHover = i;
    const cx = toX(i).toFixed(1), cy = toY(points[i].value).toFixed(1);
    cross.setAttribute("visibility", "visible");
    cross.querySelector("line").setAttribute("x1", cx);
    cross.querySelector("line").setAttribute("x2", cx);
    cross.querySelector("circle").setAttribute("cx", cx);
    cross.querySelector("circle").setAttribute("cy", cy);
    if (x == null) {
      const b = svg.getBoundingClientRect();
      x = b.left + b.width * cx / W;
      y = b.top + b.height * cy / H;
    }
    showAssetTooltip(points[i], x, y);
  };
  const hide = () => { assetHover = null; cross.setAttribute("visibility", "hidden"); hideTooltip(); };
  const pointAt = clientX => {
    const b = svg.getBoundingClientRect();
    const x = (clientX - b.left) * W / b.width;
    return n > 1 ? Math.min(n - 1, Math.max(0, Math.round((x - PL) / plotW * (n - 1)))) : 0;
  };
  svg.onpointermove = e => show(pointAt(e.clientX), e.clientX, e.clientY);
  svg.onpointerleave = hide;
  svg.onblur = hide;
  svg.onfocus = () => show(Math.min(assetHover ?? n - 1, n - 1));
  svg.onkeydown = e => {
    const move = { ArrowRight: 1, ArrowLeft: -1, End: n, Home: -n }[e.key];
    if (!move) { if (e.key === "Escape") hide(); return; }
    e.preventDefault();
    show(Math.min(n - 1, Math.max(0, (assetHover ?? n - 1) + move)));
  };
}

// İpucu: gün, varlığın parçaları (TL, döviz ve altın, fon ve hisse, alacak) ve toplam
function showAssetTooltip(p, x, y) {
  const tt = els.tooltip;
  const today = T.todayKey();
  tt.replaceChildren(el("span", "tt-date", `${fmtDay(p.date)} · ${relDays(p.date, today)}`));
  for (const [key, name] of [["lira", "TL"], ["fx", "Döviz ve altın"], ["market", "Fon ve hisse"], ["receivable", "Alacak"]]) {
    const v = p.parts[key];
    if (Math.abs(v) < EPS) continue;
    const line = el("span", "tt-row");
    line.append(el("strong", "", (v < 0 ? "−" : "") + fmt(Math.abs(v))), el("span", "tt-name", name));
    tt.append(line);
  }
  tt.append(el("span", "tt-total", `Varlık ${p.value < 0 ? "−" : ""}${fmt(Math.abs(p.value))}`));
  tt.hidden = false;
  const w = tt.offsetWidth, h = tt.offsetHeight;
  const left = x + 14 + w > window.innerWidth - 8 ? x - 14 - w : x + 14;
  tt.style.left = Math.max(8, left) + "px";
  tt.style.top = Math.max(8, y - h - 12) + "px";
}

els.assetRange.addEventListener("click", e => {
  const range = e.target.closest("button")?.dataset.range;
  if (!range || range === assetRange) return;
  assetRange = range;
  writePref(PREF.assetRange, range);
  render();
});

// Formda en son seçilen fon / hisse pazarı (yoksa fon)
function lastMarket() { return V.MARKETS[lastAsset] ? lastAsset : "FON"; }

// Fon ve hisse: elde olanlar (adet sıfır değil) TL karşılığına göre; birim fiyat, kâr (alış fiyatları biliniyorsa ortalama
// maliyetle, V.positions) ve hissede günlük değişim. Dokununca o fon / hisse için yeni alış ya da satış.
function renderHoldings(mine, bals, r) {
  const traded = mine.some(e => V.market(e.asset));
  const pos = V.positions(mine);
  const value = c => V.toTry(bals[c], c, r);
  const codes = Object.keys(bals).filter(c => V.market(c) && Math.abs(bals[c]) > 1e-9)
    .sort((a, b) => (value(b) ?? -1) - (value(a) ?? -1) || (a < b ? -1 : 1));
  const head = el("header", "panel-head hold-head");
  head.append(el("h2", "", "Fon ve hisse"));
  if (codes.length) head.append(el("span", "panel-note", fmt(codes.reduce((sum, c) => sum + (value(c) ?? 0), 0))));
  const add = el("button", "btn btn-ghost btn-sm");
  add.type = "button";
  add.append(icon("plus"), document.createTextNode("Ekle"));
  add.addEventListener("click", () => openEntrySheet(null, lastMarket()));
  head.append(add);
  const panel = el("div", "panel list-panel");
  if (codes.length) panel.append(...codes.map(c => holdingRow(c, bals[c], pos[c], r)));
  else panel.append(el("p", "hold-empty", traded ? "Elinde fon ya da hisse kalmadı."
    : "TEFAS fonlarını ve Borsa İstanbul hisselerini adetiyle ekle; güncel fiyatla TL karşılığını ve kârını gösteririm."));
  els.holdWrap.replaceChildren(head, panel);
}

function holdingRow(code, units, pos, r) {
  const m = V.market(code), x = prices?.prices?.[code];
  const row = el("div", "purchase hold");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-haspopup", "dialog");
  const mark = el("span", "mark");
  mark.append(icon(m.market === "FON" ? "pie" : "trend"));
  const main = el("div", "p-main");
  main.append(el("div", "p-title", m.ticker));
  if (m.market === "FON" && marketName(code) !== V.MARKETS.FON.name) main.append(el("div", "hold-name", marketName(code)));
  const meta = el("div", "p-meta");
  meta.append(el("span", "", fmtAsset(units, code)));
  if (x) meta.append(el("span", "", fmtPrice(x.price, code)));
  if (isCashCode(code)) meta.append(el("span", "", "nakit"));
  main.append(meta);

  const side = el("div", "p-side");
  const v = V.toTry(units, code, r);
  side.append(el("span", "amount" + (units < 0 ? " out" : ""), v == null ? "fiyat yok" : fmt(v)));
  // Kâr / zarar: güncel değer − elde kalanın ortalama maliyeti
  if (v != null && pos?.cost > 0) {
    const gain = v - pos.cost;
    side.append(el("span", "sub " + (gain > EPS ? "gain" : gain < -EPS ? "loss" : ""),
      `${gain > EPS ? "+" : gain < -EPS ? "−" : ""}${fmt(Math.abs(gain))} (${fmtPct(gain / pos.cost)})`));
  }
  if (m.market === "BIST" && x?.prev > 0) {
    const ch = x.price / x.prev - 1;
    side.append(el("span", "sub", `bugün ${ch > 0.00005 ? "+" : ch < -0.00005 ? "−" : ""}${fmtPct(ch)}`));
  }
  // Fon fiyatı günde bir açıklanır: bugünün değilse günü
  if (m.market === "FON" && x?.date && x.date !== T.todayKey()) side.append(el("span", "sub", `${fmtDayShort(x.date)} fiyatı`));
  row.append(mark, main, side);
  const open = () => openEntrySheet(null, code);
  row.addEventListener("click", open);
  row.addEventListener("keydown", ev => { if (ev.key === "Enter") open(); });
  return row;
}

function entryRow(e, r, today) {
  const a = V.asset(e.asset);
  const n = V.repeatOf(e);
  const next = V.nextDate(e, today);
  const row = el("div", "purchase" + (n != null && !next ? " done" : ""));
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const main = el("div", "p-main");
  main.append(el("div", "p-title", entryTitle(e)));
  const meta = el("div", "p-meta");
  meta.append(el("span", "card-tag", a.name), el("span", "", fmtDay(e.date)));
  if (n != null) meta.append(el("span", "", R.label(e) + (n ? ` · ${n} kez` : "")));
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
  if (n != null) amount.append(el("small", "", R.per(e)));
  side.append(amount);
  const value = V.toTry(e.amount, e.asset, r), trade = V.tradeValue(e);
  // Fon / hisse: alış ya da satış tutarı (fiyatı girildiyse) ve TL bakiyesine işlendiyse
  if (trade != null) {
    side.append(el("span", "sub", fmt(Math.abs(trade))));
    if (e.settle === true) side.append(el("span", "sub", e.amount > 0 ? "TL'den ödendi" : "TL'ye eklendi"));
  } else if (e.asset !== "TRY") side.append(el("span", "sub", value == null ? (a.market ? "fiyat yok" : "kur yok") : `≈ ${fmt(Math.abs(value))}`));
  if (n != null) side.append(el("span", "sub", next ? `sonraki ${fmtDayShort(next)}` : "bitti"));

  row.append(avatar(personById(e.personId)), main, side);
  row.addEventListener("click", () => openEntrySheet(e));
  row.addEventListener("keydown", ev => { if (ev.key === "Enter") openEntrySheet(e); });
  return row;
}

// Varlıktan ödenen harcama: çıkış olarak, dokununca harcama formu
function spendRow(p, r, today) {
  const code = T.assetOf(p);
  const rule = T.repeats(p) ? R.rule(p) : null;
  const left = upcomingPayments(p, today).filter(x => x.key > today);
  // Tek seferlik çıkış girişler gibi hep belirgin; tekrarlayan ya da taksitli bitince soluklaşır
  const row = el("div", "purchase" + (!left.length && (rule || T.planLength(p) > 1) ? " done" : ""));
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const main = el("div", "p-main");
  main.append(el("div", "p-title", p.desc));
  const meta = el("div", "p-meta");
  meta.append(el("span", "card-tag", V.asset(code).name));
  if (p.date) meta.append(el("span", "", fmtDay(p.date)));
  if (rule) meta.append(el("span", "", R.label(p) + (rule.n ? ` · ${rule.n} kez` : "")));
  else if (T.planLength(p) > 1) meta.append(el("span", "", `${T.planLength(p)} taksit`));
  if (K.valid(p.category)) meta.append(el("span", "cat-tag" + (p.categoryBy === "user" ? "" : " ai"), K.category(p.category).name));
  main.append(meta);

  const side = el("div", "p-side");
  const total = rule ? T.originalTotal(p) : p.total;
  const amount = el("span", "amount out", fmtAsset(-total, code, true));
  if (rule) amount.append(el("small", "", R.per(p)));
  side.append(amount);
  const value = V.toTry(total, code, r);
  if (code !== "TRY") side.append(el("span", "sub", value == null ? "kur yok" : `≈ ${fmt(value)}`));
  if (left.length) side.append(el("span", "sub", `sonraki ${fmtDayShort(left[0].key)}`));

  row.append(avatar(personById(p.personId)), main, side);
  row.addEventListener("click", () => openPurchaseSheet(p));
  row.addEventListener("keydown", ev => { if (ev.key === "Enter") openPurchaseSheet(p); });
  return row;
}

// ---------- Borçlar ----------
// borc.js: Varlık (eldeki + alacak) = Özvarlık + Borç; herkes için, güncel kurla TL (kuru olmayan varlık iki tarafta da
// sayılmaz). Borçlarım: kartların ödenmemiş taksitleri (takip dışı kart toplama girmez), kartsız taksitler, krediler,
// kişilere borçlar ve fazla ödenmiş kart payları. Alacaklarım: diğer kişilerin takipteki kartlardaki payları ve
// kişilerden alacaklar. Kapanan (kapatılan ya da tamamı ödenen) kayıtlar ayrı açılır.
const EPS = 0.005;

// Kartlar ilk görüldükleri gün ekstre takibine girer: trackSince'ı boş, takip dışı olmayan kartlara bugün yazılır.
// Hesapta eşitlemeden sonra (uzaktaki değerler önce gelsin), girişsiz veride açılışta.
function ensureCardTracking() {
  if (stateOwner !== (window.CF_USER_ID || null)) return;
  const cards = B.ensureTracking(state, T.todayKey());
  if (cards) { state.cards = cards; saveState(); }
}

// Ada Türkçe ek, son ünlüye göre; ad özel isim sayılır, ek kesmeyle ayrılır. "e": Mehmet'e, Ali'ye; "den": Annem'den,
// Mehmet'ten; "in": Ben'in, Emre'nin, Burak'ın
function nameWith(name, kind) {
  const s = String(name ?? "").trim() || "?";
  const low = s.toLocaleLowerCase("tr-TR");
  const v = low.match(/[aeıioöuü]/g)?.pop() ?? "e";
  const back = "aıou".includes(v);
  const last = low.slice(-1);
  const vowelEnd = "aeıioöuü".includes(last);
  if (kind === "e") return `${s}'${vowelEnd ? "y" : ""}${back ? "a" : "e"}`;
  if (kind === "den") return `${s}'${"fstkçşhp".includes(last) ? "t" : "d"}${back ? "an" : "en"}`;
  const i = { a: "ı", ı: "ı", o: "u", u: "u", e: "i", i: "i", ö: "ü", ü: "ü" }[v];
  return `${s}'${vowelEnd ? "n" : ""}${i}n`;
}

// Borcun adı: karşı taraf, yoksa not; kredide "Kredi"
function debtName(d) { return d.party || d.desc || (d.kind === "loan" ? "Kredi" : "Borç"); }
// Formdaki tür: borrowed (Borç aldım) | lent (Borç verdim) | loan (Kredi)
function debtType(d) { return d.kind === "loan" ? "loan" : d.side === "receivable" ? "lent" : "borrowed"; }
const DEBT_WORD = { borrowed: "Borç", lent: "Alacak", loan: "Kredi" };

// Kaydın geçerli ödemeleri (tarihe göre); kart payı ödemeleri için personId; kartın ekstre ödemeleri için cardId
function debtPayments(id) { return B.known(state).pays.get(id) ?? []; }
function sharePayments(pid) { return B.known(state).settlements.filter(x => x.personId === pid); }
function cardPayments(id) { return B.known(state).cardPays.get(id) ?? []; }

// Ekstreleri "Ben işaretlerim" ile ödenen (Ödendi ile) hesaba katılan kart; kart ödemesi yalnızca bunlara girilir. Elle
// mod yarın başlıyorsa (bugün ödeme varken geçildi, startDay) kart bugün otomatik gibidir.
function manualCard(c, today = T.todayKey()) {
  if (!c || !B.tracked(c) || !B.manual(c)) return false;
  const since = B.since(c, today);
  return (c.manualSince > since ? c.manualSince : since) <= today;
}
// since gününden bugüne kaç gün geçti (gecikme)
function lateDays(since, today) { return Math.round((T.toDate(today) - T.toDate(since)) / 864e5); }

// "Ben işaretlerim" kartının ekstresinin durumu (borc.js cardState): "ödendi ✓", "₺3.000,00 ödenmedi · 2 gün gecikti",
// "kısmen ödendi · kalan ₺1.000,00", "Son gün bugün: ₺3.000,00"; ileriki açık ekstrede boş
function statementText(x, today) {
  const open = x.amount - x.covered;
  if (x.state === "paid") return "ödendi ✓";
  const when = x.state === "late" ? `${lateDays(x.key, today)} gün gecikti` : x.state === "due" ? "son gün bugün" : "";
  if (x.covered > EPS) return ["kısmen ödendi", `kalan ${fmt(open)}`, when].filter(Boolean).join(" · ");
  if (x.state === "late") return `${fmt(open)} ödenmedi · ${when}`;
  return x.state === "due" ? `Son gün bugün: ${fmt(open)}` : "";
}

// "Ben işaretlerim" kartının ödenmesi gereken tutarı (borc.js cardDebt): gecikmiş ekstreler ve son günü bugün olan ayrı
// ("₺2.000,00 ödenmedi · 31 gün gecikti", "Son gün bugün: ₺3.000,00")
function unpaidTexts({ unpaid, overdue, overdueSince }, today) {
  const out = [];
  if (overdue > EPS) out.push(`${fmt(overdue)} ödenmedi · ${lateDays(overdueSince, today)} gün gecikti`);
  if (unpaid - overdue > EPS) out.push(`Son gün bugün: ${fmt(unpaid - overdue)}`);
  return out;
}

// İşaretteki rozet: elle ödenen kartın ekstresi ödendi mi (ileriki açık ekstrede yok)
function stateTag(x) { return !x ? "" : x.state === "paid" ? "ödendi" : x.state === "late" ? "gecikti" : x.state === "due" ? "son gün bugün" : ""; }

// Elle ödenen kartların elle moddaki ekstreleri: "kart|son ödeme günü" → ekstre ({ key, amount, covered, state }); until:
// ileriki ekstrelerde süresiz tekrarların o güne kadarki tekrarları
function manualStatements(today, until) {
  const out = new Map();
  for (const c of state.cards) {
    if (!manualCard(c)) continue;
    for (const x of B.cardState(state, c, today, undefined, until).statements) if (!x.auto) out.set(`${c.id}|${x.key}`, x);
  }
  return out;
}

// Döviz / altın tutarının TL karşılığı satırın altında: "≈ ₺4.000,00" ya da "kur yok"
function tryNote(amount, code, r) {
  if (code === "TRY") return null;
  const v = V.toTry(amount, code, r);
  return v == null ? "kur yok" : `≈ ${fmt(v)}`;
}

// Kuruşsuz tutar (eşitlik satırı, istatistikler): "₺89.000"
const wholeMoney = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
function fmtWhole(n) {
  const v = Math.round(n || 0) || 0;
  return (v < 0 ? "−" : "") + wholeMoney.format(Math.abs(v));   // eksi işareti uygulamanın geri kalanı gibi
}

function stat(label, text, cls) {
  const d = el("div");
  d.append(el("dt", "", label), el("dd", cls, text));
  return d;
}

// "Kur yok · dolar, gram altın dahil değil"
function assetNames(codes) { return codes.map(c => V.asset(c)?.name.toLocaleLowerCase("tr-TR") ?? c).join(", "); }

// Borç akışının işareti: kredide banka, diğerlerinde karşılıklı oklar; nötr renkte (renk yalnızca kişilerin ve kartların)
function flowMark(f) {
  const m = icon(f.debt?.kind === "loan" ? "bank" : "swap", "cmark");
  m.style.setProperty("--c", "var(--text-2)");
  return m;
}
// Borç akışının adı (borc.js flowText); kartındaki harcamalar için kişinin ödemesi "Annem · sana ödedi"
function flowLabel(f) {
  return f.type === "share" ? `${personById(f.payment.personId)?.name ?? "?"} · sana ödedi` : B.flowText(f, state);
}
// Akışın işaretli tutarı kendi biriminde: "−₺5.500,00", "+$100,00"
function flowMoney(f) { return (f.amount < 0 ? "−" : "+") + money(Math.abs(f.amount), f.asset); }
// Borç akışının penceresi: kart payı ödemesinde kişinin kart payı, diğerlerinde borcun kendisi
function openFlow(f) {
  if (f.type === "share") openShareSheet(f.payment.personId);
  else openDebtSheet(f.debt);
}
// Ödenecek borç akışlarının (B.paymentsDue) TL toplamı; kuru olmayan varlık sayılmaz
function dueSum(flows, r) { return flows.reduce((s, f) => s + (V.toTry(-f.amount, f.asset, r) ?? 0), 0); }

// Borç / kredi ödemesi satırı (ödeme satırı düzeninde): tarih rozeti, borcun adı, taksit ya da beklenen ödeme (gecikmişse
// işaretli), birden çok kişide sahibi; tutar borcun varlığında. relative: alt satırda kalan gün (Sıradaki ödemeler).
// Dokununca borcun penceresi.
function debtPayRow(f, today, { relative = false } = {}) {
  const d = f.debt;
  const li = el("li", "pay clickable" + (f.date < today ? " past" : ""));
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.setAttribute("aria-haspopup", "dialog");
  const day = T.parseDate(f.date);
  const badge = el("div", "date-badge");
  badge.append(el("span", "d", String(day.day)), el("span", "w", WEEKDAYS[T.toDate(f.date).getDay()]));

  const main = el("div", "pay-main");
  const title = el("div", "pay-title");
  title.append(flowMark(f), el("span", "p-desc", debtName(d)));
  const sub = el("div", "pay-sub");
  if (relative) sub.append(el("span", "", `${relDays(f.date, today)} · ${fmtDayShort(f.date)}`));
  sub.append(el("span", "", f.type === "pay" ? "ödeme" : f.of > 1 ? `taksit ${f.no}/${f.of}` : "vade"));
  if (f.late) sub.append(el("span", "out-text", "gecikti"));
  if (!relative && state.people.length > 1) {
    const person = personById(d.personId);
    const who = el("span", "who");
    who.append(dot(seriesVar(person)), document.createTextNode(person.name));
    sub.append(who);
  }
  main.append(title, sub);

  li.append(badge, main, el("div", "pay-amt", money(-f.amount, f.asset)));
  const open = () => openDebtSheet(d);
  li.addEventListener("click", open);
  li.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });
  return li;
}

// Bu ay bugün ve sonrasında ödenecekler, TL: kart ekstreleri, nakit taksitler (bugünkü ödenmiştir) ve borç / kredi
// taksitleri. Elle ödenen kartta borc.js'in ekstreleri: ödenmemiş geçmiş ekstreler dahil, ödenmiş kısımlar hariç; süresiz
// tekrarların ay sonuna kadarki tekrarları dahil
function dueThisMonth(today, r) {
  const idx = T.parseDate(today).idx, end = T.dateKey(idx, 31);
  const manual = new Map(state.cards.filter(c => manualCard(c, today)).map(c => [c.id, B.cardState(state, c, today, undefined, end)]));
  let total = 0;
  for (const m of cashflow(idx, idx)) {
    for (const ev of m.events) {
      if (ev.ignored || (manual.has(ev.cardId) && ev.date >= manual.get(ev.cardId).manualFrom)) continue;
      if (ev.cardId ? ev.date >= today : ev.date > today) total += ev.total;
    }
  }
  for (const cs of manual.values()) {
    for (const x of cs.statements) if (!x.auto && x.key <= end) total += x.amount - x.covered;
  }
  for (const f of B.paymentsDue(state, today, today, end)) if (!f.paid) total += V.toTry(-f.amount, f.asset, r) ?? 0;
  return total;
}

function renderDebts() {
  const today = T.todayKey();
  const r = curRates();
  const t = B.totals(state, today, r);
  const payer = state.people[0];

  setMoney(els.debtTotal, t.debt.total);
  // Varlık ve Borç yuvarlanır, Özvarlık farkıdır: tam lirada da toplam tutsun
  const A = Math.round(t.assets), D = Math.round(t.debt.total);
  els.debtEq.textContent = `Varlık ${fmtWhole(A)} = Özvarlık ${fmtWhole(A - D)} + Borç ${fmtWhole(D)}`;
  els.debtNote.classList.toggle("warn-text", t.missing.length > 0);
  els.debtNote.textContent = t.missing.length ? `Kur yok · ${assetNames(t.missing)} dahil değil` : "";
  els.debtStats.replaceChildren(
    stat("Alacak", fmtWhole(t.receivable.total)),
    stat("Bu ay ödenecek", fmtWhole(dueThisMonth(today, r))));

  // Takip bilgisi bir kez; ödeyenin TL hareketi yoksa ekstreler eksiye düşmesin diye bakiye isteği
  const tracked = state.cards.filter(B.tracked);
  const manual = tracked.filter(c => manualCard(c, today)).length;
  // Ekstre ne zaman düşer: “Otomatik”te son ödeme gününün ertesi günü, “Ben işaretlerim”de Ödendi'ye dokununca
  const when = !manual ? "son ödeme gününün ertesi günü" : manual === tracked.length ? "sen “Ödendi”ye dokununca"
    : "son ödeme gününün ertesi günü (“Ben işaretlerim” kartlarında sen “Ödendi”ye dokununca)";
  const notice = !!payer && tracked.length > 0 && !readPref(PREF.trackNotice);
  els.trackNote.hidden = !notice;
  if (notice) {
    els.trackNoteText.textContent = `Kart ekstreleri ${when} TL bakiyenden düşer. Bunu her kart için Kartlar'da kartı açıp `
      + "“Ekstre ödemesi”nden değiştirebilirsin. Kartındaki başkalarının harcamaları, onlar sana ödeyene kadar Alacaklarım'da görünür.";
  }
  const noLira = !!payer && tracked.length > 0 && !knownEntries().some(e => e.personId === payer.id && e.asset === "TRY");
  els.balanceHint.hidden = !noLira;
  if (noLira) {
    const own = B.totals(state, today, r, payer.id).balances.TRY ?? 0;
    els.balanceHintText.textContent = `Kart ekstreleri TL bakiyenden düşüyor ama henüz hiç TL girişi (maaş, bankadaki para gibi) `
      + `eklemedin; bu yüzden TL bakiyen ${fmt(own)} görünüyor. Bankadaki parayla aynı olsun diye aradaki farkı bir kez giriş `
      + "olarak ekle (ör. bankada ₺10.000 var, burada −₺2.000 görünüyorsa ₺12.000 gir).";
  }

  for (const b of els.debtSideSeg.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.side === debtSide);
    b.setAttribute("aria-pressed", String(b.dataset.side === debtSide));
  }

  const mine = t.list.filter(x => B.side(x.debt) === debtSide);
  const open = mine.filter(x => !x.status.done).sort(debtOrder);
  const shares = [...B.shares(state, today).values()].filter(s => s.person);
  const groups = [], closed = [];
  if (debtSide === "debt") {
    // Hesaba katılmayan kartlar toplama girmez: ayrı grupta, başlıkta toplam yok (en altta)
    const cards = t.cards.filter(c => c.total > EPS && c.tracked), off = t.cards.filter(c => c.total > EPS && !c.tracked);
    if (cards.length) groups.push(debtGroup("Kartlar", cards.map(c => cardDebtRow(c, payer, today)), fmt(t.debt.cards)));
    const cash = cashDebtRow(today, r);
    if (cash) groups.push(debtGroup("Nakit", [cash], fmt(t.debt.cash)));
    const loans = open.filter(x => x.debt.kind === "loan");
    if (loans.length) groups.push(debtGroup("Krediler", loans.map(x => personDebtRow(x, today, r)), fmt(t.debt.loans)));
    const people = [...open.filter(x => x.debt.kind === "person").map(x => personDebtRow(x, today, r)),
      ...shares.filter(s => s.remaining < -EPS).map(s => shareRow(s, today))];
    if (people.length) groups.push(debtGroup("Kişiler", people, fmt(t.debt.people + t.debt.overpaid)));
    if (off.length) groups.push(debtGroup("Hesaba katılmayan kartlar", off.map(c => cardDebtRow(c, payer, today))));
  } else {
    const owed = shares.filter(s => s.remaining > EPS);
    if (owed.length) groups.push(debtGroup("Kartını kullananlar", owed.map(s => shareRow(s, today)), fmt(t.receivable.cards)));
    const people = open.filter(x => x.debt.kind === "person");
    if (people.length) groups.push(debtGroup("Kişiler", people.map(x => personDebtRow(x, today, r)), fmt(t.receivable.people)));
    // Fazla ödenmiş kart: fazlası sonraki ekstrelerden düşülür
    const credit = t.cards.filter(c => c.tracked && c.credit > EPS);
    if (credit.length) groups.push(debtGroup("Fazla ödenen kartlar", credit.map(cardCreditRow), fmt(t.receivable.cardCredit)));
    closed.push(...shares.filter(s => s.charged > EPS && Math.abs(s.remaining) <= EPS).map(s => shareRow(s, today, true)));
  }
  closed.unshift(...mine.filter(x => x.status.done).sort(closedOrder).map(x => personDebtRow(x, today, r)));

  els.debtWrap.replaceChildren();
  const box = el("div", "debt-groups");
  if (groups.length) box.append(...groups);
  else {
    const debt = debtSide === "debt";
    const btn = el("button", "btn btn-primary");
    btn.type = "button";
    btn.append(icon("plus"), document.createTextNode(debt ? "Borç ekle" : "Alacak ekle"));
    btn.addEventListener("click", () => openDebtSheet(null, { type: debt ? "borrowed" : "lent" }));
    box.append(emptyState("swap", debt ? "Borcun yok" : "Alacağın yok", debt
      ? "Kart borçların burada kendiliğinden görünür. Birinden borç aldıysan ya da kredin varsa ekle."
      : "Kartınla başkası için yaptığın harcamaları eklersen, o kişi sana ödeyene kadar burada görünür (hesaba katılmayan "
        + "kartlar hariç). Birine borç verdiysen onu da buraya ekleyebilirsin.", btn));
  }
  if (closed.length) {
    const toggle = el("button", "section-toggle" + (debtClosedOpen ? " open" : ""));
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(debtClosedOpen));
    toggle.append(document.createTextNode(`Kapananlar (${closed.length})`), icon("down"));
    toggle.addEventListener("click", () => { debtClosedOpen = !debtClosedOpen; render(); });
    box.append(toggle);
    if (debtClosedOpen) {
      const panel = el("div", "panel list-panel");
      panel.append(...closed);
      box.append(panel);
    }
  }
  els.debtWrap.append(box);

  const manualLoan = t.list.some(x => x.debt.kind === "loan" && !x.status.auto);
  els.debtFoot.textContent = (payer ? `Hesaba katılan kartların ekstreleri ${when} TL bakiyenden düşer; kartındaki `
    + "başkalarının harcamaları, onlar sana ödeyene kadar Alacaklarım'da görünür. " : "")
    + `Kredi taksitleri taksit gününün ertesi günü ödenmiş sayılır${manualLoan ? "; otomatik ödenmeyen kredide sen “Ödendi”ye dokununca" : ""}. `
    + "Döviz ve altın bugünkü kurla TL'ye çevrilir.";
}

// Açık borçlar: gecikenler önce, sonra sıradaki ödeme tarihi, vadesizler en sonda
function debtOrder(a, b) {
  const key = x => (x.status.overdue > EPS ? "0" + x.status.overdueSince : "1" + (x.status.next?.date ?? x.debt.due ?? "9999") + x.debt.date);
  return key(a).localeCompare(key(b));
}
// Kapananlar: en son kapanan önce
function closedOrder(a, b) {
  const key = x => x.debt.closed ?? x.pays.at(-1)?.date ?? x.debt.date;
  return key(b).localeCompare(key(a));
}

function debtGroup(title, rows, note) {
  const sec = el("section", "debt-group");
  const head = el("header", "panel-head");
  head.append(el("h2", "", title));
  if (note) head.append(el("span", "panel-note", note));
  const panel = el("div", "panel list-panel");
  panel.append(...rows);
  sec.append(head, panel);
  return sec;
}

// Borçlar satırı (harcama satırı düzeninde): işaret, başlık, ayrıntılar, sağda tutar; dokununca, Enter ya da Space ile
// open. acts: satır içi düğmeler (dokunuşları satıra geçmez).
function debtRow({ id, mark, title, meta = [], progress, amount, amountCls = "", sub, muted, open, popup = true, acts = [] }) {
  const row = el("div", "purchase" + (muted ? " muted" : "") + (acts.length ? " act" : ""));
  if (id) row.id = id;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  if (popup) row.setAttribute("aria-haspopup", "dialog");
  const main = el("div", "p-main");
  main.append(el("div", "p-title", title));
  const m = el("div", "p-meta");
  m.append(...meta.filter(Boolean).map(x => (typeof x === "string" ? el("span", "", x) : x)));
  if (m.childElementCount) main.append(m);
  if (progress) main.append(progress);
  const side = el("div", "p-side");
  side.append(el("span", "amount" + (amountCls ? ` ${amountCls}` : ""), amount));
  if (sub) side.append(el("span", "sub", sub));
  row.append(mark, main, side);
  if (acts.length) {
    const box = el("div", "row-acts");
    box.append(...acts);
    row.append(box);
  }
  row.addEventListener("click", open);
  row.addEventListener("keydown", e => {
    if (e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); }
  });
  return row;
}

// Satır içi "Ödendi" (borç, alacak, kredi, kart, kart payı) ya da kartın "Ödemeler"i; aria ne yapıldığını söyler
function rowAction(label, aria, run, ic = "check") {
  const b = el("button", "btn btn-ghost sm debt-act");
  b.type = "button";
  b.setAttribute("aria-label", aria);
  b.append(icon(ic), el("span", "", label));
  b.addEventListener("click", e => { e.stopPropagation(); run(); });
  return b;
}

// Nötr daire içinde işaret (kart, banka) ya da karşı tarafın baş harfleri
function markOf(content) {
  const m = el("span", "mark");
  m.setAttribute("aria-hidden", "true");
  m.append(content);
  return m;
}
function partyInitials(name) {
  const words = String(name || "?").trim().split(/\s+/);
  const s = words.length > 1 ? words[0].charAt(0) + words[1].charAt(0) : words[0].charAt(0);
  return s.toLocaleUpperCase("tr-TR") || "?";
}

function whoAmount(person, amount) {
  const who = el("span", "who");
  who.append(dot(seriesVar(person)), document.createTextNode(`${nameWith(person.name, "in")} harcamaları ${fmt(amount)}`));
  return who;
}

function progressBar(done, total, text) {
  const prog = el("div", "progress");
  const bar = el("div", "bar");
  const fill = el("span");
  fill.style.width = `${total ? (done / total) * 100 : 0}%`;
  bar.append(fill);
  prog.append(bar, el("span", "", text));
  return prog;
}

// Kartın borcu: "Ben işaretlerim" kartında önce ödenmemiş ekstreler ("₺3.000,00 ödenmedi · 2 gün gecikti", "Son gün
// bugün: ₺3.000,00"), yoksa sıradaki ekstre (kesildi / bu dönemki harcamalar); kartını kullananların harcamaları.
// Ödenmemiş ya da kesilmiş ekstre varsa satır içi Ödendi. Hesaba katılmayan kart soluk (kendi grubunda).
function cardDebtRow(cd, payer, today) {
  const c = cd.card;
  const manual = manualCard(c, today);
  const meta = [];
  if (manual && cd.unpaid > EPS) {
    meta.push(...unpaidTexts(cd, today).map((text, i) => (i === 0 && cd.overdue > EPS ? el("span", "out-text", text) : text)));
  } else if (cd.next) {
    meta.push(nextStatementText(cd));
  }
  for (const p of state.people) {
    if (p.id !== payer?.id && cd.byPerson[p.id] > EPS) meta.push(whoAmount(p, cd.byPerson[p.id]));
  }
  if (manual) meta.push("sen işaretliyorsun");
  const acts = [];
  if (manual && (cd.unpaid > EPS || cd.next?.cut)) {
    acts.push(rowAction("Ödendi", `${c.name} ekstresini ödendi olarak işaretle`, () => openPaySheet({ cardId: c.id })));
  } else if (manual && cardPayments(c.id).length) {
    acts.push(payListAction(c));
  }
  return debtRow({
    id: `debt-card-${c.id}`, mark: markOf(cardMark(c.id)), title: c.name, meta, amount: fmt(cd.total),
    muted: !cd.tracked, open: () => openCardSheet(c), acts,
  });
}

// "Ben işaretlerim" kartının ödemeleri (ödenecek ekstre yokken de): kartın ödeme formu, altta önceki ödemeler
function payListAction(c) {
  return rowAction("Kart ödemelerin", `${c.name} kartına yaptığın ödemeler`, () => openPaySheet({ cardId: c.id }), "receipt");
}

// Fazla ödenmiş kart (Alacaklarım): fazlası sonraki ekstrelerden düşülür; "Ben işaretlerim" kartında ödemeleri (fazlası
// silinebilsin)
function cardCreditRow(cd) {
  const c = cd.card;
  const acts = manualCard(c) && cardPayments(c.id).length ? [payListAction(c)] : [];
  return debtRow({
    id: `credit-card-${c.id}`, mark: markOf(cardMark(c.id)), title: c.name, meta: ["karta fazla ödedin · sonraki ekstrelerden düşülür"],
    amount: fmt(cd.credit), amountCls: "in", open: () => openCardSheet(c), acts,
  });
}

// Kartsız taksitli harcamaların kalanı tek satır; dokununca Harcamalar
function cashDebtRow(today, r) {
  const cash = B.cashDebt(state, today);
  const codes = Object.keys(cash);
  if (!codes.length) return null;
  let total = 0, missing = false;
  for (const code of codes) {
    const v = V.toTry(cash[code], code, r);
    if (v == null) missing = true; else total += v;
  }
  return debtRow({
    id: "debt-cash", mark: markOf(cardMark("")), title: "Nakit taksitler",
    meta: codes.length > 1 || codes[0] !== "TRY" ? codes.map(code => money(cash[code], code)) : ["kartsız taksitli harcamalar"],
    amount: fmt(total), sub: missing ? "kur yok" : null, popup: false, open: () => { location.hash = "#harcamalar"; },
  });
}

// Kredi ya da kişiyle borç / alacak: kalan, sıradaki ödeme ya da vade, gecikme; elle ödenen açık kayıtta satır içi Ödendi
function personDebtRow({ debt: d, status: st }, today, r) {
  const loan = d.kind === "loan", debt = B.side(d) === "debt";
  const name = debtName(d);
  const meta = [];
  if (d.party && d.desc) meta.push(d.desc);
  let progress = null;
  if (st.done) {
    meta.push(st.closed ? `kapandı ${fmtDayShort(d.closed)}` : debt ? "ödendi" : "alındı");
  } else if (!st.started) {
    meta.push(`${fmtDay(d.date)} tarihinde başlar`);
  } else {
    if (st.overdue > EPS) meta.push(el("span", "out-text", `${lateDays(st.overdueSince, today)} gün gecikti`));
    if (loan) {
      if (st.next) meta.push(`sonraki ${fmtDayShort(st.next.date)} ${money(st.next.amount, d.asset)}`);
      progress = progressBar(st.paidCount, st.count, `${st.paidCount}/${st.count} ödendi`);
    } else if (st.count > 1) {
      meta.push(`${money(d.amount / st.count, d.asset)}/ay · ${st.paidCount}/${st.count}`);
    } else if (d.due && !(st.overdue > EPS)) {
      meta.push(d.due === today ? "vade bugün" : `vade ${fmtDayShort(d.due)}`);
    } else if (!d.due) {
      meta.push("vadesiz");
    }
    // Türün varsayılanından farklıysa ödeme şekli: kişide otomatik, kredide elle
    if (loan ? !st.auto : st.auto) meta.push(st.auto ? "otomatik" : "elle");
  }
  const shown = st.done || !st.started ? d.amount : st.remaining;
  const acts = [];
  if (!st.auto && st.started && !st.done) {
    acts.push(rowAction("Ödendi", loan ? `${name} kredisine ödeme ekle` : debt ? `${name} borcuna ödeme ekle` : `${name} alacağına tahsilat ekle`,
      () => openPaySheet({ debtId: d.id })));
  }
  return debtRow({
    id: `debt-${d.id}`, mark: loan ? markOf(icon("bank")) : markOf(document.createTextNode(partyInitials(name))),
    title: name, meta, progress, amount: money(shown, d.asset), amountCls: st.done ? "" : debt ? "out" : "in",
    sub: tryNote(shown, d.asset, r) ?? (!st.done && st.started && st.paid > EPS ? `${money(st.paid, d.asset)} ${debt ? "ödendi" : "alındı"}` : null),
    muted: st.done, open: () => openDebtSheet(d), acts,
  });
}

// Kişinin kart payı: kalan (eksiyse fazla ödemiştir, borç tarafında görünür), ödemesi gelen, sıradaki taksit
function shareRow(s, today, settled = false) {
  const p = s.person;
  const over = s.remaining < -EPS;
  const late = s.dueNow > EPS ? shareLate(s, today) : 0;
  const meta = settled ? ["hepsini ödedi"] : over ? [`sana ${fmt(-s.remaining)} fazla ödedi · bu kadar ona borçlusun`]
    : [late > EPS ? el("span", "out-text", `${fmt(late)} gecikti`) : s.dueNow > EPS && `günü bugün ${fmt(s.dueNow)}`,
      s.next && `sonraki ${fmtDayShort(s.next.date)} ${fmt(s.next.amount)}`];
  const acts = [];
  if (!settled && !over) {
    acts.push(rowAction("Ödendi", `${nameWith(p.name, "den")} gelen ödemeyi kaydet`, () => openPaySheet({ personId: p.id })));
    const b = el("button", "icon-btn sm share-btn");
    b.type = "button";
    b.setAttribute("aria-label", `${p.name} için ödeme özetini gönder`);
    b.title = "Ödeme özetini gönder";
    b.append(icon("share"));
    b.addEventListener("click", e => { e.stopPropagation(); sharePerson(p, todayIndex()); });
    acts.push(b);
  }
  return debtRow({
    id: `share-${p.id}`, mark: avatar(p), title: p.name, meta,
    amount: fmt(settled ? s.charged : Math.abs(s.remaining)), amountCls: settled ? "" : over ? "out" : "in",
    muted: settled, open: () => openShareSheet(p.id), acts,
  });
}

els.debtSideSeg.addEventListener("click", e => {
  const side = e.target.closest("button")?.dataset.side;
  if (!side || side === debtSide) return;
  debtSide = side;
  debtClosedOpen = false;
  render();
});
els.trackNoteOk.addEventListener("click", () => { writePref(PREF.trackNotice, "1"); render(); });
// Özet'teki borç ödemesi satırı ve Varlıklar'daki eşitlik satırı Borçlarım'a götürür (bağlantı: #borclar)
for (const a of [els.heroDebt, els.assetEq]) a.addEventListener("click", () => { debtSide = "debt"; debtClosedOpen = false; });
els.balanceHintBtn.addEventListener("click", () => openEntrySheet(null, "TRY", { desc: "Açılış bakiyesi", personId: state.people[0]?.id }));

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

// Silme iki dokunuşla, pencerenin içinde: ilki düğmeyi "Evet, sil"e çevirir, ikincisi siler. Birkaç saniye içinde
// ikinci dokunuş gelmezse ya da pencere kapanırsa düğme eski haline döner. signal: yeniden çizilen listede eski düğmelerin
// kapanış dinleyicisi kaldırılsın.
function confirmTap(btn, run, signal) {
  const label = btn.querySelector("span");
  const text = label.textContent;
  let timer;
  const reset = () => {
    clearTimeout(timer);
    btn.classList.remove("armed");
    label.textContent = text;
  };
  btn.addEventListener("click", () => {
    if (!btn.classList.contains("armed")) {
      btn.classList.add("armed");
      label.textContent = "Evet, sil";
      timer = setTimeout(reset, 4000);
      return;
    }
    reset();
    run();
  });
  btn.closest("dialog").addEventListener("close", reset, signal ? { signal } : undefined);
}

// Seçili radyo etiketleri sınıfla işaretlenir (:has(:checked) her tarayıcıda güncellenmiyor)
function syncChecked(root) {
  for (const input of root.querySelectorAll("label > input[type=radio]")) {
    input.parentElement.classList.toggle("on", input.checked);
  }
}

function radioChip(name, value, label, checked, mark) {
  const chip = el("label", "chip");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  input.checked = checked;
  chip.append(input);
  if (mark) chip.append(mark);
  chip.append(document.createTextNode(label));
  return chip;
}

// ---------- Tekrar alanı (harcama ve giriş formlarında aynı) ----------
// Sıklık: bir kez, günde / haftada / ayda bir ya da Diğer (her N gün / hafta / ayda bir); tekrarlıysa kaç kez: süresiz
// ya da N kez. Form alanları: freq, every, unit, times, timesN.
function renderRepeat(box, x) {
  const r = R.rule(x);
  const freq = !r ? "" : r.every === 1 ? r.unit : "other";
  const input = (attrs, label) => {
    const i = Object.assign(document.createElement("input"), { type: "number", step: 1, inputMode: "numeric" }, attrs);
    i.setAttribute("aria-label", label);
    return i;
  };
  const group = (cls, label, children) => {
    const g = el("div", cls);
    g.setAttribute("role", "radiogroup");
    g.setAttribute("aria-label", label);
    g.append(...children);
    return g;
  };

  const every = el("div", "rep-every");
  every.hidden = freq !== "other";
  every.append(input({ name: "every", min: 1, max: R.MAX_EVERY, value: String(r?.every > 1 ? r.every : 2) }, "Kaç"),
    group("seg", "Birim", R.UNITS.map(u => {
      const l = el("label");
      l.append(Object.assign(document.createElement("input"), { type: "radio", name: "unit", value: u, checked: u === (r?.unit ?? "month") }),
        el("span", "", R.UNIT_IN[u]));
      return l;
    })),
    el("span", "", "bir"));

  const preset = !r || TIMES_PRESETS.some(([n]) => n === r.n);
  const other = el("label", "inline-input");
  other.append(el("span", "", "Diğer"),
    input({ name: "timesN", min: 2, max: R.MAX_REPEAT, placeholder: "kez", value: preset ? "" : String(r.n) }, "Kaç kez"));
  const times = el("div", "rep-times");
  times.hidden = !r;
  times.append(el("span", "field-label", "Kaç kez"),
    group("chips", "Kaç kez", TIMES_PRESETS.map(([n, label]) => radioChip("times", String(n), label, preset && n === (r?.n ?? 0)))),
    other);

  box.classList.add("repeat");
  box.replaceChildren(group("chips", "Sıklık", FREQ_PRESETS.map(([v, label]) => radioChip("freq", v, label, v === freq))), every, times);
}

// Formdaki tekrar → { rep: kayda yazılacak alanlar (tek seferlikte boş), error: hatalı alanın adı ya da null }
function readRepeat(f) {
  const freq = f.freq.value;
  if (!freq) return { rep: {}, error: null };
  const every = freq === "other" ? Math.round(Number(f.every.value)) : 1;
  const unit = freq === "other" ? f.unit.value : freq;
  const times = f.timesN.value !== "" ? Math.round(Number(f.timesN.value)) : Number(f.times.value || 0);
  const rep = { repeat: times, every, unit };
  const error = !(every >= 1 && every <= R.MAX_EVERY) ? "every" : R.count(rep) == null ? "timesN" : null;
  return { rep: error ? {} : R.fields(rep), error };
}

// Tekrar alanındaki değişiklik: Diğer ve kaç kez satırları açılır / kapanır; yazılan sayı hazır seçenekse o seçilir
function repeatInput(box, t) {
  const f = t.form;
  if (t.name === "freq") {
    box.querySelector(".rep-every").hidden = t.value !== "other";
    box.querySelector(".rep-times").hidden = !t.value;
    if (t.value === "other") { f.every.focus(); f.every.select(); }
  }
  if (t.name === "every") t.classList.remove("invalid");
  if (t.name === "times") { f.timesN.value = ""; f.timesN.classList.remove("invalid"); }
  if (t.name === "timesN") {
    const v = String(Math.round(Number(t.value)));
    for (const r of box.querySelectorAll('input[name="times"]')) r.checked = t.value === "" ? r.value === "0" : r.value === v;
  }
}

// "Bir kez", "Ayda bir · süresiz", "2 haftada bir · 10 kez"
function repeatText(x) {
  const r = R.rule(x);
  return r ? `${R.label(x)} · ${r.n ? `${r.n} kez` : "süresiz"}` : "Bir kez";
}

const REPEAT_ERRORS = { every: `Sıklık 1–${R.MAX_EVERY} arası olmalı.`, timesN: `Tekrar 2–${R.MAX_REPEAT} kez arası olmalı.` };

// ---------- Harcama formu ----------
// Görünen yalnızca temel alanlar: tutar (odakta), ne alındığı (önceki açıklamalardan öneri), taksit, kart; altta tek
// satır özet. Tarih (varsayılan bugün), kategori (kendiliğinden önerilir) ve kişi tek satır; dokununca açılır.
// Başka kartla ilk ödeme belirgin biçimde daha geç geliyorsa tek satır ipucu. Düzenlemede ödeme durumu ve planı;
// "Kopyala" aynısından yeni harcama açar. Varlık çıkışı da bu formdur: tekrar (her N gün / hafta / ayda bir) ve varlık
// (döviz / altın harcaması kartsız ve peşindir; kartsız harcama ödendikçe varlığın bakiyesinden düşer).
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
// Sayı → alana yazılan tutar, binlik ayraçla: 1250.5 → "1.250,5"
const amountText = (n, digits = 2) => n.toLocaleString("tr-TR", { maximumFractionDigits: digits });
// Birim fiyat alana: kuruşu hep yazılır, fonda 6 haneye kadar: 246.3 → "246,30", 0.959756 → "0,959756"
const priceText = n => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

// Tutar alanından çıkınca yazılan tutar binlik ayraçla yeniden yazılır (data-amount: ondalık basamak, varsayılan 2)
document.addEventListener("focusout", e => {
  const t = e.target;
  if (!t.matches?.("input[data-amount]")) return;
  const n = parseAmount(t.value);
  if (n > 0) t.value = t.name === "price" ? priceText(n) : amountText(n, Number(t.dataset.amount) || 2);
});

// draft: kayıtlı olmayan, önceden doldurulmuş harcama (e-postadan, kopyadan, varlık formundan; entryId: harcamaya
// dönüşecek eski varlık çıkışı)
function openPurchaseSheet(p, draft) {
  if (!state.people.length) { openPeopleSheet(); toast("Önce bir kişi ekle"); return; }
  editingId = p?.id ?? null;
  inboxDraftId = draft?.inboxId ?? null;
  convertingEntryId = !p && draft?.entryId ? draft.entryId : null;
  const src = p || draft;
  const f = els.purchaseForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  els.purchaseTitle.textContent = p ? "Harcamayı düzenle" : convertingEntryId ? "Çıkışı düzenle"
    : draft?.inboxId != null ? "E-postadan harcama" : "Yeni harcama";
  els.purchaseDelete.hidden = !p && !convertingEntryId;
  els.purchaseCopy.hidden = !p;
  planOpen = false;

  const count = src?.count ?? 1;
  const other = !COUNT_PRESETS.includes(count);
  els.countChips.replaceChildren(...[...COUNT_PRESETS, "other"].map(n => countTile(n, n === "other" ? other : n === count)));
  f.elements.count.value = count;
  els.countOther.hidden = !other;

  const cardId = p ? (p.cardId && cardById(p.cardId) ? p.cardId : "")
    : draft?.cardId && cardById(draft.cardId) ? draft.cardId
    : draft ? ""
    : (lastCardId != null && (lastCardId === "" || cardById(lastCardId)) ? lastCardId : state.cards[0]?.id ?? "");

  const personId = src?.personId && personById(src.personId) ? src.personId
    : personFilter !== "all" ? personFilter
    : personById(lastPersonId) ? lastPersonId : state.people[0].id;
  els.personChips.replaceChildren(...state.people.map(x =>
    radioChip("person", x.id, x.name, x.id === personId, dot(seriesVar(x)))));
  els.personField.hidden = state.people.length < 2;
  for (const d of [els.dateRow, els.repeatRow, els.categoryRow, els.personField, els.assetRow]) d.open = false;

  const code = T.assetOf(src);
  els.purchaseAssetChips.replaceChildren(...V.ASSETS.map(a => radioChip("asset", a.code, a.name, a.code === code)));
  renderRepeat(els.purchaseRepeat, src);

  f.elements.desc.value = src?.desc ?? "";
  f.elements.amount.value = src?.total ? amountText(src.total, V.asset(code).digits) : "";
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
  if (!p) f.elements.amount.focus();
  if (src?.desc && !categorySource) suggestCategory();   // düzenlenen ya da e-postadan gelen kategorisiz harcama
}

function renderCardChips(selected) {
  els.cardChips.replaceChildren(
    ...state.cards.map(c => radioChip("card", c.id, c.name, c.id === selected, cardMark(c.id))),
    radioChip("card", "", "Nakit / banka kartı", selected === "", cardMark("")));
  syncChecked(els.cardChips);
}

// Seçili kartla değil de başka kartla ilk ödeme en az 10 gün daha geç geliyorsa tek satır ipucu; dokununca o kart seçilir
function renderCardTip(cardId, date) {
  const tip = els.cardTip;
  tip.hidden = true;
  const card = cardById(cardId);
  if (!card || !date || editingId) return;
  const timing = I.cardTiming(state, date).filter(x => !x.full && B.tracked(x.card));   // hesaba katılmayan kart önerilmez
  const mine = timing.find(x => x.card.id === card.id), best = timing[0];
  if (!mine || !best || best.card.id === card.id || best.days - mine.days < 10) return;
  tip.textContent = `${best.card.name} ile alırsan bunu ${best.days - mine.days} gün daha geç ödersin (son ödeme ${fmtDayShort(best.due)}). Seçmek için dokun.`;
  tip.dataset.card = best.card.id;
  tip.hidden = false;
}

els.cardTip.addEventListener("click", () => {
  const input = els.cardChips.querySelector(`input[value="${CSS.escape(els.cardTip.dataset.card)}"]`);
  if (!input) return;
  input.checked = true;
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

// Açılır satırların değeri: tarih, tekrar, kategori, kişi, varlık
function renderRowValues() {
  const f = els.purchaseForm.elements, today = T.todayKey();
  const date = f.date.value;
  els.dateVal.textContent = !T.parseDate(date) ? "Tarih yok"
    : date === today ? "Bugün" : date === T.addDays(today, -1) ? "Dün" : fmtDay(date);
  els.repeatVal.textContent = repeatText(readRepeat(f).rep);
  els.categoryVal.textContent = K.category(f.category.value)?.name ?? "Seçilmedi";
  els.personVal.textContent = personById(f.person.value)?.name ?? "";
  els.assetVal.textContent = V.asset(f.asset.value)?.name ?? "";
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

// Düzenlenen harcamanın durumu: kaç taksit ödendi, kalan, sonraki ödeme; tekrarlayanda kaç kez işlendi, sonraki tekrar
function renderPurchaseStatus(p) {
  els.purchaseStatus.hidden = !p;
  if (!p) return;
  const today = T.todayKey();
  if (T.repeats(p)) {
    const n = R.rule(p).n, done = R.countUntil(p, today), next = R.nextDate(p, today);
    els.purchaseStatus.textContent = [`${done}${n ? `/${n}` : ""} kez işlendi`, next ? `sonraki ${fmtDay(next)}` : "bitti"].join(" · ");
    return;
  }
  const pays = paymentsOf(p), plan = T.planLength(p);
  const left = pays.filter(x => x.key >= today);
  const parts = plan > 1
    ? [`${plan - left.length}/${plan} taksit ödendi`, left.length ? `kalan ${money(left.reduce((s, x) => s + x.amount, 0), T.assetOf(p))}` : "bitti"]
    : [left.length ? "Ödenmedi" : "Ödendi"];
  if (left[0]) parts.push(`sonraki ${fmtDay(left[0].key)}`);
  els.purchaseStatus.textContent = parts.join(" · ");
}

// Taksit kutusu: taksit sayısı (Peşin / Diğer) ve altında tutarın o seçenekle aylık karşılığı (renderCountTiles)
function countTile(value, checked) {
  const tile = el("label", "count-tile");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "countPreset";
  input.value = String(value);
  input.checked = checked;
  const word = value === 1 || value === "other";
  tile.append(input, el("span", "n" + (word ? " word" : ""), value === 1 ? "Peşin" : word ? "Diğer" : String(value)), el("span", "per"));
  return tile;
}

const tileMoney = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

// Kutulardaki tutar: yazılan toplamsa taksit başına düşen, "Taksit başına"ysa toplam. Diğer seçiliyken yazılan sayı.
// Harcama formunda; borç formu kendi formunu, kutularını, sınırını, varlığını ve kısaltma eşiğini (5 dar kutu) verir.
function renderCountTiles(f = els.purchaseForm.elements, grid = els.countChips, { max = 60, code = "TRY", compact = 1e5 } = {}) {
  const amount = parseAmount(f.amount.value);
  const per = f.per.value === "1";
  const custom = Math.round(Number(f.count.value));
  const short = v => (code === "TRY" ? (v >= compact ? "₺" + fmtShort(v) : tileMoney.format(v))
    : code === "GAU" ? `${fmtShort(v)} gr` : V.asset(code).symbol + fmtShort(v));
  for (const tile of grid.children) {
    const v = tile.querySelector("input").value;
    const other = v === "other";
    const n = other ? (tile.classList.contains("on") && custom >= 1 && custom <= max ? custom : null) : Number(v);
    if (other) {
      tile.querySelector(".n").textContent = n ? String(n) : "Diğer";
      tile.querySelector(".n").classList.toggle("word", !n);
    }
    const value = amount > 0 && n ? (per ? amount * n : amount / n) : null;
    tile.querySelector(".per").textContent = value == null ? "" : short(value);
  }
}

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
    b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); action.run(); });
    h.append(b);
  }
}

function pickCategory(id, source, desc = null) {
  for (const r of els.categoryChips.querySelectorAll("input")) r.checked = r.value === id;
  categorySource = source;
  categoryFor = id ? desc : null;
  syncChecked(els.categoryChips);
  renderRowValues();
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
  if (categoryTouched || categorySource === "user" || !els.purchaseSheet.open) return;
  if (!desc) { pickCategory(null, null); setCategoryHint(""); return; }
  const known = K.remembered(desc, K.learned(state.installments));
  if (known) { pickCategory(known, "memory", desc); setCategoryHint("önceki seçimin"); return; }
  if (!YZ.enabled) {
    pickCategory(null, null);
    const label = YZ.mode === "cloud" ? "giriş yapınca önerilir" : YZ.mode === "off" ? "Yapay zekâ önersin" : null;
    setCategoryHint("", label && { label, run: openAiSheet });
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
  const asset = V.asset(f.asset.value) ? f.asset.value : "TRY";
  const foreign = asset !== "TRY";   // döviz / altın: kartsız, peşin
  const desc = f.desc.value.trim();
  const amount = V.round(parseAmount(f.amount.value), asset);
  const count = foreign ? 1 : Math.round(Number(f.count.value || 1));
  const date = T.parseDate(f.date.value) ? f.date.value : "";
  const { rep, error } = readRepeat(f);
  const errors = [];
  if (!(amount > 0)) errors.push("amount");
  if (!desc) errors.push("desc");
  if (!(count >= 1 && count <= 60)) errors.push("count");
  if (!date && (!editing?.firstDue || rep.repeat != null)) errors.push("date");   // tekrarlayan harcamanın tarihi olmalı
  if (error) errors.push(error);
  if (!personById(f.person.value)) errors.push("person");

  const total = f.per.value === "1" && count > 1 ? Math.round(amount * count * 100) / 100 : amount;
  const p = { desc, cardId: foreign ? null : f.card.value || null, count, total };
  if (foreign) p.asset = asset;
  Object.assign(p, rep);
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

// Tekrarlayan harcamanın ilk tekrarı (tek alışveriş olarak)
function firstOccurrence(p) {
  const { repeat, every, unit, ...one } = p;
  return one;
}

function updatePurchasePreview() {
  const { p, personId, errors } = collectPurchase();
  const code = T.assetOf(p), a = V.asset(code), rule = R.rule(p);
  const box = els.purchasePreview;
  box.replaceChildren();
  els.purchaseSum.replaceChildren();
  const today = T.todayKey();
  for (const b of els.dateChips.querySelectorAll("[data-day]")) {
    b.classList.toggle("on", els.purchaseForm.elements.date.value === T.addDays(today, Number(b.dataset.day)));
  }
  els.countField.hidden = els.cardField.hidden = code !== "TRY";
  els.purchaseForm.querySelector(".amount-input .cur").textContent = a.symbol;
  els.purchaseForm.elements.amount.dataset.amount = a.digits;
  els.perRow.hidden = !(p.count > 1);
  renderCountTiles();
  renderRowValues();
  renderCardTip(p.cardId, p.date);
  if (errors.some(e => e === "amount" || e === "count" || e === "date")) return;

  const card = cardById(p.cardId);
  const first = T.payments(firstOccurrence(p), card)[0].key;
  const pays = T.payments(p, card);
  els.purchaseSum.append(el("strong", "", (p.count > 1 ? `${p.count} × ${fmt(T.perInstallment(p))}` : money(p.total, code)) + (rule ? ` ${R.per(p)}` : "")),
    el("span", "", `${p.count > 1 ? `toplam ${fmt(p.total)} · ilk ödeme` : "ödeme"} ${fmtDayShort(first)}`));
  if (rule && p.date && !errors.some(e => e in REPEAT_ERRORS)) {
    box.append(el("div", "", `${R.label(p)} · ` + (rule.n ? `${rule.n} kez, son ${fmtDay(R.lastDate(p))}` : "bitiş tarihi yok")));
  }
  if (code !== "TRY") {
    const value = V.toTry(p.total, code, curRates());
    box.append(el("div", "", value == null ? "Kur alınamadı — TL karşılığı sonra hesaplanır"
      : `≈ ${fmt(value)} · ${code === "GAU" ? "1 gr" : `1 ${a.symbol}`} = ${fmt(rates.rates[code])}`));
  }
  // Kartsız harcama varlıktan ödenir: kişinin o varlıkta hareketi varsa bakiyesi önce / sonra
  const person = personById(personId);
  if (!card && p.date && person) {
    const own = x => x.personId === person.id;
    const entries = knownEntries().filter(e => own(e) && e.asset === code && e.id !== convertingEntryId);
    if (entries.length || code !== "TRY") {
      const others = cashPurchases().filter(x => own(x) && x.id !== editingId);
      const spent = B.addSpent(T.cashSpent(others, state.cards, today), B.debtSpent(state, today, person.id));
      const before = V.balances(entries, today, spent)[code] ?? 0;
      const after = V.balances([], today, T.cashSpent([p], [], today))[code] ?? 0;
      const total = V.round(before + after, code);
      box.append(el("div", total < 0 ? "warn" : "", `${person.name} · ${a.name.toLocaleLowerCase("tr-TR")} bakiyesi ${fmtAsset(before, code)} → ${fmtAsset(total, code)}`));
    } else {
      box.append(el("div", "", "Nakit · TL bakiyesinden düşer"));
    }
  }

  // Uyarı: kart limiti aşılıyor
  const t = card && p.date ? I.cardTiming(state, p.date).find(x => x.card.id === card.id) : null;
  if (t?.available != null) {
    const own = editingId ? state.installments.find(x => x.id === editingId) : null;
    const before = own && own.cardId === card.id ? T.outstanding(paymentsOf(own), today) : 0;
    const after = t.available + before - T.outstanding(pays, today);
    if (after < 0) box.append(el("div", "warn", `${card.name} limiti ${fmt(-after)} aşılır`));
  }
  // Takipteki kart: takipten sonra son ödeme günü geçmiş taksitler ödeyenin TL bakiyesinden düşer (elle ödenen kartta
  // elle moddan önceki ekstrelerde; sonrakiler Ödendi işaretlenene kadar ödenmemiş kalır); başkası için alınmışsa
  // takipten sonraki taksitleri ondan alacaktır (borc.js)
  const payer = state.people[0];
  if (card && B.tracked(card) && p.date && payer) {
    const since = B.since(card, today);
    const from = B.manual(card) && card.manualSince > since ? card.manualSince : since;   // elle modun başladığı gün
    const counted = pays.filter(x => x.key >= since && !(x.at > today));
    const past = counted.filter(x => x.key < today && !(B.manual(card) && x.key >= from));
    const unpaid = B.manual(card) ? counted.filter(x => x.key < today && x.key >= from) : [];
    const sum = list => list.reduce((s, x) => s + x.amount, 0);
    if (past.length) {
      box.append(el("div", "", `Bu harcamanın ${fmt(sum(past))} kadarı, son ödeme günü geçmiş ${new Set(past.map(x => x.key)).size} `
        + "ekstreye giriyor. Bu kısım ödenmiş sayılır ve TL bakiyenden düşer."));
    }
    if (unpaid.length) {
      box.append(el("div", "", `Bu harcamanın ${fmt(sum(unpaid))} kadarı, son ödeme günü geçmiş ${new Set(unpaid.map(x => x.key)).size} `
        + "ekstreye giriyor. Bu kısım için Borçlar'da “Ödendi”ye dokunana kadar o ekstreler gecikmiş görünür."));
    }
    if (person && person.id !== payer.id && counted.length) {
      box.append(el("div", "", `${person.name} bu harcama için sana ${fmt(sum(counted))} ödeyecek (Alacaklarım'a eklenir).`));
    }
  }
  if (!card && !p.date) box.append(el("div", "", "Excel'den aktarılan kayıt — tarih girmezsen ödeme ayı korunur"));
  // Düzenlemede ödeme planı
  if (editingId && pays.length > 1) {
    const details = el("details", "plan");
    details.open = planOpen;
    details.addEventListener("toggle", () => { planOpen = details.open; });
    details.append(el("summary", "", `Ödeme planı (${pays.length} ${rule ? "ödeme" : "taksit"})`));
    const ol = el("ol", "plan-list");
    for (const [i, x] of pays.entries()) {
      const li = el("li", x.key < today ? "paid" : "");
      li.append(el("span", "", `${rule ? i + 1 : x.no}. ${fmtDay(x.key)}`), el("span", "amount", money(x.amount, code)));
      ol.append(li);
    }
    details.append(ol);
    box.append(details);
  }
}

els.purchaseForm.addEventListener("input", e => {
  e.target.classList?.remove("invalid");
  const f = els.purchaseForm.elements;
  if (e.target.name === "countPreset") {
    const other = e.target.value === "other";
    els.countOther.hidden = !other;
    if (other) {
      // Hazır kutularda olmayan ilk sayıdan başlar (1 → 5, 6 → 7)
      let n = Math.round(Number(f.count.value)) || 1;
      do n++; while (COUNT_PRESETS.includes(n));
      f.count.value = Math.min(n, 60);
      f.count.focus();
      f.count.select();
    } else f.count.value = e.target.value;
  }
  // Yazılan / − + ile gelinen sayı hazır kutulardan biriyse o kutu seçilir (− + açık kalır)
  if (e.target.name === "count") {
    const n = Math.round(Number(e.target.value));
    els.countChips.querySelector(`input[value="${COUNT_PRESETS.includes(n) ? n : "other"}"]`).checked = true;
  }
  if (e.target.name === "category") {
    categoryTouched = true;
    categorySource = "user";
    suggestSeq++;
    setCategoryHint("");
    els.categoryRow.open = false;
  }
  if (e.target.name === "person") els.personField.open = false;
  if (e.target.name === "asset") els.assetRow.open = false;
  repeatInput(els.purchaseRepeat, e.target);
  if (e.target.name === "desc") {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(suggestCategory, SUGGEST_DELAY);
  }
  syncChecked(els.purchaseForm);
  updatePurchasePreview();
});

// Diğer: − / + ile taksit sayısı (1–60)
els.countOther.addEventListener("click", e => {
  const b = e.target.closest("[data-step]");
  if (!b) return;
  const input = els.purchaseForm.elements.count;
  input.value = Math.min(60, Math.max(1, (Math.round(Number(input.value)) || 1) + Number(b.dataset.step)));
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

els.dateChips.addEventListener("click", e => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  const input = els.purchaseForm.elements.date;
  input.value = T.addDays(T.todayKey(), Number(b.dataset.day));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  els.dateRow.open = false;
});

els.purchaseForm.addEventListener("submit", e => {
  e.preventDefault();
  const { p, personId, errors } = collectPurchase();
  const f = els.purchaseForm.elements;
  for (const name of ["desc", "amount", "count", "date", "every", "timesN"]) f[name].classList.toggle("invalid", errors.includes(name));
  if (errors.length) {
    const msg = { desc: "Ne aldığını yaz.", amount: "Tutarı gir.", count: "Taksit sayısı 1–60 arası olmalı.", date: "Harcama tarihini gir.",
      person: "Kişi seç.", ...REPEAT_ERRORS }[errors[0]];
    els.purchasePreview.replaceChildren(el("div", "warn", msg));
    if (errors[0] === "date") els.dateRow.open = true;
    if (errors[0] in REPEAT_ERRORS) els.repeatRow.open = true;
    f[errors[0]]?.focus?.();
    return;
  }
  clearTimeout(suggestTimer);   // bekleyen öneri: kayıttan sonra classifyAfterSave verir
  suggestSeq++;
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
  if (convertingEntryId) state.entries = state.entries.filter(x => x.id !== convertingEntryId);   // çıkış artık harcama
  convertingEntryId = null;
  if (inboxDraftId != null) {
    const inboxId = inboxDraftId;
    inbox = inbox.filter(x => x.row.id !== inboxId);
    window.syncInboxClaim?.([inboxId]);
  }
  inboxDraftId = null;
  if (p.categoryBy === "user") unsure.clear();   // yeni örnekle emin olunamayanlar yeniden denenebilir
  if (!p.asset) lastCardId = p.cardId || "";
  lastPersonId = personId;
  saveState();
  els.purchaseSheet.close();
  const nudge = !p.category && !YZ.enabled && YZ.mode !== "local" && !aiNudged;
  if (nudge) aiNudged = true;
  toast((editingId ? "Harcama güncellendi" : "Harcama eklendi")
    + (p.category ? ` · ${K.category(p.category).name}`
      : !nudge ? ""
      : YZ.mode === "cloud" ? " · giriş yapınca kategoriler otomatik önerilir" : " · kategori önerisi için Ayarlar → Yapay zekâ"));
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

confirmTap(els.purchaseDelete, () => {
  if (convertingEntryId) {
    state.entries = state.entries.filter(x => x.id !== convertingEntryId);
    convertingEntryId = null;
    saveState();
    els.purchaseSheet.close();
    toast("Çıkış silindi");
    render();
    return;
  }
  const p = state.installments.find(x => x.id === editingId);
  if (!p) return;
  state.installments = state.installments.filter(x => x.id !== p.id);
  editingId = null;
  saveState();
  els.purchaseSheet.close();
  toast("Harcama silindi");
  render();
});

for (const b of document.querySelectorAll("[data-add-purchase]")) {
  b.addEventListener("click", () => (view === "varliklar" ? openEntrySheet()
    : view === "borclar" ? openDebtSheet(null, { type: debtSide === "debt" ? "borrowed" : "lent" })
    : openPurchaseSheet()));
}

// ---------- Kart formu ----------
function readCardForm() {
  const f = els.cardForm.elements;
  return {
    name: f.name.value.trim(),
    limit: parseAmount(f.limit.value) || 0,
    cutoffDay: validDay(f.cutoffDay.value),
    dueDay: validDay(f.dueDay.value),
    last4: f.last4.value.replace(/\D/g, ""),
    color: Number(f.color.value) || 0,
  };
}

// Renk seçimi: kişi / kart paletindeki renkler (--s1…--s8)
function renderColorSwatches(selected) {
  els.cardColors.replaceChildren(...Array.from({ length: SERIES_COUNT }, (_, i) => {
    const label = el("label", "swatch" + (i === selected ? " on" : ""));
    label.style.setProperty("--c", seriesVar({ color: i }));
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "color";
    input.value = String(i);
    input.checked = i === selected;
    input.setAttribute("aria-label", `Renk ${i + 1}`);
    label.append(input);
    return label;
  }));
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
    f.elements.limit.value = c.limit ? amountText(c.limit) : "";
    f.elements.cutoffDay.value = c.cutoffDay;
    f.elements.dueDay.value = c.dueDay;
    f.elements.last4.value = c.last4 || "";
  }
  // Ekstre ödemesi: yeni kartta otomatik (son ödeme günü geçince ödendi sayılır)
  f.elements.payMode.value = !c ? "auto" : !B.tracked(c) ? "off" : B.manual(c) ? "manual" : "auto";
  syncChecked(els.cardPayMode);
  renderColorSwatches(c ? c.color % SERIES_COUNT : nextColor(state.cards));
  termChange = null;
  updateCardPreview();
  openSheet(els.cardSheet);
  if (!c) f.elements.name.focus();
}

function updateCardPreview() {
  const v = readCardForm();
  const existing = cardById(editingCardId);
  const stats = existing ? cardStats(existing) : { used: 0, next: null, nextTotal: 0 };
  const tile = cardTile(v, stats, "div");
  els.cardPreview.replaceWith(tile);
  tile.classList.add("cc-preview");
  tile.id = "cardPreview";
  tile.setAttribute("aria-hidden", "true");
  els.cardPreview = tile;

  updateTermChoices(existing, v);
  if (v.cutoffDay && v.dueDay) {
    const s = T.statementOf(withTerms(existing, v) || v, T.todayKey());
    els.cardHint.textContent = `Bugün bu kartla harcama yaparsan ${s.cut === T.todayKey() ? "bugün" : `${fmtDay(s.cut)} tarihinde`} `
      + `kesilecek ekstreye girer; son ödeme ${fmtDay(s.due)}.`;
  } else {
    els.cardHint.textContent = "Kesim ve son ödeme gününü kart ekstrende bulabilirsin.";
  }
  renderCardTrack(existing);
}

// Bugün bu karta ödeme girildiyse (borc.js cardPaidToday) takip ya da "Ben işaretlerim" yarın başlar. Yeniden hesaba
// katmada bugünkü ödeme, ödediği ekstreyle birlikte başlangıçtan önce kalır (bugünden başlasa sonraki ekstreleri
// kapatırdı); elle moda geçişte bugünkü ödeme otomatikteki gibi sayılır (bugünden başlasa ikinci kez düşerdi).
function startDay(card, today) {
  return card && B.cardPaidToday(state, card, today) ? T.addDays(today, 1) : today;
}

// Formdaki ekstre ödemesi: { on, since, auto } (auto: son ödeme günü geçince ödendi say). Takipteki kartın başlangıç
// günü korunur; takibe giren kart (yeni ya da hesaba katılmayan) bugünden (startDay) takipte. Geçmiş bir günden takip
// asistanla (MCP track_since) girilir.
function readTrack(existing, today) {
  const mode = els.cardForm.elements.payMode.value;
  const since = existing && B.tracked(existing) ? B.since(existing, today) : startDay(existing, today);
  return { on: mode !== "off", since, auto: mode === "auto" };
}

// Kartın takipten gelen etkisi (borc.js cardState, yalnızca bu kart): ödeyenin TL bakiyesinden düşen (D: kendiliğinden
// ödenmiş sayılan ekstreler ve kart ödemeleri), ödenmemiş ekstreler (late: günü geçmiş kapanmamış ekstreler) ve diğer
// kişilerin takipten sonraki taksitleri (shares: alacak)
function trackEffect(card, today) {
  const out = { D: 0, late: [], shares: {}, from: B.since(card, today) };
  if (!card || !B.tracked(card)) return out;
  const cs = B.cardState(state, card, today);
  const payer = state.people[0]?.id;
  out.D = cs.deduction;
  out.late = cs.statements.filter(x => x.state === "late");
  for (const x of cs.lines) if (x.personId !== payer) out.shares[x.personId] = (out.shares[x.personId] || 0) + x.amount;
  return out;
}

// Seçili ekstre ödemesinin anlamı (kart formunda her zaman görünür)
const PAY_MODE_TEXT = {
  auto: "Ekstre, son ödeme gününün ertesi günü ödenmiş sayılır ve TL bakiyenden düşer. Bankaya ödemeyi yine sen "
    + "yaparsın; uygulamada bir şeye dokunman gerekmez.",
  manual: "Ekstreyi ödeyince Borçlar'da “Ödendi”ye dokun; tutar o zaman TL bakiyenden düşer. Son ödeme günü geçer de "
    + "dokunmazsan ekstre “gecikti” görünür.",
  off: "Bu kartın borcu toplam borcuna girmez, ekstreleri TL bakiyeni etkilemez. Ödemesini senin yapmadığın kartlar "
    + "için (ör. eşinin kartı).",
};

// Sıradaki ekstre: kesildiyse tutarı ve son ödeme günü, kesilmediyse şimdiye kadarki harcamalar ve kesim günü
function nextStatementText(cd) {
  const n = cd.next;
  return n.cut ? `Ekstre kesildi: ${fmt(n.amount)} · son ödeme ${fmtDayShort(n.date)}`
    : `Bu dönemki harcamalar: ${fmt(n.amount)} · kesim ${fmtDayShort(cd.open.cut)} · son ödeme ${fmtDayShort(n.date)}`;
}

// Kartın borcu kısa satırlar hâlinde (kart formu, kartın ödeme formu): gecikmiş, son günü bugün olan, sıradaki ekstre,
// kart borcu (ya da fazla ödenen), diğer kişilerin harcamaları
function cardDebtLines(card, cd, today) {
  const manual = manualCard(card, today);
  const payer = state.people[0]?.id;
  const out = [];
  if (manual && cd.overdue > EPS) out.push(`Gecikmiş: ${fmt(cd.overdue)} (${lateDays(cd.overdueSince, today)} gün)`);
  if (manual && cd.unpaid - cd.overdue > EPS) out.push(`Son gün bugün: ${fmt(cd.unpaid - cd.overdue)}`);
  if (cd.next && !(manual && cd.unpaid > EPS && cd.next.date <= today)) out.push(nextStatementText(cd));
  out.push(cd.total > EPS ? `Kart borcu: ${fmt(cd.total)}` : cd.credit > EPS ? `Karta ${fmt(cd.credit)} fazla ödedin` : "Kartta borç yok");
  for (const p of state.people) {
    if (p.id !== payer && cd.byPerson[p.id] > EPS) out.push(`${nameWith(p.name, "in")} harcamaları: ${fmt(cd.byPerson[p.id])} (kart borcuna dahil)`);
  }
  return out;
}

// Kart formundaki ekstre ödemesi: seçili seçeneğin anlamı ve seçim değişince kaydın etkisi (trackChange); üstünde
// kayıtlı kartın borcu satır satır
function renderCardTrack(existing) {
  const today = T.todayKey();
  const cd = existing ? B.cardDebt(state, existing, today) : null;
  els.cardDebt.hidden = !cd;
  els.cardDebtLink.hidden = !(cd?.total > EPS);
  // "Ben işaretlerim" kartının ödemeleri (erken ödemeyi silmek için de): kartın ödeme formu
  els.cardPaysLink.hidden = !(manualCard(existing) && cardPayments(existing.id).length);
  if (cd) els.cardDebt.textContent = cardDebtLines(existing, cd, today).join("\n");
  const change = trackChange(existing, readTrack(existing, today), today);
  els.trackPreview.replaceChildren(el("div", "", PAY_MODE_TEXT[els.cardForm.elements.payMode.value]),
    ...(change ? [el("div", change.warn ? "warn" : "track-change", change.text)] : []));
}

// Kayıtlı kartta seçim değişince kaydın etkisi { text, warn? } (ödeyenin TL bakiyesi, borç, alacak) ya da kaydı
// engelleyen durum (R3); değişmediyse null
function trackChange(card, track, today) {
  if (!card) return null;
  const lost = autoPrepaid(card, track, today);
  if (lost > EPS) return { text: prepaidText(card, track.since, today, lost), warn: true };
  const tracked = B.tracked(card);
  if (tracked === track.on && (!track.on || B.manual(card) === !track.auto)) return null;
  const after = withTracking(card, track, today);
  const b = trackEffect(card, today), a = trackEffect(after, today);
  const others = state.people.some(p => Math.abs((a.shares[p.id] || 0) - (b.shares[p.id] || 0)) > EPS);
  const paidToday = "Bu karta bugün ödeme girdiğin için ";
  if (!track.on) {
    return { text: "Kaydedince: kartın borcu toplam borcundan çıkar"
      + (b.D > EPS ? `; bu kart için şimdiye kadar TL bakiyenden düşen ${fmt(b.D)} geri eklenir` : "")
      + (others ? "; kartını kullananların harcamaları Alacaklarım'dan çıkar" : "") + "." };
  }
  if (!tracked) {
    const total = B.cardDebt(state, after, today).total;
    const later = track.since > today;
    return { text: (later ? `${paidToday}kart yarından itibaren hesaba katılır. ` : "")
      + `Kaydedince: son ödeme günü ${later ? "yarın" : "bugün"} ya da sonra olan ekstreler TL bakiyenden düşer, eskiler etkilemez`
      + (total > EPS ? `; kartın ${fmt(total)} borcu toplam borcuna eklenir` : "")
      + (others ? "; kartını kullananların harcamaları Alacaklarım'a girer" : "") + "." };
  }
  if (!track.auto) {
    return { text: after.manualSince > today ? `${paidToday}“Ben işaretlerim” yarın başlar; önceki ekstreler ödenmiş kalır.`
      : "Kaydedince: önceki ekstreler ödenmiş kalır; bundan sonrakileri sen işaretlersin." };
  }
  if (!b.late.length) return null;
  const late = b.late.reduce((s, x) => s + x.amount - x.covered, 0);
  return { text: `Kaydedince: “Ödendi” demediğin ${b.late.length} ekstre (${fmt(late)}) ödenmiş sayılır ve TL bakiyenden `
    + "düşer. Gerçekten ödemediysen “Ben işaretlerim”de kal." };
}

// "Ben işaretlerim"den otomatiğe dönüşte önceki ekstrelerde eriyecek erken ödeme (borc.js cardPrepaid; R3). Hesaba
// katılmazken "Ben işaretlerim"de kalmış kart da yeniden otomatik hesaba katılırken denetlenir.
function autoPrepaid(card, { on, since, auto }, today) {
  if (!card || !on || !auto || !B.manual(card)) return 0;
  return B.cardPrepaid(state, { ...card, trackOff: false, trackSince: since }, today);
}
// Engelin metni (lost: otomatikte sayılmayacak tutar, borc.js cardPrepaid): kaydedilen ödemelerin bugüne kadarki (bugün
// dahil) ekstreleri aşan kısmı, yani son ödeme günü gelmemiş ekstreler için ödenen; o kadarı çıkarılınca engel kalkar.
// Aşan yoksa engel son ödeme günü bugün olan ekstreye kaydedilen ödemeden: otomatikte o ekstre ancak yarın ödenmiş
// sayılır, bugün geçilirse TL bakiyesi bugünlük yüksek görünür; otomatiğe yarın geçilir.
function prepaidText(card, since, today, lost) {
  const cs = B.cardState(state, { ...card, trackOff: false, trackSince: since }, today);
  const ahead = cs.deduction - cs.statements.filter(x => x.key <= today).reduce((s, x) => s + x.amount, 0);
  if (!(ahead > EPS)) {
    return "“Otomatik”e bugün geçilemiyor: son ödeme günü bugün olan ekstre “Otomatik”te ancak yarın ödenmiş sayılır; bugün "
      + `geçersen ona yaptığın ödeme yüzünden TL bakiyen bugünlük ${fmt(lost)} yüksek görünür. Yarın geçebilirsin.`;
  }
  // Erken ödemenin kapattığı son ileriki ekstre: onun son ödeme günü geçince engel kendiliğinden kalkar (kart borcunu da
  // aşan ödemede bu gün yok). lost erken ödemeden büyükse son ödeme günü bugün olan ekstreye yapılan ödeme de bugün sayılmaz.
  const last = cs.prepaid > EPS ? null : cs.statements.filter(x => x.key > today && x.covered > EPS).at(-1);
  return `“Otomatik”e geçilemiyor: bu karta, son ödeme günü gelmemiş ekstreler için ${fmt(ahead)} erken ödeme kaydettin; `
    + `“Otomatik”te ödemelerinin ${fmt(lost)} kadarı ${last ? `${fmtDayShort(last.key)} gününe kadar ` : ""}sayılmaz, TL bakiyen o `
    + "kadar yüksek görünür. " + (last ? `${fmtDayShort(T.addDays(last.key, 1))} günü “Otomatik”e geçebilirsin; hemen geçmek için `
      : "Geçmek için önce ") + `“Kart ödemelerin”den bu ödemeyi sil ya da ${fmt(ahead)} kadar azalt`
    + (lost > ahead + EPS ? " (son ödeme günü bugün olan ekstre yüzünden en erken yarın)." : ".");
}

// Formdaki seçim karta yazılır: hesaba katılmayan kartta trackOff (trackSince ve manualSince saklanır), takipte başlangıç
// günü (trackOff kalkar). Otomatikten "Ben işaretlerim"e geçişte manualSince bugün (bugün ödeme varsa yarın, startDay);
// takibe giren kartta takibin başladığı gün (R2). "Ben işaretlerim"den otomatiğe manualSince silinir (R3: erken ödeme
// varsa kayıt engellenir); "Ben işaretlerim"de kalan kartta değişmez.
function withTracking(card, { on, since, auto }, today) {
  const { trackOff, manualSince, ...rest } = card;
  const before = cardById(card.id);
  if (!on) return { ...rest, ...(manualSince && { manualSince }), trackOff: true };
  if (auto) return { ...rest, trackSince: since };
  if (before && B.manual(before)) return { ...rest, trackSince: since, manualSince: before.manualSince };
  return { ...rest, trackSince: since, manualSince: before && B.tracked(before) ? startDay(before, today) : since };
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
    ? `${fmtDay(open.cut)} tarihinde kesilecek ekstrede ${open.count} harcama (${fmt(open.total)}) var. Günler değişince bunlar hangi ekstreye girsin?`
    : "Bu karttaki harcamaların ödeme tarihleri değişecek. Nasıl hesaplansın?";
  const text = {
    old: ["Bu ekstre eski günlerle kesilsin",
      `${fmtDay(open.cut)} kesilir, ${fmtDay(open.due)} tarihinde ödenir; sonraki ekstreler yeni günlerle`],
    new: ["Yeni günler hemen başlasın", open.count
      ? `Kesilmiş ekstreler değişmez; henüz kesilmemiş harcamalar ${fmtDay(next.cut)} tarihinde kesilecek ekstreye girer, son ödeme ${fmtDay(next.due)}`
      : "Kesilmiş ekstreler olduğu gibi kalır; bundan sonrakiler yeni günlerle"],
    fix: ["Günleri yanlış girmiştim", "Geçmiş ekstreler dahil hepsi yeni günlerle yeniden hesaplanır. Bu kartın günlerini daha önce değiştirdiysen o değişiklikler olduğu gibi kalır. Geçmiş ekstrelerin tutarı ve TL bakiyen değişebilir."],
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
  if (e.target.name === "color") syncChecked(els.cardColors);
  if (e.target.name === "payMode") syncChecked(els.cardPayMode);
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
    toast("Günler değişiyor: harcamaların hangi ekstreye gireceğini aşağıdan seç.");
    return;
  }
  const today = T.todayKey();
  const before = cardById(editingCardId);
  const track = readTrack(before, today);
  // "Ben işaretlerim"den otomatiğe dönüş: erken ödeme önceki ekstrelerde eriyecekse engellenir (R3)
  if (autoPrepaid(before, track, today) > EPS) {
    els.cardPayMode.querySelector("input:checked")?.focus();
    toast(trackChange(before, track, today).text);
    return;
  }
  if (!v.last4) delete v.last4;

  // Ekstre ödemesi (trackSince / trackOff / manualSince) formdan; diğer alanlar ve günlerin geçmişi korunur
  if (editingCardId) {
    state.cards = state.cards.map(c => {
      if (c.id !== editingCardId) return c;
      const { last4, history, ...rest } = withTerms(c, v);
      return withTracking({ ...rest, ...(v.last4 && { last4 }), ...(history && { history }) }, track, today);
    });
  } else {
    state.cards.push(withTracking({ id: uid(), ...v }, track, today));   // yeni kart varsayılan olarak bugünden takipte (borc.js)
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
  const isPay = x => x.kind === "payment" && x.cardId === c.id;   // kartın ekstre ödemeleri kartla gider
  const k = state.debts.filter(isPay).length;
  // Takipteki kartın düşülen ekstreleri (kart ödemeleri dahil) kartla birlikte geri gelir
  const eff = trackEffect(c, T.todayKey());
  const back = eff.D > EPS ? `\nBu kart için ${fmtDay(eff.from)} tarihinden beri TL bakiyenden düşen ${fmt(eff.D)} geri eklenir.` : "";
  const owned = [n && `${n} harcama`, k && `${k} kart ödemesi`].filter(Boolean).join(" ve ");
  if (!confirm(`“${c.name}” kartı silinsin mi?` + (owned ? ` Karttaki ${owned} ${k ? "de" : "da"} silinir.` : "") + back)) return;
  state.cards = state.cards.filter(x => x.id !== c.id);
  state.installments = state.installments.filter(p => p.cardId !== c.id);
  state.debts = state.debts.filter(x => !isPay(x));
  if (lastCardId === c.id) lastCardId = null;
  editingCardId = null;
  saveState();
  els.cardSheet.close();
  toast("Kart silindi");
  render();
});

els.addCard.addEventListener("click", () => openCardSheet());

// Elle ödenen kartın ekstre ödemeleri: kartın ödeme formu (önceki ödemeler altta; düzenlenir, silinir)
els.cardPaysLink.addEventListener("click", () => {
  const id = editingCardId;
  els.cardSheet.close();
  editingCardId = null;
  openPaySheet({ cardId: id });
});

// Kartın borcu Borçlar'da: Borçlarım'da kartın satırına kaydırılır
els.cardDebtLink.addEventListener("click", () => {
  const id = editingCardId;
  els.cardSheet.close();
  debtSide = "debt";
  debtClosedOpen = false;
  pendingScroll = `debt-card-${id}`;
  if (view === "borclar") render(); else location.hash = "#borclar";
});

// ---------- Varlık girişi formu ----------
// Çıkış harcama formudur (kart, taksit, tekrar, döviz / altın): "Çıkış" seçilince yazılanlarla harcama formu açılır.
// Eski sürümlerden kalan çıkış hareketi de harcama formunda açılır; kaydedilince harcamaya dönüşür.
// Fon ve hisse bu formda alınır ve satılır (Alış / Satış): kod (fonda adla da aranır; TEFAS listesinden öneri), adet,
// birim fiyat (bulununca güncel fiyatla dolar; kâr için) ve tutarın TL bakiyesine işlenip işlenmeyeceği. Tekrarlamaz.
// Döviz ve altın: tek seferlik giriş kurla TL'den alınabilir ("TL bakiyemden düşülsün"; işaretsizse gelir), Bozdur
// TL'ye çevirir (kurla, TL bakiyesine eklenir). Alış ve bozdurma aktarımdır: gelir ya da gider değildir.
// asset: varlık kodu ("TRY", "BIST:THYAO") ya da pazar ("FON", "BIST")
// draft: kayıtlı olmayan, önceden doldurulmuş hareket ({ desc, repeat, personId? }; içgörüdeki "Gelir ekle", Borçlar'daki
// "Bakiye gir")
const ENTRY_KINDS = [...V.ASSETS.map(a => ({ code: a.code, name: a.name })), ...Object.entries(V.MARKETS).map(([code, m]) => ({ code, name: m.name }))];

function openEntrySheet(e, asset, draft) {
  if (!state.people.length) { openPeopleSheet(); toast("Önce bir kişi ekle"); return; }
  if (e && e.amount < 0 && !V.market(e.asset) && !V.settled(e)) {
    openPurchaseSheet(null, { entryId: e.id, personId: e.personId, desc: e.desc, total: -e.amount, asset: e.asset, date: e.date, ...R.fields(e) });
    return;
  }
  editingEntryId = e?.id ?? null;
  const f = els.entryForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  els.entryDelete.hidden = !e;

  const code = e?.asset ?? asset ?? lastAsset;
  const m = V.market(code);
  const kind = m ? m.market : V.MARKETS[code] || V.asset(code) ? code : "TRY";
  els.assetChips.replaceChildren(...ENTRY_KINDS.map(a => radioChip("asset", a.code, a.name, a.code === kind)));
  const personId = e ? e.personId
    : personById(draft?.personId) ? draft.personId
    : entryFilter !== "all" ? entryFilter
    : personById(lastPersonId) ? lastPersonId : state.people[0].id;
  els.entryPersonChips.replaceChildren(...state.people.map(x =>
    radioChip("person", x.id, x.name, x.id === personId, dot(seriesVar(x)))));

  f.elements.dir.value = !e || e.amount > 0 ? "in" : m ? "out" : "sell";
  f.elements.ticker.value = m?.ticker ?? "";
  f.elements.amount.value = e ? amountText(Math.abs(e.amount), V.asset(e.asset)?.digits) : "";
  f.elements.price.value = e?.price > 0 ? priceText(e.price) : "";
  f.elements.settle.checked = e ? e.settle === true : !!m || V.MARKETS[kind] ? lastSettle : false;
  priceTouched = !!e;
  f.elements.desc.value = e?.desc ?? draft?.desc ?? "";
  f.elements.date.value = e?.date ?? T.todayKey();
  renderRepeat(els.entryRepeat, e ?? draft);
  syncChecked(f);
  updateEntryForm();
  openSheet(els.entrySheet);
  if (!e) (V.MARKETS[kind] && !m ? f.elements.ticker : f.elements.amount).focus();
}

// Formdaki fon / hisse: { kind: "FON" | "BIST", code: "FON:AFT" | null, query }
function entryMarket() {
  const f = els.entryForm.elements;
  const kind = f.asset.value;
  if (!V.MARKETS[kind]) return null;
  const query = f.ticker.value.trim();
  return { kind, query, code: V.marketCode(kind, query) };
}

// Kodun durumu: bulundu ({ price, … }), "loading", "missing" (yok), "error" ya da null (sorulamadı / bilinmiyor)
function quoteState(code) {
  return prices?.prices?.[code] ?? lookups.get(code) ?? (V.market(code)?.market === "FON" && fundListLoading ? "loading" : null);
}

// Formda fiyat / kur alanı var mı: fon ve hissede hep, döviz ve altında tek seferlik giriş ve bozdurmada
function entryPriced(f = els.entryForm.elements) {
  if (entryMarket()) return true;
  if (!V.tradable(f.asset.value)) return false;
  return f.dir.value === "sell" || (f.dir.value === "in" && !f.freq?.value);
}

function collectEntry() {
  const f = els.entryForm.elements;
  const mk = entryMarket();
  const sell = !mk && V.tradable(f.asset.value) && f.dir.value === "sell";   // döviz / altın bozdurma
  const priced = entryPriced(f);
  const asset = mk ? mk.code ?? "" : f.asset.value;
  const amount = mk ? Math.round(parseAmount(f.amount.value) * 1e4) / 1e4 : V.round(parseAmount(f.amount.value), asset);
  const price = priced ? parseAmount(f.price.value) : NaN;
  const settle = priced && (sell || f.settle.checked);
  const desc = f.desc.value.trim();
  const date = T.parseDate(f.date.value) ? f.date.value : "";
  const { rep, error } = mk || sell ? { rep: {} } : readRepeat(f);
  const out = (mk && f.dir.value === "out") || sell;
  const errors = [];
  if (mk && (!mk.code || quoteState(mk.code) === "missing")) errors.push("ticker");
  if (!(amount > 0)) errors.push("amount");
  if (priced && (f.price.value.trim() ? !(price > 0) : settle)) errors.push("price");
  if (!desc && !mk && !settle) errors.push("desc");
  if (!date) errors.push("date");
  if (error) errors.push(error);
  if (!personById(f.person.value)) errors.push("person");
  const e = { personId: f.person.value, asset, amount: out ? -amount : amount, desc, date, ...rep };
  if (price > 0) e.price = price;
  if (price > 0 && settle) e.settle = true;
  return { e, errors };
}

// Fon / hisse alanı: kodun önerileri (fonda listeden arama; boşken eldekiler) ve bulunan fon / hisse
function renderTicker(mk) {
  const f = els.entryForm.elements;
  const fund = mk.kind === "FON";
  els.entryTickerLabel.textContent = fund ? "Fon" : "Hisse";
  f.ticker.placeholder = fund ? "Kod ya da ad, örn. AFT" : "İşlem kodu, örn. THYAO";
  if (fund) loadFundList();
  const st = mk.code ? quoteState(mk.code) : null;
  if (mk.code && !st) lookupPrice(mk.code);
  const found = st && typeof st === "object";

  // Öneriler: fonda yazılana uyanlar (kod tam bulunduysa yok), boşken bu pazardaki eldekiler
  let list = [];
  if (!mk.query) {
    list = marketCodes().filter(c => V.market(c).market === mk.kind).map(c => ({ code: V.market(c).ticker, name: marketName(c) }));
  } else if (fund && fundList && !(found && mk.query.toLocaleUpperCase("en-US") === V.market(mk.code).ticker)) {
    list = V.matchFunds(fundList, mk.query, 6).map(x => ({ code: x.code, name: fundName(x.name) }));
  }
  els.entryTickerList.replaceChildren(...list.map(x => {
    const b = el("button", "ticker-opt");
    b.type = "button";
    b.append(el("b", "", x.code), el("span", "", fund ? x.name : ""));
    b.addEventListener("click", () => {
      f.ticker.value = x.code;
      f.ticker.classList.remove("invalid");
      f.price.value = "";
      priceTouched = false;
      updateEntryForm();
      f.amount.focus();
    });
    return b;
  }));

  const info = els.entryTickerInfo;
  info.className = "ticker-info";
  if (!mk.query) info.textContent = "";
  else if (found) {
    const x = st;
    const parts = [fund ? fundName(x.name ?? "") : `${V.market(mk.code).ticker} · Borsa İstanbul`, fmtPrice(x.price, mk.code)];
    if (fund && x.date) parts.push(`${fmtDayShort(x.date)} fiyatı`);
    if (!fund && x.prev > 0) {
      const ch = x.price / x.prev - 1;
      parts.push(`bugün ${ch > 0.00005 ? "+" : ch < -0.00005 ? "−" : ""}${fmtPct(ch)}`);
    }
    info.textContent = parts.filter(Boolean).join(" · ");
  } else if (!mk.code) info.textContent = fund ? (list.length ? "" : fundList ? "Bu adla ya da kodla fon bulunamadı." : "Fon kodunu yaz (3 harf).")
    : "İşlem kodunu yaz (ör. THYAO).";
  else if (st === "loading") info.textContent = "Aranıyor…";
  else if (st === "missing") { info.textContent = fund ? "TEFAS'ta bu kodla fon yok." : "Borsa İstanbul'da bu kodla hisse yok."; info.classList.add("warn"); }
  else info.textContent = "Fiyat şu an alınamadı; adetle kaydedebilirsin.";
  // Bulunan fiyat, kullanıcı yazmadıysa birim fiyata
  if (found && !priceTouched && !f.price.value) f.price.value = priceText(st.price);
}

function updateEntryForm() {
  const f = els.entryForm.elements;
  const mk = entryMarket();
  const fx = !mk && V.tradable(f.asset.value);   // döviz / altın
  if (!fx && f.dir.value === "sell") f.dir.value = "in";
  const sell = fx && f.dir.value === "sell";
  const out = (mk && f.dir.value === "out") || sell;
  const priced = entryPriced(f);
  els.entryTitle.textContent = mk ? `${editingEntryId ? "" : "Yeni "}${out ? "satış" : "alış"}${editingEntryId ? "ı düzenle" : ""}`
    .replace(/^./, c => c.toLocaleUpperCase("tr-TR"))
    : sell ? (editingEntryId ? "Bozdurmayı düzenle" : "Bozdur")
    : editingEntryId ? "Girişi düzenle" : "Yeni giriş";
  els.entryInText.textContent = mk ? "Alış" : "Giriş";
  els.entryOutText.textContent = mk ? "Satış" : "Çıkış";
  els.entrySellOpt.hidden = !fx;
  els.entryTickerField.hidden = !mk;
  els.entryPriceField.hidden = !priced;
  els.entryRepeatField.hidden = !!mk || sell;
  els.entryAmountLabel.textContent = mk ? "Adet" : "Miktar";
  els.entryPriceLabel.replaceChildren(mk ? "Birim fiyat " : f.asset.value === "GAU" ? "Gram fiyatı " : "Kur ",
    el("small", "", mk ? "(kâr / zarar için)" : "(TL)"));
  // Bozdurma hep TL'ye eklenir; döviz / altın girişinde işaretsizse gelir
  f.settle.closest("label").hidden = sell;
  els.entrySettleText.textContent = out ? "Tutar TL bakiyeme eklensin" : fx ? "TL'yle aldım: tutar TL bakiyemden düşülsün" : "Tutar TL bakiyemden düşülsün";
  f.desc.placeholder = mk || (fx && (sell || f.settle.checked)) ? "İsteğe bağlı not" : "örn. Maaş, altın alımı";
  if (mk) renderTicker(mk);
  // Döviz / altın: kur alanı TL'yle alış ya da bozdurmada güncel kurla dolar
  if (fx && priced && (sell || f.settle.checked) && !priceTouched && !f.price.value && curRates()?.[f.asset.value]) {
    f.price.value = priceText(curRates()[f.asset.value]);
  }

  const { e, errors } = collectEntry();
  const a = mk ? null : V.asset(e.asset);
  els.entryUnit.hidden = !!mk;
  if (!mk) els.entryUnit.textContent = a.symbol;
  f.amount.dataset.amount = mk ? 4 : a.digits ?? 2;
  f.amount.placeholder = mk ? "0" : "0,00";

  const n = V.repeatOf(e);
  els.entryDateLabel.textContent = n != null ? "İlk tarih" : "Tarih";

  const box = els.entryPreview;
  box.replaceChildren();
  if (errors.includes("amount")) return;
  const r = curRates();
  const today = T.todayKey();
  const person = personById(e.personId);
  if (mk) {
    if (!mk.code) return;
    const ticker = V.market(mk.code).ticker;
    box.append(el("div", "big", `${fmtAsset(e.amount, e.asset, true)} ${ticker}`));
    const trade = V.tradeValue(e), now = V.toTry(Math.abs(e.amount), e.asset, r);
    if (trade != null) box.append(el("div", "", `${out ? "Satış" : "Alış"} tutarı ${fmt(Math.abs(trade))} · ${unitFmt.format(Math.abs(e.amount))} × ${fmtPrice(e.price, e.asset)}`));
    if (now != null && (trade == null || Math.abs(Math.abs(trade) - now) > 0.005)) box.append(el("div", "", `Güncel fiyatla ≈ ${fmt(now)}`));
    if (!person) return;
    const others = knownEntries().filter(x => x.personId === person.id && x.id !== editingEntryId);
    const before = V.balances(others, today, B.spent(state, today, person.id));
    const when = e.date > today ? ` (${fmtDayShort(e.date)} tarihinde)` : "";   // tarihi gelmemiş hareket tarihinde işlenir
    const held = before[e.asset] ?? 0, left = V.round(held + e.amount, e.asset);
    box.append(el("div", left < 0 ? "warn" : "", left < 0 ? `${person.name} · elinde ${fmtAsset(held, e.asset)} ${ticker} var`
      : `${person.name} · ${ticker} ${fmtAsset(held, e.asset)} → ${fmtAsset(left, e.asset)}${when}`));
    if (e.settle) {
      const tl0 = before.TRY ?? 0, tl1 = V.round(tl0 - V.settled(e), "TRY");
      box.append(el("div", tl1 < 0 ? "warn" : "", `TL bakiyesi ${fmtAsset(tl0, "TRY")} → ${fmtAsset(tl1, "TRY")}${when}`));
    }
    return;
  }
  box.append(el("div", "big", fmtAsset(e.amount, e.asset, true) + (n != null ? " " + R.per(e) : "")));
  if (V.settled(e)) {
    box.append(el("div", "", `${e.amount < 0 ? "Bozdurma" : "Alış"} tutarı ${fmt(Math.abs(V.tradeValue(e)))} · ${fmtAsset(Math.abs(e.amount), e.asset)} × ${fmtPrice(e.price, e.asset)}`));
  } else if (e.asset !== "TRY") {
    const value = V.toTry(Math.abs(e.amount), e.asset, r);
    box.append(el("div", "", value == null ? "Kur alınamadı — TL karşılığı sonra hesaplanır"
      : `≈ ${fmt(value)} · ${a.code === "GAU" ? "1 gr" : `1 ${a.symbol}`} = ${fmt(r[e.asset])}`));
  }
  if (n != null && e.date) {
    const done = V.processedCount(e, today), next = V.nextDate(e, today);
    box.append(el("div", "", `${R.label(e)} · ` + (n ? `${n} kez, son ${fmtDay(V.lastDate(e))}` : "bitiş tarihi yok")));
    box.append(el("div", "", [done && `Bugüne kadar ${done} kez işlendi`, next && `${done ? "sonraki" : "İlki"} ${fmtDay(next)}`]
      .filter(Boolean).join(" · ")));
  }
  if (person && !errors.some(x => x in REPEAT_ERRORS)) {
    const spent = B.spent(state, today, person.id);   // nakit harcamalar ve borç etkileri
    const bals = V.balances(state.entries.filter(x => x.personId === person.id && x.id !== editingEntryId), today, spent);
    // Tarihi gelmemiş tek seferlik hareket bakiyeye tarihinde girer
    const later = n == null && e.date > today;
    const when = later ? ` (${fmtDayShort(e.date)} tarihinde)` : "";
    const before = bals[e.asset] ?? 0, after = V.round(before + e.amount * (later || !e.date ? 1 : V.processedCount(e, today)), e.asset);
    box.append(el("div", after < 0 ? "warn" : "", `${person.name} · ${a.name.toLocaleLowerCase("tr-TR")} bakiyesi ${fmtAsset(before, e.asset)} → ${fmtAsset(after, e.asset)}${when}`));
    if (V.settled(e)) {
      const tl0 = bals.TRY ?? 0, tl1 = V.round(tl0 - V.settled(e), "TRY");
      box.append(el("div", tl1 < 0 ? "warn" : "", `TL bakiyesi ${fmtAsset(tl0, "TRY")} → ${fmtAsset(tl1, "TRY")}${when}`));
    }
  }
}

els.entryForm.addEventListener("input", e => {
  const f = els.entryForm.elements;
  e.target.classList?.remove("invalid");
  // Fon / hisse değişince birim fiyat yeniden güncel fiyatla dolar; pazar değişince kod da silinir. Fon / hisse dışında
  // çıkış harcamadır.
  if (e.target.name === "asset" || e.target.name === "ticker") {
    if (e.target.name === "asset") f.ticker.value = "";
    if (e.target.name === "ticker" && f.asset.value === "BIST") {
      const at = e.target.selectionStart;
      e.target.value = e.target.value.toLocaleUpperCase("en-US");
      e.target.setSelectionRange?.(at, at);
    }
    f.price.value = "";
    priceTouched = false;
    if (!V.MARKETS[f.asset.value] && f.dir.value === "out") f.dir.value = "in";
  }
  if (e.target.name === "price") priceTouched = true;
  if (e.target.name === "dir" || e.target.name === "settle") syncChecked(els.entryForm);
  if (e.target.name === "dir" && e.target.value === "out" && !entryMarket()) {
    // Çıkış harcamadır: yazılanlar harcama formuna taşınır
    const { e: x } = collectEntry();
    els.entrySheet.close();
    openPurchaseSheet(null, { personId: x.personId, desc: x.desc, total: x.amount > 0 ? x.amount : 0, asset: x.asset, date: x.date || T.todayKey(),
      ...R.fields(x) });
    return;
  }
  repeatInput(els.entryRepeat, e.target);
  syncChecked(els.entryForm);
  updateEntryForm();
});

els.entryForm.addEventListener("submit", ev => {
  ev.preventDefault();
  const { e, errors } = collectEntry();
  const f = els.entryForm.elements;
  const mk = entryMarket();
  for (const name of ["ticker", "amount", "price", "desc", "date", "every", "timesN"]) f[name].classList.toggle("invalid", errors.includes(name));
  if (errors.length) {
    const msg = {
      ticker: !mk?.code ? (mk?.kind === "FON" ? "Fonu seç ya da kodunu yaz." : "Hissenin işlem kodunu yaz.")
        : mk.kind === "FON" ? "TEFAS'ta bu kodla fon yok." : "Borsa İstanbul'da bu kodla hisse yok.",
      amount: mk ? "Adedi gir." : "Miktarı gir.",
      price: !f.price.value.trim() ? (mk ? "TL bakiyesine işlemek için birim fiyatı gir." : "Kuru gir.") : mk ? "Birim fiyatı doğru yaz." : "Kuru doğru yaz.",
      desc: "Açıklama yaz.", date: "Tarihi gir.", person: "Kişi seç.", ...REPEAT_ERRORS,
    }[errors[0]];
    els.entryPreview.replaceChildren(el("div", "warn", msg));
    f[errors[0]]?.focus?.();
    return;
  }
  if (editingEntryId) {
    state.entries = state.entries.map(x => (x.id === editingEntryId ? { id: x.id, ...e } : x));
  } else {
    state.entries.push({ id: uid(), ...e });
  }
  lastAsset = mk ? mk.kind : e.asset;
  lastPersonId = e.personId;
  if (mk && e.price > 0) { lastSettle = e.settle === true; writePref(PREF.settle, lastSettle ? "" : "0"); }
  saveState();
  els.entrySheet.close();
  const what = mk ? (e.amount > 0 ? "Alış" : "Satış") : e.amount < 0 ? "Bozdurma" : V.settled(e) ? "Alış" : "Giriş";
  toast(editingEntryId ? `${what} güncellendi` : `${what} eklendi`);
  editingEntryId = null;
  render();
});

confirmTap(els.entryDelete, () => {
  const e = state.entries.find(x => x.id === editingEntryId);
  if (!e) return;
  state.entries = state.entries.filter(x => x.id !== e.id);
  editingEntryId = null;
  saveState();
  els.entrySheet.close();
  toast(V.market(e.asset) ? (e.amount > 0 ? "Alış silindi" : "Satış silindi") : e.amount < 0 ? "Bozdurma silindi" : "Giriş silindi");
  render();
});

// ---------- Borç formu ----------
// Borç aldım / Borç verdim (karşı taraf serbest metin) ya da Kredi. Görünen: tür, tutar (varlığın biriminde), karşı taraf
// (önceki taraflardan ve kişilerden öneri). Açılır satırlar: geri ödeme (tek sefer, isteğe bağlı vade; ya da taksitle:
// sayı, ilk taksit; kredide hep taksitli; ödeme şekli "tarihinde ödenmiş sayılsın": kredide varsayılan işaretli, kişide
// değil, vadesizde yok; geçmiş taksiti olan kayıtta kilitli), varlığa etkisi (tarih; para
// varlığa girdi / çıktı mı, kredide çekilen tutar), varlık, kişi, not. Önizleme: plan, kredinin maliyeti, bakiye ve toplam
// önce / sonra, geçmiş taksitler. Düzenlemede durum, ödemeler, Ödeme ekle, Kapat / Yeniden aç, Sil (ödemeleriyle).
const DEBT_COUNTS = [2, 3, 4, 5, 6, 10, 12];   // kişiyle taksitli borçta hazır kutular
const LOAN_COUNTS = [12, 24, 36, 48];           // kredide
const DEBT_MAX_COUNT = 600;                     // tablodaki sınır (tablo.js)
let debtPlanOpen = false;                       // önizlemedeki ödeme planı açık

// key'den n ay sonrası, aynı gün (ay kısaysa son günü)
function monthLater(key, n = 1) {
  const d = T.parseDate(key);
  return T.dateKey(d.idx + n, d.day);
}

// Gün metni: Bugün, Dün ya da "5 Kas 2026"
function dayText(key, today) {
  return key === today ? "Bugün" : key === T.addDays(today, -1) ? "Dün" : fmtDay(key);
}

// draft: { type, party?, asset?, personId? } yeni kaydın başlangıç değerleri
function openDebtSheet(d, draft = {}) {
  if (!state.people.length) { openPeopleSheet(); toast("Önce bir kişi ekle"); return; }
  editingDebtId = d?.id ?? null;
  const today = T.todayKey();
  const f = els.debtForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  const type = d ? debtType(d) : ["borrowed", "lent", "loan"].includes(draft.type) ? draft.type : "borrowed";
  const loan = type === "loan";
  const plan = d ? d.kind === "loan" || d.count > 1 : loan;
  const count = d && plan && d.count >= 1 ? d.count : loan ? 12 : 3;
  const code = d?.asset ?? (V.asset(draft.asset) ? draft.asset : "TRY");
  const digits = V.asset(code).digits;
  // Kredide yazılan taksit tutarıdır; toplamı taksite tam bölünmeyen kredi (asistanla girilmiş) toplamıyla açılır
  const per = loan && (!d || V.round(V.round(d.amount / d.count, code) * d.count, code) === d.amount);
  f.elements.type.value = type;
  f.elements.mode.value = plan ? "plan" : "once";
  f.elements.per.value = per ? "1" : "";
  f.elements.amount.value = d ? amountText(per ? d.amount / d.count : d.amount, digits) : "";
  f.elements.party.value = d?.party ?? draft.party ?? "";
  f.elements.desc.value = d?.desc ?? "";
  f.elements.date.value = d?.date ?? today;
  f.elements.due.value = d && !plan ? d.due ?? "" : "";
  f.elements.first.value = d && plan ? d.due ?? "" : monthLater(today);
  f.elements.autoPay.checked = d ? (d.kind === "loan" ? d.autoPay !== false : d.autoPay === true) : loan;
  f.elements.moved.checked = d ? d.principal > 0 : true;
  f.elements.principal.value = loan && d?.principal > 0 ? amountText(d.principal, digits) : "";
  renderDebtTiles(loan, count);

  els.debtAssetChips.replaceChildren(...V.ASSETS.map(a => radioChip("asset", a.code, a.name, a.code === code)));
  const personId = personById(d?.personId) ? d.personId : personById(draft.personId) ? draft.personId : state.people[0].id;
  els.debtPersonChips.replaceChildren(...state.people.map(x =>
    radioChip("person", x.id, x.name, x.id === personId, dot(seriesVar(x)))));
  for (const row of [els.debtPlanRow, els.debtEffectRow, els.debtAssetRow, els.debtPersonRow, els.debtNoteRow]) row.open = false;
  els.debtPlanRow.open = loan && !d;   // yeni kredide taksit sayısı ve ilk taksit gerekli
  debtPlanOpen = false;
  renderPartyList();
  renderDebtEdit(d);
  syncChecked(f);
  updateDebtForm();
  openSheet(els.debtSheet);
  if (!d) f.elements.amount.focus();
}

// Taksit kutuları: kişiyle borçta 2–12, kredide 12–48; Diğer'de − / +
function renderDebtTiles(loan, count) {
  const presets = loan ? LOAN_COUNTS : DEBT_COUNTS;
  const other = !presets.includes(count);
  els.debtCountChips.classList.toggle("five", loan);
  els.debtCountChips.replaceChildren(...[...presets, "other"].map(n => countTile(n, n === "other" ? other : n === count)));
  els.debtCountOther.hidden = !other;
  els.debtForm.elements.count.value = count;
}

// Önceki karşı taraflar (en yeniler önce) ve kişiler: yazarken öneri
function renderPartyList() {
  const seen = new Set(), out = [];
  const add = name => {
    const k = T.normalize(name ?? "");
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(Object.assign(document.createElement("option"), { value: name.trim() }));
  };
  for (let i = state.debts.length - 1; i >= 0; i--) add(state.debts[i].party);
  for (const p of state.people) add(p.name);
  els.partyList.replaceChildren(...out);
}

// Düzenlemede: durum satırı (sonunda Borcu kapat / Yeniden aç), ödemeler (başlıkta + Ödeme), Sil
function renderDebtEdit(d) {
  els.debtDelete.hidden = els.debtStatus.hidden = els.debtPays.hidden = !d;
  if (!d) return;
  const today = T.todayKey();
  const pays = debtPayments(d.id);
  const st = B.status(d, pays, today);
  const debt = B.side(d) === "debt";
  const m = x => money(x, d.asset);
  els.debtStatusText.textContent = (!st.started ? [`${fmtDay(d.date)} tarihinde başlar`]
    : st.closed ? [`${fmtDay(d.closed)} tarihinde kapandı`, st.paid > EPS && `${m(st.paid)} ${debt ? "ödendi" : "alındı"}`]
    : [st.paid > EPS && `${m(st.paid)} ${debt ? "ödendi" : "alındı"}`, st.remaining > EPS ? `kalan ${m(st.remaining)}` : "kalan yok",
       st.overdue > EPS && `${m(st.overdue)} gecikti`, st.next && `sonraki ${fmtDayShort(st.next.date)}`])
    .filter(Boolean).join(" · ");
  // Başlamamış borç kapatılamaz, ödenemez (ödeme borcun tarihinden önce olamaz); tamamı ödenen kendiliğinden kapanmıştır;
  // kapalı ya da tamamı ödenmiş borca ödeme eklenmez (önceki ödemeler düzeltilir, silinir). Kendiliğinden ödenende buradan ara ödeme girilir (satırda Ödendi yok).
  const word = { borrowed: "Borcu", lent: "Alacağı", loan: "Krediyi" }[debtType(d)];
  els.debtCloseBtn.hidden = !st.started || (st.done && !st.closed);
  els.debtCloseBtn.textContent = st.closed ? "Yeniden aç" : `${word} kapat`;
  els.debtCloseBtn.setAttribute("aria-label", st.closed ? `${word} yeniden aç` : `${word} kapat`);
  els.debtPayBtn.hidden = !st.started || st.done;
  els.debtPayBtn.textContent = debt ? (st.auto ? "+ Ara ödeme" : "+ Ödeme") : st.auto ? "+ Ara tahsilat" : "+ Tahsilat";
  els.debtPays.hidden = !pays.length && els.debtPayBtn.hidden;
  els.debtPayList.replaceChildren(...[...pays].reverse().map(x => payHistRow(x, d.asset, () => {
    els.debtSheet.close();
    openPaySheet({ debtId: d.id }, x);
  })));
}

// Ödeme satırı: tarih, not, tutar; dokununca ya da Enter / Space ile open (düzenleme). current: formda düzenlenen
function payHistRow(x, code, open, current = false) {
  const li = el("li", "editable" + (current ? " current" : ""));
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  const main = el("div", "ph-main");
  main.append(el("span", "ph-date", fmtDay(x.date)));
  if (x.desc) main.append(el("span", "ph-note", x.desc));
  li.append(main, el("span", "amount", money(x.amount, code)));
  li.addEventListener("click", open);
  li.addEventListener("keydown", e => {
    if (e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); }
  });
  return li;
}

function collectDebt() {
  const f = els.debtForm.elements;
  const editing = editingDebtId ? state.debts.find(x => x.id === editingDebtId) : null;
  const type = ["borrowed", "lent", "loan"].includes(f.type.value) ? f.type.value : "borrowed";
  const loan = type === "loan";
  const asset = V.asset(f.asset.value) ? f.asset.value : "TRY";
  const plan = loan || f.mode.value === "plan";
  const per = plan && f.per.value === "1";
  const amount = V.round(parseAmount(f.amount.value), asset);
  const count = plan ? Math.round(Number(f.count.value)) : 1;
  const due = plan ? f.first.value : f.due.value;
  const date = T.parseDate(f.date.value) ? f.date.value : "";
  const party = f.party.value.trim(), desc = f.desc.value.trim();
  const errors = [];
  if (!(amount > 0)) errors.push("amount");
  if (!loan && !party) errors.push("party");
  if (plan && !(count >= 1 && count <= DEBT_MAX_COUNT)) errors.push("count");
  if (plan && !T.parseDate(due)) errors.push("first");
  if (!date) errors.push("date");
  if (!personById(f.person.value)) errors.push("person");

  const total = per ? V.round(amount * count, asset) : amount;
  // Ana para: date günü el değiştiren. Kişiyle borçta tutarın tamamı (asistanla farklı girilmişse korunur), kredide
  // çekilen tutar; yoksa para hareketi olmamıştır (eski borç: bakiye zaten içeriyor)
  let principal = 0;
  if (loan) {
    principal = f.principal.value.trim() ? V.round(parseAmount(f.principal.value), asset) : 0;
    if (!(principal >= 0) || (total > 0 && principal > total)) errors.push("principal");
  } else if (f.moved.checked) {
    principal = editing?.principal > 0 && editing.principal !== editing.amount ? Math.min(editing.principal, total) : total;
  }

  // Kredide ve kendiliğinden ödenen borçta date'ten önceki taksitler takipten önce ödenmiştir; o günlerde el değiştiren
  // para da varlığa çoktan girmiştir: para girişi / çekilen tutar ancak ilk taksitten önceki bir günde olur
  if (principal > 0 && (loan || f.autoPay.checked) && date && T.parseDate(due) && due < date) errors.push("early");

  const d = { kind: loan ? "loan" : "person", personId: f.person.value };
  if (!loan) d.side = type === "lent" ? "receivable" : "debt";
  if (party) d.party = party;
  if (desc) d.desc = desc;
  Object.assign(d, { asset, amount: total });
  if (principal > 0) d.principal = principal;
  d.date = date;
  if (T.parseDate(due)) Object.assign(d, { due, count: plan ? count : 1 });
  // Ödeme şekli türün varsayılanından farklıysa yazılır: kredide elle (false), kişide otomatik (vadeliyse true)
  if (loan ? !f.autoPay.checked : f.autoPay.checked && d.due) d.autoPay = !loan;
  if (editing?.closed) d.closed = editing.closed;
  return { d, errors, type, plan, per, count };
}

// Ödeme şekli kilidi (borc.js modeLocked): geçmiş taksiti olan kayıtta otomatik / elle değişmez
function modeLockText(d) {
  return `${d.count > 1 || d.kind === "loan" ? "Geçmiş taksitleri olduğu" : "Vadesi geçtiği"} için ödeme şekli değiştirilemez`;
}
function modeChangeText(d) {
  return `${modeLockText(d)} (vadesiz kayıt elle ödenir). Vadeyi geri gir ya da kaydı kapatıp yenisini ekle.`;
}

function updateDebtForm() {
  const { d, errors, type, plan, per, count } = collectDebt();
  const f = els.debtForm.elements;
  const loan = type === "loan", lent = type === "lent";
  const a = V.asset(d.asset);
  const today = T.todayKey();
  const r = curRates();
  const m = x => money(x, d.asset);

  if (!editingDebtId) els.debtTitle.textContent = `Yeni ${DEBT_WORD[type].toLocaleLowerCase("tr-TR")}`;
  else els.debtTitle.textContent = { borrowed: "Borcu düzenle", lent: "Alacağı düzenle", loan: "Krediyi düzenle" }[type];
  els.debtUnit.textContent = els.debtPrincipalUnit.textContent = a.symbol;
  f.amount.dataset.amount = f.principal.dataset.amount = a.digits;
  els.debtAmountLabel.textContent = plan && per ? "Taksit tutarı" : plan ? "Toplam tutar" : "Tutar";
  const ask = { borrowed: "Kimden?", lent: "Kime?", loan: "Banka" }[type];
  f.party.placeholder = ask;
  f.party.setAttribute("aria-label", ask);
  els.debtMode.hidden = loan;
  els.debtOnce.hidden = plan;
  els.debtPlan.hidden = !plan;
  // Ödeme şekli: taksitte ve vadeli tek seferde; geçmiş taksiti olan kayıtta değiştirilemez (borc.js modeLocked)
  const editing = editingDebtId ? state.debts.find(x => x.id === editingDebtId) : null;
  const locked = !!editing && B.modeLocked(editing, today);
  els.debtAutoRow.hidden = !plan && !d.due;
  els.debtAutoText.textContent = plan ? "Taksitler tarihinde ödenmiş sayılsın" : "Vadesinde ödenmiş sayılsın";
  f.autoPay.disabled = locked;
  els.debtAutoNote.hidden = !locked || els.debtAutoRow.hidden;
  els.debtAutoNote.textContent = locked ? `${modeLockText(editing)}.` : "";
  els.debtMovedRow.hidden = loan;
  els.debtPrincipalField.hidden = !loan;
  els.debtMovedText.textContent = lent ? "Para varlığımdan çıktı" : "Para varlığıma girdi";
  els.debtPersonRow.hidden = state.people.length < 2;
  for (const b of els.debtDueChips.querySelectorAll("[data-due]")) {
    b.classList.toggle("on", b.dataset.due ? f.due.value === monthLater(d.date || today, Number(b.dataset.due)) : !f.due.value);
  }
  for (const b of els.debtDateChips.querySelectorAll("[data-day]")) b.classList.toggle("on", f.date.value === T.addDays(today, Number(b.dataset.day)));
  renderCountTiles(f, els.debtCountChips, { max: DEBT_MAX_COUNT, code: d.asset, compact: 1e4 });

  // Açılır satırların değerleri
  const mode = loan ? (f.autoPay.checked ? "" : " · elle") : f.autoPay.checked && d.due ? " · otomatik" : "";
  els.debtPlanVal.textContent = (plan ? `${count > 0 ? count : "?"} taksit` : d.due ? `vade ${fmtDay(d.due)}` : "Vadesiz") + mode;
  const moved = loan ? d.principal > 0 : f.moved.checked;
  els.debtEffectVal.textContent = [d.date ? dayText(d.date, today) : "Tarih yok",
    !moved ? "para hareketi yok" : lent ? "para çıktı" : "para girdi"].join(" · ");
  els.debtAssetVal.textContent = a.name;
  els.debtPersonVal.textContent = personById(d.personId)?.name ?? "";
  els.debtNoteVal.textContent = d.desc ?? "";

  const box = els.debtPreview;
  box.replaceChildren();
  els.debtSum.replaceChildren();
  if (errors.includes("principal")) box.append(el("div", "warn", "Çekilen tutar geri ödenecek toplamdan büyük olamaz."));
  if (errors.some(e => ["amount", "count", "first", "date", "principal"].includes(e))) return;
  // Kilitli kayıt vadesiz olursa da ödeme şekli değişir (geçmiş taksitler başka sayılırdı): kaydedilmez
  if (locked && B.auto(d) !== B.auto(editing)) {
    box.append(el("div", "warn", modeChangeText(editing)));
    return;
  }

  const items = B.schedule(d);
  const auto = B.auto(d);
  const first = items[0], last = items[items.length - 1];
  const sameYear = first && T.yearOf(T.parseDate(first.key).idx) === T.yearOf(T.parseDate(last.key).idx);
  if (items.length > 1) {
    els.debtSum.append(el("strong", "", `${items.length} × ${m(first.amount)}`), el("span", "", `toplam ${m(d.amount)} · ilk ${fmtDayShort(first.key)}`));
    box.append(el("div", "debt-plan-text", `${items.length} × ${m(first.amount)} · ilk ${fmtDayShort(first.key)}, son ${sameYear ? fmtDayShort(last.key) : fmtDay(last.key)}`));
  } else {
    els.debtSum.append(el("strong", "", m(d.amount)), el("span", "", first ? `vade ${fmtDay(first.key)}` : "vadesiz"));
  }
  if (loan && d.principal > 0) {
    const rate = B.loanRate(d);
    box.append(el("div", "", `Toplam ${m(d.amount)} · faiz ve masraf ${m(d.amount - d.principal)}`
      + (rate != null ? ` (aylık ≈ %${(rate * 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : "")));
  }
  // Kredide (otomatik ya da elle) ve kendiliğinden ödenen borçta kayıt tarihinden önceki taksitler ödenmiş sayılır
  const before = auto || loan ? items.filter(x => x.key < d.date) : [];
  if (before.length) box.append(el("div", "", `İlk ${before.length} taksit ${fmtDay(d.date)} öncesinde ödenmiş sayılır`));
  if (auto) {
    const past = items.filter(x => x.key >= d.date && x.key < today);
    if (past.length) {
      const sum = past.reduce((s, x) => s + x.amount, 0);
      box.append(el("div", "warn", `Geçmiş ${past.length} taksit (${m(sum)}) ${lent ? "varlığına eklenir" : "varlığından düşer"}`));
    }
    box.append(el("div", "", items.length > 1 ? "Taksitler tarihinin ertesi günü ödenmiş sayılır" : "Vadesinin ertesi günü ödenmiş sayılır"));
  } else {
    // Elle: yeni kayıtta günü geçmiş taksitler gecikmiş görünür
    const late = !editingDebtId && d.date <= today ? items.filter(x => x.key < today && !(loan && x.key < d.date)) : [];
    if (late.length) {
      const sum = late.reduce((s, x) => s + x.amount, 0);
      box.append(el("div", "warn", (items.length > 1 ? `Geçmiş ${late.length} taksit (${m(sum)})` : `Vadesi geçti: ${m(sum)}`)
        + ` gecikmiş görünür; ${lent ? "aldıysan" : "ödediysen"} Ödendi ile ekle`));
    }
    box.append(el("div", "", lent ? "Geri aldıkça Ödendi'ye dokun; kısmen de olur"
      : loan ? "Taksitleri ödedikçe Ödendi'ye dokun; günü geçen taksit gecikmiş görünür" : "Geri ödedikçe Ödendi'ye dokun; kısmen de olur"));
  }
  if (d.date > today) box.append(el("div", "", `${fmtDay(d.date)} tarihinde başlar; o güne kadar toplama girmez`));

  // Kaydedilince: kişinin bu varlıktaki bakiyesi ve toplam borç / alacak (bu kayıt yeni hâliyle)
  const id = editingDebtId ?? "yeni";
  const after = { ...state, debts: [...state.debts.filter(x => x.id !== id), { id, ...d }] };
  const person = personById(d.personId);
  if (person) {
    const entries = knownEntries().filter(e => e.personId === person.id);
    const bal = s => V.balances(entries, today, B.spent(s, today, person.id))[d.asset] ?? 0;
    const b0 = bal(state), b1 = bal(after);
    const label = `${person.name} · ${a.short === "TL" ? "TL" : a.name.toLocaleLowerCase("tr-TR")} bakiyesi`;
    box.append(Math.abs(b1 - b0) > EPS
      ? el("div", b1 < 0 ? "warn" : "", `${label} ${fmtAsset(b0, d.asset)} → ${fmtAsset(b1, d.asset)}`)
      : el("div", "", `${label} değişmez (${fmtAsset(b0, d.asset)})`));
  }
  const t0 = B.totals(state, today, r), t1 = B.totals(after, today, r);
  if (t1.missing.includes(d.asset)) box.append(el("div", "", "Kur alınamadı — TL karşılığı sonra hesaplanır"));
  else if (lent) box.append(el("div", "", `Toplam alacak ${fmt(t0.receivable.total)} → ${fmt(t1.receivable.total)}`));
  else box.append(el("div", "", `Toplam borç ${fmt(t0.debt.total)} → ${fmt(t1.debt.total)}`));

  // Ödeme planı: ödenmiş sayılanlar çizili
  if (items.length > 1) {
    const st = B.status({ id, ...d }, editingDebtId ? debtPayments(id) : [], today);
    const details = el("details", "plan");
    details.open = debtPlanOpen;
    details.addEventListener("toggle", () => { debtPlanOpen = details.open; });
    details.append(el("summary", "", `Ödeme planı (${items.length} taksit)`));
    const ol = el("ol", "plan-list");
    for (const x of st.items) {
      const li = el("li", x.state === "paid" ? "paid" : "");
      li.append(el("span", "", `${x.no}. ${fmtDay(x.key)}`), el("span", "amount" + (x.state === "late" ? " out-text" : ""), m(x.amount)));
      ol.append(li);
    }
    details.append(ol);
    box.append(details);
  }
}

els.debtForm.addEventListener("input", e => {
  const t = e.target, f = els.debtForm.elements;
  t.classList?.remove("invalid");
  if (t.name === "type") {
    // Kutular türe göre; sayı yeni türün kutularında yoksa türün varsayılanı. Kredide yazılan taksit tutarıdır. Ödeme
    // şekli türün varsayılanı (kredide otomatik), kaydınki otomatikse korunur; kilitliyse değişmez.
    const loan = t.value === "loan";
    const n = Math.round(Number(f.count.value));
    renderDebtTiles(loan, (loan ? LOAN_COUNTS : DEBT_COUNTS).includes(n) ? n : loan ? 12 : 3);
    f.per.value = loan ? "1" : "";
    if (loan) els.debtPlanRow.open = true;
    const editing = editingDebtId ? state.debts.find(x => x.id === editingDebtId) : null;
    if (!f.autoPay.disabled) f.autoPay.checked = loan ? editing?.kind !== "loan" || editing.autoPay !== false : editing?.autoPay === true;
  }
  if (t.name === "mode" && t.value === "plan" && !T.parseDate(f.first.value)) f.first.value = monthLater(f.date.value || T.todayKey());
  if (t.name === "countPreset") {
    const other = t.value === "other";
    els.debtCountOther.hidden = !other;
    if (other) {
      const presets = f.type.value === "loan" ? LOAN_COUNTS : DEBT_COUNTS;
      let n = Math.round(Number(f.count.value)) || 1;
      do n++; while (presets.includes(n));
      f.count.value = Math.min(n, DEBT_MAX_COUNT);
      f.count.focus();
      f.count.select();
    } else f.count.value = t.value;
  }
  if (t.name === "count") {
    const n = Math.round(Number(t.value));
    const presets = f.type.value === "loan" ? LOAN_COUNTS : DEBT_COUNTS;
    els.debtCountChips.querySelector(`input[value="${presets.includes(n) ? n : "other"}"]`).checked = true;
  }
  if (t.name === "asset") els.debtAssetRow.open = false;
  if (t.name === "person") els.debtPersonRow.open = false;
  syncChecked(els.debtForm);
  updateDebtForm();
});

els.debtCountOther.addEventListener("click", e => {
  const b = e.target.closest("[data-step]");
  if (!b) return;
  const input = els.debtForm.elements.count;
  input.value = Math.min(DEBT_MAX_COUNT, Math.max(1, (Math.round(Number(input.value)) || 1) + Number(b.dataset.step)));
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

els.debtDueChips.addEventListener("click", e => {
  const b = e.target.closest("[data-due]");
  if (!b) return;
  const f = els.debtForm.elements;
  f.due.value = b.dataset.due ? monthLater(f.date.value || T.todayKey(), Number(b.dataset.due)) : "";
  f.due.dispatchEvent(new Event("input", { bubbles: true }));
});

els.debtDateChips.addEventListener("click", e => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  const input = els.debtForm.elements.date;
  input.value = T.addDays(T.todayKey(), Number(b.dataset.day));
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

// Kaydet; closed verilirse aynı kayıtla kapatır (tarih) ya da yeniden açar (null)
function saveDebt(closed) {
  const { d, errors, type } = collectDebt();
  const f = els.debtForm.elements;
  for (const name of ["amount", "party", "count", "first", "date", "principal"]) f[name].classList.toggle("invalid", errors.includes(name));
  if (errors.length) {
    const msg = { amount: "Tutarı gir.", party: type === "lent" ? "Kime verdiğini yaz." : "Kimden aldığını yaz.",
      count: `Taksit sayısı 1–${DEBT_MAX_COUNT} arası olmalı.`, first: "İlk taksitin tarihini gir.", date: "Tarihi gir.",
      principal: "Çekilen tutar geri ödenecek toplamdan büyük olamaz.", person: "Kişi seç.",
      early: type === "loan" ? "Çekilen tutar ancak ilk taksitten önceki bir günde girilir. Eski krediyse boş bırak."
        : f.mode.value === "plan" ? "İlk taksit bu tarihten önce: para girişi kapatılmalı ya da tarih ilk taksitten önceye alınmalı."
        : "Vade bu tarihten önce: para girişi kapatılmalı ya da tarih vadeden önceye alınmalı." }[errors[0]];
    els.debtPreview.replaceChildren(el("div", "warn", msg));
    if (errors[0] === "count" || errors[0] === "first") els.debtPlanRow.open = true;
    if (errors[0] === "date" || errors[0] === "principal" || errors[0] === "early") els.debtEffectRow.open = true;
    if (errors[0] === "early") f.date.classList.add("invalid");
    if (errors[0] === "person") els.debtPersonRow.open = true;
    f[errors[0]]?.focus?.();
    return;
  }
  // Ödeme şekli kilidi: tek sefere / vadesize geçişle de aşılmaz (kaydedilen kayıt d'nin kendisi; MCP update_debt gibi)
  const cur = editingDebtId ? state.debts.find(x => x.id === editingDebtId) : null;
  if (cur && B.modeLocked(cur, T.todayKey()) && B.auto(d) !== B.auto(cur)) {
    els.debtPreview.replaceChildren(el("div", "warn", modeChangeText(cur)));
    els.debtPlanRow.open = true;
    return;
  }
  if (closed !== undefined) {
    if (closed) d.closed = closed; else delete d.closed;
  }
  if (d.closed && d.closed < d.date) {
    f.date.classList.add("invalid");
    els.debtPreview.replaceChildren(el("div", "warn", `Tarih, kapandığı günden (${fmtDay(d.closed)}) sonra olamaz.`));
    els.debtEffectRow.open = true;
    f.date.focus();
    return;
  }
  const id = editingDebtId ?? uid();
  if (editingDebtId) {
    // Sahibi değişince ödemeleri de onun olur
    state.debts = state.debts.map(x => (x.id === id ? { id, ...d }
      : x.kind === "payment" && x.debtId === id && x.personId !== d.personId ? { ...x, personId: d.personId } : x));
  } else {
    state.debts.push({ id, ...d });
  }
  saveState();
  els.debtSheet.close();
  const word = DEBT_WORD[type];
  toast(closed ? `${word} kapatıldı` : closed === null ? `${word} yeniden açıldı` : `${word} ${editingDebtId ? "güncellendi" : "eklendi"}`);
  editingDebtId = null;
  render();
}

els.debtForm.addEventListener("submit", e => { e.preventDefault(); saveDebt(); });
// Borcu kapat: kalan silinir (bağışlanır), onayla; Yeniden aç: kalan geri gelir
els.debtCloseBtn.addEventListener("click", () => {
  const d = state.debts.find(x => x.id === editingDebtId);
  if (!d) return;
  // Kapatma formdakileri de kaydeder: onaydaki kalan kaydedilecek hâliyle (form hatalıysa saveDebt zaten kaydetmez)
  const { d: next, errors } = collectDebt();
  const x = errors.length ? d : { id: d.id, ...next };
  const st = B.status(x, debtPayments(d.id), T.todayKey());
  if (!d.closed && st.remaining > EPS && !confirm(`Kalan ${money(st.remaining, x.asset)} silinip kapatılsın mı?`)) return;
  saveDebt(d.closed ? null : T.todayKey());
});
els.debtPayBtn.addEventListener("click", () => {
  const id = editingDebtId;
  els.debtSheet.close();
  if (id) openPaySheet({ debtId: id });
});

confirmTap(els.debtDelete, () => {
  const d = state.debts.find(x => x.id === editingDebtId);
  if (!d) return;
  state.debts = state.debts.filter(x => x.id !== d.id && x.debtId !== d.id);   // ödemeleriyle
  editingDebtId = null;
  saveState();
  els.debtSheet.close();
  toast(`${DEBT_WORD[debtType(d)]} silindi`);
  render();
});

// ---------- Ödeme formu ----------
// Hedef: borcun ödemesi, alacağın tahsilatı, kredinin ödemesi (otomatikte ara ödeme: sondaki taksitlerden düşer) —
// { debtId } —, kişinin kart payı ödemesi — { personId }; TL, ilk kişinin varlığına girer — ya da elle ödenen kartın ekstre
// ödemesi — { cardId, key? } (key: seçilen ekstrenin son ödeme günü); TL, ilk kişinin varlığından çıkar. Tutar
// kısayolları, tarih (en geç bugün; en erken kaydın tarihi, kartta elle ödemenin başladığı gün: düzenlemede de, daha önceki
// ödeme kendi gününde kalabilir), not. Kalanın tümü ödenince borç kendiliğinden kapanır (kalanı silmek: borç formunda
// Borcu kapat). Önizleme: kalan (kartta ödenmemiş) ve bakiye önce / sonra, fazla ödeme. Altta önceki
// ödemeler: dokununca düzenlenir, Sil ile (iki dokunuş) silinir.

// Düzenlenen ödeme olmadan veri: kalan ve bakiye bu ödemeden öncesine göre
function payBase() {
  return editingPayId ? { ...state, debts: state.debts.filter(x => x.id !== editingPayId) } : state;
}

// Tutar kısayolları: sıfır ve önceki kısayolla aynı tutar atılır
function payChipList(list) {
  return list.filter(([, v], i, all) => v > EPS && all.findIndex(([, w]) => Math.abs(w - v) <= EPS) === i);
}

// Hedefin bilgileri (base verisine göre): başlık, varlık, sahibi (bakiyesi değişen), kalan, kısayollar, önerilen tutar,
// en erken ödeme günü (min), kaydedilecek ödemenin kişisi ve bağı (pay)
function payInfo(target, today, base = state) {
  if (target?.cardId) return cardPayInfo(target, today, base);
  if (target?.debtId) {
    const k = B.known(base);
    const d = k.items.find(x => x.id === target.debtId);
    if (!d) return null;
    const pays = k.pays.get(d.id);
    const st = B.status(d, pays, today);
    const debt = B.side(d) === "debt", name = debtName(d);
    const chips = [];
    let prefill;
    if (st.auto) {
      // Taksitler tarihinde kendiliğinden düşer: buraya yalnızca ara / erken ödeme girilir, tutar önceden yazılmaz
      const one = st.count ? d.amount / st.count : st.remaining;
      chips.push(["Bir taksit", Math.min(one, st.remaining)], ["Kalanın tümü", st.remaining]);
      prefill = 0;
    } else {
      const openOf = x => x.amount - x.covered;
      const cur = st.count > 1 ? st.items.find(x => x.state !== "paid") : null;
      const dueNow = st.items.filter(x => x.state === "late" || x.state === "due").reduce((s, x) => s + openOf(x), 0);
      if (cur) chips.push(["Bu taksit", openOf(cur)]);
      if (dueNow > EPS) chips.push(["Günü gelen", dueNow]);
      chips.push(["Kalanın tümü", st.remaining]);
      prefill = dueNow > EPS ? dueNow : cur ? openOf(cur) : st.remaining;
    }
    return {
      d, st, code: d.asset, owner: d.personId, remaining: st.remaining, prefill, min: d.date,
      pay: { personId: d.personId, debtId: d.id }, chips: payChipList(chips),
      title: st.auto ? `${name} · ${debt ? "ara ödeme" : "ara tahsilat"}`
        : debt ? `${nameWith(name, "e")} ödeme` : `${nameWith(name, "den")} tahsilat`,
      done: x => (d.kind === "loan" ? `${name} ödemesi eklendi · ${money(x, d.asset)}`
        : debt ? `${nameWith(name, "e")} ${money(x, d.asset)} ödendi` : `${nameWith(name, "den")} ${money(x, d.asset)} alındı`),
      pays: debtPayments(d.id),
    };
  }
  const person = personById(target?.personId);
  if (!person || person.id === base.people[0]?.id) return null;
  const s = B.shares(base, today).get(person.id);
  const remaining = s?.remaining ?? 0, dueNow = s?.dueNow ?? 0;
  return {
    person, code: "TRY", owner: base.people[0].id, remaining, min: "", pay: { personId: person.id },
    prefill: dueNow > EPS ? dueNow : Math.max(remaining, 0),
    chips: payChipList([["Günü gelen", dueNow], ["Kalanın tümü", remaining]]),
    title: `${nameWith(person.name, "den")} ödeme`,
    done: x => `${nameWith(person.name, "den")} ${fmt(x)} alındı`,
    pays: sharePayments(person.id),
  };
}

// Elle ödenen kartın ekstre ödemesi (borc.js cardDebt; otomatik ya da takip dışı kartta yok): ödemeler kapanmamış
// ekstreleri sırayla kapatır. Önerilen tutar seçilen ekstreye kadar (dahil) kapanmamışlar; seçilmediyse ödemesi gelenler
// (gecikmiş ve bugünkü), yoksa kesilmiş sıradaki ekstre. Kısayollar: Bu ekstre (seçilen; yoksa ödemesi gelen son ekstre
// ya da kesilmiş sıradaki), Ödemesi gelen. due: "Son ödeme günü" kısayolu (bu ekstrenin günü geçtiyse).
function cardPayInfo(target, today, base) {
  const c = base.cards.find(x => x.id === target.cardId);
  const payer = base.people[0];
  if (!manualCard(c) || !payer) return null;
  const cd = B.cardDebt(base, c, today);
  const openOf = x => x.amount - x.covered;
  const list = cd.statements.filter(x => !x.auto && openOf(x) > EPS);
  const unpaid = list.filter(x => x.state === "late" || x.state === "due");
  const cut = cd.next?.cut ? list.find(x => x.key === cd.next.date) : null;
  const pick = target.key ? list.find(x => x.key === target.key) : null;
  const cur = pick ?? unpaid[unpaid.length - 1] ?? cut;
  const upTo = pick ? list.filter(x => x.key <= pick.key).reduce((s, x) => s + openOf(x), 0) : 0;
  // Ödenen ekstre(ler): seçilen ekstreye kadar, yoksa ödemesi gelenler, yoksa kesilmiş sıradaki (önerilen tutar)
  const owed = upTo > EPS ? upTo : cd.unpaid > EPS ? cd.unpaid : cut ? openOf(cut) : 0;
  // Kartta payı olan, henüz ödemeyen diğer kişiler: kendi payını sana ödediyse o kart payı ödemesidir
  const others = [...B.shares(base, today).values()].filter(s => s.person && s.byCard[c.id] > EPS && s.remaining > EPS)
    .map(s => s.person.name);
  const names = others.length > 1 ? `${others.slice(0, -1).join(", ")} ve ${others[others.length - 1]}` : others[0];
  return {
    card: c, cd, code: "TRY", owner: payer.id, remaining: cd.total, min: cd.manualFrom ?? "",
    pay: { personId: payer.id, cardId: c.id },
    prefill: owed,
    chips: payChipList([[cur ? `Ekstre · son ödeme ${fmtDayShort(cur.key)}` : "Ekstre", cur ? openOf(cur) : 0], ["Günü gelen", cd.unpaid]]),
    due: cur && cur.key <= today ? cur.key : null,
    note: cur && list.some(x => x.key < cur.key) ? "Bu ödeme önce daha eski ödenmemiş ekstrelere sayılır, kalanı bu ekstreye." : "",
    hint: names ? `Buraya yalnızca karta (bankaya) yaptığın ödemeyi gir. ${names} sana ödeme yaptıysa onu Borçlar > `
      + "Alacaklarım'da “Ödendi” ile kaydet." : "",
    title: `${c.name} ekstresi`,
    done: x => (owed <= EPS ? `${fmt(x)} kaydedildi · ${c.name} kartının sonraki ekstresine sayılır`
      : x + EPS < owed ? `${c.name} ekstresi kısmen ödendi · kalan ${fmt(owed - x)}`
      : `${c.name} ekstresi ödendi ✓` + (x > owed + EPS ? ` · fazlası ${fmt(x - owed)} sonraki ekstreye sayılır` : "")),
    pays: cardPayments(c.id),
  };
}

// Kartın ödeme formundaki durum: kart formundaki borç satırları (gecikmiş, son gün bugün, sıradaki ekstre, kart borcu)
function cardPayStatus(cd, today) {
  return cardDebtLines(cd.card, cd, today);
}

// Tutar kısayolları (kalan değiştikçe yeniden: ör. ödeme silinince)
function renderPayChips(info) {
  els.payChips.replaceChildren(...info.chips.map(([label, v]) => {
    const b = el("button", "chip", label);
    b.type = "button";
    b.dataset.amount = String(V.round(v, info.code));
    b.title = money(v, info.code);
    return b;
  }));
}

// Ödeme günü en erken günden (min) önce olamaz; düzenlenen ödeme zaten önceyse (kartta önceki elle dönemden kalan) kendi
// gününde kalabilir: E'den önceki ödeme max(A, Pb)'de erimiştir, E'ye taşınırsa ikinci kez düşerdi
function payDateOk(info, date) {
  if (!info.min || date >= info.min) return true;
  const orig = editingPayId ? state.debts.find(y => y.id === editingPayId) : null;
  return orig?.date === date;
}

function openPaySheet(target, payment) {
  const today = T.todayKey();
  payTarget = target;
  editingPayId = payment?.id ?? null;
  const info = payInfo(target, today, payBase());
  if (!info) { editingPayId = null; return; }
  if (!payment && info.d && (info.st.done || !info.st.started)) {
    toast(info.st.closed ? "Kapanmış kayda ödeme eklenmez; önce yeniden aç" : info.st.done ? "Kalan yok" : "Henüz başlamadı");
    return;
  }
  const f = els.payForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  const a = V.asset(info.code);
  els.payTitle.textContent = payment ? "Ödemeyi düzenle" : info.title;
  els.payUnit.textContent = a.symbol;
  f.elements.amount.dataset.amount = a.digits;
  const amount = payment ? payment.amount : info.prefill;
  f.elements.amount.value = amount > EPS ? amountText(V.round(amount, info.code), a.digits) : "";
  f.elements.date.value = payment?.date ?? today;
  f.elements.date.max = today;
  f.elements.date.min = payment && info.min && payment.date < info.min ? payment.date : info.min;
  f.elements.desc.value = payment?.desc ?? "";
  renderPayChips(info);
  renderPayHistory(info);
  updatePayForm();
  openSheet(els.paySheet);
  f.elements.amount.focus();
  f.elements.amount.select();
}

// Hedefin önceki ödemeleri, en yenisi üstte: dokununca düzenlenir; Sil iki dokunuşla siler
let payHistAbort = null;   // geçmiş satırlarının (confirmTap) pencere kapanış dinleyicileri; yeniden çizilince kaldırılır
function renderPayHistory(info) {
  payHistAbort?.abort();
  payHistAbort = new AbortController();
  const list = [...info.pays].reverse();
  els.payHistory.hidden = !list.length;
  els.payList.replaceChildren();
  for (const x of list) {
    const li = payHistRow(x, info.code, () => openPaySheet(payTarget, x), x.id === editingPayId);
    const del = el("button", "btn btn-danger sm");
    del.type = "button";
    del.setAttribute("aria-label", `${fmtDay(x.date)} ödemesini sil`);
    del.append(el("span", "", "Sil"));
    del.addEventListener("click", e => e.stopPropagation());
    li.append(del);
    els.payList.append(li);
    confirmTap(del, () => {
      // Kapanmış borcun ödemesi silinince borç yeniden açılır: kapatan ödeme gidince kalan sessizce silinmesin
      const d = x.debtId ? state.debts.find(y => y.id === x.debtId) : null;
      const reopen = !!d?.closed;
      state.debts = state.debts.filter(y => y.id !== x.id)
        .map(y => (reopen && y.id === d.id ? (({ closed, ...rest }) => rest)(y) : y));
      saveState();
      toast(reopen ? "Ödeme silindi · kayıt yeniden açıldı" : "Ödeme silindi");
      render();
      if (x.id === editingPayId || !payInfo(payTarget, T.todayKey())) { editingPayId = null; els.paySheet.close(); return; }
      const info = payInfo(payTarget, T.todayKey(), payBase());
      renderPayChips(info);
      renderPayHistory(info);
      updatePayForm();
    }, payHistAbort.signal);
  }
}

function updatePayForm() {
  const f = els.payForm.elements, today = T.todayKey();
  const base = payBase();
  const info = payInfo(payTarget, today, base);
  const box = els.payPreview;
  box.replaceChildren();
  if (!info) return;
  const m = x => money(x, info.code);
  const amount = V.round(parseAmount(f.amount.value), info.code);
  const date = f.date.value;
  for (const b of els.payChips.children) b.classList.toggle("on", Math.abs(Number(b.dataset.amount) - amount) <= EPS);
  // Tarih kısayolları: en erken günden önceki gizli; kartta ekstrenin son ödeme günü (Bugün / Dün değilse)
  for (const b of els.payDateChips.querySelectorAll("[data-day]")) {
    const key = T.addDays(today, Number(b.dataset.day));
    b.hidden = !!info.min && key < info.min;
    b.classList.toggle("on", date === key);
  }
  const due = info.due && info.due < T.addDays(today, -1) && !(info.min && info.due < info.min) ? info.due : null;
  els.payDueChip.hidden = !due;
  els.payDueChip.dataset.date = due ?? "";
  els.payDueChip.textContent = due ? `Son ödeme günü · ${fmtDayShort(due)}` : "Son ödeme günü";
  els.payDueChip.classList.toggle("on", !!due && date === due);
  els.payHint.textContent = [info.note, info.hint].filter(Boolean).join(" ");
  els.payStatus.textContent = info.cd ? cardPayStatus(info.cd, today).join("\n")
    : info.person ? (info.remaining < -EPS ? `Sana ${m(-info.remaining)} fazla ödedi` : `Sana borcu: ${m(Math.max(info.remaining, 0))}`)
    : [info.remaining < -EPS ? `${m(-info.remaining)} fazla ödendi` : `kalan ${m(Math.max(info.remaining, 0))}`,
      info.st?.overdue > EPS && `${m(info.st.overdue)} gecikti`, info.st?.next && `sonraki ${fmtDayShort(info.st.next.date)}`]
      .filter(Boolean).join(" · ");
  if (!(amount > 0) || !T.parseDate(date)) return;
  if (date > today) { box.append(el("div", "warn", "Ödeme tarihi bugünden sonra olamaz.")); return; }
  if (!payDateOk(info, date)) { box.append(el("div", "warn", payMinText(info))); return; }

  // Kaydedilince: kalan (kartta ödenmemiş ekstreler ya da kart borcu) ve sahibinin bakiyesi
  const x = { id: editingPayId ?? "yeni", kind: "payment", ...info.pay, amount, date };
  const after = { ...base, debts: [...base.debts, x] };
  const next = payInfo(payTarget, today, after);
  const left = next.remaining;
  // Kapanmış borcun ödemesi düzenlenirken kalan yoktur (kapanınca silindi): kalan ve fazla yazılmaz
  const closed = !!info.st?.closed;
  if (info.cd && info.cd.unpaid > EPS) {
    box.append(el("div", "", `Ödenmemiş ekstre ${m(info.cd.unpaid)} → ${m(next.cd.unpaid)}`));
    // Ödenmemişi aşan kısım sonraki ekstreleri önceden kapatır (kart borcunu da aşarsa aşağıda uyarı)
    const ahead = Math.min(amount, Math.max(info.remaining, 0)) - info.cd.unpaid;
    if (ahead > EPS) box.append(el("div", "", `Fazlası ${m(ahead)} sonraki ekstreye sayılır.`));
  } else if (!closed) {
    box.append(el("div", "", `${info.cd ? "Kart borcu" : info.person ? "Sana borcu" : "Kalan"} ${m(Math.max(info.remaining, 0))} → ${m(Math.max(left, 0))}`));
  }
  const owner = personById(info.owner);
  if (owner) {
    const entries = knownEntries().filter(e => e.personId === owner.id);
    const bal = s => V.balances(entries, today, B.spent(s, today, owner.id))[info.code] ?? 0;
    const a = V.asset(info.code);
    // İlk kişi (kullanıcı) için ikinci tekil: "TL bakiyen"; başkasına ait borçta adıyla
    const unit = a.short === "TL" ? "TL" : a.name.toLocaleLowerCase("tr-TR");
    box.append(el("div", "", (owner.id === state.people[0]?.id ? `${a.short === "TL" ? "TL" : a.name} bakiyen ` : `${nameWith(owner.name, "in")} ${unit} bakiyesi `)
      + `${fmtAsset(bal(base), info.code)} → ${fmtAsset(bal(after), info.code)}`));
  }
  const over = info.d || info.cd ? amount - Math.max(info.remaining, 0) : -left;
  if (over > EPS && !closed) {
    box.append(el("div", "warn", info.cd ? `Kartın tüm borcundan ${m(over)} fazla; fazlası sonraki ekstrelerden düşülür.`
      : info.person ? `${nameWith(info.person.name, "in")} sana kalan borcundan ${m(over)} fazla; bu kadarını ona borçlu görünürsün.`
      : `Kalan borçtan ${m(over)} fazla.`));
  }
}

// Ödeme en erken günden (info.min) önce olamaz: kartta "Ben işaretlerim"in başladığı gün, borçta kaydın başladığı gün
function payMinText(info) {
  return info.cd ? `Bu kartta ekstreleri ${fmtDay(info.min)} tarihinden beri sen işaretliyorsun; ödeme tarihi bundan önce olamaz.`
    : `Ödeme, kaydın başladığı ${fmtDay(info.min)} gününden önce olamaz.`;
}

els.payForm.addEventListener("input", e => {
  e.target.classList?.remove("invalid");
  updatePayForm();
});

els.payChips.addEventListener("click", e => {
  const b = e.target.closest("[data-amount]");
  if (!b) return;
  const f = els.payForm.elements;
  const code = payInfo(payTarget, T.todayKey(), payBase())?.code ?? "TRY";
  f.amount.value = amountText(Number(b.dataset.amount), V.asset(code).digits);
  updatePayForm();
});

els.payDateChips.addEventListener("click", e => {
  const b = e.target.closest("[data-day], [data-date]");
  if (!b) return;
  const input = els.payForm.elements.date;
  input.value = b.dataset.date || T.addDays(T.todayKey(), Number(b.dataset.day));
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

els.payForm.addEventListener("submit", e => {
  e.preventDefault();
  const f = els.payForm.elements, today = T.todayKey();
  const info = payInfo(payTarget, today, payBase());
  if (!info) { els.paySheet.close(); return; }
  const amount = V.round(parseAmount(f.amount.value), info.code);
  const date = T.parseDate(f.date.value) ? f.date.value : "";
  const bad = !(amount > 0) ? "amount" : !date || date > today || !payDateOk(info, date) ? "date" : null;
  f.amount.classList.toggle("invalid", bad === "amount");
  f.date.classList.toggle("invalid", bad === "date");
  if (bad) {
    els.payPreview.replaceChildren(el("div", "warn", bad === "amount" ? "Tutarı gir."
      : !date ? "Tarihi gir." : date > today ? "Ödeme tarihi bugünden sonra olamaz." : payMinText(info)));
    f[bad].focus();
    return;
  }
  const desc = f.desc.value.trim();
  const x = { id: editingPayId ?? uid(), kind: "payment", ...info.pay, amount, date, ...(desc && { desc }) };
  if (editingPayId) state.debts = state.debts.map(y => (y.id === editingPayId ? x : y));
  else state.debts.push(x);
  saveState();
  els.paySheet.close();
  toast(editingPayId ? "Ödeme güncellendi" : info.done(amount));
  editingPayId = null;
  render();
});

// ---------- Kart payı ----------
// Kişinin takipteki kartlardaki taksitleri (ödemeler ilk taksitten başlayarak kapatır), ödemeleri; Hatırlat bu ayın
// ödeme özetini gönderir, Ödendi ödeme formunu açar.
function openShareSheet(pid) {
  if (!personById(pid)) return;
  sharePid = pid;
  renderShareSheet();
  openSheet(els.shareSheet);
}

function renderShareSheet() {
  const today = T.todayKey();
  const person = personById(sharePid);
  const s = B.shares(state, today).get(sharePid);
  const title = el("h2", "", person.name);
  title.id = "shareTitle";
  els.shareHead.replaceChildren(avatar(person), title);
  const remaining = s?.remaining ?? 0;
  els.shareStats.replaceChildren(
    remaining < -EPS ? stat("Sana fazla ödedi", fmt(-remaining), "out-text") : stat("Sana borcu", fmt(remaining), remaining > EPS ? "in-text" : ""),
    stat("Günü gelen", fmt(s?.dueNow ?? 0)),
    stat(s?.next ? `Sonraki · ${fmtDayShort(s.next.date)}` : "Sonraki", s?.next ? fmt(s.next.amount) : "—"));

  const items = B.shareItems(state, sharePid, today);
  els.shareItems.replaceChildren(...(items.length ? items.map(x => shareItemRow(x, today)) : [el("li", "empty", "Hesaba katılan kartlarında harcaması yok")]));
  const pays = [...sharePayments(sharePid)].reverse();
  els.sharePaysBox.hidden = !pays.length;
  els.sharePays.replaceChildren(...pays.map(x => payHistRow(x, "TRY", () => {
    els.shareSheet.close();
    openPaySheet({ personId: sharePid }, x);
  })));
}

// Kart payı taksiti (ödeme satırı düzeninde): ödeme günü, kart ve harcama, taksit; tutar ve ödenen kısmı
function shareItemRow(x, today) {
  const paid = x.covered >= x.amount - EPS;
  const li = el("li", "pay" + (paid ? " past" : ""));
  const d = T.parseDate(x.key);
  const badge = el("div", "date-badge");
  badge.append(el("span", "d", String(d.day)), el("span", "w", T.monthShort(d.idx)));
  const main = el("div", "pay-main");
  const title = el("div", "pay-title");
  title.append(cardMark(x.cardId), el("span", "p-desc", x.purchase.desc));
  const plan = T.planLength(x.purchase);
  main.append(title, el("div", "pay-sub", `${cardName(x.cardId)} · ${plan > 1 ? `${x.no}/${plan}. taksit` : "peşin"}`));
  const side = el("div", "share-amt");
  side.append(el("span", "amount", fmt(x.amount)), paid ? el("small", "in-text", "ödendi ✓")
    : x.covered > EPS ? el("small", "", `${fmt(x.covered)} ödendi`)
    : el("small", "", x.key < today ? `${lateDays(x.key, today)} gün gecikti` : x.key === today ? "günü bugün"
      : relDays(x.key, today).toLocaleLowerCase("tr-TR")));
  li.append(badge, main, side);
  editsPurchase(li, x.purchase, () => els.shareSheet.close());
  return li;
}

els.shareRemind.addEventListener("click", () => {
  const person = personById(sharePid);
  if (person) sharePerson(person, todayIndex());
});
els.sharePaid.addEventListener("click", () => {
  const pid = sharePid;
  els.shareSheet.close();
  openPaySheet({ personId: pid });
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
    const k = state.debts.filter(x => x.personId === p.id && x.kind !== "payment").length;
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
      // Borçları ödemeleriyle gider; kart payı ödemeleri ilk kişinin varlığına girdiğinden, kart ekstresi ödemeleri onun
      // varlığından çıktığından ilk kişi silinirse hepsi gider (borcu ve kartı olmayan ödeme kart payı ödemesidir)
      const first = state.people[0].id === p.id;
      const gone = new Set(state.debts.filter(x => x.personId === p.id && x.kind !== "payment").map(x => x.id));
      const drop = x => x.personId === p.id || gone.has(x.debtId) || (first && x.kind === "payment" && !x.debtId);
      const loose = state.debts.filter(x => drop(x) && x.kind === "payment" && !x.debtId);
      const settled = loose.filter(x => !x.cardId).length, cardPaid = loose.length - settled;
      const owned = [n && `${n} harcaması`, m && `${m} varlık hareketi`, k && `${k} borç/alacak kaydı`, settled && `kartındaki harcamalar için ${settled} ödemesi`,
        cardPaid && `${cardPaid} kart ödemesi`].filter(Boolean);
      const list = owned.length > 1 ? `${owned.slice(0, -1).join(", ")} ve ${owned[owned.length - 1]}` : owned[0];
      if (!confirm(list ? `“${p.name}” ve ${list} silinsin mi?` : `“${p.name}” silinsin mi?`)) return;
      state.people = state.people.filter(x => x.id !== p.id);
      state.installments = state.installments.filter(i => i.personId !== p.id);
      state.entries = state.entries.filter(x => x.personId !== p.id);
      state.debts = state.debts.filter(x => !drop(x));
      saveState(); renderPeopleSheet(); render();
    });
    li.append(avatar(p), input, del, el("span", "sub", [n && `${n} harcama`, m && `${m} hareket`, k && `${k} borç`].filter(Boolean).join(" · ") || "kayıt yok"));
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
      .sort((a, b) => (b.date ?? b.firstDue ?? "").localeCompare(a.date ?? a.firstDue ?? ""));
    // Bulutta toplu (bir istekte 25), cihazda tek tek; her parçadan sonra kaydedilir
    const size = YZ.mode === "cloud" ? 25 : 5;
    let done = 0, skipped = 0;
    for (let i = 0; i < todo.length; i += size) {
      if (stateOwner !== owner || !YZ.enabled) break;
      const part = todo.slice(i, i + size);
      const results = await YZ.suggestMany(part.map(p => p.desc), memory);
      if (!results || stateOwner !== owner) break;
      part.forEach((p, k) => {
        const r = results[k], cur = state.installments.find(x => x.id === p.id);
        if (!r || !cur || K.valid(cur.category) || cur.desc !== p.desc) return;
        if (r.confidence < K.SURE) { unsure.add(p.id); skipped++; return; }
        update(p.id, r.category);
        done++;
      });
      if (done) { saveState(); render(); }
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

// ---------- Yapay zekâ: kategori önerisi ve asistanlar (MCP) ----------
// Kategori önerisi yz.js'te: bulut (giriş yapmış kullanıcıda varsayılan), cihazda ya da kapalı.
// Asistanlar /mcp'ye (mcp/worker.js) bağlanır; kullanıcı oauth/consent.html'de izin verir.
const mb = n => Math.round((n || 0) / 1e6);

function renderAiStatus() {
  const i = YZ.info, mode = YZ.mode, local = YZ.supported();
  const loose = knownPurchases().filter(p => !K.valid(p.category) && !unsure.has(p.id)).length;
  const left = knownPurchases().filter(p => !K.valid(p.category) && unsure.has(p.id)).length;
  for (const b of els.aiModeSeg.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-checked", String(b.dataset.mode === mode));
    if (b.dataset.mode === "local") { b.disabled = !local; b.title = local ? "" : "Bu tarayıcıda çalışmıyor"; }
  }
  els.aiProgress.hidden = true;
  els.aiBackfill.hidden = true;
  const show = (title, sub) => { els.aiLocalTitle.textContent = title; els.aiLocalSub.textContent = sub; };
  const unsureNote = left ? ` ${left} harcamada emin olamadı; kategorisini Harcamalar'dan seçebilirsin.` : "";

  if (mode === "off") {
    show("Kapalı", "Yalnızca daha önce seçtiğin kategoriler aynı işyerlerine verilir.");
    return;
  }
  if (mode === "cloud") {
    if (!window.syncGetUser?.()) {
      show("Bulut · giriş gerekli", "Giriş yapınca çalışır. Girişsiz kullanımda Cihazda seçeneğini kullanabilirsin.");
      return;
    }
    show("Bulut · açık", "Harcama açıklamaların CashFollow sunucusunda (Cloudflare) büyük bir dil modeliyle sınıflandırılır, "
      + "saklanmaz. İndirme gerekmez." + unsureNote);
  } else if (i.status === "loading") {
    show(i.total && i.loaded < i.total ? "Cihazda · indiriliyor…" : "Cihazda · yükleniyor…",
      i.total ? `${mb(i.loaded)} / ${mb(i.total)} MB` : "Hazırlanıyor");
    els.aiProgress.hidden = !i.total;
    els.aiProgress.firstElementChild.style.width = `${i.total ? Math.min(100, (i.loaded / i.total) * 100) : 0}%`;
  } else if (i.status === "error") {
    show("Cihazda · açılamadı", `${i.error} — Bulut'a geçebilir ya da yeniden seçebilirsin.`);
  } else {
    show("Cihazda · açık", `Model bu cihazda (~${YZ.SIZE_MB} MB), internetsiz çalışır; veri cihazdan çıkmaz. `
      + (i.status === "ready" ? "Hazır." : "Gerektiğinde yüklenir.") + unsureNote);
  }
  if (loose && YZ.enabled) {
    els.aiBackfill.hidden = false;
    els.aiBackfill.disabled = backfillBusy;
    els.aiBackfill.textContent = backfillBusy ? `Ayrılıyor… ${loose} kaldı` : `${loose} kategorisiz harcamayı ayır`;
  }
}

YZ.onChange(() => { if (els.aiSheet.open) renderAiStatus(); });

els.aiModeSeg.addEventListener("click", async e => {
  const next = e.target.closest("button")?.dataset.mode;
  if (!next || next === YZ.mode) return;
  if (YZ.mode === "local" && !confirm("Cihaza indirilen model silinsin mi? Verilen kategoriler kalır.")) return;
  if (next === "local" && !confirm(`Model bu cihaza indirilecek (yaklaşık ${YZ.SIZE_MB} MB). Wi-Fi önerilir. Devam edelim mi?`)) return;
  unsure.clear();
  const pending = YZ.setMode(next);
  renderAiStatus();
  const ok = await pending;
  renderAiStatus();
  render();
  if (next === "local") toast(ok ? "Cihazdaki model hazır" : "Model yüklenemedi");
  if (YZ.enabled) backfillCategories();
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

els.settingsBtn.addEventListener("click", () => {
  renderThemeSeg();
  els.cashDefText.textContent = cashDefText().replace(/^./, c => c.toLocaleUpperCase("tr-TR"));
  openSheet(els.settingsSheet);
});

// ---------- Nakit tanımı ----------
// Nakit grafiğinin saydığı varlıklar: TL, TL para piyasası fonları (hepsi), döviz, altın ve eldeki (ya da önceden
// seçilmiş) diğer fon ve hisseler tek tek. Değişiklik hemen uygulanır, cihazda kalır (para.cashDef); en az biri seçili.
function openCashDefSheet() {
  els.settingsSheet.close();
  renderCashDef();
  openSheet(els.cashDefSheet);
}

function renderCashDef() {
  const opt = (value, title, sub) => {
    const row = el("label", "check cash-opt");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = cashDef.includes(value);
    const text = el("span", "cash-opt-text");
    text.append(el("strong", "", title));
    if (sub) text.append(el("small", "", sub));
    row.append(input, text);
    return row;
  };
  const codes = [...new Set([...marketCodes(), ...cashDef.filter(c => V.market(c))])];
  const funds = codes.filter(c => V.moneyMarket(prices?.prices?.[c]));
  const others = codes.filter(c => !funds.includes(c));
  els.cashDefList.replaceChildren(
    opt("TRY", "Türk lirası", "Ana para birimi"),
    opt(V.MMF, "TL para piyasası fonları", funds.length ? `Elindekiler: ${funds.map(c => V.market(c).ticker).join(", ")}`
      : "TEFAS'taki para piyasası fonları; aynı gün nakde döner (T+0)"),
    ...V.ASSETS.filter(a => a.code !== "TRY").map(a => opt(a.code, a.name)),
    ...(others.length ? [el("span", "group-label cash-def-head", "Elindeki diğer fon ve hisseler")] : []),
    ...others.map(c => opt(c, V.market(c).ticker, marketName(c))),
  );
}

function setCashDef(list) {
  cashDef = V.cashDef(list);
  const same = cashDef.length === V.CASH_DEFAULT.length && V.CASH_DEFAULT.every(c => cashDef.includes(c));
  writePref(PREF.cashDef, same ? "" : JSON.stringify(cashDef));
  render();
}

els.cashDefList.addEventListener("change", e => {
  const picked = [...els.cashDefList.querySelectorAll("input:checked")].map(x => x.value);
  if (!picked.length) { e.target.checked = true; toast("En az birini seç"); return; }
  setCashDef(picked);
});
els.cashDefReset.addEventListener("click", () => { setCashDef(null); renderCashDef(); toast("Nakit: TL ve para piyasası fonları"); });
els.cashDefBtn.addEventListener("click", openCashDefSheet);
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
    ensureCardTracking();
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
    if (!people.length && !s.cards.length && !s.installments.length && !s.entries.length && !s.debts.length) {
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
    [local.entries.length, "varlık hareketi"], [local.debts.filter(x => x.kind !== "payment").length, "borç/alacak kaydı"], [local.debts.filter(x => x.kind === "payment").length, "ödeme"], [people, "kişi"]]
    .filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(", ");
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
  const newCard = card ? null : { ...defaultCard(result.dueDay, "kart", nextColor(state.cards)), trackSince: T.todayKey() };
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

els.cashStart.addEventListener("change", () => {
  cashStart = els.cashStart.value;
  cashShift = 0;
  writePref(PREF.cashStart, cashStart);
  render();
});
els.cashMode.addEventListener("click", e => {
  const mode = e.target.closest("button")?.dataset.mode;
  if (!mode || mode === cashMode) return;
  cashMode = mode;
  writePref(PREF.cashMode, mode);
  render();
});
document.querySelector(".cash-panel").addEventListener("click", e => {
  const b = e.target.closest("[data-cash-shift]");
  if (b) { cashShift += Number(b.dataset.cashShift); render(); }
});
els.cashRange.addEventListener("click", () => { cashShift = 0; render(); });

els.timelineKind.addEventListener("click", e => {
  const kind = e.target.closest("button")?.dataset.kind;
  if (!kind || kind === timelineKind) return;
  timelineKind = kind;
  render();
});

els.timelineStart.addEventListener("change", () => {
  timelineStart = els.timelineStart.value;
  timelineDay = null;
  writePref(PREF.timelineStart, timelineStart);
  render();
});

els.purchaseSort.addEventListener("change", () => {
  purchaseSort = els.purchaseSort.value;
  writePref(PREF.purchaseSort, purchaseSort);
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
  resizeFrame = requestAnimationFrame(() => {
    if (view === "ozet") { renderChart(chartMonths); renderCash(); }
    if (view === "varliklar") renderAssetChart(entryFilter);
  });
});

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
  // Yeni sürümün service worker'ı denetimi alınca sayfa bir kez yenilenir, açık form varsa kapanınca (sw.js ana sürümde
  // sayfayı kendisi de yeniler, ama Safari'de bu her zaman çalışmıyor). İlk kurulumda yenilenmez.
  const updating = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updating || reloading) return;
    reloading = true;
    const go = () => (document.querySelector('dialog[open]') ? setTimeout(go, 1000) : location.reload());
    go();
  });
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
    onSynced(pulled) { if (pulled) ensureCardTracking(); checkInbox(); backfillCategories(); },
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") window.syncRefresh?.();
});

// Girişsiz veride kartlar açılışta takibe girer (oturum açıksa hesabın verisi eşitlemeden sonra, onSynced'de)
if (!stateOwner) ensureCardTracking();
render();
// Açılışta: kullanıcının daha önce verdiği kategoriler ve (açıksa) cihazdaki modelle kategorisizler
setTimeout(() => backfillCategories(), 4000);

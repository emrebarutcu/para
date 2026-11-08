// ---------- State + storage ----------
const T = window.Taksit;
const E = window.Eposta;
const V = window.Varlik;
const R = window.Tekrar;
const K = window.Kategori;
const I = window.Icgoru;
const YZ = window.YZ;
const B = window.Borc;
const N = window.Nakit;   // Nakit grafiği ve Varlığın seyri (nakit.js)
const P = window.Para;    // ülkeler ve para birimleri (para.js)
// Görünen metinler Türkçe yazılır, L(metin) ile gösterilir: tarayıcı Türkçe değilse dilinin sözlüğünden (dil/<kod>.json, dil.js;
// sözlük index.html'de app.js'ten önce dil-sayfa.js yükler, üst düzeydeki sabitler de çevrilir). Değişken yerleri {0}, {1}…
const D = window.Dil;
const L = D.t;

// Hesabın ana para birimi: ülkesinden (girişliyse hesabın user_metadata.country, girişsizse cihazda; para.js). Kartlar,
// nakit harcamalar, toplamlar ve "TL" yazan her yer ondadır; state.home'a da yazılır (hesap modülleri oradan okur).
let HOME = "TRY";
// Hesabın ülkesinin özellikleri (para.js features: taksit öne çıkıyor mu, Pay in 4 sağlayıcıları, kartın faizi, fon /
// hisse, banka e-postaları, Excel içe aktarma); applyHome ülkeden yazar. Ülkede olmayan özellik görünmez.
let FEAT = P.features(P.DEFAULT_COUNTRY);
const STORAGE_KEY_BASE = "cashflow.v1";
function getStorageKey() {
  return window.CF_USER_ID ? `${STORAGE_KEY_BASE}.${window.CF_USER_ID}` : STORAGE_KEY_BASE;
}

const MAX_MONTHS = 60;           // akışta gösterilecek en fazla ay
const CHART_MONTHS = 12;         // özetteki grafikte gösterilecek ay
const CASH_COLOR = "var(--cash)";
const VIEWS = ["ozet", "akis", "harcamalar", "kartlar", "borclar", "varliklar"];
const COUNT_PRESETS = [1, 2, 3, 4, 6, 9, 12];
const FREQ_PRESETS = [["", L("Bir kez")], ["day", L("Günde bir")], ["week", L("Haftada bir")], ["month", L("Ayda bir")], ["other", L("Diğer")]];   // tekrar sıklığı
const TIMES_PRESETS = [[0, L("Süresiz")], [3, L("{0} kez", 3)], [6, L("{0} kez", 6)], [12, L("{0} kez", 12)]];   // kaç kez tekrarlar
const WEEKDAYS = [L("Paz"), L("Pzt"), L("Sal"), L("Çar"), L("Per"), L("Cum"), L("Cmt")];
const CAL_WEEKDAYS = [L("Pzt"), L("Sal"), L("Çar"), L("Per"), L("Cum"), L("Cmt"), L("Paz")];   // takvim pazartesiyle başlar
const PREF = { theme: "para.theme", chartBy: "para.chartBy", flowMode: "para.flowMode", timelineMode: "para.timelineMode", rates: "para.rates",
  cashStart: "para.cashStart", cashMode: "para.cashMode", timelineStart: "para.timelineStart", trackNotice: "para.trackNotice",
  purchaseSort: "para.purchaseSort", prices: "para.prices", settle: "para.settle", cashDef: "para.cashDef",
  assetRange: "para.assetRange", history: "para.history", country: "para.ulke" };
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
  try { return V.cashDef(JSON.parse(readPref(PREF.cashDef)), HOME); } catch { return [...V.cashDefault(HOME)]; }
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
let lastBnpl = null;          // formda son seçilen Pay in 4 sağlayıcısı
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
let lastAsset = HOME;
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
    if (!raw) return { ...defaultState(), home: HOME };
    return hydrate({ ...JSON.parse(raw), home: HOME });
  } catch { return { ...defaultState(), home: HOME }; }
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
  applyHome();
  state = loadState();   // kullanıcıya özel local storage'a geç
  resetView();
  render();
  askOfflineData();
};
window.onAuthLogout = function () {
  window.CF_USER_ID = null;
  els.moveModal.hidden = true;
  stateOwner = null;
  applyHome();
  state = { ...defaultState(), home: HOME };  // temiz slate — hesap verisi ekranda kalmasın
  resetView();
  render();
};

// ---------- CashFollow Premium ----------
// Web'de satın alma yok: Premium iPhone uygulamasından alınır ve hesaba bağlanır (subscriptions; mcp/abonelik.js). Web
// hesabın satırına bakar (tablo.js premium: iPhone ve asistanla aynı kural). Ücretsiz sürüm iPhone'daki gibi (SETUP.md →
// Abonelik): 2 kart, yalnızca kullanıcının kendisi; Akış, İçgörüler, Varlığın seyri ve asistan Premium. Sınırı aşan eski
// kart ve kişiler kalır, yalnızca yenisi eklenemez. Girişsiz web ücretsizdir. Durum bilinmezken (oturum henüz okunmadı ya da
// bağlantı yok ve önceki okuma yok) kilit gösterilmez; son okunan değer saklanır, telefonda alınca sekme öne gelince açılır.
const FREE_CARDS = 2, FREE_PEOPLE = 1;
const PREMIUM_TTL = 60_000;        // öne gelince en sık bu aralıkla yeniden sorulur
let premium = null;                // true / false / null (bilinmiyor)
let premiumUser = undefined;       // durumu tutulan kullanıcı (girişsizse null)
let premiumAt = 0;
const premiumKey = id => `para.premium.${id}`;
const paywallSeen = new Set();     // analitik: her kilit sayfa başına bir kez
const locked = () => premium === false;

function setPremium(p) {
  if (p === premium) return;
  premium = p;
  render();
  if (els.peopleSheet.open) renderPeopleSheet();
}

async function checkPremium() {
  const user = window.syncGetUser?.() ?? null;
  if (!user) return;
  premiumAt = Date.now();
  const p = await window.syncPremium?.();
  if (p == null || (window.syncGetUser?.()?.id ?? null) !== user.id) return;   // okunamadı ya da bu arada çıkış yapıldı
  writePref(premiumKey(user.id), p ? "1" : "0");
  setPremium(p);
}

// sync.js: oturum belli olunca ve her değişince
window.onAuthUser = function (user) {
  const id = user?.id ?? null;
  if (id === premiumUser) return;
  premiumUser = id;
  if (!id) { setPremium(false); return; }
  const saved = readPref(premiumKey(id));
  setPremium(saved == null ? null : saved === "1");
  checkPremium();
};

// Kilitli özelliğin yerine: ne olduğu ve Premium'un nereden alınacağı (girişsizse giriş düğmesi). Başlığı olan panelin
// içinde title null.
function premiumLock(title, desc, reason) {
  const box = el("div", "premium-lock");
  const head = el("div", "premium-lock-head");
  const badge = el("span", "premium-badge");
  badge.append(icon("lock"), document.createTextNode(L("Premium")));
  if (title) head.append(el("strong", "", title));
  head.append(badge);
  box.append(head, el("p", "", desc), el("p", "hint", L("CashFollow Premium iPhone uygulamasından alınır (Ayarlar → CashFollow Premium). Aynı hesapla giriş yaptığında burada da açılır.")));
  if (!window.syncGetUser?.() && window.syncOpenAuth) {
    const b = el("button", "btn btn-primary sm", L("Giriş yap"));
    b.type = "button";
    b.addEventListener("click", () => window.syncOpenAuth());
    box.append(b);
  }
  if (!paywallSeen.has(reason)) { paywallSeen.add(reason); window.Analitik?.event("paywall_shown", { reason }); }
  return box;
}

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

// Kuruş hanesi para birimine göre (para.js digits): yen 0, Kuveyt dinarı 3
const homeDigits = () => P.CURRENCIES.find(c => c.code === HOME)?.digits ?? 2;
let moneyFmt = new Intl.NumberFormat(D.locale(), { style: "currency", currency: HOME, minimumFractionDigits: homeDigits(), maximumFractionDigits: homeDigits() });
const numFmt = new Intl.NumberFormat(D.locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmt(n) { return moneyFmt.format(n || 0); }
function fmtNum(n) { return numFmt.format(n || 0); }
// "önce → sonra": sağdan sola yazıda ok ters döner
const ARROW = D.dir() === "rtl" ? "←" : "→";

function fmtShort(n) {
  const abs = Math.abs(n), s = n < 0 ? "-" : "";
  const f = v => new Intl.NumberFormat(D.locale(), { maximumFractionDigits: 1 }).format(v);
  const [mn, k] = D.lang === "ar" ? [" مليون", " ألف"] : ["M", "K"];   // iPhone'daki kisa() gibi
  if (abs >= 1e6) return s + f(abs / 1e6) + mn;
  if (abs >= 1e3) return s + f(abs / 1e3) + k;
  return s + Math.round(abs).toLocaleString(D.locale());
}

// "2026-10-22" → "22 Eki 2026" / "22 Eki"; ay indeksi → "Ekim 2026". Türkçe ve İngilizce dışında yerel yazımla (Intl):
// de "22. Okt. 2026", ja "2026年10月22日"
const dateFmts = new Map();
function intlDate(key, opts) {
  const k = JSON.stringify(opts);
  if (!dateFmts.has(k)) dateFmts.set(k, new Intl.DateTimeFormat(D.locale(), { ...opts, timeZone: "UTC" }));
  const [y, m, d] = key.split("-").map(Number);
  return dateFmts.get(k).format(new Date(Date.UTC(y, m - 1, d || 15)));
}
const ownDates = () => D.lang === "tr" || D.lang === "en";
function fmtDay(key) {
  if (!ownDates()) return intlDate(key, { day: "numeric", month: "short", year: "numeric" });
  const d = T.parseDate(key);
  return `${d.day} ${T.monthShort(d.idx)} ${T.yearOf(d.idx)}`;
}
function fmtDayShort(key) {
  if (!ownDates()) return intlDate(key, { day: "numeric", month: "short" });
  const d = T.parseDate(key);
  return `${d.day} ${T.monthShort(d.idx)}`;
}
function monthLong(idx) {
  if (!ownDates()) return intlDate(T.monthKey(idx), { month: "long", year: "numeric" });
  return `${T.monthName(idx)} ${T.yearOf(idx)}`;
}

function relDays(key, today) {
  const d = Math.round((T.toDate(key) - T.toDate(today)) / 864e5);
  if (d === 0) return L("Bugün");
  if (d === 1) return L("Yarın");
  if (d > 1) return L("{0} gün sonra", d);
  return d === -1 ? L("Dün") : L("{0} gün önce", -d);
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
function cardName(id) { return cardById(id)?.name ?? L("Nakit"); }
function seriesVar(entity) { return `var(--s${(entity.color % SERIES_COUNT) + 1})`; }
function cardColor(id) { const c = cardById(id); return c ? seriesVar(c) : CASH_COLOR; }
function paymentsOf(p, until) { return T.payments(p, cardById(p.cardId), until); }
// Bonus ödemesi (Japonya, ボーナス払い; para.js bonusFor, taksit.js bonus): hesabın ülkesi Japonya'ysa sunulur
function bonusAllowed() { return FEAT.bonus; }
// Bonus ödemeli harcamanın ödeme adı: "Yaz bonusu · 10 Ağu" ya da "Kış bonusu"
function bonusPayName(x) { return x.bonus === "summer" ? L("Yaz bonusu") : L("Kış bonusu"); }
// Tekrarlayan harcamada sıradaki tekrarın ödemeleri de (henüz gelmemiş olsa da) sayılır: liste ve durum için
function upcomingPayments(p, today) { return paymentsOf(p, T.repeats(p) ? R.nextDate(p, today) ?? today : undefined); }
// Tutar harcamanın / hareketin varlığında: TL ise "₺1.250,00", değilse "$100,00", "12,5 gr"
function money(n, code = HOME) { return code === HOME ? fmt(n) : fmtAsset(n, code); }

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
  const upper = s => s.toLocaleUpperCase(D.locale());
  const words = person.name.trim().split(/\s+/);
  if (words.length > 1) return upper(words[0].charAt(0) + words[1].charAt(0));
  const first = upper(words[0].charAt(0));
  const clash = state.people.some(p => p.id !== person.id && upper(p.name.trim().charAt(0)) === first);
  return clash ? first + words[0].charAt(1).toLocaleLowerCase(D.locale()) : first;
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
    } else if (part.type !== "literal" || D.dir() === "rtl") node.append(document.createTextNode(part.value));   // sağdan solada boşluk ve yön işaretleri kalır
  }
}

function knownPurchases() { return N.knownPurchases(state); }

// Son ödemenin ayı; süresiz tekrarlayan TL harcaması varsa en az bir yıl ileri bakılır
function lastPaymentIndex() {
  let last = -Infinity;
  for (const p of knownPurchases()) {
    if (T.assetOf(p, HOME) !== HOME) continue;
    const card = cardById(p.cardId);
    if (card && !B.tracked(card)) continue;   // hesaba katılmayan kart ödeme penceresini uzatmaz
    const list = paymentsOf(p);
    if (list.length) last = Math.max(last, list[list.length - 1].idx);
    if (T.endless(p)) last = Math.max(last, todayIndex() + 11);
  }
  return Math.max(last, B.carryIndex(state, T.todayKey()));   // döner kredide devreden bakiyenin ekstresi
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
  assetPanel: $("assetPanel"), assetRange: $("assetRange"), assetSum: $("assetSum"), assetChart: $("assetChart"), assetNote: $("assetNote"), assetLock: $("assetLock"),
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
  dateChips: $("dateChips"), descList: $("descList"), countOther: $("countOther"), perRow: $("perRow"), bonusRow: $("bonusRow"), cardTip: $("cardTip"),
  dateRow: $("dateRow"), dateVal: $("dateVal"), categoryRow: $("categoryRow"), categoryVal: $("categoryVal"), personVal: $("personVal"),
  repeatRow: $("repeatRow"), repeatVal: $("repeatVal"), purchaseRepeat: $("purchaseRepeat"), assetRow: $("assetRow"), assetVal: $("assetVal"),
  purchaseAssetChips: $("purchaseAssetChips"), countField: $("countField"), cardField: $("cardField"),
  planSeg: $("planSeg"), bnplField: $("bnplField"), bnplChips: $("bnplChips"), bnplHint: $("bnplHint"),
  cardSheet: $("cardSheet"), cardForm: $("cardForm"), cardTitle: $("cardTitle"),
  cardDelete: $("cardDelete"), cardPreview: $("cardPreview"), cardHint: $("cardHint"), cardColors: $("cardColors"),
  cardDebt: $("cardDebt"), cardPayMode: $("cardPayMode"), trackPreview: $("trackPreview"),
  cardDebtLink: $("cardDebtLink"), cardPaysLink: $("cardPaysLink"),
  termField: $("termField"), termNote: $("termNote"), termChoices: $("termChoices"),
  eventSheet: $("eventSheet"), eventTitle: $("eventTitle"), eventDate: $("eventDate"), eventSplit: $("eventSplit"),
  eventItems: $("eventItems"), eventToFlow: $("eventToFlow"), eventState: $("eventState"), eventOk: $("eventOk"), eventPay: $("eventPay"),
  peopleSheet: $("peopleSheet"), peopleEdit: $("peopleEdit"), personAddForm: $("personAddForm"), peopleLock: $("peopleLock"),
  settingsSheet: $("settingsSheet"), settingsBtn: $("settingsBtn"), themeSeg: $("themeSeg"),
  countrySelect: $("countrySelect"), authCountry: $("authCountry"),
  cashDefBtn: $("cashDefBtn"), cashDefText: $("cashDefText"), cashDefSheet: $("cashDefSheet"), cashDefList: $("cashDefList"),
  cashDefReset: $("cashDefReset"),
  inboxBtn: $("inboxBtn"), inboxSheet: $("inboxSheet"), inboxLoginNote: $("inboxLoginNote"), inboxSetup: $("inboxSetup"), inboxBanks: $("inboxBanks"),
  inboxAddress: $("inboxAddress"),
  aiBtn: $("aiBtn"), aiSheet: $("aiSheet"), mcpUrl: $("mcpUrl"), aiLoginNote: $("aiLoginNote"), aiPremiumNote: $("aiPremiumNote"),
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
function cashflow(fromIdx, toIdx) { return N.cashflow(state, fromIdx, toIdx, T.todayKey()); }

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

  const adding = view === "varliklar" ? "entry" : view === "borclar" ? (debtSide === "debt" ? "debt" : "receivable") : "purchase";
  els.addLabel.textContent = { entry: L("Hareket"), debt: L("Borç"), receivable: L("Alacak"), purchase: L("Harcama") }[adding];
  els.fab.setAttribute("aria-label", { entry: L("Hareket ekle"), debt: L("Borç ekle"), receivable: L("Alacak ekle"), purchase: L("Harcama ekle") }[adding]);

  if (pendingScroll) {
    const target = document.getElementById(pendingScroll);
    pendingScroll = null;
    target?.scrollIntoView({ block: "center" });
  }
}

// ---------- Özet ----------
function renderOverview(months, start, last) {
  const at = idx => months.find(m => m.idx === idx);
  els.heroLabel.textContent = start === todayIndex() ? L("Bu ay ödenecek") : L("{0} ayında ödenecek", T.monthName(start));
  setMoney(els.heroAmount, at(start)?.total || 0);
  els.nextLabel.textContent = T.monthName(start + 1);
  els.nextTotal.textContent = fmt(at(start + 1)?.total || 0);
  els.remaining.textContent = fmt(months.reduce((s, m) => s + m.total, 0));
  // Son taksit: ödenecek bir şey kalan son ay; süresiz tekrarlayan (hesaba katılan) harcama varsa bitmez
  const endless = knownPurchases().some(p => T.assetOf(p, HOME) === HOME && T.endless(p) && !(cardById(p.cardId) && !B.tracked(cardById(p.cardId))));
  const lastDue = [...months].reverse().find(m => m.total > EPS);
  els.endLabel.textContent = endless ? L("Süresiz") : lastDue ? `${T.monthShort(lastDue.idx)} ${T.yearOf(lastDue.idx)}` : "—";
  // Ayın borç ve kredi ödemeleri ayrı satırda (yukarıdaki tutar yalnızca kart ve nakit ödemeleri); dokununca Borçlar
  const debtDue = dueSum(B.paymentsDue(state, T.todayKey(), T.dateKey(start, 1), T.dateKey(start, 31)), curRates());
  els.heroDebt.hidden = !(debtDue > EPS);
  els.heroDebt.textContent = L("+ {0} borç ödemesi ›", fmt(debtDue));

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
  if (locked() && list.length) {
    els.insightMore.hidden = true;
    const li = el("li");
    li.append(premiumLock(null, L("{0} içgörü hazır: harcama alışkanlıkların, yaklaşan yükler ve öneriler.", list.length), "insights"));
    els.insightList.replaceChildren(li);
    return;
  }
  els.insightMore.hidden = list.length <= INSIGHTS_SHOWN;
  els.insightMore.textContent = insightsOpen ? L("Daha az") : L("Tümü ({0})", list.length);
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
  if (x.action.kind === "entry") openEntrySheet(null, HOME, { desc: L("Maaş"), repeat: 0 });
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
    head.append(el("span", "cat-name", r.id ? r.name : L("Kategorisiz")), el("span", "cat-amt", fmt(r.value)));
    const bar = el("div", "cat-bar");
    const fill = el("span");
    fill.style.width = `${(r.value / max) * 100}%`;
    bar.append(fill);
    const meta = el("div", "cat-meta");
    meta.append(el("span", "", D.pct(Math.round(r.share * 100))));
    if (r.id && r.average > 0) {
      const d = r.value / r.average - 1;
      if (Math.abs(d) >= 0.1) meta.append(el("span", d > 0 ? "out-text" : "in-text", d > 0 ? L("↑ 3 ay ortalamasından {0} fazla", D.pct(Math.round(Math.abs(d) * 100)))
        : L("↓ 3 ay ortalamasından {0} az", D.pct(Math.round(Math.abs(d) * 100)))));
    }
    li.append(head, bar, meta);
    return li;
  }));
  const loose = b.rows.some(r => !r.id);
  els.catNote.textContent = L("Taksitli alışveriş tamamıyla alındığı aya yazılır.")
    + (loose && !YZ.enabled ? " " + L("Kategorisizleri yapay zekâ ayırabilir: Ayarlar → Yapay zekâ.") : "");
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
    els.upcoming.append(el("li", "empty", state.installments.length || state.debts.length ? L("Yaklaşan ödeme yok") : L("Henüz harcama yok")));
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
  sub.append(el("span", "", x.state === "late" ? L("son ödeme {0}", fmtDayShort(x.key)) : x.state === "due" ? L("Son gün bugün")
    : `${relDays(x.key, today)} · ${fmtDayShort(x.key)}`));
  if (x.state === "late") sub.append(el("span", "out-text", L("{0} gün gecikti", lateDays(x.key, today))));
  if ((x.paid ?? x.covered) > EPS) sub.append(el("span", "", L("kısmen ödendi · kalan")));   // döner kredide covered devredeni de sayar
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
    if (!V.asset(e.asset) || (V.market(e.asset) && !V.settled(e, HOME))) continue;
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
  if (entries.some(x => x.e.asset !== HOME) || spends.some(x => T.assetOf(x.p, HOME) !== HOME)
    || flows.some(f => f.asset !== HOME) || costs.some(d => d.asset !== HOME)) loadRates();

  const entryRank = new Map(state.entries.map((e, i) => [e.id, i]));
  const spendRank = new Map(state.installments.map((p, i) => [p.id, state.entries.length + i]));
  const items = [
    ...entries.map(({ e, date }) => (V.settled(e, HOME)
      ? { kind: "move", date, entry: e, value: 0, rank: entryRank.get(e.id) }
      : { kind: e.amount > 0 ? "in" : "out", date, entry: e, value: V.toTry(e.amount, e.asset, r, HOME), rank: entryRank.get(e.id) })),
    ...spends.map(({ p, date }) => {
      const amount = T.originalTotal(p);
      return { kind: "out", date, purchase: p, amount, value: V.toTry(-amount, T.assetOf(p, HOME), r, HOME), rank: spendRank.get(p.id) };
    }),
    ...costs.map((d, i) => {
      const amount = -B.sign(d) * (d.amount - d.principal);   // işaretli, borcun varlığında
      return { kind: amount < 0 ? "out" : "in", date: d.date, debt: d, amount, value: V.toTry(amount, d.asset, r, HOME),
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
    stat(L("Girdi"), approx + "+" + fmt(inSum), "in-text"),
    stat(L("Çıktı"), approx + "−" + fmt(outSum), "out-text"),
    stat(L("Net"), approx + (net < 0 ? "−" : net > 0 ? "+" : "") + fmt(Math.abs(net)), net < 0 ? "out-text" : net > 0 ? "in-text" : ""));
  els.timelineSum.title = missing ? L("Kuru alınamayan döviz/altın hareketleri toplama dahil değil") : "";

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
    const text = timelineKind === "in" ? (whole ? L("Bu ay girdi yok") : L("Bu dönemde girdi yok"))
      : timelineKind === "out" ? (whole ? L("Bu ay çıktı yok") : L("Bu dönemde çıktı yok"))
      : whole ? L("Bu ay hareket yok") : L("Bu dönemde hareket yok");
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
      const o = el("option", "", L("Ayın {0}", dayWithSuffix(i + 1)));
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
    const payText = paid.map(({ ev, st, flow }) => (ev ? L("{0} ekstresi {1}", cardName(ev.cardId), fmt(ev.total))
        + (ev.ignored ? ` (${L("hesaba katılmıyor")})` : stateTag(st) ? ` (${stateTag(st)})` : "")
      : `${flowLabel(flow)} ${flowMoney(flow)}`));
    b.setAttribute("aria-label", `${fmtDayShort(key)}: ` + (list.length || paid.length
      ? [inSum && L("girdi {0}", fmt(inSum)), outSum && L("çıktı {0}", fmt(outSum)), unknown && L("kuru bilinmeyen hareket"), ...payText].filter(Boolean).join(", ")
      : L("hareket yok")));
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
    if (!pays.has(timelineDay)) day.append(el("p", "tl-empty", timelineKind === "in" ? L("Bu gün girdi yok") : timelineKind === "out" ? L("Bu gün çıktı yok") : L("Bu gün hareket yok")));
  }
  els.timeline.append(day);
}

// Günün başlığı: tarih, bugünse etiket; o gün ödenen kart ekstreleri işaret olarak (dokununca ödemenin ayrıntısı:
// kime ne kadar düştüğü ve içindeki harcamalar; elle ödenen kartta ödendi / ödenmedi rozeti) ve borç akışları (dokununca
// borcun ya da kart payının penceresi)
function timelineDayHead(date, today, pays = []) {
  const head = el("div", "tl-date");
  head.append(el("span", "", `${fmtDayShort(date)} · ${WEEKDAYS[T.toDate(date).getDay()]}`));
  if (date === today) head.append(el("span", "tl-tag", L("Bugün")));
  for (const { ev, st, flow: f } of pays) {
    const b = el("button", "tl-pay");
    b.type = "button";
    b.setAttribute("aria-haspopup", "dialog");
    if (ev) {
      b.title = [...new Set(ev.items.map(i => i.purchase.desc))].join(", ");
      if (ev.ignored) b.classList.add("ignored");
      // Durum: ödendi / son gün bugün / gecikti; yalnızca gecikti kırmızı. Hesaba katılmayan kartta etiket. Etiket varken
      // ad yalın kart adı (dar ekranda ad kırpılmasın; tam adı ipucunda)
      const tag = ev.ignored ? L("hesaba katılmıyor") : stateTag(st);
      b.title = L("{0} ekstresi — {1}", cardName(ev.cardId), b.title);
      b.append(cardMark(ev.cardId), el("span", "tl-pay-name", tag ? cardName(ev.cardId) : L("{0} ekstresi", cardName(ev.cardId))));
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
  li.append(el("span", "", L("Bugün · {0}", fmtDayShort(today))));
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
    sub.append(el("span", "", m ? V.MARKETS[m.market].name : L(V.asset(e.asset).name)));
    if (V.settled(e, HOME)) {
      // Aktarım (TL bakiyesine işlenen alış / satış): miktar ve TL tutarı, toplama girmez
      side.append(el("span", "amount", m ? `${fmtAsset(e.amount, e.asset, true)} ${m.ticker}` : fmtAsset(e.amount, e.asset, true)));
      // Türkçede ekli para birimi (TL'den / TL'ye), İngilizcede yön ayrı metinde
      const moved = fmt(Math.abs(V.settled(e, HOME)));
      side.append(el("small", "", D.lang === "tr" ? `aktarım · ${moved} ${e.amount > 0 ? homeEk("den") : homeEk("ye")}`
        : e.amount > 0 ? L("aktarım · {0}, {1} bakiyesinden", moved, homeShort()) : L("aktarım · {0}, {1} bakiyesine", moved, homeShort())));
    } else {
      side.append(el("span", "amount", fmtAsset(e.amount, e.asset, true)));
      if (e.asset !== HOME) side.append(el("small", "", it.value == null ? L("kur yok") : `≈ ${fmt(Math.abs(it.value))}`));
    }
    open = () => openEntrySheet(e);
  } else if (it.debt) {
    // Kredinin (borcun) faiz ve masrafı: çekildiği gün özvarlıktan bir kez düşer; alacakta faiz girdidir
    const d = it.debt;
    const person = personById(d.personId);
    title.textContent = d.kind === "loan" ? (d.party ? L("{0} kredisi", d.party) : L("Kredi")) : debtName(d);
    if (state.people.length > 1) {
      const who = el("span", "who");
      who.append(dot(seriesVar(person)), document.createTextNode(person.name));
      sub.append(who);
    }
    sub.append(el("span", "", B.side(d) === "debt" ? L("faiz ve masraf") : L("faiz")));
    side.append(el("span", "amount", (it.amount < 0 ? "−" : "+") + money(Math.abs(it.amount), d.asset)));
    if (d.asset !== HOME) side.append(el("small", "", it.value == null ? L("kur yok") : `≈ ${fmt(Math.abs(it.value))}`));
    open = () => openDebtSheet(d);
  } else {
    // Harcama alındığı gün: kartı (ya da nakit / döviz / altın), taksitliyse taksit sayısı
    const p = it.purchase;
    const code = T.assetOf(p, HOME);
    const person = personById(p.personId);
    title.textContent = p.desc;
    if (state.people.length > 1) {
      const who = el("span", "who");
      who.append(dot(seriesVar(person)), document.createTextNode(person.name));
      sub.append(who);
    }
    const card = cardById(p.cardId);
    const how = el("span", "who");
    how.append(cardMark(p.cardId), document.createTextNode(card ? card.name : code === HOME ? L("Nakit") : V.asset(code).name));
    sub.append(how);
    if (T.planLength(p) > 1) sub.append(el("span", "", L("{0} taksit", T.planLength(p))));
    side.append(el("span", "amount", "−" + money(it.amount, code)));
    if (code !== HOME) side.append(el("small", "", it.value == null ? L("kur yok") : `≈ ${fmt(Math.abs(it.value))}`));
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
  if (!B.tracked(card)) return { text: L("Bu kart hesaba katılmıyor: ekstre {0} bakiyeni etkilemez.", homeShort()) };
  if (ev.date < B.since(card, today)) return { text: L("Kart hesaba katılmadan önceki ekstre: {0} bakiyeni etkilemez.", homeShort()) };
  const x = manualCard(card, today)
    ? B.cardState(state, card, today, undefined, ev.date).statements.find(y => y.key === ev.date && !y.auto) : null;
  if (x) {
    const open = T.statementOf(card, today);
    return { x, text: statementText(x, today) || (x.key < open.due
      ? L("Ekstre kesildi · son ödeme {0}. Ödeyince “Ödendi”ye dokun.", fmtDayShort(x.key))
      : x.key === open.due ? L("Ekstre henüz kesilmedi · kesim {0} · son ödeme {1}.", fmtDayShort(open.cut), fmtDayShort(x.key))
      : L("Ekstre henüz kesilmedi · son ödeme {0}.", fmtDayShort(x.key))) };
  }
  // "Ben işaretlerim" ileride başlıyorsa (bugün ödeme varken geçildi, startDay) o günden sonraki ekstreler Ödendi bekler
  const since = B.since(card, today);
  const from = B.manual(card) ? (card.manualSince > since ? card.manualSince : since) : null;
  if (from && from > today && ev.date >= from) {
    return { text: from === T.addDays(today, 1)
      ? L("“Ben işaretlerim” yarın başlar · son ödeme {0}. Ödeyince “Ödendi”ye dokun.", fmtDayShort(ev.date))
      : L("“Ben işaretlerim” {0} günü başlar · son ödeme {1}. Ödeyince “Ödendi”ye dokun.", fmtDayShort(from), fmtDayShort(ev.date)) };
  }
  const paidOn = T.addDays(ev.date, 1);
  return { text: ev.date < today ? L("Ödenmiş sayıldı: {0} günü {1} bakiyenden düştü.", fmtDayShort(paidOn), homeShort())
    : ev.date === today ? L("Son gün bugün. Yarın ödenmiş sayılır ve {0} bakiyenden düşer.", homeShort())
    : L("Son ödeme {0}. {1} günü ödenmiş sayılır ve {2} bakiyenden düşer.", fmtDayShort(ev.date), fmtDayShort(paidOn), homeShort()) };
}

function openEventSheet(ev) {
  sheetEvent = ev;
  const today = T.todayKey();
  els.eventTitle.replaceChildren(cardMark(ev.cardId), document.createTextNode(ev.cardId ? L("{0} ekstresi", cardName(ev.cardId)) : L("Nakit ödemeler")));
  els.eventDate.textContent = `${WEEKDAYS[T.toDate(ev.date).getDay()]}, ${fmtDay(ev.date)} · ${relDays(ev.date, today)}`;
  const card = cardById(ev.cardId);
  const { text, x } = eventStatus(card, ev, today);
  els.eventState.hidden = !text;
  els.eventState.textContent = text;
  els.eventState.className = "p-status" + (x?.state === "late" ? " late" : x?.state === "paid" ? " paid" : "");
  const pay = !!x && x.amount - x.covered > EPS && x.key < T.statementOf(card, today).due;
  els.eventPay.hidden = !pay;
  els.eventPay.setAttribute("aria-label", L("{0} ekstresini ödendi olarak işaretle", card?.name ?? ""));
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
  const pct = v => D.pct(Math.round((v / total) * 100));

  const legend = el("ul", "ev-legend");
  const segs = new Map(), rows = new Map();
  let pinned = null;
  const show = id => {
    const x = parts.find(p => p.person.id === id);
    box.parentElement?.toggleAttribute("data-active", !!x);
    for (const [k, n] of segs) n.classList.toggle("on", k === id);
    for (const [k, n] of rows) n.classList.toggle("on", k === id);
    big.textContent = fmt(x ? x.value : total);
    small.textContent = x ? `${x.person.name} · ${pct(x.value)}` : parts.length > 1 ? L("{0} kişi", parts.length) : L("toplam");
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
  return items.map(({ purchase, no, amount, bonus }) => {
    const p = personById(purchase.personId);
    const plan = T.planLength(purchase);
    const li = el("li");
    li.style.setProperty("--c", seriesVar(p));
    const main = el("div", "ev-item-main");
    main.append(el("span", "desc", purchase.desc),
      el("span", "meta", `${p.name} · ${bonus ? bonusPayName({ bonus }) : plan > 1 ? L("{0}/{1}. taksit", no, plan) : L("peşin")}`));
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
    info.append(el("div", "name", p.name), el("div", "sub", s ? shareSub(s, today) : remaining ? L("kalan {0}", fmt(remaining)) : L("kalan yok")));
    li.append(avatar(p), info, el("div", "amount", fmt(due)));
    if (i > 0 && due > 0) {
      const b = el("button", "icon-btn sm share-btn");
      b.type = "button";
      b.setAttribute("aria-label", L("{0} için {1} ödeme özetini gönder", p.name, T.monthName(start)));
      b.title = L("Ödeme özetini gönder");
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
  if (s.remaining < -EPS) return L("sana {0} fazla ödedi", fmt(-s.remaining));
  if (s.remaining <= EPS) return L("sana borcu yok");
  const late = shareLate(s, today);
  const tail = late > EPS ? " · " + L("{0} gecikti", fmt(late)) : s.dueNow > EPS ? " · " + L("günü bugün {0}", fmt(s.dueNow)) : "";
  return L("sana borcu {0}", fmt(s.remaining)) + tail;
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
      lines.push(`• ${it.purchase.desc}${plan > 1 ? ` (${L("{0}/{1}. taksit", it.no, plan)})` : ""}: ${fmt(it.amount)} — ${cardName(ev.cardId)}, ${fmtDayShort(ev.date)}`);
    }
  }
  const rest = months.slice(1).reduce((s, m) => s + (m.byPerson[person.id] || 0), 0);
  // Hesaba katılan kartlardaki harcamalarından bana ödediği ve kalan
  const share = B.shares(state, T.todayKey()).get(person.id);
  const left = fmt(Math.max(share?.remaining ?? 0, 0));
  return [L("Merhaba {0}, {1} ödemelerin:", person.name, monthLong(idx)), ...lines, L("Bu ay toplam: {0}", fmt(months[0].byPerson[person.id] || 0)),
    rest ? L("Sonraki aylarda: {0}", fmt(rest)) : null,
    share ? (share.settled > EPS ? L("Kartımdaki harcamalarından bana ödediğin: {0} · Kalan borcun: {1}", fmt(share.settled), left)
      : L("Kartımdaki harcamalarından kalan borcun: {0}", left)) : null].filter(Boolean).join("\n");
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
  if (ev.ignored) sub.append(el("span", "", L("hesaba katılmıyor")));
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
      list.push({ name: L("Nakit"), color: CASH_COLOR, value: m => m.byCard[T.CASH] || 0 });
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
      ? L("Bu aydan sonra ödenecek taksit yok.")
      : L("Harcama ekleyince aylık ödemelerin burada görünür.");
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
  if (series.length > 1) tt.append(el("span", "tt-total", L("Toplam {0}", fmt(m.total))));
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
function cashPeriod(today, start, shift) { return N.cashPeriod(today, start, shift); }

function cashSeries(from, to, today) {
  const out = N.cashSeries(state, from, to, today, { rates: curRates(), isCash: isCashCode });
  if (out.missing.length || knownEntries().some(e => e.asset !== HOME)) loadRates();   // fon bilgisi de (para piyasası fonu mu)
  return out;
}

// Ayın günü iyelik ekiyle: 1'i, 6'sı, 15'i, 20'si, 30'u (İngilizcede sıra sayısı: 1st, 2nd, 3rd, 15th; diğer dillerde sayı)
function dayWithSuffix(n) {
  if (D.lang === "en") return n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  if (D.lang !== "tr") return String(n);   // diğer dillerde ek cümlede: "Am {0}. des Monats", "毎月{0}日"
  const last = n % 10;
  const suffix = last ? ["i", "si", "ü", "ü", "i", "sı", "si", "i", "u"][last - 1] : n === 20 ? "si" : "u";
  return `${n}'${suffix}`;
}

// Başlangıç seçenekleri: bugün, süren tekrarlayan TL girişlerinin günleri (en büyük 3), ayın her günü
function renderCashStart(today) {
  const incomes = knownEntries()
    .filter(e => e.asset === HOME && e.amount > 0 && V.repeatOf(e) != null && R.unit(e) === "month" && V.nextDate(e, today))
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
  const days = Array.from({ length: 31 }, (_, i) => [String(i + 1), L("Ayın {0}", dayWithSuffix(i + 1))]);
  els.cashStart.replaceChildren(option(["today", L("Bugün")]), ...(opts.length ? [group(L("Gelir günü"), opts)] : []), group(L("Ayın günü"), days));
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
    ? [stat(L("Girdi"), "+" + fmt(data.inSum), "in-text"),
       stat(L("Çıktı"), "−" + fmt(data.outSum), "out-text"),
       stat(L("Net"), signed(lastDay.net, true), tone(lastDay.net))]
    : [todayAt >= 0 ? stat(L("Bugün"), signed(days[todayAt].balance), tone(days[todayAt].balance))
                    : stat(L("Dönem başı"), signed(data.before), tone(data.before)),
       stat(L("{0} sonunda", fmtDayShort(to)), signed(lastDay.balance), tone(lastDay.balance)),
       stat(L("En düşük · {0}", fmtDayShort(low.date)), signed(low.balance), tone(low.balance))]));
  els.cashSum.hidden = !data.any;

  const svg = els.cashChart;
  hideTooltip();
  els.cashEmpty.hidden = data.any;
  els.cashNote.hidden = !data.any;
  const change = el("button", "link", L("Değiştir"));
  change.type = "button";
  change.addEventListener("click", openCashDefSheet);
  els.cashNote.replaceChildren(L("Nakit: {0}.", cashDefText()) + " ", change, " · " + L("Grafikte nakdin girdileri ve çıktıları (tekrarlayanlar dahil), kart ekstreleri, nakit taksitler, borç ve alacak ödemeleri var. Ekstreler son ödeme gününde görünür; ödemediğin geçmiş ekstreler bugünde gösterilir. Hesaba katılmayan kartlar grafikte yok.")
    + (cashDef.some(c => c !== HOME) ? " " + L("Döviz, altın ve fonlar bugünkü kur ve fiyatla {0} çevrilir.", homeEk("ye")) : "")
    + (data.missing.length ? " " + L("Kuru ya da fiyatı alınamayan {0} dahil değil.", data.missing.map(c => lowerName(V.asset(c).name)).join(", ")) : ""));
  svg.style.display = data.any ? "" : "none";
  svg.setAttribute("aria-label", net ? L("{0} – {1} dönem net nakit hareketi", fmtDayShort(from), fmtDayShort(to)) : L("{0} – {1} nakit bakiyesi", fmtDayShort(from), fmtDayShort(to)));
  if (!data.any) {
    els.cashEmpty.textContent = L("Varlıklar'a giriş ve çıkış ekleyince nakdinin dönem dönem seyri burada görünür.");
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
    const label = days[d].date === today ? L("Bugün") : fmtDayShort(days[d].date);
    xLblSvg += `<text x="${(d ? x : toX(0)).toFixed(1)}" y="${H - 6}" text-anchor="${d ? "middle" : "start"}" font-size="11" fill="var(--text-3)">${label}</text>`;
  }
  // Dönemin içindeki bugün: dikey çizgi ve üstte etiket (ilk gün değilse)
  let nowSvg = "";
  if (todayAt > 0) {
    const x = toX(todayAt + 0.5).toFixed(1);
    nowSvg = `<line x1="${x}" y1="${PT - 4}" x2="${x}" y2="${PT + plotH}" stroke="var(--text-3)" stroke-width="1"/>
      <text x="${x}" y="${PT - 9}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text-2)">${L("Bugün")}</text>`;
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
  if (day.moves.length > shown.length) tt.append(el("span", "tt-name", L("+{0} hareket daha", day.moves.length - shown.length)));
  if (!day.moves.length) tt.append(el("span", "tt-name", L("Hareket yok")));
  const v = net ? day.net : day.balance;
  tt.append(el("span", "tt-total", `${net ? L("Dönem net") : L("Gün sonu")} ${v < 0 ? "−" : net && v > 0 ? "+" : ""}${fmt(Math.abs(v))}`));
  tt.hidden = false;
  const w = tt.offsetWidth, h = tt.offsetHeight;
  const left = x + 14 + w > window.innerWidth - 8 ? x - 14 - w : x + 14;
  tt.style.left = Math.max(8, left) + "px";
  tt.style.top = Math.max(8, y - h - 12) + "px";
}

// ---------- Akış ----------
function renderFlow(months) {
  els.flowMode.hidden = locked();
  if (locked()) {
    els.flowTable.hidden = true;
    els.flowList.replaceChildren(premiumLock(L("Akış"), L("Önümüzdeki ayların ödeme planı: her ödeme günü, içindeki taksitler, kişilerin payı ve 12 aylık grafik."), "cash_flow"));
    return;
  }
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
      state.installments.length ? L("Bu aydan sonra ödeme yok") : L("Henüz ödeme yok"),
      state.installments.length ? L("Önceki aylara bakmak için ay seçiciyi kullan.") : L("Harcama ekleyince ödeme tarihleri kartına göre burada sıralanır.")));
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
      if (!debts.length) panel.append(el("p", "month-empty", L("Bu ay ödeme yok")));
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
      head.append(el("span", "", L("Borç ödemeleri")), el("span", "amount", fmt(dueSum(debts, r))));
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
  for (const { purchase, no, amount, bonus } of items) {
    const p = personById(purchase.personId);
    const li = el("li");
    const who = el("span", "who");
    who.append(dot(seriesVar(p)), document.createTextNode(p.name));
    const plan = T.planLength(purchase);
    li.append(who, el("span", "", purchase.desc),
      el("span", "no", bonus ? bonusPayName({ bonus }) : plan > 1 ? `${no}/${plan}` : L("peşin")), el("span", "amount", fmt(amount)));
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
  li.title = L("Harcamayı düzenle");
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
  head.append(el("th", "", L("Ay")));
  for (const p of people) {
    const th = el("th", "num");
    th.append(dot(seriesVar(p)), document.createTextNode(p.name));
    head.append(th);
  }
  head.append(el("th", "num", L("Toplam")));

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
  foot.append(el("td", "", L("Toplam")));
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
  container.append(chip("all", L("Tümü")));
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
  const value = x => V.toTry(T.originalTotal(x.p), T.assetOf(x.p, HOME), curRates(), HOME) ?? -Infinity;
  const order = {
    new: (a, b) => byDate(a, b) || byName(a, b),
    amount: (a, b) => value(b) - value(a) || byName(a, b),
    name: (a, b) => byName(a, b) || byDate(a, b),
  }[purchaseSort];
  if (purchaseSort === "amount" && mine.some(x => T.assetOf(x.p, HOME) !== HOME)) loadRates();
  const active = mine.filter(x => x.left).sort(order ?? ((a, b) => a.next.localeCompare(b.next) || byName(a, b)));
  const done = mine.filter(x => !x.left).sort(order ?? ((a, b) => b.pays[b.pays.length - 1].key.localeCompare(a.pays[a.pays.length - 1].key)));

  // E-postadan gelenler sıralamanın üstünde: Sırala yalnızca altındaki listeyi dizer
  const mail = inbox.length && FEAT.bankEmails;   // banka e-postaları yalnızca Türkiye'de
  els.inboxWrap.replaceChildren(...(mail ? [inboxPanel()] : []));
  els.inboxWrap.hidden = !mail;
  els.purchaseSort.value = purchaseSort;
  els.purchaseTools.hidden = mine.length < 2;
  els.purchaseWrap.replaceChildren();
  if (!mine.length) {
    const btn = el("button", "btn btn-primary");
    btn.type = "button";
    btn.append(icon("plus"), document.createTextNode(L("Harcama ekle")));
    btn.addEventListener("click", () => openPurchaseSheet());
    els.purchaseWrap.append(emptyState("receipt", L("Henüz harcama yok"),
      L("Peşin ya da taksitli harcamalarını ekle; ödeme tarihlerini kartının kesim ve son ödeme gününe göre hesaplarım."), btn));
    return;
  }

  const groups = el("div", "purchase-groups");
  if (active.length) groups.append(purchaseList(active, today));
  else groups.append(el("p", "empty", L("Devam eden harcama yok")));

  if (done.length) {
    const toggle = el("button", "section-toggle" + (showDone ? " open" : ""));
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(showDone));
    toggle.append(document.createTextNode(L("Biten harcamalar ({0})", done.length)), icon("down"));
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
  const code = T.assetOf(p, HOME);
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
  if (code !== HOME) meta.append(el("span", "", L(V.asset(code).name)));
  if (T.bnpl(p)) meta.append(el("span", "", `${T.bnplName(p)} · Pay in ${plan}`));   // şimdi al sonra öde: 2 haftada bir
  else if (T.bonus(p) && cardById(p.cardId)) meta.append(el("span", "", T.bonusName(p, cardById(p.cardId))));   // bonus ödemesi (Japonya)
  else if (plan > 1 || !rule) meta.append(el("span", "", plan > 1 ? L("{0} taksit", plan) : L("Peşin")));
  if (rule) meta.append(el("span", "", R.label(p) + (rule.n ? " · " + L("{0} kez", rule.n) : "")));
  if (K.valid(p.category)) meta.append(el("span", "cat-tag" + (p.categoryBy === "user" ? "" : " ai"), K.category(p.category).name));
  main.append(meta);
  if (rule?.n) {
    const done = R.countUntil(p, today);
    const prog = el("div", "progress");
    const bar = el("div", "bar");
    const fill = el("span");
    fill.style.width = `${(done / rule.n) * 100}%`;
    bar.append(fill);
    prog.append(bar, el("span", "", L("{0}/{1} tekrar", done, rule.n)));
    main.append(prog);
  } else if (plan > 1 && !rule) {
    const prog = el("div", "progress");
    const bar = el("div", "bar");
    const fill = el("span");
    fill.style.width = `${(paid / plan) * 100}%`;
    bar.append(fill);
    prog.append(bar, el("span", "", L("{0}/{1} ödendi", paid, plan)));
    main.append(prog);
  }

  const side = el("div", "p-side");
  if (rule) {
    const amount = el("span", "amount", money(T.originalTotal(p), code));
    amount.append(el("small", "", R.per(p)));
    side.append(amount, el("span", "sub", next ? L("sonraki {0}", fmtDayShort(next)) : L("bitti")));
  } else if (T.bnpl(p)) {
    const rest = T.payments(p, cardById(p.cardId)).filter(x => x.key >= today).reduce((t, x) => t + x.amount, 0);
    side.append(el("span", "amount", fmt(p.total)), el("span", "sub", rest > EPS ? L("kalan {0}", fmt(rest)) : L("bitti")));
  } else if (T.bonus(p) && cardById(p.cardId)) {
    side.append(el("span", "amount", fmt(p.total)), el("span", "sub", next ? L("bonus {0}", fmtDayShort(next)) : L("ödendi")));
  } else if (plan > 1) {
    const amount = el("span", "amount", fmt(per));
    amount.append(el("small", "", L("/ay")));
    side.append(amount, el("span", "sub", left ? L("kalan {0}", fmt(left * per)) : L("bitti")));
  } else if (code !== HOME) {
    side.append(el("span", "amount", money(p.total, code)), el("span", "sub", next ? relDays(next, today).toLocaleLowerCase(D.locale()) : L("ödendi")));
  } else {
    side.append(el("span", "amount", fmt(p.total)), el("span", "sub", next ? L("{0} ödenecek", relDays(next, today).toLocaleLowerCase(D.locale())) : L("ödendi")));
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
  left.append(el("div", "cc-name", c.name || L("Kart adı")));
  const days = el("div", "cc-days");
  days.append(el("div", "", L("Kesim {0}", c.cutoffDay || "—")), el("div", "", L("Son ödeme {0}", c.dueDay || "—")));
  top.append(left, days);

  const mid = el("div", "cc-mid");
  const over = c.limit > 0 && stats.used > c.limit;
  if (c.limit > 0) {
    mid.append(el("div", "lbl", over ? L("Limit aşımı") : L("Kullanılabilir limit")),
      el("div", "val", fmt(Math.abs(c.limit - stats.used))));
  } else {
    mid.append(el("div", "lbl", L("Kart borcu")), el("div", "val", fmt(stats.used)));
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
    el("span", "", c.limit > 0 ? L("{0} / {1} kullanıldı", fmtShort(stats.used), fmtShort(c.limit)) : L("Limit girilmedi")),
    el("span", "", stats.late ? L("{0} gecikti", fmt(stats.overdue))   // yalnızca gecikmiş kısım; bugün ödenecek satırlarda ayrı
      : stats.next ? L("Son ödeme {0} · {1}", fmtDayShort(stats.next), fmt(stats.nextTotal)) : L("Ödenecek ekstre yok")));
  bottom.append(foot);

  const chipRow = el("div", "cc-chiprow");
  chipRow.append(el("div", "cc-chip"));
  if (c.last4) chipRow.append(el("span", "cc-num", `•••• ${c.last4}`));
  if (over) chipRow.append(el("span", "cc-alert", L("Limit aşıldı")));
  else if (c.id && !B.tracked(c)) chipRow.append(el("span", "cc-alert cc-off", L("Hesaba katılmıyor")));
  tile.append(top, chipRow, mid, bottom);
  return tile;
}

function renderCards() {
  els.cardGrid.replaceChildren();
  for (const c of state.cards) {
    const tile = cardTile(c, cardStats(c));
    tile.setAttribute("aria-label", L("{0} kartını düzenle", c.name));
    tile.addEventListener("click", () => openCardSheet(c));
    els.cardGrid.append(tile);
  }
  const add = el("button", "cc-add");
  add.type = "button";
  add.append(icon("plus"), document.createTextNode(state.cards.length ? L("Yeni kart") : L("İlk kartını ekle")));
  add.addEventListener("click", () => openCardSheet());
  els.cardGrid.append(add);
  const full = locked() && state.cards.length >= FREE_CARDS;
  els.addCard.hidden = full;
  if (full) {
    add.hidden = true;
    els.cardGrid.append(premiumLock(L("Yeni kart"), L("Ücretsiz sürüm: {0} kart, yalnızca sen. Premium'da yapay zekâ asistanı (Claude, ChatGPT), sınırsız kart ve kişi, Akış, Alabilir miyim?, içgörüler ve Varlığın seyri.", FREE_CARDS), "cards"));
  }
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
  if (!rates && !list.length) return undefined;
  // Kurlar ve fon / hisse fiyatları TL'dir; hesabın ana para birimine çevrilir (para.js)
  const lira = { TRY: 1, ...(rates && rates.rates) };
  for (const [code, x] of list) lira[code] = x.price;
  return P.homeRates(lira, HOME) ?? undefined;
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
const CASH_NAMES = { TRY: "TL", USD: L("dolar"), EUR: L("euro"), GAU: L("gram altın"), [V.MMF]: L("para piyasası fonları") };
const cashName = code => CASH_NAMES[code] ?? P.currency(code)?.short ?? code;
function cashDefText() {
  const names = cashDef.map(c => V.market(c)?.ticker ?? cashName(c));
  if (!names.length) return L("hiçbiri");
  return names.length === 1 ? names[0] : L("{0} ve {1}", names.slice(0, -1).join(", "), names[names.length - 1]);
}

const unitFmt = new Intl.NumberFormat(D.locale(), { maximumFractionDigits: 4 });
// Birim fiyat ya da kur: fonda TEFAS gibi 6 hane, hissede 2, döviz ve altında 4
function fmtPrice(p, code) {
  const m = V.market(code)?.market;
  const digits = m === "FON" ? 6 : m === "BIST" ? 2 : 4;
  return new Intl.NumberFormat(D.locale(), { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: digits }).format(p);
}
// "%2,3" (İngilizcede "2.3%")
function fmtPct(r) {
  return D.pct(new Intl.NumberFormat(D.locale(), { maximumFractionDigits: 1 }).format(Math.abs(r * 100)));
}

// Varlığın kendi biriminde: "₺1.250,00", "$100,00", "12,5 gr", fon ve hissede "1.000 adet"
function fmtAsset(amount, code, signed = false) {
  const a = V.asset(code);
  const sign = amount < 0 ? "−" : signed && amount > 0 ? "+" : "";
  if (a.market) return sign + L("{0} adet", unitFmt.format(Math.abs(amount)));
  const n = new Intl.NumberFormat(D.locale(), { minimumFractionDigits: code === "GAU" ? 0 : 2, maximumFractionDigits: a.digits })
    .format(Math.abs(amount));
  return code === "GAU" ? sign + L("{0} gr", n) : `${sign}${a.symbol}${n}`;
}

// Hareketin başlığı: açıklaması; boşsa fon / hissede "THYAO alışı", TL'yle alınan / bozdurulan dövizde "Dolar alışı"
function entryTitle(e) { return N.entryTitle(e); }

// "bugün 13:36" ya da "18 Eki 13:36"
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const time = d.toLocaleTimeString(D.locale(), { hour: "2-digit", minute: "2-digit" });
  const key = T.dateKey(d.getFullYear() * 12 + d.getMonth(), d.getDate());
  return key === T.todayKey() ? L("bugün {0}", time) : `${fmtDayShort(key)} ${time}`;
}

function knownEntries() { return N.knownEntries(state); }

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

  els.assetLabel.textContent = entryFilter === "all" ? L("Varlık") : L("{0} · varlık", personById(entryFilter).name);
  setMoney(els.assetTotal, t.assets);
  // Eşitlik satırı yalnızca borç ya da alacak varsa (dokununca Borçlar)
  els.assetEqLine.hidden = !(t.debt.total > EPS || t.receivable.total > EPS);
  const A = Math.round(t.assets), Bo = Math.round(t.debt.total);   // Borçlar'daki gibi: Özvarlık farkıdır
  els.assetEq.textContent = L("= Özvarlık {0} + Borç {1} ›", fmtWhole(A - Bo), fmtWhole(Bo));
  els.assetIncl.textContent = t.receivable.total > EPS ? L("{0} alacak dahil", fmtWhole(t.receivable.total)) : "";
  const stale = !rates || ratesFailed || t.missing.length;
  const noPrice = t.missing.some(c => V.market(c));   // fiyatı alınamayan fon / hisse toplamda yok
  els.ratesNote.classList.toggle("warn-text", !!stale);
  els.ratesNote.textContent = !rates ? (ratesLoading ? L("Kurlar alınıyor…") : L("Kur alınamadı · yalnızca {0}", homeShort()))
    : L("Kur {0}", fmtTime(rates.updatedAt)) + (ratesFailed ? " · " + L("güncellenemedi") : "")
      + (noPrice ? " · " + (pricesLoading ? L("fiyatlar alınıyor…") : L("fiyatı alınamayan var")) : "");
  els.rateStats.replaceChildren(...V.assetsFor(HOME).filter(a => a.code !== HOME).map(a => {
    const d = el("div");
    // 1'in altındaki kurlar (ör. euro hesabında TL) daha çok haneyle
    const v = r?.[a.code];
    const text = !v ? "—" : v >= 1 ? fmt(v) : new Intl.NumberFormat(D.locale(), { style: "currency", currency: HOME, maximumSignificantDigits: 4 }).format(v);
    d.append(el("dt", "", L(a.name)), el("dd", "", text));
    return d;
  }));

  renderPersonFilter(els.entryFilter, entryFilter, id => all.filter(ofPerson(id)).length + spends.filter(ofPerson(id)).length,
    id => { entryFilter = id; });
  els.entryFilter.hidden = state.people.length < 2;
  renderAssetChart(entryFilter);

  els.assetGrid.replaceChildren(...V.assetsFor(HOME).map(a => {
    const bal = bals[a.code] ?? 0;
    const tile = el("button", "asset" + (a.code in bals ? "" : " empty-asset"));
    tile.type = "button";
    tile.setAttribute("aria-label", L("{0} girişi ekle", L(a.name)));
    const name = el("div", "asset-name");
    name.append(el("span", "asset-sym", L(a.symbol)), document.createTextNode(L(a.name)));
    const value = V.toTry(bal, a.code, r, HOME);
    tile.append(name, el("div", "asset-bal" + (bal < 0 ? " neg" : ""), fmtAsset(bal, a.code)),
      el("div", "asset-try", a.code === HOME ? "\u00a0" : value == null ? L("kur yok") : `≈ ${fmt(value)}`));
    tile.addEventListener("click", () => openEntrySheet(null, a.code));
    return tile;
  }));
  // Alacak: kart payları, kişilerden alacaklar ve fazla ödenmiş kartlar; dokununca Borçlar → Alacaklarım
  if (t.receivable.total > EPS) {
    const tile = el("button", "asset receivable");
    tile.type = "button";
    tile.setAttribute("aria-label", L("Alacak {0}, Alacaklarım'da gör", fmt(t.receivable.total)));
    const name = el("div", "asset-name");
    const sym = el("span", "asset-sym");
    sym.append(icon("swap"));
    name.append(sym, document.createTextNode(L("Alacak")));
    tile.append(name, el("div", "asset-bal", fmt(t.receivable.total)),
      el("div", "asset-try", [t.receivable.cards > EPS && L("kartını kullananlar"), t.receivable.people > EPS && L("borç verdiğin kişiler"),
        t.receivable.cardCredit > EPS && L("karta fazla ödediğin")].filter(Boolean).join(" · ")));
    tile.addEventListener("click", () => { debtSide = "receivable"; debtClosedOpen = false; location.hash = "#borclar"; });
    els.assetGrid.append(tile);
  }

  renderHoldings(mine, bals, r);

  els.entryWrap.replaceChildren();
  if (!mine.length && !mineSpends.length) {
    const btn = el("button", "btn btn-primary");
    btn.type = "button";
    btn.append(icon("plus"), document.createTextNode(L("Hareket ekle")));
    btn.addEventListener("click", () => openEntrySheet());
    els.entryWrap.append(emptyState("coins", L("Henüz hareket yok"),
      FEAT.markets
        ? L("{0}, döviz ya da gram altın girişlerini ve çıkışlarını, fon ve hisse alışlarını ekle; bakiyeni güncel kur ve fiyatla {0} olarak gösteririm.", homeShort())
        : L("{0}, döviz ya da gram altın girişlerini ve çıkışlarını ekle; bakiyeni güncel kur ve fiyatla {0} olarak gösteririm.", homeShort()), btn));
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
  head.append(el("h2", "", L("Hareketler")));
  els.entryWrap.append(head, panel);
}

// ---------- Varlığın seyri ----------
// Varlıklar'daki Varlık (eldeki + alacak, B.totals) gün gün: her gün o güne kadarki kayıtlarla ve o günün kur ve
// fiyatlarıyla (/api/gecmis: dolar, euro, gram altın ve hisseler İş Yatırım'ın, fonlar TEFAS'ın günlük kapanışları;
// kapanışı olmayan gün öncekiyle). Bugün güncel kur ve fiyatla, üstteki toplamla aynıdır. Geçmişi alınamayan varlık
// bugünkü fiyatla sayılır (notta yazar). Uzun dönemde birkaç günde bir nokta (en fazla ~180). Özet'teki Nakit
// grafiğinden ayrıdır: o yalnızca nakdi gösterir.
const ASSET_RANGES = N.ASSET_RANGES;
const HISTORY_TTL = 60 * 60_000;   // geçmiş fiyatlar bu kadar süre taze sayılır (/api/gecmis de bu kadar saklar)
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
function historyCodes() { return N.historyCodes(state); }

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
function priceAt(list, day) { return N.priceAt(list, day); }

// Verinin day günü sonundaki hali: o güne kadarki hareketler, harcamalar ve borç kayıtları (tarihsiz harcama ilk ödeme
// ayından)
function stateAt(day) { return N.stateAt(state, day); }

function firstRecordDate() { return N.firstRecordDate(state); }

// → { span, codes, points: [{ date, value, parts: { lira, fx, market, receivable } }], approx, missing } ya da kayıt yoksa null
function assetSeries(range, pid) {
  const today = T.todayKey();
  const span = N.assetSpan(state, range, today);
  if (span == null) return null;
  const codes = historyCodes();
  const hist = historyFor(span, codes);
  const cur = curRates() ?? { [HOME]: 1 };
  const key = [range, pid, today, state.entries, state.entries.length, state.installments, state.installments.length, state.debts,
    state.debts.length, state.cards, state.people, rates, prices, hist.stamp];
  if (assetMemo && key.every((x, i) => x === assetMemo.key[i])) return assetMemo.value;
  const value = { span, codes, ...N.assetPoints(state, { today, span, codes, cur, series: hist.series, pid }) };
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
  const lock = locked();
  for (const n of [els.assetRange, els.assetSum, els.assetChart, els.assetNote]) n.hidden = lock;
  els.assetLock.hidden = !lock;
  if (lock) {
    els.assetLock.replaceChildren(premiumLock(null, L("Varlığın, borcun ve özvarlığın aylar içinde nasıl değiştiği."), "net_worth"));
    return;
  }
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
    stat(L("Bugün"), (end.value < 0 ? "−" : "") + fmt(Math.abs(end.value))),
    stat(L("Değişim"), sign(diff) + fmt(Math.abs(diff)) + (start.value > EPS ? ` · ${fmtPct(diff / start.value)}` : ""),
      diff > EPS ? "in-text" : diff < -EPS ? "out-text" : ""),
  );
  const names = list => list.map(c => (V.asset(c) ? lowerName(V.asset(c).name) : c)).join(", ");
  els.assetNote.textContent = (FEAT.markets
    ? L("Her gün o güne kadarki kayıtlarla ve o günün kur ve fiyatlarıyla: dolar, euro, gram altın ve hisseler günlük kapanışla (İş Yatırım), fonlar TEFAS fiyatıyla; bugün güncel kur ve fiyatla.")
    : L("Her gün o güne kadarki kayıtlarla ve o günün kurlarıyla (günlük kapanış); bugün güncel kurla."))
    + " " + L("Alacaklar dahil. Nakdin seyri Özet'teki Nakit grafiğinde.")
    + (historyLoading && data.codes.length ? " " + L("Geçmiş fiyatlar alınıyor…") : "")
    + (!historyLoading && data.approx.length ? " " + L("Geçmiş fiyatı alınamayan {0} bugünkü fiyatla sayıldı.", names(data.approx)) : "")
    + (data.missing.length ? " " + L("Kuru ya da fiyatı alınamayan {0} dahil değil.", names(data.missing)) : "");

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
    const label = points[i].date === today ? L("Bugün") : long ? `${T.monthShort(d.idx)} ${String(T.yearOf(d.idx)).slice(2)}` : fmtDayShort(points[i].date);
    const anchor = k === 0 ? "start" : k === count - 1 ? "end" : "middle";
    xLblSvg += `<text x="${toX(i).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" font-size="11" fill="var(--text-3)">${label}</text>`;
  }
  const line = points.map((p, i) => `${i ? "L" : "M"}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ");
  const endY = toY(end.value);
  const endDot = `<circle cx="${toX(n - 1).toFixed(1)}" cy="${endY.toFixed(1)}" r="4" fill="var(--text)" stroke="var(--surface)" stroke-width="2"/>`;
  const endLbl = `<text x="${(W - PR).toFixed(1)}" y="${(endY < PT + 14 ? endY + 18 : endY - 9).toFixed(1)}" text-anchor="end" font-size="11" font-weight="600" fill="var(--text)">${fmtShort(end.value)}</text>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-label", L("Varlığın seyri: {0} {1}, bugün {2}", dayLabel(start.date), fmt(start.value), fmt(end.value)));
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
  for (const [key, name] of [["lira", homeShort()], ["fx", L("Döviz ve altın")], ["market", L("Fon ve hisse")], ["receivable", L("Alacak")]]) {
    const v = p.parts[key];
    if (Math.abs(v) < EPS) continue;
    const line = el("span", "tt-row");
    line.append(el("strong", "", (v < 0 ? "−" : "") + fmt(Math.abs(v))), el("span", "tt-name", name));
    tt.append(line);
  }
  tt.append(el("span", "tt-total", `${L("Varlık")} ${p.value < 0 ? "−" : ""}${fmt(Math.abs(p.value))}`));
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
  const pos = V.positions(mine, HOME);
  const value = c => V.toTry(bals[c], c, r, HOME);
  const codes = Object.keys(bals).filter(c => V.market(c) && Math.abs(bals[c]) > 1e-9)
    .sort((a, b) => (value(b) ?? -1) - (value(a) ?? -1) || (a < b ? -1 : 1));
  // Türkiye dışında fon ve hisse eklenmez (FEAT.markets); önceden eklenmiş olanlar görünür, Ekle yok
  const markets = FEAT.markets;
  if (!markets && !codes.length) { els.holdWrap.replaceChildren(); return; }
  const head = el("header", "panel-head hold-head");
  head.append(el("h2", "", L("Fon ve hisse")));
  if (codes.length) head.append(el("span", "panel-note", fmt(codes.reduce((sum, c) => sum + (value(c) ?? 0), 0))));
  const add = el("button", "btn btn-ghost btn-sm");
  add.type = "button";
  add.append(icon("plus"), document.createTextNode(L("Ekle")));
  add.addEventListener("click", () => openEntrySheet(null, lastMarket()));
  if (markets) head.append(add);
  const panel = el("div", "panel list-panel");
  if (codes.length) panel.append(...codes.map(c => holdingRow(c, bals[c], pos[c], r)));
  else panel.append(el("p", "hold-empty", traded ? L("Elinde fon ya da hisse kalmadı.")
    : L("TEFAS fonlarını ve Borsa İstanbul hisselerini adetiyle ekle; güncel fiyatla {0} karşılığını ve kârını gösteririm.", homeShort())));
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
  if (isCashCode(code)) meta.append(el("span", "", L("nakit")));
  main.append(meta);

  const side = el("div", "p-side");
  const v = V.toTry(units, code, r, HOME);
  side.append(el("span", "amount" + (units < 0 ? " out" : ""), v == null ? L("fiyat yok") : fmt(v)));
  // Kâr / zarar: güncel değer − elde kalanın ortalama maliyeti
  if (v != null && pos?.cost > 0) {
    const gain = v - pos.cost;
    side.append(el("span", "sub " + (gain > EPS ? "gain" : gain < -EPS ? "loss" : ""),
      `${gain > EPS ? "+" : gain < -EPS ? "−" : ""}${fmt(Math.abs(gain))} (${fmtPct(gain / pos.cost)})`));
  }
  if (m.market === "BIST" && x?.prev > 0) {
    const ch = x.price / x.prev - 1;
    side.append(el("span", "sub", L("bugün {0}", (ch > 0.00005 ? "+" : ch < -0.00005 ? "−" : "") + fmtPct(ch))));
  }
  // Fon fiyatı günde bir açıklanır: bugünün değilse günü
  if (m.market === "FON" && x?.date && x.date !== T.todayKey()) side.append(el("span", "sub", L("{0} fiyatı", fmtDayShort(x.date))));
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
  meta.append(el("span", "card-tag", L(a.name)), el("span", "", fmtDay(e.date)));
  if (n != null) meta.append(el("span", "", R.label(e) + (n ? " · " + L("{0} kez", n) : "")));
  main.append(meta);
  if (n) {
    const done = V.processedCount(e, today);
    const prog = el("div", "progress");
    const bar = el("div", "bar");
    const fill = el("span");
    fill.style.width = `${(done / n) * 100}%`;
    bar.append(fill);
    prog.append(bar, el("span", "", L("{0}/{1} işlendi", done, n)));
    main.append(prog);
  }

  const side = el("div", "p-side");
  const amount = el("span", "amount " + (e.amount > 0 ? "in" : "out"), fmtAsset(e.amount, e.asset, true));
  if (n != null) amount.append(el("small", "", R.per(e)));
  side.append(amount);
  const value = V.toTry(e.amount, e.asset, r, HOME), trade = V.tradeValue(e, HOME);
  // Fon / hisse: alış ya da satış tutarı (fiyatı girildiyse) ve TL bakiyesine işlendiyse
  if (trade != null) {
    side.append(el("span", "sub", fmt(Math.abs(trade))));
    if (e.settle === true) side.append(el("span", "sub", e.amount > 0 ? L("{0} bakiyesinden ödendi", homeShort()) : L("{0} bakiyesine eklendi", homeShort())));
  } else if (e.asset !== HOME) side.append(el("span", "sub", value == null ? (a.market ? L("fiyat yok") : L("kur yok")) : `≈ ${fmt(Math.abs(value))}`));
  if (n != null) side.append(el("span", "sub", next ? L("sonraki {0}", fmtDayShort(next)) : L("bitti")));

  row.append(avatar(personById(e.personId)), main, side);
  row.addEventListener("click", () => openEntrySheet(e));
  row.addEventListener("keydown", ev => { if (ev.key === "Enter") openEntrySheet(e); });
  return row;
}

// Varlıktan ödenen harcama: çıkış olarak, dokununca harcama formu
function spendRow(p, r, today) {
  const code = T.assetOf(p, HOME);
  const rule = T.repeats(p) ? R.rule(p) : null;
  const left = upcomingPayments(p, today).filter(x => x.key > today);
  // Tek seferlik çıkış girişler gibi hep belirgin; tekrarlayan ya da taksitli bitince soluklaşır
  const row = el("div", "purchase" + (!left.length && (rule || T.planLength(p) > 1) ? " done" : ""));
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const main = el("div", "p-main");
  main.append(el("div", "p-title", p.desc));
  const meta = el("div", "p-meta");
  meta.append(el("span", "card-tag", L(V.asset(code).name)));
  if (p.date) meta.append(el("span", "", fmtDay(p.date)));
  if (rule) meta.append(el("span", "", R.label(p) + (rule.n ? " · " + L("{0} kez", rule.n) : "")));
  else if (T.planLength(p) > 1) meta.append(el("span", "", L("{0} taksit", T.planLength(p))));
  if (K.valid(p.category)) meta.append(el("span", "cat-tag" + (p.categoryBy === "user" ? "" : " ai"), K.category(p.category).name));
  main.append(meta);

  const side = el("div", "p-side");
  const total = rule ? T.originalTotal(p) : p.total;
  const amount = el("span", "amount out", fmtAsset(-total, code, true));
  if (rule) amount.append(el("small", "", R.per(p)));
  side.append(amount);
  const value = V.toTry(total, code, r, HOME);
  if (code !== HOME) side.append(el("span", "sub", value == null ? L("kur yok") : `≈ ${fmt(value)}`));
  if (left.length) side.append(el("span", "sub", L("sonraki {0}", fmtDayShort(left[0].key))));

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
  if (D.lang !== "tr") return s;   // İngilizcede ek yok: cümle anahtarı yerini tutar ("{0}'s purchases")
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
function debtName(d) { return d.party || d.desc || (d.kind === "loan" ? L("Kredi") : L("Borç")); }
// Formdaki tür: borrowed (Borç aldım) | lent (Borç verdim) | loan (Kredi)
function debtType(d) { return d.kind === "loan" ? "loan" : d.side === "receivable" ? "lent" : "borrowed"; }
const DEBT_WORD = { borrowed: L("Borç"), lent: L("Alacak"), loan: L("Kredi") };

// Kaydın geçerli ödemeleri (tarihe göre); kart payı ödemeleri için personId; kartın ekstre ödemeleri için cardId
function debtPayments(id) { return B.known(state).pays.get(id) ?? []; }
function sharePayments(pid) { return B.known(state).settlements.filter(x => x.personId === pid); }
function cardPayments(id) { return B.known(state).cardPays.get(id) ?? []; }

// Ekstreleri "Ben işaretlerim" ile ödenen (Ödendi ile) hesaba katılan kart; kart ödemesi yalnızca bunlara girilir. Elle
// mod yarın başlıyorsa (bugün ödeme varken geçildi, startDay) kart bugün otomatik gibidir.
function manualCard(c, today = T.todayKey()) { return N.manualCard(c, today); }
// since gününden bugüne kaç gün geçti (gecikme)
function lateDays(since, today) { return Math.round((T.toDate(today) - T.toDate(since)) / 864e5); }

// "Ben işaretlerim" kartının ekstresinin durumu (borc.js cardState): "ödendi ✓", "₺3.000,00 ödenmedi · 2 gün gecikti",
// "kısmen ödendi · kalan ₺1.000,00", "Son gün bugün: ₺3.000,00"; ileriki açık ekstrede boş
function statementText(x, today) {
  const open = x.amount - x.covered;
  if (x.state === "paid") return L("ödendi ✓");
  // Döner kredi (borc.js revolve): asgari ödendi, kalan faiziyle sonraki ekstreye devretti
  if (x.state === "carried") return L("{0} devretti · faiz işler", fmt(x.carried));
  const when = x.state === "late" ? L("{0} gün gecikti", lateDays(x.key, today)) : x.state === "due" ? L("son gün bugün") : "";
  if ((x.paid ?? x.covered) > EPS) return [L("kısmen ödendi"), L("kalan {0}", fmt(open)), when].filter(Boolean).join(" · ");
  if (x.state === "late") return L("{0} ödenmedi · {1}", fmt(open), when);
  return x.state === "due" ? L("Son gün bugün: {0}", fmt(open)) : "";
}

// "Ben işaretlerim" kartının ödenmesi gereken tutarı (borc.js cardDebt): gecikmiş ekstreler ve son günü bugün olan ayrı
// ("₺2.000,00 ödenmedi · 31 gün gecikti", "Son gün bugün: ₺3.000,00")
function unpaidTexts({ unpaid, overdue, overdueSince }, today) {
  const out = [];
  if (overdue > EPS) out.push(L("{0} ödenmedi · {1}", fmt(overdue), L("{0} gün gecikti", lateDays(overdueSince, today))));
  if (unpaid - overdue > EPS) out.push(L("Son gün bugün: {0}", fmt(unpaid - overdue)));
  return out;
}

// İşaretteki rozet: elle ödenen kartın ekstresi ödendi mi (ileriki açık ekstrede yok)
function stateTag(x) { return !x ? "" : x.state === "paid" ? L("ödendi") : x.state === "late" ? L("gecikti") : x.state === "due" ? L("son gün bugün") : ""; }

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
  if (code === HOME) return null;
  const v = V.toTry(amount, code, r, HOME);
  return v == null ? L("kur yok") : `≈ ${fmt(v)}`;
}

// Kuruşsuz tutar (eşitlik satırı, istatistikler): "₺89.000"
let wholeMoney = new Intl.NumberFormat(D.locale(), { style: "currency", currency: HOME, maximumFractionDigits: 0 });
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
function assetNames(codes) { return codes.map(c => (V.asset(c) ? lowerName(V.asset(c).name) : c)).join(", "); }
// Cümle içinde varlığın adı: Türkçede küçük harfle ("gram altın"), İngilizcede olduğu gibi ("US Dollar")
function lowerName(name) { return D.lang === "tr" ? name.toLocaleLowerCase("tr-TR") : L(name); }

// Borç akışının işareti: kredide banka, diğerlerinde karşılıklı oklar; nötr renkte (renk yalnızca kişilerin ve kartların)
function flowMark(f) {
  const m = icon(f.debt?.kind === "loan" ? "bank" : "swap", "cmark");
  m.style.setProperty("--c", "var(--text-2)");
  return m;
}
// Borç akışının adı (borc.js flowText); kartındaki harcamalar için kişinin ödemesi "Annem · sana ödedi"
function flowLabel(f) { return N.flowLabel(state, f); }
// Akışın işaretli tutarı kendi biriminde: "−₺5.500,00", "+$100,00"
function flowMoney(f) { return (f.amount < 0 ? "−" : "+") + money(Math.abs(f.amount), f.asset); }
// Borç akışının penceresi: kart payı ödemesinde kişinin kart payı, diğerlerinde borcun kendisi
function openFlow(f) {
  if (f.type === "share") openShareSheet(f.payment.personId);
  else openDebtSheet(f.debt);
}
// Ödenecek borç akışlarının (B.paymentsDue) TL toplamı; kuru olmayan varlık sayılmaz
function dueSum(flows, r) { return flows.reduce((s, f) => s + (V.toTry(-f.amount, f.asset, r, HOME) ?? 0), 0); }

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
  sub.append(el("span", "", f.type === "pay" ? L("ödeme") : f.of > 1 ? L("taksit {0}/{1}", f.no, f.of) : L("vade")));
  if (f.late) sub.append(el("span", "out-text", L("gecikti")));
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
  for (const f of B.paymentsDue(state, today, today, end)) if (!f.paid) total += V.toTry(-f.amount, f.asset, r, HOME) ?? 0;
  return total;
}

function renderDebts() {
  const today = T.todayKey();
  const r = curRates();
  const t = B.totals(state, today, r);
  const payer = state.people[0];

  setMoney(els.debtTotal, t.debt.total);
  // Varlık ve Borç yuvarlanır, Özvarlık farkıdır: tam lirada da toplam tutsun
  const A = Math.round(t.assets), Dt = Math.round(t.debt.total);
  els.debtEq.textContent = L("Varlık {0} = Özvarlık {1} + Borç {2}", fmtWhole(A), fmtWhole(A - Dt), fmtWhole(Dt));
  els.debtNote.classList.toggle("warn-text", t.missing.length > 0);
  els.debtNote.textContent = t.missing.length ? L("Kur yok · {0} dahil değil", assetNames(t.missing)) : "";
  els.debtStats.replaceChildren(
    stat(L("Alacak"), fmtWhole(t.receivable.total)),
    stat(L("Bu ay ödenecek"), fmtWhole(dueThisMonth(today, r))));

  // Takip bilgisi bir kez; ödeyenin TL hareketi yoksa ekstreler eksiye düşmesin diye bakiye isteği
  const tracked = state.cards.filter(B.tracked);
  const manual = tracked.filter(c => manualCard(c, today)).length;
  // Ekstre ne zaman düşer: “Otomatik”te son ödeme gününün ertesi günü, “Ben işaretlerim”de Ödendi'ye dokununca
  const when = !manual ? L("son ödeme gününün ertesi günü") : manual === tracked.length ? L("sen “Ödendi”ye dokununca")
    : L("son ödeme gününün ertesi günü (“Ben işaretlerim” kartlarında sen “Ödendi”ye dokununca)");
  const notice = !!payer && tracked.length > 0 && !readPref(PREF.trackNotice);
  els.trackNote.hidden = !notice;
  if (notice) {
    els.trackNoteText.textContent = L("Kart ekstreleri {0} {1} bakiyenden düşer. Bunu her kart için Kartlar'da kartı açıp “Ekstre ödemesi”nden değiştirebilirsin. Kartındaki başkalarının harcamaları, onlar sana ödeyene kadar Alacaklarım'da görünür.",
      when, homeShort());
  }
  const noLira = !!payer && tracked.length > 0 && !knownEntries().some(e => e.personId === payer.id && e.asset === HOME);
  els.balanceHint.hidden = !noLira;
  if (noLira) {
    const own = B.totals(state, today, r, payer.id).balances[HOME] ?? 0;
    els.balanceHintText.textContent = L("Kart ekstreleri {0} bakiyenden düşüyor ama henüz hiç {0} girişi (maaş, bankadaki para gibi) eklemedin; bu yüzden {0} bakiyen {1} görünüyor. Bankadaki parayla aynı olsun diye aradaki farkı bir kez giriş olarak ekle (ör. bankada {2} var, burada {3} görünüyorsa {4} gir).",
      homeShort(), fmt(own), wholeMoney.format(10000), wholeMoney.format(-2000), wholeMoney.format(12000));
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
    if (cards.length) groups.push(debtGroup(L("Kartlar"), cards.map(c => cardDebtRow(c, payer, today)), fmt(t.debt.cards)));
    const cash = cashDebtRow(today, r);
    if (cash) groups.push(debtGroup(L("Nakit"), [cash], fmt(t.debt.cash)));
    const loans = open.filter(x => x.debt.kind === "loan");
    if (loans.length) groups.push(debtGroup(L("Krediler"), loans.map(x => personDebtRow(x, today, r)), fmt(t.debt.loans)));
    const people = [...open.filter(x => x.debt.kind === "person").map(x => personDebtRow(x, today, r)),
      ...shares.filter(s => s.remaining < -EPS).map(s => shareRow(s, today))];
    if (people.length) groups.push(debtGroup(L("Kişiler"), people, fmt(t.debt.people + t.debt.overpaid)));
    if (off.length) groups.push(debtGroup(L("Hesaba katılmayan kartlar"), off.map(c => cardDebtRow(c, payer, today))));
  } else {
    const owed = shares.filter(s => s.remaining > EPS);
    if (owed.length) groups.push(debtGroup(L("Kartını kullananlar"), owed.map(s => shareRow(s, today)), fmt(t.receivable.cards)));
    const people = open.filter(x => x.debt.kind === "person");
    if (people.length) groups.push(debtGroup(L("Kişiler"), people.map(x => personDebtRow(x, today, r)), fmt(t.receivable.people)));
    // Fazla ödenmiş kart: fazlası sonraki ekstrelerden düşülür
    const credit = t.cards.filter(c => c.tracked && c.credit > EPS);
    if (credit.length) groups.push(debtGroup(L("Fazla ödenen kartlar"), credit.map(cardCreditRow), fmt(t.receivable.cardCredit)));
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
    btn.append(icon("plus"), document.createTextNode(debt ? L("Borç ekle") : L("Alacak ekle")));
    btn.addEventListener("click", () => openDebtSheet(null, { type: debt ? "borrowed" : "lent" }));
    box.append(emptyState("swap", debt ? L("Borcun yok") : L("Alacağın yok"), debt
      ? L("Kart borçların burada kendiliğinden görünür. Birinden borç aldıysan ya da kredin varsa ekle.")
      : L("Kartınla başkası için yaptığın harcamaları eklersen, o kişi sana ödeyene kadar burada görünür (hesaba katılmayan kartlar hariç). Birine borç verdiysen onu da buraya ekleyebilirsin."), btn));
  }
  if (closed.length) {
    const toggle = el("button", "section-toggle" + (debtClosedOpen ? " open" : ""));
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(debtClosedOpen));
    toggle.append(document.createTextNode(L("Kapananlar ({0})", closed.length)), icon("down"));
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
  els.debtFoot.textContent = (payer ? L("Hesaba katılan kartların ekstreleri {0} {1} bakiyenden düşer; kartındaki başkalarının harcamaları, onlar sana ödeyene kadar Alacaklarım'da görünür.", when, homeShort()) + " " : "")
    + (manualLoan ? L("Kredi taksitleri taksit gününün ertesi günü ödenmiş sayılır; otomatik ödenmeyen kredide sen “Ödendi”ye dokununca.")
      : L("Kredi taksitleri taksit gününün ertesi günü ödenmiş sayılır.")) + " "
    + L("Döviz ve altın bugünkü kurla {0} çevrilir.", homeEk("ye"));
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
  return s.toLocaleUpperCase(D.locale()) || "?";
}

function whoAmount(person, amount) {
  const who = el("span", "who");
  who.append(dot(seriesVar(person)), document.createTextNode(L("{0} harcamaları {1}", nameWith(person.name, "in"), fmt(amount))));
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
  if (manual) meta.push(L("sen işaretliyorsun"));
  const acts = [];
  if (manual && (cd.unpaid > EPS || cd.next?.cut)) {
    acts.push(rowAction(L("Ödendi"), L("{0} ekstresini ödendi olarak işaretle", c.name), () => openPaySheet({ cardId: c.id })));
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
  return rowAction(L("Kart ödemelerin"), L("{0} kartına yaptığın ödemeler", c.name), () => openPaySheet({ cardId: c.id }), "receipt");
}

// Fazla ödenmiş kart (Alacaklarım): fazlası sonraki ekstrelerden düşülür; "Ben işaretlerim" kartında ödemeleri (fazlası
// silinebilsin)
function cardCreditRow(cd) {
  const c = cd.card;
  const acts = manualCard(c) && cardPayments(c.id).length ? [payListAction(c)] : [];
  return debtRow({
    id: `credit-card-${c.id}`, mark: markOf(cardMark(c.id)), title: c.name, meta: [L("karta fazla ödedin · sonraki ekstrelerden düşülür")],
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
    const v = V.toTry(cash[code], code, r, HOME);
    if (v == null) missing = true; else total += v;
  }
  return debtRow({
    id: "debt-cash", mark: markOf(cardMark("")), title: L("Nakit taksitler"),
    meta: codes.length > 1 || codes[0] !== HOME ? codes.map(code => money(cash[code], code)) : [L("kartsız taksitli harcamalar")],
    amount: fmt(total), sub: missing ? L("kur yok") : null, popup: false, open: () => { location.hash = "#harcamalar"; },
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
    meta.push(st.closed ? L("kapandı {0}", fmtDayShort(d.closed)) : debt ? L("ödendi") : L("alındı"));
  } else if (!st.started) {
    meta.push(L("{0} tarihinde başlar", fmtDay(d.date)));
  } else {
    if (st.overdue > EPS) meta.push(el("span", "out-text", L("{0} gün gecikti", lateDays(st.overdueSince, today))));
    if (loan) {
      if (st.next) meta.push(L("sonraki {0} {1}", fmtDayShort(st.next.date), money(st.next.amount, d.asset)));
      progress = progressBar(st.paidCount, st.count, L("{0}/{1} ödendi", st.paidCount, st.count));
    } else if (st.count > 1) {
      meta.push(L("{0}/ay · {1}/{2}", money(d.amount / st.count, d.asset), st.paidCount, st.count));
    } else if (d.due && !(st.overdue > EPS)) {
      meta.push(d.due === today ? L("vade bugün") : L("vade {0}", fmtDayShort(d.due)));
    } else if (!d.due) {
      meta.push(L("vadesiz"));
    }
    // Türün varsayılanından farklıysa ödeme şekli: kişide otomatik, kredide elle
    if (loan ? !st.auto : st.auto) meta.push(st.auto ? L("otomatik") : L("elle"));
  }
  const shown = st.done || !st.started ? d.amount : st.remaining;
  const acts = [];
  if (!st.auto && st.started && !st.done) {
    acts.push(rowAction(L("Ödendi"), loan ? L("{0} kredisine ödeme ekle", name) : debt ? L("{0} borcuna ödeme ekle", name) : L("{0} alacağına tahsilat ekle", name),
      () => openPaySheet({ debtId: d.id })));
  }
  return debtRow({
    id: `debt-${d.id}`, mark: loan ? markOf(icon("bank")) : markOf(document.createTextNode(partyInitials(name))),
    title: name, meta, progress, amount: money(shown, d.asset), amountCls: st.done ? "" : debt ? "out" : "in",
    sub: tryNote(shown, d.asset, r) ?? (!st.done && st.started && st.paid > EPS ? (debt ? L("{0} ödendi", money(st.paid, d.asset)) : L("{0} alındı", money(st.paid, d.asset))) : null),
    muted: st.done, open: () => openDebtSheet(d), acts,
  });
}

// Kişinin kart payı: kalan (eksiyse fazla ödemiştir, borç tarafında görünür), ödemesi gelen, sıradaki taksit
function shareRow(s, today, settled = false) {
  const p = s.person;
  const over = s.remaining < -EPS;
  const late = s.dueNow > EPS ? shareLate(s, today) : 0;
  const meta = settled ? [L("hepsini ödedi")] : over ? [L("sana {0} fazla ödedi · bu kadar ona borçlusun", fmt(-s.remaining))]
    : [late > EPS ? el("span", "out-text", L("{0} gecikti", fmt(late))) : s.dueNow > EPS && L("günü bugün {0}", fmt(s.dueNow)),
      s.next && L("sonraki {0} {1}", fmtDayShort(s.next.date), fmt(s.next.amount))];
  const acts = [];
  if (!settled && !over) {
    acts.push(rowAction(L("Ödendi"), L("{0} gelen ödemeyi kaydet", nameWith(p.name, "den")), () => openPaySheet({ personId: p.id })));
    const b = el("button", "icon-btn sm share-btn");
    b.type = "button";
    b.setAttribute("aria-label", L("{0} için ödeme özetini gönder", p.name));
    b.title = L("Ödeme özetini gönder");
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
els.balanceHintBtn.addEventListener("click", () => openEntrySheet(null, HOME, { desc: L("Açılış bakiyesi"), personId: state.people[0]?.id }));

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
      label.textContent = L("Evet, sil");
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
// Sıklık biriminin adı "[2] [haftada] bir" / "Every [2] [weeks]" içinde
const UNIT_EVERY = { day: L("günde"), week: L("haftada"), month: L("ayda") };
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
  // Türkçede "[2] [haftada] bir", İngilizcede "Every [2] [weeks]"
  every.append(...(D.lang === "tr" ? [] : [el("span", "", L("Her"))]),
    input({ name: "every", min: 1, max: R.MAX_EVERY, value: String(r?.every > 1 ? r.every : 2) }, L("Kaç")),
    group("seg", L("Birim"), R.UNITS.map(u => {
      const l = el("label");
      l.append(Object.assign(document.createElement("input"), { type: "radio", name: "unit", value: u, checked: u === (r?.unit ?? "month") }),
        el("span", "", UNIT_EVERY[u]));
      return l;
    })),
    ...(D.lang === "tr" ? [el("span", "", "bir")] : []));

  const preset = !r || TIMES_PRESETS.some(([n]) => n === r.n);
  const other = el("label", "inline-input");
  other.append(el("span", "", L("Diğer")),
    input({ name: "timesN", min: 2, max: R.MAX_REPEAT, placeholder: L("kez"), value: preset ? "" : String(r.n) }, L("Kaç kez")));
  const times = el("div", "rep-times");
  times.hidden = !r;
  times.append(el("span", "field-label", L("Kaç kez")),
    group("chips", L("Kaç kez"), TIMES_PRESETS.map(([n, label]) => radioChip("times", String(n), label, preset && n === (r?.n ?? 0)))),
    other);

  box.classList.add("repeat");
  box.replaceChildren(group("chips", L("Sıklık"), FREQ_PRESETS.map(([v, label]) => radioChip("freq", v, label, v === freq))), every, times);
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
  return r ? `${R.label(x)} · ${r.n ? L("{0} kez", r.n) : L("süresiz")}` : L("Bir kez");
}

const REPEAT_ERRORS = { every: L("Sıklık 1–{0} arası olmalı.", R.MAX_EVERY), timesN: L("Tekrar 2–{0} kez arası olmalı.", R.MAX_REPEAT) };

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

// "1.250,50", "1250,5", "1250.50", "1.250" → sayı (Türkçe yazımda nokta binlik, virgül ondalık; Almanca, Fransızca,
// İspanyolca, İtalyanca, Felemenkçe, Portekizce de virgüllü). İngilizce, Japonca, Korecede virgül binlik, nokta ondalık:
// "1,250.50", "1250.5". Para birimi işaretleri ve boşluklar (Fransızcanın binlik boşluğu da) atılır.
const DECIMAL = (1.5).toLocaleString(D.locale()).charAt(1);
function parseAmount(v) {
  const t = String(v ?? "").replace(/[\s\p{Sc}]/gu, "");
  if (!t) return NaN;
  if (DECIMAL !== ",") return Number(t.replace(/,/g, ""));
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return Number(t);
}
// Sayı → alana yazılan tutar, binlik ayraçla: 1250.5 → "1.250,5"
const amountText = (n, digits = 2) => n.toLocaleString(D.locale(), { maximumFractionDigits: digits });
// Birim fiyat alana: kuruşu hep yazılır, fonda 6 haneye kadar: 246.3 → "246,30", 0.959756 → "0,959756"
const priceText = n => n.toLocaleString(D.locale(), { minimumFractionDigits: 2, maximumFractionDigits: 6 });

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
  if (!state.people.length) { openPeopleSheet(); toast(L("Önce bir kişi ekle")); return; }
  editingId = p?.id ?? null;
  inboxDraftId = draft?.inboxId ?? null;
  convertingEntryId = !p && draft?.entryId ? draft.entryId : null;
  const src = p || draft;
  const f = els.purchaseForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  els.purchaseTitle.textContent = p ? L("Harcamayı düzenle") : convertingEntryId ? L("Çıkışı düzenle")
    : draft?.inboxId != null ? L("E-postadan harcama") : L("Yeni harcama");
  els.purchaseDelete.hidden = !p && !convertingEntryId;
  els.purchaseCopy.hidden = !p;
  planOpen = false;

  const count = src?.count ?? 1;
  const other = !COUNT_PRESETS.includes(count);
  els.countChips.replaceChildren(...[...COUNT_PRESETS, "other"].map(n => countTile(n, n === "other" ? other : n === count)));
  f.elements.count.value = count;
  els.countOther.hidden = !other;
  // Taksidin öne çıkmadığı ülkede peşin başlar; taksitli harcama düzenlenirken Taksitli açık
  f.elements.plan.value = count > 1 ? "1" : "";
  // Şimdi al sonra öde: ülkenin sağlayıcıları; düzenlenen harcamanın sağlayıcısı listede yoksa o da (ülke değişmiş olabilir)
  const provider = p && T.bnpl(p) ? p.bnpl : null;
  const providers = provider && !FEAT.bnpl.includes(provider) ? [provider, ...FEAT.bnpl] : FEAT.bnpl;
  const chosen = provider ?? (providers.includes(lastBnpl) ? lastBnpl : providers[0]);
  els.bnplChips.replaceChildren(...providers.map(id => radioChip("bnplProvider", id, T.bnplName({ bnpl: id }), id === chosen)));
  f.elements.bnpl.checked = !!provider;
  f.elements.bonus.value = T.bonus(src) ? String(src.count) : "";

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

  const code = T.assetOf(src, HOME);
  els.purchaseAssetChips.replaceChildren(...V.assetsFor(HOME).map(a => radioChip("asset", a.code, L(a.name), a.code === code)));
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
  setCategoryHint(categorySource === "ai" ? L("öneri") : "");
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
    radioChip("card", "", L("Nakit / banka kartı"), selected === "", cardMark("")));
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
  tip.textContent = L("{0} ile alırsan bunu {1} gün daha geç ödersin (son ödeme {2}). Seçmek için dokun.", best.card.name, best.days - mine.days, fmtDayShort(best.due));
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
  els.dateVal.textContent = !T.parseDate(date) ? L("Tarih yok")
    : date === today ? L("Bugün") : date === T.addDays(today, -1) ? L("Dün") : fmtDay(date);
  els.repeatVal.textContent = repeatText(readRepeat(f).rep);
  els.categoryVal.textContent = K.category(f.category.value)?.name ?? L("Seçilmedi");
  els.personVal.textContent = personById(f.person.value)?.name ?? "";
  els.assetVal.textContent = V.asset(f.asset.value) ? L(V.asset(f.asset.value).name) : "";
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
    els.purchaseStatus.textContent = [L("{0} kez işlendi", `${done}${n ? `/${n}` : ""}`), next ? L("sonraki {0}", fmtDay(next)) : L("bitti")].join(" · ");
    return;
  }
  const pays = paymentsOf(p), plan = T.planLength(p);
  const left = pays.filter(x => x.key >= today);
  const bonusName = T.bonus(p) && cardById(p.cardId) ? [T.bonusName(p, cardById(p.cardId))] : [];
  const parts = bonusName.concat(plan > 1
    ? [L("{0}/{1} taksit ödendi", plan - left.length, plan), left.length ? L("kalan {0}", money(left.reduce((s, x) => s + x.amount, 0), T.assetOf(p, HOME))) : L("bitti")]
    : [left.length ? L("Ödenmedi") : L("Ödendi")]);
  if (left[0]) parts.push(L("sonraki {0}", fmtDay(left[0].key)));
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
  tile.append(input, el("span", "n" + (word ? " word" : ""), value === 1 ? L("Peşin") : word ? L("Diğer") : String(value)), el("span", "per"));
  return tile;
}

let tileMoney = new Intl.NumberFormat(D.locale(), { style: "currency", currency: HOME, maximumFractionDigits: 0 });

// Kutulardaki tutar: yazılan toplamsa taksit başına düşen, "Taksit başına"ysa toplam. Diğer seçiliyken yazılan sayı.
// Harcama formunda; borç formu kendi formunu, kutularını, sınırını, varlığını ve kısaltma eşiğini (5 dar kutu) verir.
function renderCountTiles(f = els.purchaseForm.elements, grid = els.countChips, { max = 60, code = HOME, compact = 1e5 } = {}) {
  const amount = parseAmount(f.amount.value);
  const per = f.per.value === "1";
  const custom = Math.round(Number(f.count.value));
  const short = v => (code === HOME ? (v >= compact ? homeSymbol() + fmtShort(v) : tileMoney.format(v))
    : code === "GAU" ? L("{0} gr", fmtShort(v)) : V.asset(code).symbol + fmtShort(v));
  for (const tile of grid.children) {
    const v = tile.querySelector("input").value;
    const other = v === "other";
    const n = other ? (tile.classList.contains("on") && custom >= 1 && custom <= max ? custom : null) : Number(v);
    if (other) {
      tile.querySelector(".n").textContent = n ? String(n) : L("Diğer");
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
  if (known) { pickCategory(known, "memory", desc); setCategoryHint(L("önceki seçimin")); return; }
  if (!YZ.enabled) {
    pickCategory(null, null);
    const label = YZ.mode === "cloud" ? L("giriş yapınca önerilir") : YZ.mode === "off" ? L("Yapay zekâ önersin") : null;
    setCategoryHint("", label && { label, run: openAiSheet });
    return;
  }
  setCategoryHint(L("öneriliyor…"));
  try {
    const r = await guessCategory(desc);
    if (seq !== suggestSeq || categoryTouched || !els.purchaseSheet.open) return;
    if (!r) { setCategoryHint(""); return; }
    if (r.confidence < K.SURE) {
      pickCategory(null, null);
      setCategoryHint(L("emin değilim") + " · ", { label: L("{0} olabilir", K.category(r.category).name), run: () => chooseCategory(r.category) });
      return;
    }
    pickCategory(r.category, "ai", desc);
    setCategoryHint(L("öneri"));
  } catch {
    if (seq === suggestSeq) setCategoryHint(L("öneri alınamadı"));
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
  const asset = V.asset(f.asset.value) ? f.asset.value : HOME;
  const foreign = asset !== HOME;   // döviz / altın: kartsız, peşin
  const desc = f.desc.value.trim();
  const amount = V.round(parseAmount(f.amount.value), asset);
  // Şimdi al sonra öde (ülkede varsa): 4 ödeme, 2 haftada bir; tekrarlamaz
  const bnpl = !foreign && els.bnplChips.children.length && f.bnpl.checked ? f.bnplProvider.value || null : null;
  // Taksidin öne çıkmadığı ülkede "Peşin" seçiliyse tek ödeme
  const single = FEAT.installments === "secondary" && f.plan.value !== "1";
  const date = T.parseDate(f.date.value) ? f.date.value : "";
  const { rep, error } = bnpl ? { rep: {}, error: null } : readRepeat(f);
  // Bonus ödemesi (Japonya, FEAT.bonus): kartlı, tarihli, tekrarlamayan harcamada; 1 tek bonus, 2 iki bonusa bölünmüş
  const bonusOk = bonusAllowed() && !foreign && !bnpl && !!cardById(f.card.value) && rep.repeat == null;
  const bonus = bonusOk && date ? Number(f.bonus.value) || 0 : 0;
  const count = foreign ? 1 : bnpl ? 4 : bonus || (single ? 1 : Math.round(Number(f.count.value || 1)));
  const errors = [];
  if (!(amount > 0)) errors.push("amount");
  if (!desc) errors.push("desc");
  if (!(count >= 1 && count <= 60)) errors.push("count");
  if (!date && (!editing?.firstDue || rep.repeat != null)) errors.push("date");   // tekrarlayan harcamanın tarihi olmalı
  if (error) errors.push(error);
  if (!personById(f.person.value)) errors.push("person");

  const total = f.per.value === "1" && count > 1 && !bnpl && !bonus ? Math.round(amount * count * 100) / 100 : amount;
  const p = { desc, cardId: foreign ? null : f.card.value || null, count, total };
  if (foreign) p.asset = asset;
  Object.assign(p, rep);
  if (bonus) p.bonus = true;
  if (bnpl) {
    p.bnpl = bnpl;
    if (!date && !errors.includes("date")) errors.push("date");   // ilk ödeme harcama günü
  }
  if (K.valid(f.category.value)) Object.assign(p, { category: f.category.value, categoryBy: categorySource === "user" ? "user" : "ai" });
  if (date) {
    p.date = date;
  } else if (editing?.firstDue) {
    // Excel'den gelen tarihsiz kayıt: ödeme ayı ve plan korunur
    p.firstDue = editing.firstDue;
    if (editing.planCount) p.planCount = editing.planCount;
  }
  return { p, personId: f.person.value, errors, bonusOk };
}

// Tekrarlayan harcamanın ilk tekrarı (tek alışveriş olarak)
function firstOccurrence(p) {
  const { repeat, every, unit, ...one } = p;
  return one;
}

function updatePurchasePreview() {
  const { p, personId, errors, bonusOk } = collectPurchase();
  const code = T.assetOf(p, HOME), a = V.asset(code), rule = R.rule(p);
  const bonus = T.bonus(p);
  const box = els.purchasePreview;
  box.replaceChildren();
  els.purchaseSum.replaceChildren();
  const today = T.todayKey();
  for (const b of els.dateChips.querySelectorAll("[data-day]")) {
    b.classList.toggle("on", els.purchaseForm.elements.date.value === T.addDays(today, Number(b.dataset.day)));
  }
  els.cardField.hidden = code !== HOME;
  // Taksit: Pay in 4'te yok; taksidin öne çıkmadığı ülkede Peşin / Taksitli, taksit seçimi Taksitli'de
  const secondary = FEAT.installments === "secondary";
  const picking = !secondary || els.purchaseForm.elements.plan.value === "1";
  els.countField.hidden = code !== HOME || !!p.bnpl;
  els.planSeg.hidden = !secondary;
  els.countChips.hidden = !picking;
  els.countOther.hidden = !picking || els.countChips.querySelector('input[value="other"]')?.checked !== true;
  const one = els.countChips.querySelector('input[value="1"]')?.closest(".count-tile");
  if (one) one.hidden = secondary;   // Taksitli'de Peşin kutusu yok
  els.repeatRow.hidden = !!p.bnpl;
  els.bnplField.hidden = code !== HOME || !els.bnplChips.children.length;
  els.bnplChips.hidden = !p.bnpl;
  const parts = p.bnpl && p.total > 0 && p.date ? T.bnplAmounts(p) : null;
  els.bnplHint.textContent = parts ? L("Bugün {0}, sonra 2 haftada bir 3 × {1}", fmt(parts[0]), fmt(parts.at(-1))) : "";
  els.purchaseForm.querySelector(".amount-input .cur").textContent = a.symbol;
  els.purchaseForm.elements.amount.dataset.amount = a.digits;
  els.perRow.hidden = !(p.count > 1) || !!p.bnpl || bonus;
  // Bonus ödemesi (Japonya): seçilince taksit kutuları gizlenir
  els.bonusRow.hidden = !bonusOk;
  if (bonus) els.planSeg.hidden = els.countChips.hidden = els.countOther.hidden = true;
  renderCountTiles();
  renderRowValues();
  renderCardTip(p.cardId, p.date);
  if (errors.some(e => e === "amount" || e === "count" || e === "date")) return;

  const card = cardById(p.cardId);
  const first = T.payments(firstOccurrence(p), card)[0].key;
  const pays = T.payments(p, card);
  if (bonus && card) {
    // Bonus ödemesi: tutar ve bonus günleri ("Yaz bonusu 10 Ağu")
    els.purchaseSum.append(el("strong", "", money(p.total, code)),
      el("span", "", pays.map(x => `${bonusPayName(x)} ${fmtDayShort(x.key)}${pays.length > 1 ? ` · ${fmt(x.amount)}` : ""}`).join(" + ")));
  } else {
    els.purchaseSum.append(el("strong", "", (p.count > 1 ? `${p.count} × ${fmt(T.perInstallment(p))}` : money(p.total, code)) + (rule ? ` ${R.per(p)}` : "")),
      el("span", "", p.count > 1 ? L("toplam {0} · ilk ödeme {1}", fmt(p.total), fmtDayShort(first)) : L("ödeme {0}", fmtDayShort(first))));
  }
  if (rule && p.date && !errors.some(e => e in REPEAT_ERRORS)) {
    box.append(el("div", "", `${R.label(p)} · ` + (rule.n ? L("{0} kez, son {1}", rule.n, fmtDay(R.lastDate(p))) : L("bitiş tarihi yok"))));
  }
  if (code !== HOME) {
    const value = V.toTry(p.total, code, curRates(), HOME);
    box.append(el("div", "", value == null ? L("Kur alınamadı — {0} karşılığı sonra hesaplanır", homeShort())
      : `≈ ${fmt(value)} · ${code === "GAU" ? L("{0} gr", 1) : `1 ${a.symbol}`} = ${fmt(rates.rates[code])}`));
  }
  // Kartsız harcama varlıktan ödenir: kişinin o varlıkta hareketi varsa bakiyesi önce / sonra
  const person = personById(personId);
  if (!card && p.date && person) {
    const own = x => x.personId === person.id;
    const entries = knownEntries().filter(e => own(e) && e.asset === code && e.id !== convertingEntryId);
    if (entries.length || code !== HOME) {
      const others = cashPurchases().filter(x => own(x) && x.id !== editingId);
      const spent = B.addSpent(T.cashSpent(others, state.cards, today, HOME), B.debtSpent(state, today, person.id));
      const before = V.balances(entries, today, spent, HOME)[code] ?? 0;
      const after = V.balances([], today, T.cashSpent([p], [], today, HOME), HOME)[code] ?? 0;
      const total = V.round(before + after, code);
      box.append(el("div", total < 0 ? "warn" : "", L("{0} · {1} bakiyesi {2} → {3}", person.name, lowerName(a.name), fmtAsset(before, code), fmtAsset(total, code))));
    } else {
      box.append(el("div", "", L("Nakit · {0} bakiyesinden düşer", homeShort())));
    }
  }

  // Uyarı: kart limiti aşılıyor
  const t = card && p.date ? I.cardTiming(state, p.date).find(x => x.card.id === card.id) : null;
  if (t?.available != null) {
    const own = editingId ? state.installments.find(x => x.id === editingId) : null;
    const before = own && own.cardId === card.id ? T.outstanding(paymentsOf(own), today) : 0;
    const after = t.available + before - T.outstanding(pays, today);
    if (after < 0) box.append(el("div", "warn", L("{0} limiti {1} aşılır", card.name, fmt(-after))));
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
      box.append(el("div", "", L("Bu harcamanın {0} kadarı, son ödeme günü geçmiş {1} ekstreye giriyor. Bu kısım ödenmiş sayılır ve {2} bakiyenden düşer.",
        fmt(sum(past)), new Set(past.map(x => x.key)).size, homeShort())));
    }
    if (unpaid.length) {
      box.append(el("div", "", L("Bu harcamanın {0} kadarı, son ödeme günü geçmiş {1} ekstreye giriyor. Bu kısım için Borçlar'da “Ödendi”ye dokunana kadar o ekstreler gecikmiş görünür.",
        fmt(sum(unpaid)), new Set(unpaid.map(x => x.key)).size)));
    }
    if (person && person.id !== payer.id && counted.length) {
      box.append(el("div", "", L("{0} bu harcama için sana {1} ödeyecek (Alacaklarım'a eklenir).", person.name, fmt(sum(counted)))));
    }
  }
  if (!card && !p.date) box.append(el("div", "", L("Excel'den aktarılan kayıt — tarih girmezsen ödeme ayı korunur")));
  // Düzenlemede ödeme planı
  if (editingId && pays.length > 1) {
    const details = el("details", "plan");
    details.open = planOpen;
    details.addEventListener("toggle", () => { planOpen = details.open; });
    details.append(el("summary", "", rule ? L("Ödeme planı ({0} ödeme)", pays.length) : L("Ödeme planı ({0} taksit)", pays.length)));
    const ol = el("ol", "plan-list");
    for (const [i, x] of pays.entries()) {
      const li = el("li", x.key < today ? "paid" : "");
      li.append(el("span", "", x.bonus ? `${bonusPayName(x)} · ${fmtDay(x.key)}` : `${rule ? i + 1 : x.no}. ${fmtDay(x.key)}`), el("span", "amount", money(x.amount, code)));
      ol.append(li);
    }
    details.append(ol);
    box.append(details);
  }
}

els.purchaseForm.addEventListener("input", e => {
  e.target.classList?.remove("invalid");
  const f = els.purchaseForm.elements;
  // Peşin / Taksitli: Taksitli'ye geçince Peşin seçiliyse 3 taksit
  if (e.target.name === "plan" && e.target.value === "1" && Math.round(Number(f.count.value)) <= 1) {
    f.count.value = 3;
    els.countChips.querySelector('input[value="3"]').checked = true;
  }
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
    const msg = { desc: L("Ne aldığını yaz."), amount: L("Tutarı gir."), count: L("Taksit sayısı 1–60 arası olmalı."), date: L("Harcama tarihini gir."),
      person: L("Kişi seç."), ...REPEAT_ERRORS }[errors[0]];
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
  if (p.bnpl) lastBnpl = p.bnpl;
  lastPersonId = personId;
  saveState();
  els.purchaseSheet.close();
  const nudge = !p.category && !YZ.enabled && YZ.mode !== "local" && !aiNudged;
  if (nudge) aiNudged = true;
  toast((editingId ? L("Harcama güncellendi") : L("Harcama eklendi"))
    + (p.category ? ` · ${K.category(p.category).name}`
      : !nudge ? ""
      : " · " + (YZ.mode === "cloud" ? L("giriş yapınca kategoriler otomatik önerilir") : L("kategori önerisi için Ayarlar → Yapay zekâ"))));
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
    toast(L("Çıkış silindi"));
    render();
    return;
  }
  const p = state.installments.find(x => x.id === editingId);
  if (!p) return;
  state.installments = state.installments.filter(x => x.id !== p.id);
  editingId = null;
  saveState();
  els.purchaseSheet.close();
  toast(L("Harcama silindi"));
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
    input.setAttribute("aria-label", L("Renk {0}", i + 1));
    label.append(input);
    return label;
  }));
}

function openCardSheet(c) {
  if (!c && locked() && state.cards.length >= FREE_CARDS) { location.hash = "#kartlar"; render(); return; }
  editingCardId = c?.id ?? null;
  const f = els.cardForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  els.cardTitle.textContent = c ? L("Kartı düzenle") : L("Yeni kart");
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
  f.elements.apr.value = B.revolving(c) ? String(c.apr) : "";
  // Bonus ayları (Japonya): yaz ve kış ayı seçenekleri ay adlarıyla
  const [summer, winter] = T.bonusMonths(c);
  const monthOptions = (select, months, selected) => select.replaceChildren(...months.map(m => {
    const o = el("option", "", T.monthName(m - 1));
    o.value = String(m);
    o.selected = m === selected;
    return o;
  }));
  monthOptions(f.elements.bonusSummer, [...new Set([6, 7, 8, 9, summer])].sort((a, b) => a - b), summer);
  monthOptions(f.elements.bonusWinter, [...new Set([11, 12, 1, 2, winter])], winter);
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
    els.cardHint.textContent = s.cut === T.todayKey()
      ? L("Bugün bu kartla harcama yaparsan bugün kesilecek ekstreye girer; son ödeme {0}.", fmtDay(s.due))
      : L("Bugün bu kartla harcama yaparsan {0} tarihinde kesilecek ekstreye girer; son ödeme {1}.", fmtDay(s.cut), fmtDay(s.due));
  } else {
    els.cardHint.textContent = L("Kesim ve son ödeme gününü kart ekstrende bulabilirsin.");
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
const payModeText = () => ({
  auto: L("Ekstre, son ödeme gününün ertesi günü ödenmiş sayılır ve {0} bakiyenden düşer. Bankaya ödemeyi yine sen yaparsın; uygulamada bir şeye dokunman gerekmez.", homeShort()),
  manual: L("Ekstreyi ödeyince Borçlar'da “Ödendi”ye dokun; tutar o zaman {0} bakiyenden düşer. Son ödeme günü geçer de dokunmazsan ekstre “gecikti” görünür.", homeShort()),
  off: L("Bu kartın borcu toplam borcuna girmez, ekstreleri {0} bakiyeni etkilemez. Ödemesini senin yapmadığın kartlar için (ör. eşinin kartı).", homeShort()),
});

// Sıradaki ekstre: kesildiyse tutarı ve son ödeme günü, kesilmediyse şimdiye kadarki harcamalar ve kesim günü
function nextStatementText(cd) {
  const n = cd.next;
  return n.cut ? L("Ekstre kesildi: {0} · son ödeme {1}", fmt(n.amount), fmtDayShort(n.date))
    : L("Bu dönemki harcamalar: {0} · kesim {1} · son ödeme {2}", fmt(n.amount), fmtDayShort(cd.open.cut), fmtDayShort(n.date));
}

// Kartın borcu kısa satırlar hâlinde (kart formu, kartın ödeme formu): gecikmiş, son günü bugün olan, sıradaki ekstre,
// kart borcu (ya da fazla ödenen), diğer kişilerin harcamaları
function cardDebtLines(card, cd, today) {
  const manual = manualCard(card, today);
  const payer = state.people[0]?.id;
  const out = [];
  if (manual && cd.overdue > EPS) out.push(L("Gecikmiş: {0} ({1} gün)", fmt(cd.overdue), lateDays(cd.overdueSince, today)));
  if (manual && cd.unpaid - cd.overdue > EPS) out.push(L("Son gün bugün: {0}", fmt(cd.unpaid - cd.overdue)));
  if (cd.next && !(manual && cd.unpaid > EPS && cd.next.date <= today)) out.push(nextStatementText(cd));
  out.push(cd.total > EPS ? L("Kart borcu: {0}", fmt(cd.total)) : cd.credit > EPS ? L("Karta {0} fazla ödedin", fmt(cd.credit)) : L("Kartta borç yok"));
  for (const p of state.people) {
    // Türkçede ad ekiyle ("Ali'nin"); İngilizcede ad olduğu gibi ("Ali's")
    if (p.id !== payer && cd.byPerson[p.id] > EPS) out.push(L("{0} harcamaları: {1} (kart borcuna dahil)", D.lang === "tr" ? nameWith(p.name, "in") : p.name, fmt(cd.byPerson[p.id])));
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
  els.trackPreview.replaceChildren(el("div", "", payModeText()[els.cardForm.elements.payMode.value]),
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
  if (!track.on) {
    return { text: L("Kaydedince: kartın borcu toplam borcundan çıkar")
      + (b.D > EPS ? L("; bu kart için şimdiye kadar {0} bakiyenden düşen {1} geri eklenir", homeShort(), fmt(b.D)) : "")
      + (others ? L("; kartını kullananların harcamaları Alacaklarım'dan çıkar") : "") + "." };
  }
  if (!tracked) {
    const total = B.cardDebt(state, after, today).total;
    const later = track.since > today;
    return { text: (later ? L("Bu karta bugün ödeme girdiğin için kart yarından itibaren hesaba katılır.") + " " : "")
      + (later ? L("Kaydedince: son ödeme günü yarın ya da sonra olan ekstreler {0} bakiyenden düşer, eskiler etkilemez", homeShort())
        : L("Kaydedince: son ödeme günü bugün ya da sonra olan ekstreler {0} bakiyenden düşer, eskiler etkilemez", homeShort()))
      + (total > EPS ? L("; kartın {0} borcu toplam borcuna eklenir", fmt(total)) : "")
      + (others ? L("; kartını kullananların harcamaları Alacaklarım'a girer") : "") + "." };
  }
  if (!track.auto) {
    return { text: after.manualSince > today ? L("Bu karta bugün ödeme girdiğin için “Ben işaretlerim” yarın başlar; önceki ekstreler ödenmiş kalır.")
      : L("Kaydedince: önceki ekstreler ödenmiş kalır; bundan sonrakileri sen işaretlersin.") };
  }
  if (!b.late.length) return null;
  const late = b.late.reduce((s, x) => s + x.amount - x.covered, 0);
  return { text: L("Kaydedince: “Ödendi” demediğin {0} ekstre ({1}) ödenmiş sayılır ve {2} bakiyenden düşer. Gerçekten ödemediysen “Ben işaretlerim”de kal.",
    b.late.length, fmt(late), homeShort()) };
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
  const ahead = cs.deduction - cs.statements.filter(x => x.key <= today).reduce((s, x) => s + x.amount - (x.carryIn || 0), 0);
  if (!(ahead > EPS)) {
    return L("“Otomatik”e bugün geçilemiyor: son ödeme günü bugün olan ekstre “Otomatik”te ancak yarın ödenmiş sayılır; bugün geçersen ona yaptığın ödeme yüzünden {0} bakiyen bugünlük {1} yüksek görünür. Yarın geçebilirsin.",
      homeShort(), fmt(lost));
  }
  // Erken ödemenin kapattığı son ileriki ekstre: onun son ödeme günü geçince engel kendiliğinden kalkar (kart borcunu da
  // aşan ödemede bu gün yok). lost erken ödemeden büyükse son ödeme günü bugün olan ekstreye yapılan ödeme de bugün sayılmaz.
  const last = cs.prepaid > EPS ? null : cs.statements.filter(x => x.key > today && x.covered > EPS).at(-1);
  return L("“Otomatik”e geçilemiyor: bu karta, son ödeme günü gelmemiş ekstreler için {0} erken ödeme kaydettin; ", fmt(ahead))
    + (last ? L("“Otomatik”te ödemelerinin {0} kadarı {1} gününe kadar sayılmaz, {2} bakiyen o kadar yüksek görünür. ", fmt(lost), fmtDayShort(last.key), homeShort())
      : L("“Otomatik”te ödemelerinin {0} kadarı sayılmaz, {1} bakiyen o kadar yüksek görünür. ", fmt(lost), homeShort()))
    + (last ? L("{0} günü “Otomatik”e geçebilirsin; hemen geçmek için “Kart ödemelerin”den bu ödemeyi sil ya da {1} kadar azalt", fmtDayShort(T.addDays(last.key, 1)), fmt(ahead))
      : L("Geçmek için önce “Kart ödemelerin”den bu ödemeyi sil ya da {0} kadar azalt", fmt(ahead)))
    + (lost > ahead + EPS ? L(" (son ödeme günü bugün olan ekstre yüzünden en erken yarın).") : ".");
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
    ? L("{0} tarihinde kesilecek ekstrede {1} harcama ({2}) var. Günler değişince bunlar hangi ekstreye girsin?", fmtDay(open.cut), open.count, fmt(open.total))
    : L("Bu karttaki harcamaların ödeme tarihleri değişecek. Nasıl hesaplansın?");
  const text = {
    old: [L("Bu ekstre eski günlerle kesilsin"),
      L("{0} kesilir, {1} tarihinde ödenir; sonraki ekstreler yeni günlerle", fmtDay(open.cut), fmtDay(open.due))],
    new: [L("Yeni günler hemen başlasın"), open.count
      ? L("Kesilmiş ekstreler değişmez; henüz kesilmemiş harcamalar {0} tarihinde kesilecek ekstreye girer, son ödeme {1}", fmtDay(next.cut), fmtDay(next.due))
      : L("Kesilmiş ekstreler olduğu gibi kalır; bundan sonrakiler yeni günlerle")],
    fix: [L("Günleri yanlış girmiştim"), L("Geçmiş ekstreler dahil hepsi yeni günlerle yeniden hesaplanır. Bu kartın günlerini daha önce değiştirdiysen o değişiklikler olduğu gibi kalır. Geçmiş ekstrelerin tutarı ve {0} bakiyen değişebilir.", homeShort())],
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
    apr: f.apr.value !== "" && !(Number(f.apr.value) >= 0 && Number(f.apr.value) <= 100),
  };
  for (const [k, isBad] of Object.entries(bad)) f[k].classList.toggle("invalid", isBad);
  const firstBad = Object.keys(bad).find(k => bad[k]);
  if (firstBad) {
    f[firstBad].focus();
    if (firstBad === "last4") toast(last4Taken ? L("Bu son 4 hane başka bir kartta kayıtlı") : L("Son 4 hane 4 rakam olmalı"));
    return;
  }
  if (termChange && !termChange.selected) {
    els.termChoices.classList.add("invalid");
    els.termChoices.querySelector("input")?.focus();
    toast(L("Günler değişiyor: harcamaların hangi ekstreye gireceğini aşağıdan seç."));
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
  // Yıllık faiz (döner kredi olan ülkelerde, FEAT.apr; borc.js): boşsa yok; ülkede yoksa kayıtlı olan kalır
  const apr = FEAT.apr && f.apr.value !== "" ? Math.round(Number(f.apr.value) * 100) / 100 : null;
  const withApr0 = c => {
    const { apr: _, ...rest } = c;
    return apr != null ? { ...rest, apr } : FEAT.apr ? rest : c;
  };
  // Bonus ayları (Japonya; taksit.js bonusMonths): varsayılan [8, 1] yazılmaz; başka ülkede kayıttaki kalır
  const months = T.validBonusMonths([f.bonusSummer.value, f.bonusWinter.value]);
  const withBonus = c => {
    if (!bonusAllowed()) return c;
    const { bonusMonths: _, ...rest } = c;
    return months && (months[0] !== T.BONUS_MONTHS[0] || months[1] !== T.BONUS_MONTHS[1]) ? { ...rest, bonusMonths: months } : rest;
  };
  const withApr = c => withBonus(withApr0(c));

  // Ekstre ödemesi (trackSince / trackOff / manualSince) formdan; diğer alanlar ve günlerin geçmişi korunur
  if (editingCardId) {
    // Elle ödenen APR'li karttan çıkarken (otomatik ya da APR silindi) işlemiş faiz harcama olarak kalır: özvarlık değişmez
    const next = withApr(withTracking({ ...before }, track, today));
    const revolvingNow = c => B.tracked(c) && B.manual(c) && B.revolving(c);
    if (revolvingNow(before) && B.tracked(next) && !revolvingNow(next)) {
      for (const x of B.interestCharges(state, before, today)) state.installments.push({ id: uid(), ...x });
    }
    state.cards = state.cards.map(c => {
      if (c.id !== editingCardId) return c;
      const { last4, history, ...rest } = withTerms(c, v);
      return withApr(withTracking({ ...rest, ...(v.last4 && { last4 }), ...(history && { history }) }, track, today));
    });
  } else {
    state.cards.push(withApr(withTracking({ id: uid(), ...v }, track, today)));   // yeni kart varsayılan olarak bugünden takipte (borc.js)
  }
  saveState();
  els.cardSheet.close();
  toast(editingCardId ? L("Kart güncellendi") : L("Kart eklendi"));
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
  const back = eff.D > EPS ? "\n" + L("Bu kart için {0} tarihinden beri {1} bakiyenden düşen {2} geri eklenir.", fmtDay(eff.from), homeShort(), fmt(eff.D)) : "";
  const owned = n && k ? L(" Karttaki {0} harcama ve {1} kart ödemesi de silinir.", n, k)
    : n ? L(" Karttaki {0} harcama da silinir.", n) : k ? L(" Karttaki {0} kart ödemesi de silinir.", k) : "";
  if (!confirm(L("“{0}” kartı silinsin mi?", c.name) + owned + back)) return;
  state.cards = state.cards.filter(x => x.id !== c.id);
  state.installments = state.installments.filter(p => p.cardId !== c.id);
  state.debts = state.debts.filter(x => !isPay(x));
  if (lastCardId === c.id) lastCardId = null;
  editingCardId = null;
  saveState();
  els.cardSheet.close();
  toast(L("Kart silindi"));
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
// Hareket formundaki varlıklar: ana para birimi, sık kullanılan yabancılar, altın; fon ve hisse yalnızca Türkiye'de
const entryKinds = () => [...V.assetsFor(HOME).map(a => ({ code: a.code, name: L(a.name) })),
  ...(FEAT.markets ? Object.entries(V.MARKETS).map(([code, m]) => ({ code, name: m.name })) : [])];

function openEntrySheet(e, asset, draft) {
  if (!state.people.length) { openPeopleSheet(); toast(L("Önce bir kişi ekle")); return; }
  if (e && e.amount < 0 && !V.market(e.asset) && !V.settled(e, HOME)) {
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
  const kind = m ? m.market : V.MARKETS[code] || V.asset(code) ? code : HOME;
  els.assetChips.replaceChildren(...entryKinds().map(a => radioChip("asset", a.code, a.name, a.code === kind)));
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
  if (!V.tradable(f.asset.value, HOME)) return false;
  return f.dir.value === "sell" || (f.dir.value === "in" && !f.freq?.value);
}

function collectEntry() {
  const f = els.entryForm.elements;
  const mk = entryMarket();
  const sell = !mk && V.tradable(f.asset.value, HOME) && f.dir.value === "sell";   // döviz / altın bozdurma
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
  const fx = !mk && V.tradable(f.asset.value, HOME);   // döviz / altın
  if (!fx && f.dir.value === "sell") f.dir.value = "in";
  const sell = fx && f.dir.value === "sell";
  const out = (mk && f.dir.value === "out") || sell;
  const priced = entryPriced(f);
  els.entryTitle.textContent = mk ? (out ? (editingEntryId ? L("Satışı düzenle") : L("Yeni satış")) : editingEntryId ? L("Alışı düzenle") : L("Yeni alış"))
    : sell ? (editingEntryId ? L("Bozdurmayı düzenle") : L("Bozdur"))
    : editingEntryId ? L("Girişi düzenle") : L("Yeni giriş");
  els.entryInText.textContent = mk ? L("Alış") : L("Giriş");
  els.entryOutText.textContent = mk ? L("Satış") : L("Çıkış");
  els.entrySellOpt.hidden = !fx;
  els.entryTickerField.hidden = !mk;
  els.entryPriceField.hidden = !priced;
  els.entryRepeatField.hidden = !!mk || sell;
  els.entryAmountLabel.textContent = mk ? L("Adet") : L("Miktar");
  els.entryPriceLabel.replaceChildren((mk ? L("Birim fiyat") : f.asset.value === "GAU" ? L("Gram fiyatı") : L("Kur")) + " ",
    el("small", "", mk ? L("(kâr / zarar için)") : `(${homeShort()})`));
  // Bozdurma hep TL'ye eklenir; döviz / altın girişinde işaretsizse gelir
  f.settle.closest("label").hidden = sell;
  els.entrySettleText.textContent = out ? L("Tutar {0} bakiyeme eklensin", homeShort())
    : fx ? L("{0} aldım: tutar {1} bakiyemden düşülsün", homeEk("yle"), homeShort()) : L("Tutar {0} bakiyemden düşülsün", homeShort());
  f.desc.placeholder = mk || (fx && (sell || f.settle.checked)) ? L("İsteğe bağlı not") : L("örn. Maaş, altın alımı");
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
  f.amount.placeholder = mk ? "0" : (0).toLocaleString(D.locale(), { minimumFractionDigits: 2 });

  const n = V.repeatOf(e);
  els.entryDateLabel.textContent = n != null ? L("İlk tarih") : L("Tarih");

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
    const trade = V.tradeValue(e, HOME), now = V.toTry(Math.abs(e.amount), e.asset, r, HOME);
    if (trade != null) {
      const args = [fmt(Math.abs(trade)), unitFmt.format(Math.abs(e.amount)), fmtPrice(e.price, e.asset)];
      box.append(el("div", "", out ? L("Satış tutarı {0} · {1} × {2}", ...args) : L("Alış tutarı {0} · {1} × {2}", ...args)));
    }
    if (now != null && (trade == null || Math.abs(Math.abs(trade) - now) > 0.005)) box.append(el("div", "", L("Güncel fiyatla ≈ {0}", fmt(now))));
    if (!person) return;
    const others = knownEntries().filter(x => x.personId === person.id && x.id !== editingEntryId);
    const before = V.balances(others, today, B.spent(state, today, person.id), HOME);
    const when = e.date > today ? L(" ({0} tarihinde)", fmtDayShort(e.date)) : "";   // tarihi gelmemiş hareket tarihinde işlenir
    const held = before[e.asset] ?? 0, left = V.round(held + e.amount, e.asset);
    box.append(el("div", left < 0 ? "warn" : "", left < 0 ? L("{0} · elinde {1} {2} var", person.name, fmtAsset(held, e.asset), ticker)
      : `${person.name} · ${ticker} ${fmtAsset(held, e.asset)} ${ARROW} ${fmtAsset(left, e.asset)}${when}`));
    if (e.settle) {
      const tl0 = before[HOME] ?? 0, tl1 = V.round(tl0 - V.settled(e, HOME), HOME);
      box.append(el("div", tl1 < 0 ? "warn" : "", L("{0} bakiyesi {1} → {2}", homeShort(), fmtAsset(tl0, HOME), fmtAsset(tl1, HOME)) + when));
    }
    return;
  }
  box.append(el("div", "big", fmtAsset(e.amount, e.asset, true) + (n != null ? " " + R.per(e) : "")));
  if (V.settled(e, HOME)) {
    const args = [fmt(Math.abs(V.tradeValue(e, HOME))), fmtAsset(Math.abs(e.amount), e.asset), fmtPrice(e.price, e.asset)];
    box.append(el("div", "", e.amount < 0 ? L("Bozdurma tutarı {0} · {1} × {2}", ...args) : L("Alış tutarı {0} · {1} × {2}", ...args)));
  } else if (e.asset !== HOME) {
    const value = V.toTry(Math.abs(e.amount), e.asset, r, HOME);
    box.append(el("div", "", value == null ? L("Kur alınamadı — {0} karşılığı sonra hesaplanır", homeShort())
      : `≈ ${fmt(value)} · ${a.code === "GAU" ? L("1 gr") : `1 ${a.symbol}`} = ${fmt(r[e.asset])}`));
  }
  if (n != null && e.date) {
    const done = V.processedCount(e, today), next = V.nextDate(e, today);
    box.append(el("div", "", `${R.label(e)} · ` + (n ? L("{0} kez, son {1}", n, fmtDay(V.lastDate(e))) : L("bitiş tarihi yok"))));
    box.append(el("div", "", [done && L("Bugüne kadar {0} kez işlendi", done), next && (done ? L("sonraki {0}", fmtDay(next)) : L("İlki {0}", fmtDay(next)))]
      .filter(Boolean).join(" · ")));
  }
  if (person && !errors.some(x => x in REPEAT_ERRORS)) {
    const spent = B.spent(state, today, person.id);   // nakit harcamalar ve borç etkileri
    const bals = V.balances(state.entries.filter(x => x.personId === person.id && x.id !== editingEntryId), today, spent, HOME);
    // Tarihi gelmemiş tek seferlik hareket bakiyeye tarihinde girer
    const later = n == null && e.date > today;
    const when = later ? L(" ({0} tarihinde)", fmtDayShort(e.date)) : "";
    const before = bals[e.asset] ?? 0, after = V.round(before + e.amount * (later || !e.date ? 1 : V.processedCount(e, today)), e.asset);
    const name = D.lang === "tr" ? a.name.toLocaleLowerCase("tr-TR") : L(a.name);
    box.append(el("div", after < 0 ? "warn" : "", L("{0} · {1} bakiyesi {2} → {3}", person.name, name, fmtAsset(before, e.asset), fmtAsset(after, e.asset)) + when));
    if (V.settled(e, HOME)) {
      const tl0 = bals[HOME] ?? 0, tl1 = V.round(tl0 - V.settled(e, HOME), HOME);
      box.append(el("div", tl1 < 0 ? "warn" : "", L("{0} bakiyesi {1} → {2}", homeShort(), fmtAsset(tl0, HOME), fmtAsset(tl1, HOME)) + when));
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
      amount: mk ? L("Adedi gir.") : L("Miktarı gir."),
      price: !f.price.value.trim() ? (mk ? L("{0} bakiyesine işlemek için birim fiyatı gir.", homeShort()) : L("Kuru gir.")) : mk ? L("Birim fiyatı doğru yaz.") : L("Kuru doğru yaz."),
      desc: L("Açıklama yaz."), date: L("Tarihi gir."), person: L("Kişi seç."), ...REPEAT_ERRORS,
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
  const what = mk ? (e.amount > 0 ? "buy" : "sell") : e.amount < 0 ? "fx" : V.settled(e, HOME) ? "buy" : "in";
  toast(editingEntryId
    ? { buy: L("Alış güncellendi"), sell: L("Satış güncellendi"), fx: L("Bozdurma güncellendi"), in: L("Giriş güncellendi") }[what]
    : { buy: L("Alış eklendi"), sell: L("Satış eklendi"), fx: L("Bozdurma eklendi"), in: L("Giriş eklendi") }[what]);
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
  toast(V.market(e.asset) ? (e.amount > 0 ? L("Alış silindi") : L("Satış silindi")) : e.amount < 0 ? L("Bozdurma silindi") : L("Giriş silindi"));
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
  return key === today ? L("Bugün") : key === T.addDays(today, -1) ? L("Dün") : fmtDay(key);
}

// draft: { type, party?, asset?, personId? } yeni kaydın başlangıç değerleri
function openDebtSheet(d, draft = {}) {
  if (!state.people.length) { openPeopleSheet(); toast(L("Önce bir kişi ekle")); return; }
  editingDebtId = d?.id ?? null;
  const today = T.todayKey();
  const f = els.debtForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  const type = d ? debtType(d) : ["borrowed", "lent", "loan"].includes(draft.type) ? draft.type : "borrowed";
  const loan = type === "loan";
  const plan = d ? d.kind === "loan" || d.count > 1 : loan;
  const count = d && plan && d.count >= 1 ? d.count : loan ? 12 : 3;
  const code = d?.asset ?? (V.asset(draft.asset) ? draft.asset : HOME);
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

  els.debtAssetChips.replaceChildren(...V.assetsFor(HOME).map(a => radioChip("asset", a.code, L(a.name), a.code === code)));
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
  const paid = x => (debt ? L("{0} ödendi", m(x)) : L("{0} alındı", m(x)));
  els.debtStatusText.textContent = (!st.started ? [L("{0} tarihinde başlar", fmtDay(d.date))]
    : st.closed ? [L("{0} tarihinde kapandı", fmtDay(d.closed)), st.paid > EPS && paid(st.paid)]
    : [st.paid > EPS && paid(st.paid), st.remaining > EPS ? L("kalan {0}", m(st.remaining)) : L("kalan yok"),
       st.overdue > EPS && L("{0} gecikti", m(st.overdue)), st.next && L("sonraki {0}", fmtDayShort(st.next.date))])
    .filter(Boolean).join(" · ");
  // Başlamamış borç kapatılamaz, ödenemez (ödeme borcun tarihinden önce olamaz); tamamı ödenen kendiliğinden kapanmıştır;
  // kapalı ya da tamamı ödenmiş borca ödeme eklenmez (önceki ödemeler düzeltilir, silinir). Kendiliğinden ödenende buradan ara ödeme girilir (satırda Ödendi yok).
  const type = debtType(d);
  const close = { borrowed: L("Borcu kapat"), lent: L("Alacağı kapat"), loan: L("Krediyi kapat") }[type];
  const reopen = { borrowed: L("Borcu yeniden aç"), lent: L("Alacağı yeniden aç"), loan: L("Krediyi yeniden aç") }[type];
  els.debtCloseBtn.hidden = !st.started || (st.done && !st.closed);
  els.debtCloseBtn.textContent = st.closed ? L("Yeniden aç") : close;
  els.debtCloseBtn.setAttribute("aria-label", st.closed ? reopen : close);
  els.debtPayBtn.hidden = !st.started || st.done;
  els.debtPayBtn.textContent = debt ? (st.auto ? L("+ Ara ödeme") : L("+ Ödeme")) : st.auto ? L("+ Ara tahsilat") : L("+ Tahsilat");
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
  const asset = V.asset(f.asset.value) ? f.asset.value : HOME;
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
  return d.count > 1 || d.kind === "loan" ? L("Geçmiş taksitleri olduğu için ödeme şekli değiştirilemez")
    : L("Vadesi geçtiği için ödeme şekli değiştirilemez");
}
function modeChangeText(d) {
  return modeLockText(d) + L(" (vadesiz kayıt elle ödenir). Vadeyi geri gir ya da kaydı kapatıp yenisini ekle.");
}

function updateDebtForm() {
  const { d, errors, type, plan, per, count } = collectDebt();
  const f = els.debtForm.elements;
  const loan = type === "loan", lent = type === "lent";
  const a = V.asset(d.asset);
  const today = T.todayKey();
  const r = curRates();
  const m = x => money(x, d.asset);

  if (!editingDebtId) els.debtTitle.textContent = { borrowed: L("Yeni borç"), lent: L("Yeni alacak"), loan: L("Yeni kredi") }[type];
  else els.debtTitle.textContent = { borrowed: L("Borcu düzenle"), lent: L("Alacağı düzenle"), loan: L("Krediyi düzenle") }[type];
  els.debtUnit.textContent = els.debtPrincipalUnit.textContent = a.symbol;
  f.amount.dataset.amount = f.principal.dataset.amount = a.digits;
  els.debtAmountLabel.textContent = plan && per ? L("Taksit tutarı") : plan ? L("Toplam tutar") : L("Tutar");
  const ask = { borrowed: L("Kimden?"), lent: L("Kime?"), loan: L("Banka") }[type];
  f.party.placeholder = ask;
  f.party.setAttribute("aria-label", ask);
  els.debtMode.hidden = loan;
  els.debtOnce.hidden = plan;
  els.debtPlan.hidden = !plan;
  // Ödeme şekli: taksitte ve vadeli tek seferde; geçmiş taksiti olan kayıtta değiştirilemez (borc.js modeLocked)
  const editing = editingDebtId ? state.debts.find(x => x.id === editingDebtId) : null;
  const locked = !!editing && B.modeLocked(editing, today);
  els.debtAutoRow.hidden = !plan && !d.due;
  els.debtAutoText.textContent = plan ? L("Taksitler tarihinde ödenmiş sayılsın") : L("Vadesinde ödenmiş sayılsın");
  f.autoPay.disabled = locked;
  els.debtAutoNote.hidden = !locked || els.debtAutoRow.hidden;
  els.debtAutoNote.textContent = locked ? `${modeLockText(editing)}.` : "";
  els.debtMovedRow.hidden = loan;
  els.debtPrincipalField.hidden = !loan;
  els.debtMovedText.textContent = lent ? L("Para varlığımdan çıktı") : L("Para varlığıma girdi");
  els.debtPersonRow.hidden = state.people.length < 2;
  for (const b of els.debtDueChips.querySelectorAll("[data-due]")) {
    b.classList.toggle("on", b.dataset.due ? f.due.value === monthLater(d.date || today, Number(b.dataset.due)) : !f.due.value);
  }
  for (const b of els.debtDateChips.querySelectorAll("[data-day]")) b.classList.toggle("on", f.date.value === T.addDays(today, Number(b.dataset.day)));
  renderCountTiles(f, els.debtCountChips, { max: DEBT_MAX_COUNT, code: d.asset, compact: 1e4 });

  // Açılır satırların değerleri
  const mode = loan ? (f.autoPay.checked ? "" : " · " + L("elle")) : f.autoPay.checked && d.due ? " · " + L("otomatik") : "";
  els.debtPlanVal.textContent = (plan ? L("{0} taksit", count > 0 ? count : "?") : d.due ? L("vade {0}", fmtDay(d.due)) : L("Vadesiz")) + mode;
  const moved = loan ? d.principal > 0 : f.moved.checked;
  els.debtEffectVal.textContent = [d.date ? dayText(d.date, today) : L("Tarih yok"),
    !moved ? L("para hareketi yok") : lent ? L("para çıktı") : L("para girdi")].join(" · ");
  els.debtAssetVal.textContent = L(a.name);
  els.debtPersonVal.textContent = personById(d.personId)?.name ?? "";
  els.debtNoteVal.textContent = d.desc ?? "";

  const box = els.debtPreview;
  box.replaceChildren();
  els.debtSum.replaceChildren();
  if (errors.includes("principal")) box.append(el("div", "warn", L("Çekilen tutar geri ödenecek toplamdan büyük olamaz.")));
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
    els.debtSum.append(el("strong", "", `${items.length} × ${m(first.amount)}`), el("span", "", L("toplam {0} · ilk {1}", m(d.amount), fmtDayShort(first.key))));
    box.append(el("div", "debt-plan-text", `${items.length} × ${m(first.amount)} · ` + L("ilk {0}, son {1}", fmtDayShort(first.key), sameYear ? fmtDayShort(last.key) : fmtDay(last.key))));
  } else {
    els.debtSum.append(el("strong", "", m(d.amount)), el("span", "", first ? L("vade {0}", fmtDay(first.key)) : L("vadesiz")));
  }
  if (loan && d.principal > 0) {
    const rate = B.loanRate(d);
    box.append(el("div", "", L("Toplam {0} · faiz ve masraf {1}", m(d.amount), m(d.amount - d.principal))
      + (rate != null ? L(" (aylık ≈ {0})", D.pct((rate * 100).toLocaleString(D.locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }))) : "")));
  }
  // Kredide (otomatik ya da elle) ve kendiliğinden ödenen borçta kayıt tarihinden önceki taksitler ödenmiş sayılır
  const before = auto || loan ? items.filter(x => x.key < d.date) : [];
  if (before.length) box.append(el("div", "", L("İlk {0} taksit {1} öncesinde ödenmiş sayılır", before.length, fmtDay(d.date))));
  if (auto) {
    const past = items.filter(x => x.key >= d.date && x.key < today);
    if (past.length) {
      const sum = past.reduce((s, x) => s + x.amount, 0);
      box.append(el("div", "warn", lent ? L("Geçmiş {0} taksit ({1}) varlığına eklenir", past.length, m(sum))
        : L("Geçmiş {0} taksit ({1}) varlığından düşer", past.length, m(sum))));
    }
    box.append(el("div", "", items.length > 1 ? L("Taksitler tarihinin ertesi günü ödenmiş sayılır") : L("Vadesinin ertesi günü ödenmiş sayılır")));
  } else {
    // Elle: yeni kayıtta günü geçmiş taksitler gecikmiş görünür
    const late = !editingDebtId && d.date <= today ? items.filter(x => x.key < today && !(loan && x.key < d.date)) : [];
    if (late.length) {
      const sum = late.reduce((s, x) => s + x.amount, 0);
      box.append(el("div", "warn", items.length > 1
        ? (lent ? L("Geçmiş {0} taksit ({1}) gecikmiş görünür; aldıysan Ödendi ile ekle", late.length, m(sum))
          : L("Geçmiş {0} taksit ({1}) gecikmiş görünür; ödediysen Ödendi ile ekle", late.length, m(sum)))
        : lent ? L("Vadesi geçti: {0} gecikmiş görünür; aldıysan Ödendi ile ekle", m(sum))
        : L("Vadesi geçti: {0} gecikmiş görünür; ödediysen Ödendi ile ekle", m(sum))));
    }
    box.append(el("div", "", lent ? L("Geri aldıkça Ödendi'ye dokun; kısmen de olur")
      : loan ? L("Taksitleri ödedikçe Ödendi'ye dokun; günü geçen taksit gecikmiş görünür") : L("Geri ödedikçe Ödendi'ye dokun; kısmen de olur")));
  }
  if (d.date > today) box.append(el("div", "", L("{0} tarihinde başlar; o güne kadar toplama girmez", fmtDay(d.date))));

  // Kaydedilince: kişinin bu varlıktaki bakiyesi ve toplam borç / alacak (bu kayıt yeni hâliyle)
  const id = editingDebtId ?? "yeni";
  const after = { ...state, debts: [...state.debts.filter(x => x.id !== id), { id, ...d }] };
  const person = personById(d.personId);
  if (person) {
    const entries = knownEntries().filter(e => e.personId === person.id);
    const bal = s => V.balances(entries, today, B.spent(s, today, person.id), HOME)[d.asset] ?? 0;
    const b0 = bal(state), b1 = bal(after);
    const name = a.code === HOME ? homeShort() : D.lang === "tr" ? a.name.toLocaleLowerCase("tr-TR") : L(a.name);
    box.append(Math.abs(b1 - b0) > EPS
      ? el("div", b1 < 0 ? "warn" : "", L("{0} · {1} bakiyesi {2} → {3}", person.name, name, fmtAsset(b0, d.asset), fmtAsset(b1, d.asset)))
      : el("div", "", L("{0} · {1} bakiyesi değişmez ({2})", person.name, name, fmtAsset(b0, d.asset))));
  }
  const t0 = B.totals(state, today, r), t1 = B.totals(after, today, r);
  if (t1.missing.includes(d.asset)) box.append(el("div", "", L("Kur alınamadı — {0} karşılığı sonra hesaplanır", homeShort())));
  else if (lent) box.append(el("div", "", L("Toplam alacak {0} → {1}", fmt(t0.receivable.total), fmt(t1.receivable.total))));
  else box.append(el("div", "", L("Toplam borç {0} → {1}", fmt(t0.debt.total), fmt(t1.debt.total))));

  // Ödeme planı: ödenmiş sayılanlar çizili
  if (items.length > 1) {
    const st = B.status({ id, ...d }, editingDebtId ? debtPayments(id) : [], today);
    const details = el("details", "plan");
    details.open = debtPlanOpen;
    details.addEventListener("toggle", () => { debtPlanOpen = details.open; });
    details.append(el("summary", "", L("Ödeme planı ({0} taksit)", items.length)));
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
    const msg = { amount: L("Tutarı gir."), party: type === "lent" ? L("Kime verdiğini yaz.") : L("Kimden aldığını yaz."),
      count: L("Taksit sayısı 1–{0} arası olmalı.", DEBT_MAX_COUNT), first: L("İlk taksitin tarihini gir."), date: L("Tarihi gir."),
      principal: L("Çekilen tutar geri ödenecek toplamdan büyük olamaz."), person: L("Kişi seç."),
      early: type === "loan" ? L("Çekilen tutar ancak ilk taksitten önceki bir günde girilir. Eski krediyse boş bırak.")
        : f.mode.value === "plan" ? L("İlk taksit bu tarihten önce: para girişi kapatılmalı ya da tarih ilk taksitten önceye alınmalı.")
        : L("Vade bu tarihten önce: para girişi kapatılmalı ya da tarih vadeden önceye alınmalı.") }[errors[0]];
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
    els.debtPreview.replaceChildren(el("div", "warn", L("Tarih, kapandığı günden ({0}) sonra olamaz.", fmtDay(d.closed))));
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
  const done = closed ? "closed" : closed === null ? "reopened" : editingDebtId ? "updated" : "added";
  toast({
    borrowed: { closed: L("Borç kapatıldı"), reopened: L("Borç yeniden açıldı"), updated: L("Borç güncellendi"), added: L("Borç eklendi") },
    lent: { closed: L("Alacak kapatıldı"), reopened: L("Alacak yeniden açıldı"), updated: L("Alacak güncellendi"), added: L("Alacak eklendi") },
    loan: { closed: L("Kredi kapatıldı"), reopened: L("Kredi yeniden açıldı"), updated: L("Kredi güncellendi"), added: L("Kredi eklendi") },
  }[type][done]);
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
  if (!d.closed && st.remaining > EPS && !confirm(L("Kalan {0} silinip kapatılsın mı?", money(st.remaining, x.asset)))) return;
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
  toast({ borrowed: L("Borç silindi"), lent: L("Alacak silindi"), loan: L("Kredi silindi") }[debtType(d)]);
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

// Ada Türkçe ek (nameWith: Ali'ye, Ali'den, Ali'nin); İngilizcede ek yok, ad olduğu gibi (cümle anahtarın çevirisinde kurulur)
function adEk(name, kind) { return D.lang === "tr" ? nameWith(name, kind) : String(name ?? "").trim() || "?"; }

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
      chips.push([L("Bir taksit"), Math.min(one, st.remaining)], [L("Kalanın tümü"), st.remaining]);
      prefill = 0;
    } else {
      const openOf = x => x.amount - x.covered;
      const cur = st.count > 1 ? st.items.find(x => x.state !== "paid") : null;
      const dueNow = st.items.filter(x => x.state === "late" || x.state === "due").reduce((s, x) => s + openOf(x), 0);
      if (cur) chips.push([L("Bu taksit"), openOf(cur)]);
      if (dueNow > EPS) chips.push([L("Günü gelen"), dueNow]);
      chips.push([L("Kalanın tümü"), st.remaining]);
      prefill = dueNow > EPS ? dueNow : cur ? openOf(cur) : st.remaining;
    }
    return {
      d, st, code: d.asset, owner: d.personId, remaining: st.remaining, prefill, min: d.date,
      pay: { personId: d.personId, debtId: d.id }, chips: payChipList(chips),
      title: st.auto ? (debt ? L("{0} · ara ödeme", name) : L("{0} · ara tahsilat", name))
        : debt ? L("{0} ödeme", adEk(name, "e")) : L("{0} tahsilat", adEk(name, "den")),
      done: x => (d.kind === "loan" ? L("{0} ödemesi eklendi · {1}", name, money(x, d.asset))
        : debt ? L("{0} {1} ödendi", adEk(name, "e"), money(x, d.asset)) : L("{0} {1} alındı", adEk(name, "den"), money(x, d.asset))),
      pays: debtPayments(d.id),
    };
  }
  const person = personById(target?.personId);
  if (!person || person.id === base.people[0]?.id) return null;
  const s = B.shares(base, today).get(person.id);
  const remaining = s?.remaining ?? 0, dueNow = s?.dueNow ?? 0;
  return {
    person, code: HOME, owner: base.people[0].id, remaining, min: "", pay: { personId: person.id },
    prefill: dueNow > EPS ? dueNow : Math.max(remaining, 0),
    chips: payChipList([[L("Günü gelen"), dueNow], [L("Kalanın tümü"), remaining]]),
    title: L("{0} kart payı ödemesi", adEk(person.name, "den")),
    done: x => L("{0} {1} alındı", adEk(person.name, "den"), fmt(x)),
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
  const names = others.length > 1 ? L("{0} ve {1}", others.slice(0, -1).join(", "), others[others.length - 1]) : others[0];
  return {
    card: c, cd, code: HOME, owner: payer.id, remaining: cd.total, min: cd.manualFrom ?? "",
    pay: { personId: payer.id, cardId: c.id },
    prefill: owed,
    chips: payChipList([[cur ? L("Ekstre · son ödeme {0}", fmtDayShort(cur.key)) : L("Ekstre"), cur ? openOf(cur) : 0], [L("Günü gelen"), cd.unpaid]]),
    due: cur && cur.key <= today ? cur.key : null,
    note: cur && list.some(x => x.key < cur.key) ? L("Bu ödeme önce daha eski ödenmemiş ekstrelere sayılır, kalanı bu ekstreye.") : "",
    hint: names ? L("Buraya yalnızca karta (bankaya) yaptığın ödemeyi gir. {0} sana ödeme yaptıysa onu Borçlar > Alacaklarım'da “Ödendi” ile kaydet.", names) : "",
    title: L("{0} ekstresi", c.name),
    done: x => (owed <= EPS ? L("{0} kaydedildi · {1} kartının sonraki ekstresine sayılır", fmt(x), c.name)
      : x + EPS < owed ? L("{0} ekstresi kısmen ödendi · kalan {1}", c.name, fmt(owed - x))
      : L("{0} ekstresi ödendi ✓", c.name) + (x > owed + EPS ? " " + L("· fazlası {0} sonraki ekstreye sayılır", fmt(x - owed)) : "")),
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
    toast(info.st.closed ? L("Kapanmış kayda ödeme eklenmez; önce yeniden aç") : info.st.done ? L("Kalan yok") : L("Henüz başlamadı"));
    return;
  }
  const f = els.payForm;
  f.reset();
  for (const n of f.querySelectorAll(".invalid")) n.classList.remove("invalid");
  const a = V.asset(info.code);
  els.payTitle.textContent = payment ? L("Ödemeyi düzenle") : info.title;
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
    del.setAttribute("aria-label", L("{0} ödemesini sil", fmtDay(x.date)));
    del.append(el("span", "", L("Sil")));
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
      toast(reopen ? L("Ödeme silindi · kayıt yeniden açıldı") : L("Ödeme silindi"));
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
  els.payDueChip.textContent = due ? L("Son ödeme günü · {0}", fmtDayShort(due)) : L("Son ödeme günü");
  els.payDueChip.classList.toggle("on", !!due && date === due);
  els.payHint.textContent = [info.note, info.hint].filter(Boolean).join(" ");
  els.payStatus.textContent = info.cd ? cardPayStatus(info.cd, today).join("\n")
    : info.person ? (info.remaining < -EPS ? L("Sana {0} fazla ödedi", m(-info.remaining)) : L("Sana borcu: {0}", m(Math.max(info.remaining, 0))))
    : [info.remaining < -EPS ? L("{0} fazla ödendi", m(-info.remaining)) : L("kalan {0}", m(Math.max(info.remaining, 0))),
      info.st?.overdue > EPS && L("{0} gecikti", m(info.st.overdue)), info.st?.next && L("sonraki {0}", fmtDayShort(info.st.next.date))]
      .filter(Boolean).join(" · ");
  if (!(amount > 0) || !T.parseDate(date)) return;
  if (date > today) { box.append(el("div", "warn", L("Ödeme tarihi bugünden sonra olamaz."))); return; }
  if (!payDateOk(info, date)) { box.append(el("div", "warn", payMinText(info))); return; }

  // Kaydedilince: kalan (kartta ödenmemiş ekstreler ya da kart borcu) ve sahibinin bakiyesi
  const x = { id: editingPayId ?? "yeni", kind: "payment", ...info.pay, amount, date };
  const after = { ...base, debts: [...base.debts, x] };
  const next = payInfo(payTarget, today, after);
  const left = next.remaining;
  // Kapanmış borcun ödemesi düzenlenirken kalan yoktur (kapanınca silindi): kalan ve fazla yazılmaz
  const closed = !!info.st?.closed;
  if (info.cd && info.cd.unpaid > EPS) {
    box.append(el("div", "", L("Ödenmemiş ekstre {0} → {1}", m(info.cd.unpaid), m(next.cd.unpaid))));
    // Ödenmemişi aşan kısım sonraki ekstreleri önceden kapatır (kart borcunu da aşarsa aşağıda uyarı)
    const ahead = Math.min(amount, Math.max(info.remaining, 0)) - info.cd.unpaid;
    if (ahead > EPS) box.append(el("div", "", L("Fazlası {0} sonraki ekstreye sayılır.", m(ahead))));
  } else if (!closed) {
    box.append(el("div", "", `${info.cd ? L("Kart borcu") : info.person ? L("Sana borcu") : L("Kalan")} ${m(Math.max(info.remaining, 0))} ${ARROW} ${m(Math.max(left, 0))}`));
  }
  const owner = personById(info.owner);
  if (owner) {
    const entries = knownEntries().filter(e => e.personId === owner.id);
    const bal = s => V.balances(entries, today, B.spent(s, today, owner.id), HOME)[info.code] ?? 0;
    const a = V.asset(info.code);
    // İlk kişi (kullanıcı) için ikinci tekil: "TL bakiyen"; başkasına ait borçta adıyla
    const short = a.code === HOME ? homeShort() : L(a.name);
    const unit = a.code === HOME ? homeShort() : lowerName(a.name);
    box.append(el("div", "", (owner.id === state.people[0]?.id ? L("{0} bakiyen", short) : L("{0} {1} bakiyesi", adEk(owner.name, "in"), unit))
      + ` ${fmtAsset(bal(base), info.code)} ${ARROW} ${fmtAsset(bal(after), info.code)}`));
  }
  const over = info.d || info.cd ? amount - Math.max(info.remaining, 0) : -left;
  if (over > EPS && !closed) {
    box.append(el("div", "warn", info.cd ? L("Kartın tüm borcundan {0} fazla; fazlası sonraki ekstrelerden düşülür.", m(over))
      : info.person ? L("{0} sana kalan borcundan {1} fazla; bu kadarını ona borçlu görünürsün.", adEk(info.person.name, "in"), m(over))
      : L("Kalan borçtan {0} fazla.", m(over))));
  }
}

// Ödeme en erken günden (info.min) önce olamaz: kartta "Ben işaretlerim"in başladığı gün, borçta kaydın başladığı gün
function payMinText(info) {
  return info.cd ? L("Bu kartta ekstreleri {0} tarihinden beri sen işaretliyorsun; ödeme tarihi bundan önce olamaz.", fmtDay(info.min))
    : L("Ödeme, kaydın başladığı {0} gününden önce olamaz.", fmtDay(info.min));
}

els.payForm.addEventListener("input", e => {
  e.target.classList?.remove("invalid");
  updatePayForm();
});

els.payChips.addEventListener("click", e => {
  const b = e.target.closest("[data-amount]");
  if (!b) return;
  const f = els.payForm.elements;
  const code = payInfo(payTarget, T.todayKey(), payBase())?.code ?? HOME;
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
    els.payPreview.replaceChildren(el("div", "warn", bad === "amount" ? L("Tutarı gir.")
      : !date ? L("Tarihi gir.") : date > today ? L("Ödeme tarihi bugünden sonra olamaz.") : payMinText(info)));
    f[bad].focus();
    return;
  }
  const desc = f.desc.value.trim();
  const x = { id: editingPayId ?? uid(), kind: "payment", ...info.pay, amount, date, ...(desc && { desc }) };
  if (editingPayId) state.debts = state.debts.map(y => (y.id === editingPayId ? x : y));
  else state.debts.push(x);
  saveState();
  els.paySheet.close();
  toast(editingPayId ? L("Ödeme güncellendi") : info.done(amount));
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
    remaining < -EPS ? stat(L("Sana fazla ödedi"), fmt(-remaining), "out-text") : stat(L("Sana borcu"), fmt(remaining), remaining > EPS ? "in-text" : ""),
    stat(L("Günü gelen"), fmt(s?.dueNow ?? 0)),
    stat(s?.next ? L("Sonraki · {0}", fmtDayShort(s.next.date)) : L("Sonraki"), s?.next ? fmt(s.next.amount) : "—"));

  const items = B.shareItems(state, sharePid, today);
  els.shareItems.replaceChildren(...(items.length ? items.map(x => shareItemRow(x, today)) : [el("li", "empty", L("Hesaba katılan kartlarında harcaması yok"))]));
  const pays = [...sharePayments(sharePid)].reverse();
  els.sharePaysBox.hidden = !pays.length;
  els.sharePays.replaceChildren(...pays.map(x => payHistRow(x, HOME, () => {
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
  main.append(title, el("div", "pay-sub", `${cardName(x.cardId)} · ${plan > 1 ? L("{0}/{1}. taksit", x.no, plan) : L("peşin")}`));
  const side = el("div", "share-amt");
  side.append(el("span", "amount", fmt(x.amount)), paid ? el("small", "in-text", L("ödendi ✓"))
    : x.covered > EPS ? el("small", "", L("{0} ödendi", fmt(x.covered)))
    : el("small", "", x.key < today ? L("{0} gün gecikti", lateDays(x.key, today)) : x.key === today ? L("günü bugün")
      : relDays(x.key, today).toLocaleLowerCase(D.locale())));
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
  const full = locked() && state.people.length >= FREE_PEOPLE;
  els.personAddForm.hidden = full;
  els.peopleLock.hidden = !full;
  if (full) els.peopleLock.replaceChildren(premiumLock(L("Kişiler"), L("Ücretsiz sürüm: {0} kart, yalnızca sen. Premium'da yapay zekâ asistanı (Claude, ChatGPT), sınırsız kart ve kişi, Akış, Alabilir miyim?, içgörüler ve Varlığın seyri.", FREE_CARDS), "people"));
  els.peopleEdit.replaceChildren();
  for (const p of state.people) {
    const n = state.installments.filter(i => i.personId === p.id).length;
    const m = state.entries.filter(x => x.personId === p.id).length;
    const k = state.debts.filter(x => x.personId === p.id && x.kind !== "payment").length;
    const li = el("li");
    const input = document.createElement("input");
    input.type = "text";
    input.value = p.name;
    input.setAttribute("aria-label", L("{0} adı", p.name));
    input.addEventListener("change", () => {
      const name = input.value.trim();
      const clash = state.people.some(x => x.id !== p.id && T.normalize(x.name) === T.normalize(name));
      if (!name || clash) { input.value = p.name; if (clash) toast(L("Bu adda bir kişi var")); return; }
      p.name = name;
      saveState(); render(); toast(L("Ad güncellendi"));
    });
    const del = el("button", "icon-btn");
    del.type = "button";
    del.setAttribute("aria-label", L("{0} sil", p.name));
    del.append(icon("x"));
    del.addEventListener("click", () => {
      if (state.people.length === 1) { toast(L("En az bir kişi olmalı")); return; }
      // Borçları ödemeleriyle gider; kart payı ödemeleri ilk kişinin varlığına girdiğinden, kart ekstresi ödemeleri onun
      // varlığından çıktığından ilk kişi silinirse hepsi gider (borcu ve kartı olmayan ödeme kart payı ödemesidir)
      const first = state.people[0].id === p.id;
      const gone = new Set(state.debts.filter(x => x.personId === p.id && x.kind !== "payment").map(x => x.id));
      const drop = x => x.personId === p.id || gone.has(x.debtId) || (first && x.kind === "payment" && !x.debtId);
      const loose = state.debts.filter(x => drop(x) && x.kind === "payment" && !x.debtId);
      const settled = loose.filter(x => !x.cardId).length, cardPaid = loose.length - settled;
      const owned = [n && L("{0} harcaması", n), m && L("{0} varlık hareketi", m), k && L("{0} borç/alacak kaydı", k), settled && L("kartındaki harcamalar için {0} ödemesi", settled),
        cardPaid && L("{0} kart ödemesi", cardPaid)].filter(Boolean);
      const list = owned.length > 1 ? L("{0} ve {1}", owned.slice(0, -1).join(", "), owned[owned.length - 1]) : owned[0];
      if (!confirm(list ? L("“{0}” ve {1} silinsin mi?", p.name, list) : L("“{0}” silinsin mi?", p.name))) return;
      state.people = state.people.filter(x => x.id !== p.id);
      state.installments = state.installments.filter(i => i.personId !== p.id);
      state.entries = state.entries.filter(x => x.personId !== p.id);
      state.debts = state.debts.filter(x => !drop(x));
      saveState(); renderPeopleSheet(); render();
    });
    li.append(avatar(p), input, del, el("span", "sub", [n && L("{0} harcama", n), m && L("{0} hareket", m), k && L("{0} borç", k)].filter(Boolean).join(" · ") || L("kayıt yok")));
    els.peopleEdit.append(li);
  }
}

els.personAddForm.addEventListener("submit", e => {
  e.preventDefault();
  const input = els.personAddForm.elements.name;
  const name = input.value.trim();
  if (!name) return;
  if (state.people.some(p => T.normalize(p.name) === T.normalize(name))) { toast(L("Bu adda bir kişi var")); return; }
  if (locked() && state.people.length >= FREE_PEOPLE) { renderPeopleSheet(); return; }
  state.people.push({ id: uid(), name, color: nextColor(state.people) });
  input.value = "";
  saveState(); renderPeopleSheet(); render();
  toast(L("{0} eklendi", name));
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
  if (inboxBusy || typeof window.syncInboxFetch !== "function" || !FEAT.bankEmails) return;   // yalnızca Türkiye'de
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
      meta.append(el("span", "", parsed.currency === HOME ? fmt(parsed.amount) : `${fmtNum(parsed.amount)} ${parsed.currency}`));
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

// Desteklenen bankalar eposta.js'ten (BANKS): tutar, tarih, son 4 hane ve işyeri okunanlar
function inboxBanksText() {
  return `Şimdilik desteklenen bankalar: ${E.BANKS.join(", ")}. Diğer bankaların e-postaları da okunmaya çalışılır; `
    + "okunamayan Harcamalar'da onaya düşer. Aşağıdaki Bir e-postayı dene ile bankanın e-postasını deneyebilirsin.";
}

async function openInboxSheet() {
  els.inboxBanks.textContent = inboxBanksText();
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
    el("div", "big", parsed.amount != null ? (parsed.currency === HOME ? fmt(parsed.amount) : `${fmtNum(parsed.amount)} ${parsed.currency}`) : "Tutar okunamadı"),
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
    toast(L("Kopyalandı"));
  } catch { toast(L("Kopyalanamadı")); }
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
      toast([done && L("{0} harcama kategorilere ayrıldı", done), skipped && L("{0} harcamada emin olamadım", skipped)].filter(Boolean).join(" · "));
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
    if (b.dataset.mode === "local") { b.disabled = !local; b.title = local ? "" : L("Bu tarayıcıda çalışmıyor"); }
  }
  els.aiProgress.hidden = true;
  els.aiBackfill.hidden = true;
  const show = (title, sub) => { els.aiLocalTitle.textContent = title; els.aiLocalSub.textContent = sub; };
  const unsureNote = left ? " " + L("{0} harcamada emin olamadı; kategorisini Harcamalar'dan seçebilirsin.", left) : "";

  if (mode === "off") {
    show(L("Kapalı"), L("Yalnızca daha önce seçtiğin kategoriler aynı işyerlerine verilir."));
    return;
  }
  if (mode === "cloud") {
    if (!window.syncGetUser?.()) {
      show(L("Bulut · giriş gerekli"), L("Giriş yapınca çalışır. Girişsiz kullanımda Cihazda seçeneğini kullanabilirsin."));
      return;
    }
    show(L("Bulut · açık"), L("Harcama açıklamaların CashFollow sunucusunda (Cloudflare) büyük bir dil modeliyle sınıflandırılır, saklanmaz. İndirme gerekmez.")
      + unsureNote);
  } else if (i.status === "loading") {
    show(i.total && i.loaded < i.total ? L("Cihazda · indiriliyor…") : L("Cihazda · yükleniyor…"),
      i.total ? `${mb(i.loaded)} / ${mb(i.total)} MB` : L("Hazırlanıyor"));
    els.aiProgress.hidden = !i.total;
    els.aiProgress.firstElementChild.style.width = `${i.total ? Math.min(100, (i.loaded / i.total) * 100) : 0}%`;
  } else if (i.status === "error") {
    show(L("Cihazda · açılamadı"), L("{0} — Bulut'a geçebilir ya da yeniden seçebilirsin.", i.error));
  } else {
    show(L("Cihazda · açık"), L("Model bu cihazda (~{0} MB), internetsiz çalışır; veri cihazdan çıkmaz.", YZ.SIZE_MB) + " "
      + (i.status === "ready" ? L("Hazır.") : L("Gerektiğinde yüklenir.")) + unsureNote);
  }
  if (loose && YZ.enabled) {
    els.aiBackfill.hidden = false;
    els.aiBackfill.disabled = backfillBusy;
    els.aiBackfill.textContent = backfillBusy ? L("Ayrılıyor… {0} kaldı", loose) : L("{0} kategorisiz harcamayı ayır", loose);
  }
}

YZ.onChange(() => { if (els.aiSheet.open) renderAiStatus(); });

els.aiModeSeg.addEventListener("click", async e => {
  const next = e.target.closest("button")?.dataset.mode;
  if (!next || next === YZ.mode) return;
  if (YZ.mode === "local" && !confirm(L("Cihaza indirilen model silinsin mi? Verilen kategoriler kalır."))) return;
  if (next === "local" && !confirm(L("Model bu cihaza indirilecek (yaklaşık {0} MB). Wi-Fi önerilir. Devam edelim mi?", YZ.SIZE_MB))) return;
  unsure.clear();
  const pending = YZ.setMode(next);
  renderAiStatus();
  const ok = await pending;
  renderAiStatus();
  render();
  if (next === "local") toast(ok ? L("Cihazdaki model hazır") : L("Model yüklenemedi"));
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
    note: L("Claude'da açılan pencerede adres hazır: Ekle'ye dokun, sonra CashFollow sayfasında giriş yapıp İzin ver'e dokun."),
  },
  chatgpt: {
    url: () => "https://chatgpt.com/plugins",
    copy: true,
    note: L("Adres kopyalandı. ChatGPT'de + → Add custom MCP server: ad olarak CashFollow yaz, adresi yapıştır, kimlik doğrulamada OAuth seç ve Create as a plugin'e dokun. Sonra CashFollow sayfasında İzin ver."),
  },
  gemini: {
    url: () => "https://gemini.google.com/apps",
    copy: true,
    note: L("Adres kopyalandı. Gemini'de Custom apps → Add a custom app: adresi yapıştır, Next'e dokun, sonra CashFollow sayfasında İzin ver. Gemini'de özel uygulamalar şimdilik ABD'de, kişisel Google hesabıyla ve İngilizce arayüzde açık."),
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
      els.aiAddNote.textContent = note.replace(L("Adres kopyalandı."), L("Adres kopyalanamadı, elle kopyala: {0}", mcp));
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
  els.aiPremiumNote.hidden = true;
  els.aiAppsGroup.hidden = true;
  openSheet(els.aiSheet);
  if (loggedIn) {
    // Asistan Premium ister (mcp/server.js); ilk kullanıcılar Premium'dur, bu not yalnızca yeni hesaplara çıkar
    window.syncPremium?.().then(p => { els.aiPremiumNote.hidden = p !== false; });
    await renderAiApps();
  }
}

async function renderAiApps() {
  const grants = await window.syncOAuthGrants?.();
  els.aiApps.replaceChildren();
  els.aiAppsGroup.hidden = !grants;
  if (!grants) return;
  if (!grants.length) { els.aiApps.append(el("li", "hint", L("Henüz bağlı uygulama yok"))); return; }
  for (const g of grants) {
    const li = el("li");
    const info = el("span", "row-text");
    info.append(el("strong", "", g.client?.name || L("Uygulama")), el("small", "", L("{0} tarihinden beri", fmtDay(g.granted_at.slice(0, 10)))));
    const del = el("button", "btn btn-ghost sm", L("Kaldır"));
    del.type = "button";
    del.addEventListener("click", async () => {
      if (!confirm(L("“{0}” artık CashFollow verilerine erişemesin mi?", g.client?.name || L("Uygulama")))) return;
      del.disabled = true;
      try {
        await window.syncOAuthRevoke(g.client.id);
        toast(L("Erişim kaldırıldı"));
      } catch { toast(L("Kaldırılamadı")); }
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

// Ülke adı: İngilizcede tarayıcının verdiği ad (Intl.DisplayNames; iPhone'da Bicim.ulkeAdi gibi), Türkçede para.js'teki ad
const regionNames = D.lang !== "tr" && typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames([D.locale()], { type: "region" }) : null;
function countryName(c) {
  try { return regionNames?.of(c.code) || c.name; } catch { return c.name; }
}

// Ülke seçimi: "Almanya · Euro"; İngilizcede "Germany · EUR" (iPhone gibi para biriminin kodu), ada göre sıralı
function fillCountries(select, selected) {
  const list = D.lang === "tr" ? P.COUNTRIES
    : [...P.COUNTRIES].sort((a, b) => countryName(a).localeCompare(countryName(b), D.locale()));
  select.replaceChildren(...list.map(c => {
    const cur = D.lang === "tr" ? P.currency(c.currency)?.short ?? c.currency : c.currency;
    const o = el("option", "", `${countryName(c)} · ${cur}`);
    o.value = c.code;
    return o;
  }));
  select.value = selected;
}
fillCountries(els.countrySelect, currentCountry());
fillCountries(els.authCountry, guessCountry());
els.countrySelect.addEventListener("change", async () => {
  const code = els.countrySelect.value;
  try {
    await setCountry(code);
    toast(L("Ülke: {0} · {1}", countryName(P.country(code)), homeShort()));
  } catch (err) {
    els.countrySelect.value = currentCountry();
    toast(L("Ülke değiştirilemedi: {0}", err?.message || err));
  }
});
window.setCountry = setCountry;

els.settingsBtn.addEventListener("click", () => {
  els.countrySelect.value = currentCountry();
  renderThemeSeg();
  els.cashDefText.textContent = cashDefText().replace(/^./, c => c.toLocaleUpperCase(D.locale()));
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
    opt(HOME, V.asset(HOME) ? L(V.asset(HOME).name) : HOME, L("Ana para birimi")),
    ...(FEAT.markets ? [opt(V.MMF, L("TL para piyasası fonları"), funds.length ? L("Elindekiler: {0}", funds.map(c => V.market(c).ticker).join(", "))
      : L("TEFAS'taki para piyasası fonları; aynı gün nakde döner (T+0)"))] : []),
    ...V.assetsFor(HOME).filter(a => a.code !== HOME).map(a => opt(a.code, L(a.name))),
    ...(others.length ? [el("span", "group-label cash-def-head", L("Elindeki diğer fon ve hisseler"))] : []),
    ...others.map(c => opt(c, V.market(c).ticker, marketName(c))),
  );
}

function setCashDef(list) {
  cashDef = V.cashDef(list, HOME);
  const same = cashDef.length === V.cashDefault(HOME).length && V.cashDefault(HOME).every(c => cashDef.includes(c));
  writePref(PREF.cashDef, same ? "" : JSON.stringify(cashDef));
  render();
}

els.cashDefList.addEventListener("change", e => {
  const picked = [...els.cashDefList.querySelectorAll("input:checked")].map(x => x.value);
  if (!picked.length) { e.target.checked = true; toast(L("En az birini seç")); return; }
  setCashDef(picked);
});
els.cashDefReset.addEventListener("click", () => { setCashDef(null); renderCashDef(); toast(L("Nakit: {0}", cashDefText())); });
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
      if (!confirm(L("Mevcut verilerin üzerine yazılacak. Devam edelim mi?"))) return;
      state = hydrate(data);
    }
    ensureCardTracking();
    resetView();
    saveState();
    render();
    toast(L("İçe aktarıldı"));
  } catch (err) {
    alert(err.userMessage || (isExcel ? "Excel dosyası okunamadı." : L("Geçersiz dosya.")));
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
    const people = s.people.filter(p => !(p.id === "ben" && (p.name === "Ben" || p.name === L("Ben"))));
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
  const people = local.people.filter(p => !(p.id === "ben" && (p.name === "Ben" || p.name === L("Ben")))).length;
  els.moveSummary.textContent = [[local.installments.length, n => L("{0} harcama", n)], [local.cards.length, n => L("{0} kart", n)],
    [local.entries.length, n => L("{0} varlık hareketi", n)], [local.debts.filter(x => x.kind !== "payment").length, n => L("{0} borç/alacak kaydı", n)],
    [local.debts.filter(x => x.kind === "payment").length, n => L("{0} ödeme", n)], [people, n => L("{0} kişi", n)]]
    .filter(([n]) => n).map(([n, w]) => w(n)).join(", ");
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
    els.moveMsg.textContent = "⚠ " + L("Hesabındaki veriler alınamadı. İnternet bağlantını kontrol edip yeniden dene.");
    els.moveMsg.style.color = "var(--expense)";
    return;
  }
  const local = offlineData();
  if (local) state = hydrate(window.Tablo.combine(state, local));
  localStorage.removeItem(STORAGE_KEY_BASE);
  els.moveModal.hidden = true;
  saveState();
  render();
  toast(L("Veriler hesabına taşındı"));
  await window.syncPushNow?.();
});

els.moveDropBtn.addEventListener("click", () => {
  if (!confirm(L("Bu cihaza girdiğin veriler silinecek. Devam edelim mi?"))) return;
  localStorage.removeItem(STORAGE_KEY_BASE);
  els.moveModal.hidden = true;
  toast(L("Cihazdaki veriler silindi"));
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

  const newPeople = result.people.filter(p => !state.people.some(x => T.normalize(x.name) === T.normalize(p.name))).length;
  if (locked() && newPeople && state.people.length + newPeople > FREE_PEOPLE) {
    throw Object.assign(new Error("premium"), { userMessage: L("Excel'deki her sayfa bir kişi. Ücretsiz sürümde yalnızca sen varsın; başka kişiler için CashFollow Premium gerekir (iPhone uygulamasından alınır).") });
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
    window.Analitik?.event("tab_viewed", { tab: view });
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

// ---------- Ülke ve ana para birimi ----------
// Girişsizken cihazdaki seçim, yoksa Türkiye (var olan girişsiz veri TL'dir; tarayıcının dili yalnızca kayıt formunda ön
// seçimdir: guessCountry). Girişliyken hesabın ülkesi; hesap bilgisi gelene kadar bu cihazda son görülen.
function currentCountry() {
  const uid = window.CF_USER_ID;
  if (uid) {
    const meta = P.country(window.syncGetUser?.()?.user_metadata?.country)?.code;
    if (meta) { writePref(`${PREF.country}.${uid}`, meta); return meta; }
    return P.country(readPref(`${PREF.country}.${uid}`))?.code ?? P.DEFAULT_COUNTRY;
  }
  return P.country(readPref(PREF.country))?.code ?? P.DEFAULT_COUNTRY;
}

// Kayıt formunda ön seçim: tarayıcının bölgesi ("de-DE" → Almanya), yoksa Türkiye
function guessCountry() {
  const region = (navigator.languages?.[0] || navigator.language || "").split("-")[1];
  return P.country(region)?.code ?? P.DEFAULT_COUNTRY;
}

// Ana para biriminin kısa adı: Türkçede para.js'teki (TL, Dolar, Euro…), İngilizcede kodu (TL, USD, EUR; iPhone gibi)
function homeShort() {
  if (D.lang !== "tr") return HOME === "TRY" ? "TL" : HOME;
  return P.currency(HOME)?.short ?? HOME;
}

// Ana para biriminin adı ekiyle: TL'den, Euro'ya, Dolar'la… (Türkçe ses uyumu; kısaltmalar okunduğu gibi). İngilizcede
// ek yok: kısa adın kendisi (anahtarın çevirisi cümleyi kurar)
function homeEk(kind) {
  const word = homeShort();
  if (D.lang !== "tr") return word;
  if (word === "TL") return { den: "TL'den", ye: "TL'ye", yle: "TL'yle" }[kind];
  const lower = word.toLocaleLowerCase("tr-TR");
  const vowels = [...lower].filter(c => "aeıioöuü".includes(c));
  const back = "aıou".includes(vowels.at(-1) ?? "a");
  const endsVowel = "aeıioöuü".includes(lower.at(-1));
  const hard = "çfhkpsşt".includes(lower.at(-1));
  const ek = kind === "den" ? (hard ? "t" : "d") + (back ? "an" : "en")
    : kind === "ye" ? (endsVowel ? "y" : "") + (back ? "a" : "e")
    : (endsVowel ? "y" : "") + (back ? "la" : "le");
  return `${word}'${ek}`;
}
function homeSymbol() { return P.currency(HOME)?.symbol ?? HOME; }

const IMPORT_ACCEPT = els.importInput.accept;   // index.html: JSON yedeği ve Excel (Excel yalnızca Türkiye'de)

function applyHome() {
  HOME = P.homeOfCountry(currentCountry());
  FEAT = P.features(currentCountry());
  if (state) state.home = HOME;
  moneyFmt = new Intl.NumberFormat(D.locale(), { style: "currency", currency: HOME, minimumFractionDigits: homeDigits(), maximumFractionDigits: homeDigits() });
  wholeMoney = new Intl.NumberFormat(D.locale(), { style: "currency", currency: HOME, maximumFractionDigits: 0 });
  tileMoney = new Intl.NumberFormat(D.locale(), { style: "currency", currency: HOME, maximumFractionDigits: 0 });
  cashDef = readCashDef();
  for (const n of document.querySelectorAll("[data-home]")) n.textContent = homeShort();
  for (const n of document.querySelectorAll("[data-home-symbol]")) n.textContent = homeSymbol();
  // Türkiye'ye özel olanlar (FEAT markets / bankEmails / excelImport): banka e-postaları, Excel içe aktarma, fon / hisse
  // ve para piyasası notları
  const tr = FEAT.markets;
  for (const n of document.querySelectorAll("[data-tr]")) n.hidden = !tr;
  for (const n of document.querySelectorAll("[data-not-tr]")) n.hidden = tr;
  // Kartın yıllık faizi (FEAT.apr; döner kredi olan ülkeler)
  for (const n of document.querySelectorAll("[data-apr]")) n.hidden = !FEAT.apr;
  // Japonya'ya özel olanlar (FEAT.bonus): kartın bonus ayları
  for (const n of document.querySelectorAll("[data-jp]")) n.hidden = !bonusAllowed();
  els.importInput.accept = FEAT.excelImport ? IMPORT_ACCEPT : ".json,application/json";
}

// Ülke değişir: hesapta user_metadata'ya (web, iPhone ve asistan aynısını görür), girişsizse cihaza. Tutarlar çevrilmez.
async function setCountry(code) {
  if (!P.country(code)) return;
  if (window.CF_USER_ID) await window.syncSetCountry?.(code);
  else writePref(PREF.country, code);
  applyHome();
  saveState();
  render();
}

applyHome();

// ---------- Boot ----------
if (typeof window.syncInit === 'function') {
  window.syncInit({
    getState: userId => (stateOwner === userId ? state : null),
    onRemoteData(next) {
      state = hydrate({ ...next, home: HOME });
      localStorage.setItem(getStorageKey(), JSON.stringify(state));
      render();
    },
    onSynced(pulled) { if (pulled) ensureCardTracking(); checkInbox(); backfillCategories(); },
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    window.syncRefresh?.();
    if (premium !== true && Date.now() - premiumAt > PREMIUM_TTL) checkPremium();
  }
});

// Girişsiz veride kartlar açılışta takibe girer (oturum açıksa hesabın verisi eşitlemeden sonra, onSynced'de)
if (!stateOwner) ensureCardTracking();
render();
window.Analitik?.event("app_opened", { signed_in: !!window.CF_USER_ID });
window.Analitik?.loadFlags();
// Açılışta: kullanıcının daha önce verdiği kategoriler ve (açıksa) cihazdaki modelle kategorisizler
setTimeout(() => backfillCategories(), 4000);

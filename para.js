// ---------- Ülkeler ve para birimleri (DOM'dan bağımsız) ----------
// Her hesabın bir ülkesi ve ondan gelen ana para birimi (home) vardır: kartlar, nakit harcamalar, ekstreler, kişilerin
// payları ve bütün toplamlar ana para birimindedir; diğer para birimleri ve altın ana para birimine güncel kurla
// çevrilir. Ülke kayıtta sorulur, hesabın bilgisidir (Supabase user_metadata.country; girişsizken cihazda). Ana para
// birimi veride state.home'dur (taksit.js hydrate: yoksa TRY). Ülke değişince tutarlar çevrilmez: kayıtlar yazıldıkları
// para biriminde kalır.
// Ülkeye göre özellikler (taksit, şimdi al sonra öde, kartın faizi, fon / hisse, banka e-postaları): features.
(function (root) {
  // Para birimleri: kur kaynağının (mcp/kur.js) verdikleri. digits: kuruş hanesi
  const CURRENCIES = [
    ["TRY", "Türk lirası", "TL", "₺"], ["USD", "Amerikan doları", "Dolar", "$"], ["EUR", "Euro", "Euro", "€"],
    ["GBP", "İngiliz sterlini", "Sterlin", "£"], ["CHF", "İsviçre frangı", "Frank", "CHF"], ["CAD", "Kanada doları", "CAD", "CA$"],
    ["AUD", "Avustralya doları", "AUD", "A$"], ["NZD", "Yeni Zelanda doları", "NZD", "NZ$"], ["JPY", "Japon yeni", "Yen", "¥", 0],
    ["SEK", "İsveç kronu", "SEK", "kr"], ["NOK", "Norveç kronu", "NOK", "kr"], ["DKK", "Danimarka kronu", "DKK", "kr"],
    ["PLN", "Polonya zlotisi", "Zloti", "zł"], ["CZK", "Çek korunası", "Koruna", "Kč"], ["HUF", "Macar forinti", "Forint", "Ft"],
    ["RON", "Romen leyi", "Ley", "lei"], ["AED", "BAE dirhemi", "Dirhem", "AED"], ["SAR", "Suudi riyali", "Riyal", "SAR"],
    ["QAR", "Katar riyali", "QAR", "QAR"], ["KWD", "Kuveyt dinarı", "KWD", "KWD", 3], ["AZN", "Azerbaycan manatı", "Manat", "₼"],
    ["GEL", "Gürcü larisi", "Lari", "₾"], ["KZT", "Kazak tengesi", "Tenge", "₸"], ["RUB", "Rus rublesi", "Ruble", "₽"],
    ["UAH", "Ukrayna grivnası", "Grivna", "₴"], ["CNY", "Çin yuanı", "Yuan", "CN¥"],
  ].map(([code, name, short, symbol, digits = 2]) => ({ code, name, short, symbol, digits }));
  const BY_CODE = new Map(CURRENCIES.map(c => [c.code, c]));

  // Ülkeler (ad sırasıyla) ve para birimleri
  const COUNTRIES = [
    ["TR", "Türkiye", "TRY"], ["DE", "Almanya", "EUR"], ["US", "Amerika Birleşik Devletleri", "USD"], ["AU", "Avustralya", "AUD"],
    ["AT", "Avusturya", "EUR"], ["AZ", "Azerbaycan", "AZN"], ["AE", "Birleşik Arap Emirlikleri", "AED"], ["BE", "Belçika", "EUR"],
    ["GB", "Birleşik Krallık", "GBP"], ["BG", "Bulgaristan", "EUR"], ["CZ", "Çekya", "CZK"], ["CN", "Çin", "CNY"],
    ["DK", "Danimarka", "DKK"], ["EE", "Estonya", "EUR"], ["FI", "Finlandiya", "EUR"], ["FR", "Fransa", "EUR"],
    ["GE", "Gürcistan", "GEL"], ["HR", "Hırvatistan", "EUR"], ["NL", "Hollanda", "EUR"], ["IE", "İrlanda", "EUR"],
    ["ES", "İspanya", "EUR"], ["SE", "İsveç", "SEK"], ["CH", "İsviçre", "CHF"], ["IT", "İtalya", "EUR"], ["JP", "Japonya", "JPY"],
    ["CA", "Kanada", "CAD"], ["QA", "Katar", "QAR"], ["KZ", "Kazakistan", "KZT"], ["KW", "Kuveyt", "KWD"], ["LV", "Letonya", "EUR"],
    ["LT", "Litvanya", "EUR"], ["LU", "Lüksemburg", "EUR"], ["HU", "Macaristan", "HUF"], ["MT", "Malta", "EUR"],
    ["NO", "Norveç", "NOK"], ["PL", "Polonya", "PLN"], ["PT", "Portekiz", "EUR"], ["RO", "Romanya", "RON"], ["RU", "Rusya", "RUB"],
    ["SK", "Slovakya", "EUR"], ["SI", "Slovenya", "EUR"], ["SA", "Suudi Arabistan", "SAR"], ["UA", "Ukrayna", "UAH"],
    ["GR", "Yunanistan", "EUR"], ["NZ", "Yeni Zelanda", "NZD"],
  ].map(([code, name, currency]) => ({ code, name, currency }));
  const BY_COUNTRY = new Map(COUNTRIES.map(c => [c.code, c]));

  // Ülkenin başlıca saat dilimi: hesabın saat dilimi bilinmiyorsa "bugün" bununla hesaplanır (asistan sunucusu).
  // Uygulama ve web cihazın saat dilimini kullanır ve hesaba yazar (user_metadata.tz).
  const ZONES = {
    TR: "Europe/Istanbul", US: "America/New_York", GB: "Europe/London", DE: "Europe/Berlin", FR: "Europe/Paris",
    NL: "Europe/Amsterdam", IT: "Europe/Rome", ES: "Europe/Madrid", CA: "America/Toronto", AU: "Australia/Sydney",
    AZ: "Asia/Baku", AE: "Asia/Dubai", JP: "Asia/Tokyo", CN: "Asia/Shanghai", RU: "Europe/Moscow", NZ: "Pacific/Auckland",
  };
  const zoneOfCountry = code => ZONES[String(code ?? "").toUpperCase()] ?? "UTC";
  // Geçerli IANA saat dilimi mi (ör. "America/Chicago")
  function isZone(z) {
    if (typeof z !== "string" || !z) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; }
  }

  const DEFAULT_COUNTRY = "TR";
  const DEFAULT_HOME = "TRY";

  const currency = code => BY_CODE.get(code) ?? null;
  const isCurrency = code => BY_CODE.has(code);
  const country = code => BY_COUNTRY.get(String(code ?? "").toUpperCase()) ?? null;
  // Ülkenin para birimi; bilinmeyen ülke için TL
  const homeOfCountry = code => country(code)?.currency ?? DEFAULT_HOME;
  // Verinin ana para birimi
  const homeOf = state => (isCurrency(state?.home) ? state.home : DEFAULT_HOME);
  // ── Ülkeye göre özellikler ──
  // Bir ülkede kullanılmayan özellik orada görünmez; web, iPhone ve asistan aynı tabloya bakar (hesabın ülkesiyle:
  // user_metadata.country). Para birimi yetmez: euro birçok ülkenin. Listede olmayan ülke DEFAULT_FEATURES'ı alır;
  // listedekiler yalnızca farklı olanı yazar. Yeni bir özellik: DEFAULT_FEATURES'a varsayılanı, ülkelere kendi değeri
  // (ör. Japonya'nın bonus ödemesi).
  //   installments  kart taksidi: "primary" harcama formunda taksit seçenekleri hep açık; "secondary" form peşin
  //                 başlar, taksit seçimi "Taksitli" düğmesinin arkasında. Taksit hiçbir ülkede gizlenmez.
  //   bnpl          "şimdi al sonra öde" (Pay in 4) sağlayıcıları (taksit.js BNPL); boşsa yok. features() listenin
  //                 sonuna "other"ı (Diğer) ekler.
  //   apr           kartın yıllık faizi: döner kredi, asgari ödeme (borc.js revolving)
  //   markets       fon ve hisse (TEFAS, Borsa İstanbul), para piyasası fonları
  //   bankEmails    banka e-postaları (Türk bankalarının bildirimleri; eposta.js)
  //   excelImport   Excel içe aktarma (Türkçe sayfa biçimi)
  const DEFAULT_FEATURES = { installments: "secondary", bnpl: [], apr: false, markets: false, bankEmails: false, excelImport: false };
  const EU_BNPL = ["klarna", "paypal"];
  const GULF = { installments: "primary", bnpl: ["tabby", "tamara"] };
  const PRIMARY = { installments: "primary" };
  const FEATURES = {
    TR: { installments: "primary", markets: true, bankEmails: true, excelImport: true },
    US: { apr: true, bnpl: ["klarna", "afterpay", "affirm", "paypal", "zip", "sezzle"] },
    CA: { apr: true, bnpl: ["klarna", "afterpay", "affirm", "paypal"] },
    GB: { apr: true, bnpl: ["klarna", "clearpay", "paypal"] },
    AU: { apr: true, bnpl: ["afterpay", "zip", "klarna", "paypal"] },
    NZ: { apr: true, bnpl: ["afterpay", "zip", "klarna"] },
    JP: { installments: "primary", apr: true },
    KR: PRIMARY,
    DE: { bnpl: EU_BNPL }, AT: { bnpl: EU_BNPL }, NL: { bnpl: EU_BNPL }, BE: { bnpl: EU_BNPL },
    SE: { bnpl: EU_BNPL }, NO: { bnpl: EU_BNPL }, DK: { bnpl: EU_BNPL }, FI: { bnpl: EU_BNPL },
    FR: { bnpl: ["klarna", "paypal", "alma"] }, ES: { bnpl: EU_BNPL }, IT: { bnpl: ["klarna", "paypal", "scalapay"] },
    AE: GULF, SA: GULF, QA: GULF, KW: GULF,
    // Taksidin yaygın olduğu, henüz ülke listesinde (COUNTRIES) olmayanlar: eklenince hazır
    IL: PRIMARY, BR: PRIMARY, MX: PRIMARY, AR: PRIMARY, CL: PRIMARY, CO: PRIMARY, PE: PRIMARY, UY: PRIMARY,
  };
  // Ülkenin özellikleri (yeni nesne; değiştirmek tabloyu bozmaz). Bilinmeyen ya da boş ülke varsayılanı alır.
  function features(code) {
    const c = String(code ?? "").toUpperCase();
    const f = { ...DEFAULT_FEATURES, ...FEATURES[c] };
    return { ...f, bnpl: f.bnpl.length ? [...f.bnpl, "other"] : [] };
  }
  // Para biriminden ülke, ülkesi bilinmeyen eski çağrılar için: yalnızca tek ülkenin para birimiyse o ülke (TRY → TR,
  // USD → US); euro gibi birden çok ülkeninki null (özellikler varsayılan)
  function countryOfHome(home) {
    const list = COUNTRIES.filter(c => c.currency === home);
    return list.length === 1 ? list[0].code : null;
  }
  // Para birimine göre eski sorular (yeni kod features(ülke) kullanır). Fon / hisse ve para piyasası fonları TL'de
  // (yalnızca Türkiye'nin para birimi), diğerleri para biriminin tek ülkesine göre
  const marketsFor = home => home === "TRY";
  const aprFor = home => features(countryOfHome(home)).apr;
  const bnplFor = home => features(countryOfHome(home)).bnpl.length > 0;
  // Formlarda önce sunulan yabancı para birimleri: ana para biriminin dışında dolar, euro, sterlin
  const commonForeign = home => ["USD", "EUR", "GBP", "TRY"].filter(c => c !== home).slice(0, 3);

  // Kur kaynağı TL karşılıklarını verir (/api/kur: { TRY: 1, USD: 49.9, … }); ana para birimine göre kurlar: kod → bir
  // biriminin ana para birimi karşılığı. Fon ve hisse fiyatları da TL'dir, aynı oranla çevrilir. Ana para biriminin TL
  // karşılığı bilinmiyorsa null.
  function homeRates(tryRates, home) {
    if (!tryRates) return null;
    const base = home === "TRY" ? 1 : tryRates[home];
    if (!(base > 0)) return null;
    const out = {};
    for (const [code, v] of Object.entries(tryRates)) if (Number.isFinite(v) && v > 0) out[code] = v / base;
    out.TRY = 1 / base;
    out[home] = 1;
    return out;
  }

  const api = { CURRENCIES, COUNTRIES, DEFAULT_COUNTRY, DEFAULT_HOME, currency, isCurrency, country, homeOfCountry, homeOf, FEATURES, DEFAULT_FEATURES, features, countryOfHome, marketsFor, aprFor, bnplFor, commonForeign, homeRates, zoneOfCountry, isZone };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Para = api;
})(this);

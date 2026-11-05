// Dil: kullanıcıya görünen metinler Türkçe yazılır; başka dilde gösterilecekse sözlükten (dil/<kod>.json) çevrilir.
// Anahtar Türkçe metnin kendisidir; değişken yerleri {0}, {1}… ile yazılır: t("{0} limiti doldu", ad).
// Diller: LANGS. iPhone telefonun, web tarayıcının tercih ettiği dillerden ilk desteklenenini seçer, yoksa "en"
// (Motor.swift, dil-sayfa.js → choose). Çeviri sırası: seçilen dilin sözlüğü → İngilizce sözlük (yedek) → Türkçe.
// scripts/dil.mjs her t("…") ve L("…") için her sözlükte çeviri var mı denetler.
(function (root) {
  const LANGS = ["tr", "en", "de", "fr", "es", "it", "nl", "ja", "ko", "pt", "ar"];
  // Sayı ve tarih biçimi için yerel ayar (Portekizce Brezilya yazımıyla; Arapça Körfez bankaları gibi Batı rakamları ve
  // Miladi takvimle: 1,234.50 د.إ.‏, 5 نوفمبر)
  const LOCALES = { tr: "tr-TR", en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES", it: "it-IT", nl: "nl-NL", ja: "ja-JP", ko: "ko-KR", pt: "pt-BR",
    ar: "ar-AE-u-ca-gregory-nu-latn" };
  let lang = "tr";
  let dict = {};
  let fallback = {};

  const parse = d => (typeof d === "string" ? JSON.parse(d) : d || {});

  // code: dil kodu; dictionary: o dilin sözlüğü; english: İngilizce sözlük (dictionary'de olmayan anahtarlar için)
  function setLang(code, dictionary, english) {
    lang = LANGS.includes(code) ? code : "tr";
    dict = lang === "tr" ? {} : parse(dictionary);
    fallback = lang === "tr" || lang === "en" ? {} : parse(english);
  }

  // Tercih edilen diller listesinden (["de-DE", "en"…]) ilk desteklenen; hiçbiri değilse "en"
  function choose(preferred) {
    for (const p of preferred || []) {
      const c = String(p || "").toLowerCase().split(/[-_]/)[0];
      if (LANGS.includes(c)) return c;
    }
    return "en";
  }

  const pick = (d, k) => (typeof d[k] === "string" && d[k]) || null;

  // Metni çevirir ve {0}, {1}… yerlerine değerleri koyar
  function t(tr, ...args) {
    const s = (lang !== "tr" && (pick(dict, tr) || pick(fallback, tr))) || tr;
    return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m)) : s;
  }

  const locale = () => LOCALES[lang];
  // Yüzde: Türkçede "%45", diğer dillerde "45%"
  const pct = n => (lang === "tr" ? `%${n}` : `${n}%`);

  // Yazı yönü: Arapça sağdan sola (dil-sayfa.js → <html dir>)
  const dir = () => (lang === "ar" ? "rtl" : "ltr");

  const api = { LANGS, setLang, choose, t, locale, pct, dir, get lang() { return lang; } };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Dil = api;
})(this);

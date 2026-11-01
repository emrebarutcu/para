// Dil: kullanıcıya görünen metinler Türkçe yazılır; başka dilde gösterilecekse sözlükten (dil/en.json) çevrilir.
// Anahtar Türkçe metnin kendisidir; değişken yerleri {0}, {1}… ile yazılır: t("{0} limiti doldu", ad).
// Web ve asistan (MCP) şimdilik Türkçe kalır (dil "tr"); iPhone telefon Türkçe değilse "en" ayarlar (Motor).
// Sözlükte olmayan metin Türkçe gösterilir; scripts/dil.mjs her t("…") ve L("…") için çeviri var mı denetler.
(function (root) {
  let lang = "tr";
  let dict = {};

  function setLang(code, dictionary) {
    lang = code === "en" ? "en" : "tr";
    dict = lang === "tr" ? {} : (typeof dictionary === "string" ? JSON.parse(dictionary) : dictionary || {});
  }

  // Metni çevirir ve {0}, {1}… yerlerine değerleri koyar
  function t(tr, ...args) {
    const s = (lang !== "tr" && typeof dict[tr] === "string" && dict[tr]) || tr;
    return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m)) : s;
  }

  // Sayı ve tarih biçimi için yerel ayar
  const locale = () => (lang === "en" ? "en-US" : "tr-TR");
  // Yüzde: Türkçede "%45", İngilizcede "45%"
  const pct = n => (lang === "en" ? `${n}%` : `%${n}`);

  const api = { setLang, t, locale, pct, get lang() { return lang; } };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Dil = api;
})(this);

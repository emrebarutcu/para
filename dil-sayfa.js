// Web'in dili: tarayıcı Türkçe ise Türkçe, değilse İngilizce (iPhone'daki Dil.swift gibi). index.html'de dil.js'ten hemen
// sonra, diğer betiklerden önce yüklenir: sözlüğü (dil/en.json) eşzamanlı alır ki app.js ve sync.js'teki L("…") ile
// üst düzeydeki sabitler de çevrilsin; sonra sayfanın sabit metinlerini (index.html) çevirir.
// Sabit metinler: metin düğümleri ve aria-label / title / placeholder. Doğrudan metni ve satır içi alt öğesi olan öğe
// (<p>Kart <strong>ekstreleri</strong> düşer</p>) tek metin olarak çevrilir; alt öğeler {0}, {1}… yerindedir:
// "Kart {0} düşer". translate="no" ve data-tr (Türkiye'ye özel) öğeler çevrilmez.
// scripts/dil.mjs aynı gezinmeyle (texts) index.html'in metinlerinin sözlükte olup olmadığını denetler.
(function (root) {
  const ATTRS = ["aria-label", "title", "placeholder"];
  const SKIP = new Set(["SCRIPT", "STYLE", "SVG", "TEMPLATE", "NOSCRIPT"]);
  const INLINE = new Set(["A", "SPAN", "STRONG", "B", "EM", "I", "SMALL", "CODE", "KBD", "BR", "U", "MARK", "ABBR"]);
  const norm = s => s.replace(/\s+/g, " ").trim();
  const letters = s => /\p{L}/u.test(s);
  const tag = n => n.nodeName.toUpperCase();

  function mixed(n) {
    let text = false, inline = false;
    for (const c of n.childNodes) {
      if (c.nodeType === 3 && letters(c.nodeValue)) text = true;
      else if (c.nodeType === 1 && INLINE.has(tag(c))) inline = true;
    }
    return text && inline;
  }

  // Öğenin çevrilecek metinlerini gezer: visit(anahtar, uygula); uygula(çeviri) metni yerine koyar
  function texts(n, visit) {
    if (n.nodeType !== 1) return;
    if (SKIP.has(tag(n)) && tag(n) !== "SVG" || n.getAttribute("translate") === "no" || n.getAttribute("data-tr") != null) return;
    for (const a of ATTRS) {
      const v = n.getAttribute(a);
      if (v && letters(v)) visit(norm(v), t => n.setAttribute(a, t));
    }
    if (tag(n) === "SVG") return;   // grafiklerin yalnızca aria-label'ı
    const kids = [...n.childNodes];
    if (mixed(n)) {
      const els = kids.filter(c => c.nodeType === 1);
      let i = 0, raw = "";
      for (const c of kids) raw += c.nodeType === 3 ? c.nodeValue : c.nodeType === 1 ? `{${i++}}` : "";
      visit(norm(raw), t => {
        const doc = n.ownerDocument;
        const lead = /^\s/.test(raw) ? " " : "", trail = /\s$/.test(raw) ? " " : "";
        const parts = (lead + t + trail).split(/\{(\d+)\}/);
        n.replaceChildren(...parts.map((p, k) => (k % 2 ? els[Number(p)] : doc.createTextNode(p))).filter(Boolean));
      });
    } else {
      for (const c of kids) {
        if (c.nodeType !== 3 || !letters(c.nodeValue)) continue;
        const v = c.nodeValue;
        visit(norm(v), t => { c.nodeValue = v.match(/^\s*/)[0] + t + v.match(/\s*$/)[0]; });
      }
    }
    for (const c of kids) if (c.nodeType === 1) texts(c, visit);
  }

  // Tarayıcının ilk dili Türkçe değilse "en"
  function browserLang(nav) {
    const l = (nav && (nav.languages && nav.languages[0] || nav.language)) || "tr";
    return /^tr\b/i.test(l) ? "tr" : "en";
  }

  const api = { texts, browserLang };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.DilSayfa = api;
  if (typeof document === "undefined") return;

  const D = root.Dil;
  if (browserLang(root.navigator) !== "tr") {
    try {
      const x = new XMLHttpRequest();
      x.open("GET", "/dil/en.json", false);   // eşzamanlı: sonraki betikler çevrilmiş metinle başlasın
      x.send();
      if (x.status === 200) D.setLang("en", x.responseText);
    } catch (e) { /* sözlük gelmezse Türkçe kalır */ }
  }
  document.documentElement.lang = D.lang;
  if (D.lang !== "tr") {
    texts(document.body, (k, apply) => {
      const t = D.t(k);
      if (t !== k) apply(t);
    });
    // Tutar alanlarının örneği yerel yazımla: "0,00" → "0.00"
    const zero = (0).toLocaleString(D.locale(), { minimumFractionDigits: 2 });
    for (const i of document.querySelectorAll('input[placeholder="0,00"]')) i.placeholder = zero;
  }
})(this);

// ---------- Banka e-postasından harcama okuma (DOM'dan bağımsız) ----------
// Kredi kartı harcama bildiriminden tutar, kartın son 4 hanesi, tarih, taksit sayısı ve işyeri çıkarılır.
// Bankaların metinleri farklı olduğu için kalıplar geniş tutulur; okunamayan alan null döner.
(function (root) {
  const FOLD = { "ı": "i", "ş": "s", "ğ": "g", "ü": "u", "ö": "o", "ç": "c" };
  const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];

  // Küçük harf + Türkçe harfler ASCII'ye ("İŞYERİ" → "isyeri"); uzunluk korunur, indeksler asıl metinle örtüşür
  function fold(s) {
    return s.toLocaleLowerCase("tr-TR").replace(/[ışğüöç]/g, ch => FOLD[ch]);
  }

  // Adlı HTML varlıkları (Yapı Kredi "ger&ccedil;ekleştirilmiştir" yazar); &amp; &lt; &gt; ayrıca, en sonda çözülür
  const ENTITY = {
    ccedil: "ç", Ccedil: "Ç", uuml: "ü", Uuml: "Ü", ouml: "ö", Ouml: "Ö", quot: '"', apos: "'",
    rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", euro: "€", pound: "£",
  };

  // <a href="https://…">Doğrula</a> → "Doğrula (https://…)": bağlantı metinde kalır, uygulamada tıklanabilir
  const LINK = /<a\b[^>]*?\bhref\s*=\s*["']?(https?:[^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  function linkText(_, url, label) {
    return label.includes(url) ? label : `${label} (${url})`;
  }

  // HTML e-postayı düz metne çevirir
  function plainText(s) {
    return String(s ?? "")
      .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(LINK, linkText)
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&([a-z]+);/gi, (m, ad) => ENTITY[ad] ?? m)
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n[\s\n]*/g, "\n")
      .trim();
  }

  // "1.250,00" / "1250,5" / "1,250.00" / "1.250" → sayı; son ayraçtan sonra 1–2 hane varsa kuruştur
  function toAmount(s) {
    const m = s.match(/^(.*?)(?:[.,](\d{1,2}))?$/);
    return Number(m[1].replace(/[.,]/g, "") + (m[2] ? "." + m[2] : ""));
  }

  const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
  const CUR = String.raw`tl|try|₺|usd|eur|gbp|\$|€|£`;
  const AMOUNT = new RegExp(String.raw`(?<![a-z])(${CUR})\s*(${NUM})(?![\d])|(?<![\d.,])(${NUM})\s*(${CUR})(?![a-z])`, "g");
  const CURRENCY = { tl: "TRY", try: "TRY", "₺": "TRY", usd: "USD", $: "USD", eur: "EUR", "€": "EUR", gbp: "GBP", "£": "GBP" };

  // Harcama tutarı olmayan sayılar: limit, borç, puan…
  const NOT_SPEND_BEFORE = /(limit|bakiye|borc|asgari|puan|bonus|chip|odul|mil |kazan|indirim)[^\n]{0,30}$/;
  const NOT_SPEND_AFTER = /^[^\n]{0,15}(puan|bonus|chip|odul|mil\b|kazan|indirim|limit)/;
  const SPEND_NEAR = /(tutar|harcama|alisveris|islem|odeme yap)/;
  const PER_INSTALLMENT = /(taksit tutari|aylik taksit|taksit basi)[^\n]{0,20}$/;

  function findAmount(f) {
    const found = [];
    for (const m of f.matchAll(AMOUNT)) {
      const before = f.slice(Math.max(0, m.index - 40), m.index);
      const after = f.slice(m.index + m[0].length, m.index + m[0].length + 30);
      if (NOT_SPEND_BEFORE.test(before) || NOT_SPEND_AFTER.test(after)) continue;
      const amount = toAmount(m[2] ?? m[3]);
      if (!(amount > 0)) continue;
      found.push({
        amount,
        currency: CURRENCY[m[1] ?? m[4]],
        per: PER_INSTALLMENT.test(before),
        near: SPEND_NEAR.test(before) || SPEND_NEAR.test(after),
      });
    }
    return found.find(x => x.near && !x.per) || found.find(x => !x.per) || found[0] || null;
  }

  function findLast4(f) {
    const m = f.match(/(\d{4})\s*(?:ile|ıle)\s*(?:biten|sonlanan)/)
      || f.match(/(?:(?:[*x•]{2,}|\.{2,}[*x•]*)[\s-]*)+(\d{4})(?!\d)/)
      || f.match(/son\s*(?:4|dort)\s*hane(?:si)?\s*:?\s*(\d{4})(?!\d)/);
    return m ? m[1] : null;
  }

  function validDate(y, mo, d) {
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  }
  function key(y, mo, d) {
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // Metindeki ilk geçerli tarih; e-postanın geliş gününden sonraki tarihler (son ödeme vb.) atlanır
  function findDate(f, received) {
    const re = new RegExp(String.raw`(?<!\d)(\d{1,2})(?:[./-](\d{1,2})[./-]|\s+(${MONTHS.join("|")})\s+)(\d{4})(?!\d)`, "g");
    for (const m of f.matchAll(re)) {
      const d = Number(m[1]), mo = m[2] ? Number(m[2]) : MONTHS.indexOf(m[3]) + 1, y = Number(m[4]);
      if (!validDate(y, mo, d)) continue;
      const k = key(y, mo, d);
      if (!received || k <= received) return k;
    }
    return null;
  }

  function findCount(f) {
    if (/\bpesin\b/.test(f)) return 1;
    const m = f.match(/(?<![\d.,])(\d{1,2})\s*(?:ay(?:lik)?\s*)?taksit/) || f.match(/taksit(?: sayisi)?\s*:?\s*(\d{1,2})(?![\d.,])/);
    const n = m ? Number(m[1]) : null;
    return n >= 1 && n <= 60 ? n : null;
  }

  // İşyeri adından önce gelen tarih, tutar ve kart ifadeleri atılır: "… tarihinde 25,00 TL tutarında NETFLIX.COM" → "NETFLIX.COM"
  const MERCHANT_CUT = /^.*\b(?:tarihinde|saatinde|tarihli|kartinizla|kartinizdan|kartiniz ile|tutarinda|tutarindaki|taksitli|harcama|tl|try|usd|eur|gbp)\s+/;
  function cleanMerchant(s) {
    const out = s.replace(/^[\s\d:./-]+/, "").replace(/[\s'’"“”(),.:;-]+$/, "").replace(/\s+/g, " ").trim();
    return out.length >= 2 ? out.slice(0, 40) : null;
  }

  function findMerchant(f, text) {
    const label = /(?:uye )?isyeri(?: adi)?\s*:\s*([^\n]+?)(?=\s{2,}|\n|$|\s(?:tarih|tutar|islem))/.exec(f);
    if (label) return cleanMerchant(text.substr(label.index + label[0].length - label[1].length, label[1].length));
    // "… X işyerinde" ya da Yapı Kredi: "… kartınız ile X firmasından 28.10.2026 tarihinde …"
    const before = /([^\n:;]{2,60}?)\s+(?:(?:uye\s+)?isyerinde(?:n)?|firmasinda(?:n)?)\b/.exec(f);
    if (before) {
      const start = before.index;
      let part = text.substr(start, before[1].length);
      const cut = fold(part).match(MERCHANT_CUT);
      if (cut) part = part.slice(cut[0].length);
      return cleanMerchant(part);
    }
    return null;
  }

  // { body, subject, receivedAt } → { amount, currency, last4, date, count, merchant, refund, ok, reason }
  function parse({ body, subject, receivedAt } = {}) {
    // Bağlantılar atılır: içlerindeki sayılar tutar, tarih ya da kart hanesi sanılmasın
    let text = plainText([subject, body].filter(Boolean).join("\n")).replace(/https?:\/\/\S+/gi, " ");
    let f = fold(text);
    if (f.length !== text.length) text = f;   // nadir Unicode harfler: indeksler kaymasın diye katlanmış metin kullanılır

    const rd = receivedAt ? new Date(receivedAt) : null;
    const received = rd && !isNaN(rd) ? key(rd.getFullYear(), rd.getMonth() + 1, rd.getDate()) : null;

    const found = findAmount(f);
    const count = findCount(f);
    const r = {
      amount: found ? found.amount : null,
      currency: found ? found.currency : null,
      last4: findLast4(f),
      date: findDate(f, received) || received,
      count: count || 1,
      merchant: findMerchant(f, text),
      refund: /\b(iade|iptal)\b/.test(f),
    };
    // Yalnızca taksit tutarı yazıyorsa toplam taksit sayısıyla bulunur
    if (found?.per && count) r.amount = Math.round(found.amount * count * 100) / 100;

    r.reason = r.amount == null ? "Tutar okunamadı"
      : r.currency !== "TRY" ? `Yabancı para (${r.currency})`
      : r.refund ? "İade / iptal bildirimi"
      : !r.date ? "Tarih okunamadı"
      : null;
    r.ok = !r.reason;
    return r;
  }

  // ── Kurulum e-postaları (harcama değildir) ──

  const LINKS = /https?:\/\/[^\s<>"')\]]+/g;
  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
  const VERIFY_WORD = /(dogrula|onayla|teyit|aktiflestir|etkinlestir|verify|confirm|activate)/;

  // Adres doğrulama: Gmail'in yönlendirme onayı ("(#123456789) Gmail Forwarding Confirmation - Receive Mail from
  // ali@gmail.com", Türkçesi "Gmail Yönlendirme Onayı") ya da bankanın "adresini doğrula" e-postası. Uygulama bunları
  // harcama gibi değil, "Onayla" düğmesiyle gösterir.
  // { body, subject, sender } → { gmail, code, link, from } ya da null (code: Gmail'in onay kodu; from: yönlendiren adres)
  function verification({ body, subject, sender } = {}) {
    const text = plainText([subject, body].filter(Boolean).join("\n"));
    const f = fold(text);
    const links = [...text.matchAll(LINKS)].map(m => ({ url: m[0], at: m.index }));
    const gmail = /forwarding-noreply@google\.com/.test(fold(String(sender ?? ""))) || /gmail (forwarding confirmation|yonlendirme onayi)/.test(f);
    if (gmail) {
      const code = (String(subject ?? "").match(/\(#\s*(\d{5,12})\)/) || f.match(/(?:confirmation code|onay kodu)\s*:?\s*(\d{5,12})/))?.[1] ?? null;
      const link = (links.find(l => /mail-settings\.google\.com|mail\.google\.com\/mail\/(?:u\/\d+\/)?vf/.test(l.url)) ?? links[0])?.url ?? null;
      // Yönlendiren adres: konudaki adres; yoksa metindeki ilk adres ("ali@gmail.com has requested to …")
      const from = (String(subject ?? "").match(EMAIL) || text.match(EMAIL))?.[0] ?? null;
      return { gmail: true, code, link, from };
    }
    if (!links.length || !VERIFY_WORD.test(f)) return null;
    if (findAmount(f.replace(LINKS, m => " ".repeat(m.length)))) return null;   // tutarı olan e-posta harcama bildirimidir
    // Doğrulama sözcüğüne yakın bağlantı (bağlantı metni "Doğrula (https://…)" biçimindedir); yoksa ilki
    const near = links.find(l => VERIFY_WORD.test(f.slice(Math.max(0, l.at - 80), l.at)));
    return { gmail: false, code: null, link: (near ?? links[0]).url, from: null };
  }

  // Uygulamadaki "Deneme e-postası gönder": konu TEST_SUBJECT. Adresin çalıştığını gösterir, harcama eklenmez.
  const TEST_SUBJECT = "CashFollow deneme";
  function isTest({ subject } = {}) {
    return /cashfollow (deneme|test)\b/.test(fold(String(subject ?? "")));
  }

  // E-postanın türü: test (deneme), verification (adres doğrulama), purchase (tutarı okunan bildirim), other
  function kind(mail = {}) {
    if (isTest(mail)) return "test";
    if (verification(mail)) return "verification";
    return parse(mail).amount != null ? "purchase" : "other";
  }

  // Gerçek harcama bildirimleriyle denenmiş, tutar, tarih, kartın son 4 hanesi ve işyeri okunan bankalar. Diğer bankaların
  // e-postaları da okunmaya çalışılır; okunamayan onaya düşer. Web'deki Banka e-postaları penceresi ve asistan buradan okur.
  const BANKS = ["Yapı Kredi"];

  const api = { parse, plainText, fold, toAmount, verification, isTest, kind, TEST_SUBJECT, BANKS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Eposta = api;
})(this);

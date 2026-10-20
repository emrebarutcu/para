// ---------- Harcama kategorileri (DOM'dan bağımsız) ----------
// Kategoriyi cihazdaki küçük dil modeli (yz.js, çok dilli metin gömme modeli) önerir: açıklama, her kategorinin anlam
// kelimelerine ve kullanıcının daha önce kategorisini seçtiği harcamalara olan benzerliğine göre sıralanır. Sabit bir
// işyeri sözlüğü yoktur. Kullanıcının seçtiği ya da düzelttiği kategori öğrenilir: aynı işyerine (farklı yazılışı dahil)
// doğrudan verilir, benzer işyerlerinde modelin örneği olur.
(function (root) {
  // Sıra arayüzdeki sıradır. words: kategorinin anlamı (Türkçe ve İngilizce kelimeler; işyeri adı değil)
  const CATEGORIES = [
    { id: "market", name: "Market", hint: "süpermarket, bakkal, manav, kasap", words: [
      "market alışverişi", "süpermarket", "gıda marketi", "bakkal", "manav ve kasap", "gıda ürünleri", "hipermarket",
      "zincir market mağazası", "toptan gıda", "şarküteri", "süt ekmek yumurta", "grocery store supermarket", "food retail grocery chain"] },
    { id: "yeme", name: "Yeme-içme", hint: "restoran, kafe, yemek siparişi", words: [
      "restoran", "kafe ve kahve", "yemek siparişi", "fast food", "lokanta", "pastane tatlıcı", "dondurma", "kahve zinciri",
      "yemek siparişi uygulaması", "restaurant cafe food", "fast food chain coffee shop"] },
    { id: "ulasim", name: "Ulaşım", hint: "akaryakıt, taksi, toplu taşıma, otopark, araç bakımı", words: [
      "akaryakıt benzin istasyonu", "petrol", "taksi", "toplu taşıma ulaşım kartı", "otopark", "otoyol köprü geçiş ücreti",
      "araç servisi", "akaryakıt dağıtım şirketi", "taksi uygulaması", "ulaşım kartı dolum", "otoyol geçiş sistemi", "oto bakım",
      "fuel gas station taxi parking", "fuel company transport"] },
    { id: "alisveris", name: "Alışveriş", hint: "giyim, ayakkabı, online alışveriş siteleri", words: [
      "giyim mağazası", "ayakkabı", "kıyafet", "online alışveriş sitesi", "hazır giyim mağazacılık", "moda markası",
      "ayakkabı mağazası", "e-ticaret pazaryeri", "clothing fashion store", "online shopping marketplace fashion brand"] },
    { id: "elektronik", name: "Elektronik", hint: "telefon cihazı, bilgisayar, televizyon, oyun konsolu", words: [
      "elektronik mağazası", "cep telefonu", "bilgisayar", "televizyon", "oyun konsolu", "teknoloji mağazası",
      "bilgisayar mağazası", "ses sistemi", "akıllı telefon", "electronics store", "consumer electronics retailer"] },
    { id: "ev", name: "Ev", hint: "kira, aidat, mobilya, beyaz eşya, ev eşyası", words: [
      "kira", "site aidatı", "mobilya", "beyaz eşya", "ev eşyası dekorasyon", "yapı market", "ev tekstili", "mutfak eşyası",
      "beyaz eşya bayisi", "oturma grubu", "yapı market dekorasyon", "furniture home appliances", "home furnishing store"] },
    { id: "fatura", name: "Faturalar", hint: "elektrik, su, doğalgaz, internet, cep telefonu faturası", words: [
      "elektrik faturası", "su faturası", "doğalgaz faturası", "internet faturası", "cep telefonu faturası GSM operatörü",
      "telekom operatörü", "mobil operatör", "fiber internet", "elektrik dağıtım şirketi", "su idaresi", "utility bill",
      "telecom operator utility company"] },
    { id: "saglik", name: "Sağlık ve bakım", hint: "eczane, hastane, doktor, kozmetik, kuaför, spor salonu", words: [
      "eczane", "hastane", "doktor", "diş", "kozmetik kişisel bakım", "kuaför", "spor salonu", "gözlük", "veteriner",
      "sağlık grubu hastanesi", "kozmetik mağazası", "kişisel bakım zinciri", "güzellik", "optik", "pharmacy hospital",
      "health cosmetics personal care"] },
    { id: "egitim", name: "Eğitim", hint: "okul, kurs, kitap, kırtasiye", words: [
      "okul ücreti", "kurs", "kitap", "kırtasiye", "online eğitim", "özel ders", "etüt merkezi", "öğrenim ücreti", "kolej",
      "dil kursu", "online kurs platformu", "education course books", "school tuition online learning"] },
    { id: "eglence", name: "Eğlence", hint: "dijital abonelik, oyun, sinema, konser", words: [
      "dijital abonelik dizi film", "müzik aboneliği", "oyun", "sinema", "konser bileti", "dizi film platformu", "müzik platformu",
      "video platformu üyeliği", "oyun platformu", "bilet satış", "streaming subscription games cinema", "streaming service video music"] },
    { id: "seyahat", name: "Seyahat", hint: "uçak, otobüs bileti, otel, tatil", words: [
      "uçak bileti havayolu", "otobüs bileti", "otel konaklama", "tatil", "tur", "havayolu şirketi", "otobüs bileti satış",
      "otel rezervasyon sitesi", "tur şirketi", "flight hotel travel", "airline hotel booking"] },
    { id: "diger", name: "Diğer", hint: "hiçbirine uymayan", words: [
      "noter", "vergi", "bağış", "hediye", "avukat", "harç", "ceza", "sigorta", "kargo"] },
  ];
  const BY_ID = new Map(CATEGORIES.map(c => [c.id, c]));
  const OTHER = "diger";
  const PREFIX = "query: ";   // e5 modelleri metnin önünde bunu bekler
  const EXAMPLES = 64;        // modele örnek olan en fazla kullanıcı seçimi (en yeniler)
  const USER_BONUS = 0.02;    // kullanıcının örneği, kategori kelimeleriyle aynı benzerlikte öne geçer
  const SHARPNESS = 60;       // benzerlik farkını güvene çeviren katsayı (e5 benzerlikleri dar aralıktadır)
  // Bu güvenin altındaki öneri kendiliğinden verilmez (kullanıcı seçer). Ölçüm: güveni ≥ 0.3 olanların %91'i doğru,
  // harcamaların %57'si bu eşiği geçiyor; bütün tahminlerin doğru oranı %63 (test markalarını hiç görmemiş deneme)
  const SURE = 0.3;

  function category(id) { return BY_ID.get(id) ?? null; }
  function valid(id) { return BY_ID.has(id); }

  // Aynı işyeri farklı yazılabilir: "MIGROS TICARET A.S. ISTANBUL" ile "Migros Ticaret A.Ş." aynı anahtara düşer.
  // Rakamlar (şube / terminal numarası) ve noktalama atılır.
  function keyOf(desc) {
    return String(desc ?? "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  // Kullanıcının kategorisini bildiği harcamalar (sonradan eklenen sonda) → anahtar → kategori.
  // Yalnızca kullanıcının seçtiği / onayladığı kategoriler öğretir (categoryBy: "user"), modelin tahmini öğretmez.
  function learned(purchases) {
    const map = new Map();
    for (const p of purchases) {
      if (p?.categoryBy !== "user" || !valid(p.category)) continue;
      const key = keyOf(p.desc);
      if (key) { map.delete(key); map.set(key, p.category); }   // en son seçim geçerli, sırada sona geçer
    }
    return map;
  }

  // Açıklamanın öğrenilmiş kategorisi (aynı anahtar ya da ilk iki kelimesi aynı işyeri); yoksa null
  function remembered(desc, memory) {
    const key = keyOf(desc);
    if (!key) return null;
    if (memory.has(key)) return memory.get(key);
    const head = key.split(" ").slice(0, 2).join(" ");
    if (head.length < 4) return null;
    let found = null;
    for (const [k, c] of memory) if (k.split(" ").slice(0, 2).join(" ") === head) found = c;
    return found;
  }

  // Modele verilecek metinler: kategori kelimeleri ve kullanıcının son seçimleri (anahtar → kategori)
  const words = () => CATEGORIES.flatMap(c => c.words.map(text => ({ id: c.id, text })));
  const examples = memory => [...(memory || new Map())].slice(-EXAMPLES).map(([text, id]) => ({ id, text }));

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // q: açıklamanın vektörü (normalize), protos: [{ id, v }] kategori kelimeleri, users: [{ id, v }] kullanıcı örnekleri.
  // Kategori puanı: kelimelerinden en benzer ikisinin ortalaması; kullanıcı örneği daha benzerse onun benzerliği.
  // → { category, confidence, scores } — confidence: puanların yumuşak en büyüğünde seçilenin payı (0…1)
  function rank(q, protos, users = []) {
    const by = new Map(CATEGORIES.map(c => [c.id, []]));
    for (const p of protos) by.get(p.id)?.push(dot(q, p.v));
    const scores = {};
    for (const [id, list] of by) {
      list.sort((a, b) => b - a);
      scores[id] = list.length ? (list[0] + (list[1] ?? list[0])) / 2 : -1;
    }
    for (const u of users) if (u.id in scores) scores[u.id] = Math.max(scores[u.id], dot(q, u.v) + USER_BONUS);
    const order = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const top = order[0][1];
    const total = order.reduce((s, [, x]) => s + Math.exp(SHARPNESS * (x - top)), 0);
    return { category: order[0][0], confidence: 1 / total, scores };
  }

  const api = { CATEGORIES, OTHER, PREFIX, EXAMPLES, SURE, category, valid, keyOf, learned, remembered, words, examples, rank };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Kategori = api;
})(this);

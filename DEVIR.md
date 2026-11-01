# Devir notu — bulut oturumundan Mac'teki oturuma (1 Kasım 2026)

Bu dosya geçicidir: iş devam edince silinir (`main`'e birleştirmeden önce). Kalıcı kurallar `CLAUDE.md`'de.

## Hedef

ABD pazarı, iPhone öncelikli, uygulama içi abonelikle açılan özellikler. Yol haritası:

1. **Doğruluk ve App Store red riskleri** — bu dalda yapıldı (aşağıda).
2. **ABD uyumu** — sırada:
   - "Şimdi al sonra öde" (BNPL: Affirm, Klarna, Afterpay): 2 haftada bir, 4 taksit. `taksit.js` şimdi yalnızca aylık taksit
     biliyor.
   - Kart borcunu kısmen ödeyip faizle (APR) taşıma, asgari ödeme. Şimdi ekstrenin hep tamamı ödenmiş varsayılıyor.
   - Türkiye'ye özel özellikleri ABD'de gizlemek: TEFAS / BIST, banka e-postaları (Türk bankaları).
3. **Abonelik** — StoreKit 2, abonelik ekranı (fiyat, süre, deneme, "Satın alımları geri yükle"), App Store sunucu
   bildirimleriyle aboneliği Supabase'e yazmak (web de görsün), web'de Stripe.
4. **Yayın** — çökme raporlama, İngilizce mağaza sayfası ve ekran görüntüleri, ABD'li kullanıcılarla dış TestFlight.

## Bu dal: `claude/abd-hazirlik` (sürüm 8.0.0, `main`'e birleştirilmedi)

- **Saat dilimi**: "bugün" İstanbul'a sabitti. iPhone cihazın saat dilimini kullanır; iPhone ve web onu hesaba yazar
  (`user_metadata.tz`); asistan sunucusu onu, yoksa ülkenin başlıca saat dilimini kullanır (`para.js zoneOfCountry`).
- **Hesap silme**: iPhone Ayarlar → Hesabı sil, web hesap penceresi. SQL `supabase/gecis/8.0.0.sql`
  (`delete_my_account`) **projeye uygulandı**.
- **Gizlilik politikası / kullanım koşulları**: `privacy.html`, `terms.html` (İngilizce). Bağlantılar iPhone Ayarlar'da,
  kayıt ekranında ve web'de. **Kullanıcıya sorulacak**: iletişim adresi şimdilik `support@cashfollow.app` — gerçek adres
  ne? Koşullara hukukçu bakmalı (uygulanacak hukuk maddesi yok).
- **İngilizce** (iPhone): telefon Türkçe değilse İngilizce. Swift `L("…")`, JS `L` / `D.t`, sözlük `dil/en.json` (480
  metin), biçimler bölgeye göre ($1,234.56, November 20). Web henüz Türkçe.
- **Analitik ve A/B** (PostHog, HTTP API; SDK yok): `Uygulama/Analitik.swift`, `analitik.js`. **Anahtar boş → kapalı.**
  Kullanıcı PostHog'da (ABD bölgesi) proje açıp anahtarı (`phc_…`, herkese açık) verince `Yapilandirma.swift posthogKey` ve
  `config.js POSTHOG_KEY`'e yazılır. Olaylar tutar / ad içermez; Ayarlar'da kapatılabilir. A/B: `Analitik.bayrak("ad")`.
- **Ekran görüntüleri** hızlandı: `ekran.yml` uygulamayı bir kez açar, `-tur` ile ekranları gezer (~8 dk).
- Yukarıdakilerin hepsi CI'da derlendi; öz-denetim İngilizce simülatörde geçti. Son görüntüler: `ekran-goruntuleri` dalı.

## Açık kararlar (kullanıcıdan)

- Banka bağlantısı (Plaid) olacak mı, yoksa "elle, gizlilik öncelikli" mi?
- Fiyat ve ücretsiz / ücretli ayrımı. Öneri: ücretsiz birkaç kart + bu ay + sıradaki ödemeler; ücretli sınırsız kart / kişi,
  Alabilir miyim?, nakit tahmini, içgörüler, varlığın seyri, asistan bağlantısı. Ayda ~5 $, yılda ~35–40 $, 7 gün deneme.

## Sıradaki adım

1. Mac'te derle, simülatörde İngilizce ve Türkçe dene (komutlar `CLAUDE.md`'de).
2. Kullanıcı onaylarsa bu dalı PR ile `main`'e birleştir (sürüm 8.0.0; SQL zaten uygulandı), `testflight.yml`'i çalıştır.
3. Sonra yol haritasının 2. adımı.

## Dersler

- Swift hatalarını yerelde derleyerek yakala; CI'a küçük commit'leri art arda gönderme (her biri 8+ dk'lık iş başlatır).
- Simülatör İngilizce açılır: Türkçe denemek için `-AppleLanguages "(tr)" -AppleLocale tr_TR`.
- Öz-denetim (`Uygulama/OzDenetim.swift`) dilden bağımsız olmalı (metin değil kimlik karşılaştır).

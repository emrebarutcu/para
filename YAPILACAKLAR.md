# Yapılacaklar

Kullanıcıyla konuşulup sıraya alınanlar. Kullanıcıyı tutmaya yönelik yol haritası `TUTUNDURMA.md`'de.

## Bütçe ayırma

Belirli şeylere para ayırma:
- **Düzenli:** her ay market için 5.000 ₺ gibi. Kategoriye ya da işyerine bağlanır, ay ay yenilenir.
- **Tek seferlik:** tatil için 30.000 ₺, Aralık'a kadar gibi. Bir tutarı ve isteğe bağlı bir bitiş tarihi vardır.

Harcandıkça kalanı görünür, aşılacaksa uyarır. Web, iPhone ve asistan (MCP) aynı hesabı kullanır. Ayrıntılar
tasarlanırken yazılacak.

## Banka e-postaları: ikinci tur

İlk tur 8.15.0'da yapıldı (SETUP.md → 6):
- Gmail / Outlook / iCloud'dan yönlendirme rehberi;
- Gmail onay kodu ve banka doğrulamasında "Onayla";
- kartın son 4 hanesini ilk e-postada sorma;
- son e-posta durumu ve deneme e-postası;
- iPhone'da arka planda kontrol ve bildirim.

Sırayla yapılacaklar. Her biri ayrı PR olarak, web, iPhone ve asistanda birlikte.

### 1. İşyeri adını temizleme ve öğrenme

**Sorun:** e-postadaki ad "MIGROS SANAL MAGAZA ISTANBUL TR" gibi geliyor. Kullanıcı her seferinde düzeltiyor.

**Çözüm:**
- `eposta.js`'te temizleme:
  - şehir / ülke ekleri (ISTANBUL TR), "SANAL MAGAZA", POS ve şube numaraları atılır;
  - büyük harf düzgün yazılır ("Migros");
  - bilinen markalar listesi (`kategori.js`'tekilerle birlikte).
- Öğrenme: kullanıcı e-postadan eklenen bir harcamanın adını ya da kategorisini değiştirince "MIGROS SANAL…" → "Migros ·
  Market" eşlemesi saklanır. Sonraki e-postalar bu adla ve kategoriyle eklenir.
  - Kategori için `kategori.js` `remembered` / `learned` zaten var (asıl ad üzerinden); ad için de aynısı yapılır.
  - Ham ad harcamada saklanmalı (yeni alan `purchases.source_desc`, eklemeli şema → MINOR). Yoksa öğrenme anahtarı kaybolur.
- Asistan: `add_inbox_purchase` ve `check_inbox` öğrenilen adı kullanır.

**Ölçüm:** e-postadan eklenen harcamaların ilk 7 günde adı düzeltilenlerin oranı (`purchase_edited`, `source: email`).

### 2. Onay bekleyenleri görünür kılma

**Sorun:** onay bekleyenler yalnızca Harcamalar sekmesinin üstünde. Özet'te açılan kullanıcı görmüyor.

**Çözüm:**
- ✓ (1.1.0, iPhone) Özet'te üstte küçük kart: "2 e-posta onay bekliyor" → dokununca Harcamalar. Harcamalar sekmesinde
  de rozet (iPhone `.badge`).
- iPhone: listede sola kaydır → Yok say, sağa kaydır → Ekle. Kartı belli olanda (tek dokunuş) doğrudan ekler.
- Web: aynı kart Özet'te; Harcamalar sekme adında sayı.

### 3. Hesap şartını yumuşatma

**Sorun:** banka e-postaları bulut gerektirir. Girişsiz kullanıcı Ayarlar'da yalnızca "önce giriş yap" yazısını görüyor.

**Çözüm:**
- Banka e-postaları ekranında girişsiz kullanıcıya özelliği anlatan kısa bir tanıtım ve tek düğme: "Hesap aç ve başla".
- Hesap açılınca aynı ekrana dönülür ve adres hemen görünür; cihazdaki veri `askMove` akışıyla hesaba taşınır.
- Sign in with Apple, `TUTUNDURMA.md` → 6 ile birlikte (hesabı değerli anda isteme). Bu madde onu bekleyebilir. Önce
  mevcut e-posta / şifreyle yapılır.

### 4. Yeni bankalar

**Sorun:** yalnızca Yapı Kredi gerçek e-postalarla denendi (`eposta.js` → `BANKS`). Diğerleri "okunmaya çalışılır".

**Çözüm:**
- Garanti BBVA, İş Bankası (Maximum), Akbank (Axess), QNB, Enpara, Ziraat, Halkbank, Denizbank, Vakıfbank: her biri için
  gerçek bildirim örneği toplanır, kalıp eklenir, `mcp/test`'e örnekle test yazılır, `BANKS`'e eklenir.
- Örnek toplamak için: okunamayan e-postada (onay bekleyen, "Tutar okunamadı" vb.) **"Bu bankayı desteklemek için
  gönder"** düğmesi.
  - Kullanıcı açıkça onaylar. Gönderilmeden önce metindeki ad, kart numarası, tutar dışı sayılar maskelenir.
  - Yeni tablo `inbox_samples`, yalnızca servis rolü okur.
  - Gizlilik metni güncellenir (privacy.html).
- Bankalara göre okuma oranı ölçülür: gönderen alan adı → okunan / okunamayan.

### 5. Mükerrer kayıt

**Sorun:** kullanıcı harcamayı elle de girdiyse e-posta gelince ikinci kez eklenir.

**Çözüm:**
- E-postadan eklemeden önce aynı kart, aynı tutar, ±2 gün içinde ve e-postadan gelmemiş bir harcama varsa eklenmez.
  Onay bekleyenlere düşer: "Bu harcama zaten var gibi: Migros · 450 ₺ · 17 Eki" → **Aynı** (e-posta işlendi olur, elle
  girilen kalır) / **Ayrı harcama** (eklenir).
- Ters yön: e-postadan eklenmiş harcama varken kullanıcı aynısını elle girerse formda uyarı.
- Kural `eposta.js`'te ya da `taksit.js`'te tek yerde; web, iPhone ve asistan aynısını kullanır.

### 6. İade / iptal e-postası

**Sorun:** iade e-postaları şimdilik yalnızca onaya düşer. İade / erken kapatma akışı yok.

**Çözüm:** harcama ayrıntısına "İade / iptal" ve "Taksitleri erken kapat" gelince (ayrı iş), iade e-postası eşleşen
harcamayı bulur (kart, işyeri, tutar) ve tek dokunuşla iade önerir.

### Bilinen sınır

Bir kartın tek bir son 4 hanesi olabiliyor (`cards.last4`). Ek kart ya da sanal kart başka numarayla gelirse "yalnızca bu
harcamayı ekle" seçilmeli. Birden çok hane gerekirse `cards.last4` dizi olur (şema değişikliği).

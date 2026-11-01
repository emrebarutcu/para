# iPhone uygulaması — kullanıcı akışları ve UX değerlendirmesi

Puan: 1 (yapılamıyor / çok zor) … 5 (hızlı ve açık). "Önce" 7.1.0, "Sonra" bu düzenlemeden sonrası.
Ölçüt: kaç dokunuş, ne kadar düşünmek gerekiyor, sonuç görünüyor mu, hata yapma riski.

## En sık işler

| # | Akış | Önce | Sorun | Sonra |
|---|------|:----:|-------|:-----:|
| 1 | **Taksitli harcama ekleme** | 3 | 6 alan; taksit 60 seçenekli menü; kart menüsü hep ilk kartı seçiyor; tutar ikinci sırada | 5 |
| 2 | **"Bunu alabilir miyim, hangi kartla?"** | 1 | iPhone'da yok (asistanda var: simulate_purchase) | 4 |
| 3 | **Abonelik / kira (her ay tekrarlayan harcama)** | 1 | Harcama formunda tekrar seçeneği yok | 4 |
| 4 | **Bu ay ne ödeyeceğim, sıradaki ödeme ne?** | 4 | Cevap üstte ama Özet 7 kartlık uzun bir sayfa | 5 |
| 5 | **Ödeme gününde hangi taksitler var?** | 2 | Kişi sayısı artınca sayfa sağa taşıp kayıyor (hata); aylık grafik Özet'te de var | 4 |
| 6 | **Ekstreyi ödendi işaretleme** | 3 | Borçlar'da büyük kart görsellerinin altında kalıyor | 4 |
| 7 | **Maaş / gelir girme** | 2 | "Varlıklar → + → Hareket ekle"; tek form dört farklı iş görüyor (gelir, gider, döviz, fon) | 4 |
| 8 | **Nakit gider (ör. kira nakit)** | 2 | Aynı form, "Yön: Çıkış" seçmek gerekiyor | 4 |
| 9 | **Harcamayı bulma / düzenleme / silme** | 3 | Arama ve kişi süzgeci iyi; Süren / Biten / Hepsi seçicisi fazladan; silme yalnızca basılı tutunca | 4 |

## Daha seyrek işler

| # | Akış | Önce | Sorun | Sonra |
|---|------|:----:|-------|:-----:|
| 10 | Kategoriye göre harcama | 2 | Özet'in en altında; tek ay; dokunulmuyor | 4 |
| 11 | Varlık hareketini düzeltme | 1 | Yalnızca silinebiliyor (update_entry var) | 4 |
| 12 | Kart ekleme / düzenleme | 3 | Kart başına büyük görsel; çok kartta sayfa çok uzuyor | 4 |
| 13 | Döviz / altın alış-satış | 3 | Genel formda; "TL ile alındı" anahtarı kafa karıştırıcı | 4 |
| 14 | Fon / hisse | 3 | Kod elle yazılıyor | 3 |
| 15 | Borç / kredi ekleme ve ödeme | 3 | İyi; liste kartın altında | 3 |
| 16 | Kişi payını tahsil etme | 3 | İyi | 3 |
| 17 | Param ay sonuna yetecek mi? (Nakit) | 3 | Özet'te üçüncü kart | 4 |
| 18 | Varlığın seyri | 4 | — | 4 |
| 19 | Ayarlar (ülke, nakit tanımı, kişiler) | 4 | — | 4 |
| 20 | Giriş / çevrimdışı / eşitleme | 4 | — | 4 |

## Kaldırılanlar (sadeleşme)

- **Özet**: Kişiler, Kategoriler ve Aylık ödemeler kartları. Özet yalnızca "bu ay ve yakında" sorusunu yanıtlıyor.
  Kişilerin payı Akış'ta ayın başlığında, kategoriler Harcamalar'da, aylık grafik Akış'ta.
- **Harcamalar**: Süren / Biten / Hepsi seçicisi → liste süren harcamalar; bitenler en altta "Biten harcamalar (n)".
- **Borçlar**: kart başına büyük görsel → sıkışık satır (renk, ad, sonraki ödeme, limit çubuğu). Toplam borç kartındaki açıklama metni.
- **Varlıklar**: 200 hareketlik uzun liste → son 10, "Tümü" ile hepsi.

## Eklenenler

- **+ düğmesi bulunduğun ekranın işini doğrudan açar** (ara seçici ekranı denendi, bir adım fazlaydı):
  Özet, Akış, Harcamalar'da dokununca Harcama formu, basılı tutunca diğer eklemeler; Varlıklar'da dokununca
  Gelir / Döviz-altın / Fon-hisse menüsü; Borçlar'da Borç verdim / Borç aldım / Kredi / Kredi kartı menüsü. Menülerin
  altında "Diğer" ile her ekleme her sekmeden yapılabilir. Nakit harcama ayrı seçenek değil, Harcama'da "Nakit".
  Ödeme kaydı (ekstre, borç taksiti, kişi payı) bağlamında kalır: ilgili satırdaki "Ödendi".
- **Harcama formu baştan**: tutar en üstte ve büyük; taksit çipleri (Peşin, 2, 3, 6, 9, 12, diğer); kartlar renkli çipler,
  son kullanılan kart seçili gelir; "Her ay tekrarlar" anahtarı (abonelik, kira).
- **Alabilir miyim?** Formda tutar yazılınca: ilk ödeme hangi ay, o ayın ödemesi önce → sonra, ay sonunda boşta kalan
  nakit (eksiye düşerse kırmızı uyarı), kartın kalan limiti; ilk ödemesi en geç gelen kart önerisi.
- **Varlık hareketleri türüne göre**: Gelir, Döviz / altın, Fon / hisse — her biri kendi sade formuyla.
- **Hareket düzenleme**: harekete dokununca form dolu açılır.
- **Kategoriler Harcamalar'da**: bu ayın dağılımı; kategoriye dokununca liste o kategoriye süzülür.
- **Geciken ekstre Özet'te**: sıradaki ödemelerde gecikmiş ekstrenin yanında "Ödendi" düğmesi.
- **Kart ayrıntısı**: karta dokununca ekstre, kalan limit, ödendi, düzenle, sil — tek yerde.

## Sekmelerin işi (tek cümle)

- **Özet** — bu ay ne ödeyeceğim, sırada ne var, param yetecek mi.
- **Akış** — önümüzdeki aylar, gün gün hangi ödeme.
- **Harcamalar** — neye harcadım, bul, düzelt.
- **Borçlar** — kartlarım, kredilerim, kim bana borçlu.
- **Varlıklar** — neyim var, nasıl değişiyor.

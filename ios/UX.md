# iPhone uygulaması — kullanıcı akışları

İlke: her ekran tek bir soruyu yanıtlar; her iş en az dokunuşla, bulunduğun ekrandan yapılır; ekranda yalnızca
gerekeni görürsün, ayrıntı istersen bir dokunuşla açılır; jargon yok.

Puan: 1 (yapılamıyor / çok zor) … 5 (hızlı ve açık). Üç sütun: 7.1.0 → ilk düzenleme → şimdiki hali.

## Sekmeler

| Sekme | Yanıtladığı soru | İçerik |
|-------|------------------|--------|
| Özet | Bu ay ne ödeyeceğim, sırada ne var, param yetecek mi? | Bu ay ödenecek, sıradaki 5 ödeme, 2 içgörü, Nakit |
| Akış | Önümüzdeki aylarda hangi gün ne ödeyeceğim? | 12 aylık grafik, ay ay ödeme günleri; "Sonraki 12 ayı da göster" |
| Harcamalar | Neye harcadım? | Liste ya da Kategoriler; kişi süzgeci, arama, bitenler altta |
| Kartlar | Kartlarım, kredilerim, kim bana borçlu? | Toplam borç, kartlar, kartından harcayanlar, borç / alacaklar |
| Varlıklar | Neyim var, nasıl değişiyor? | Varlıkların, seyri, para birimleri, fon / hisse, hareketler |

## + düğmesi

Bulunduğun ekranın işini doğrudan açar:

- Özet, Akış, Harcamalar: dokun → Harcama formu. Basılı tut → bütün eklemeler.
- Varlıklar: dokun → Gelir, Döviz / altın, Fon / hisse (altında Diğer).
- Kartlar: dokun → Borç verdim, Borç aldım, Kredi, Kredi kartı (altında Diğer).

Nakit harcama ayrı seçenek değildir: Harcama'da "Nakit" seçilir. Ödeme kaydı (ekstre, borç taksiti, kişi payı)
ilgili satırdaki "Ödendi" / "Ödedi" düğmesindedir.

## Akışlar

| # | Akış | 7.1 | 1. tur | Şimdi | Nasıl |
|---|------|:---:|:------:|:-----:|-------|
| 1 | İlk açılış | 3 | 3 | 5 | Yeni kullanıcıya karşılama: ülke → "Hesap açmadan başla" → kart → kesim günü → bir taksit → "Planın hazır" (bu ay ödenecek + hatırlatma izni); hesap isteğe bağlı ("Hesabım var, giriş yap") |
| 2 | Yeni kullanıcının ilk adımları | 1 | 1 | 5 | Özet'te "Başlarken": kart ekle, harcama ekle, maaşını ekle (yapılanlar işaretlenir; karşılamada girilenler işaretli gelir, maaş her ay tekrarlar) |
| 3 | Taksitli harcama ekleme | 3 | 5 | 5 | + → tutar, ne alındı, kart, taksit → altta Kaydet (eksik ne ise yazar) |
| 4 | Alabilir miyim, hangi kartla? | 1 | 4 | 5 | Formda tutar yazınca: ilk ödeme, o ayın ödemesi önce → sonra, gelir yetiyor mu, kalan limit, daha geç ödenen kart önerisi |
| 5 | Abonelik / kira | 1 | 4 | 5 | Harcama formunda "Her ay tekrarlar" |
| 6 | Bu ay ne ödeyeceğim? | 4 | 5 | 5 | Özet'in en üstü: büyük tutar, gelecek ay, kalan bütün taksitler |
| 7 | Ödeme gününde neler var? | 2 | 4 | 5 | Akış: ödeme gününe dokun, taksitler açılır |
| 8 | Ekstreyi ödendi işaretleme | 3 | 4 | 5 | Kartlar'da satırdaki "Ödendi"; gecikmişse Özet'te de |
| 9 | Maaş / gelir | 2 | 4 | 5 | Varlıklar → + → Gelir: tutar, ne geliri, her ay |
| 10 | Döviz / altın alış-satış | 3 | 4 | 5 | Aldım / Sattım; "parasını TL bakiyemden ödedim" |
| 11 | Harcamayı bulma / düzenleme / silme | 3 | 4 | 4 | Arama, kişi süzgeci; dokun → ayrıntı → Düzenle / Sil |
| 12 | Kategoriye göre harcama | 2 | 4 | 5 | Harcamalar → Kategoriler; kategoriye dokun → o kategorinin listesi |
| 13 | Varlık hareketini düzeltme | 1 | 4 | 4 | Harekete dokun → form dolu açılır |
| 14 | Kart ekleme / düzenleme | 3 | 4 | 4 | + → Kredi kartı; karta dokun → ayrıntı → Düzenle / Sil |
| 15 | Kredi ekleme | 2 | 3 | 5 | Banka, aylık taksit, kaç taksit, ilk taksit, otomatik ödeniyor mu; gerisi "Daha fazla"da |
| 16 | Borç verdim / aldım | 3 | 3 | 5 | Kime / kimden, tutar; isteğe bağlı taksit ya da geri ödeme tarihi |
| 17 | Borç taksiti ödeme | 3 | 3 | 4 | Borca dokun → tutar ve tarih dolu → Ödemeyi kaydet |
| 18 | Kişinin kart payını tahsil | 3 | 3 | 5 | Kartlar → Kartından harcayanlar → "Ödedi" |
| 19 | Param ay sonuna yetecek mi? | 3 | 4 | 5 | Özet → Nakit: bugün, ay sonunda, en düşük; dönem başı (maaş günü) Ayarlar'da |
| 20 | Fon / hisse | 3 | 3 | 3 | Kod elle yazılıyor (sırada: kod arama) |
| 21 | Ayarlar | 4 | 4 | 5 | Hesap, ülke, nakit (dönem başı, nakit sayılanlar), kişiler (renkleriyle) |
| 22 | Ödeme günü hatırlatması | – | – | 5 | İlk açılışta "Planın hazır" ekranında, gelecek bildirimin önizlemesiyle; sonra Özet'te sıradaki ödemelerin altında bir kez "Hatırlatayım mı?" ("Şimdi değil" → 3 gün sonra); Ayarlar → Bildirimler: kaç gün önce, saat |
| 23 | Uygulama kilidi | – | – | 5 | Ayarlar → "Face ID ile kilitle"; açılışta ve arka plandan dönünce sorar, uygulama değiştiricide tutar görünmez |

## Kaldırılanlar

- Özet: Kişiler, Kategoriler, Aylık ödemeler (Akış ve Harcamalar'da); "Son taksit: Süresiz" istatistiği.
- Nakit kartı: dönem başı menüsü (Ayarlar'a taşındı). "Dönem net" görünümü geri geldi (Bakiye | Dönem net).
- Akış: takvim simgesindeki ay sayısı menüsü (altta "Sonraki 12 ayı da göster").
- Harcamalar: Süren / Biten / Hepsi seçicisi.
- Kartlar: büyük kart görselleri (karta dokununca ayrıntıda), "Net varlık" (Varlıklar'da).
- Varlıklar: "Özvarlık" formülü, grafiğin altındaki küçük kırılım satırı, boş fon / hisse bölümü.
- Formlar: kredide "Tutar aylık taksit" anahtarı (hep aylık taksit sorulur), "Paranın el değiştirdiği gün" (Daha fazla → Tarih).
- Sözcükler: "Çevrimdışı", "Bulut senkronizasyonu", "Hareket", "Yön: Giriş / Çıkış".

## Her formda aynı

Üstte Vazgeç ve Kaydet; altta büyük Kaydet düğmesi — eksik bir şey varsa düğmede o yazar ("Tutarı yaz").
Tür seçili açılır (+ menüsünden geldiği gibi). Seyrek alanlar "Daha fazla"da.

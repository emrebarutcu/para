# Kullanıcıyı tutmak — bulgular ve yol haritası

Kasım 2026, 8.13.0. Sekiz ajanlık bir çalışmanın özeti. Beş araştırmacı baktı: iPhone'un ilk açılışı, web'in ilk
açılışı, finans uygulamalarında tutundurma araştırması, bildirim / e-posta altyapısı ve ölçüm. Sonra iki rakip tasarım
yazıldı: "önce değer" ve "önce eylem". Hakem "önce eylem"i seçti (20/25'e 14/25) ve ötekinin iyi fikirlerini ekledi.
Akışın kendisi: `Ekranlar/KarsilamaEkrani.swift`, `Uygulama/Karsilama.swift`; UX.md → akış 1.

## En önemli bulgular

- **İlk ekran bir giriş formuydu.** Hiçbir değer gösterilmeden önce e-posta ve şifre isteniyordu; "Hesap açmadan başla"
  formun en altındaydı. Kayıt çoğu zaman e-posta doğrulamasında takılıyor (Sign in with Apple yok). Web'de de aynısı var.
- **"Aha" anı geç geliyordu.** "Bu ay ödenecek" ancak bir harcama kaydedilince görünür. Kartla başlayan yol yaklaşık 12
  dokunuş ve 4 alan tutuyordu. Kesim ve son ödeme günü sorulduğu hâlde nerede yazdığı söylenmiyordu.
- **Söz ile davranış uymuyordu.** Başlarken "maaş her ay tekrarlanır" diyordu ama form tekrarı kapalı açıyordu. Tekrar
  etmeyen maaş yüzünden içgörüler yanlış alarm veriyordu ("Aralık ayında açık var").
- **Desteklenmeyen bölgede ülke sessizce Türkiye oluyordu.** Örneğin Brezilya ya da Kore'deki kullanıcı ₺ ile başlıyordu,
  oysa pt ve ko çevirileri var.
- **İlk haftada geri çağıran bir şey yok.** Hatırlatma izni yalnızca ödemesi olan kullanıcıdan isteniyordu. Kartını
  eklemeyen ve en çok kaybedilen kullanıcıya hiç ulaşılamıyor. Kesim günü bildirimi, widget ve e-posta yok.
- **Ücretsiz kullanıcı ilk gün dört kilide çarpıyor.** Akış, "Alabilir miyim?" (ilk harcama formunun içinde), İçgörüler ve
  Varlığın seyri kilitli. Kilit düğmesi Kaydet'le aynı görünüyor.
- **Ölçüm eksikti.** İlk açılış, Başlarken ve etkinleşme ölçülmüyordu. A/B yardımcısı ilk açılış denemesi
  yapamıyordu: bayrak yüklenmeden okununca maruz kalma yanlış yazılıyordu.
- **Dışarıdan bilinenler:**
  - Finans uygulamalarında D1 kaynağa göre yaklaşık %12–34 arası değişiyor; kendi tabanımızı ölçmeliyiz.
  - Denemelerin %80–90'ı kurulum günü başlıyor.
  - Bildirim izni bağlam içinde, hatırlatacak ilk şey oluşunca istenmeli (Apple'ın önerisi).
  - Türkiye'de kanca taksit ve kesim günü: kesimden hemen sonra alınan yaklaşık 40 günde ödenir.

## Bu sürümde yapılanlar (8.13.0)

- **Karşılama akışı:** ülke → "Hesap açmadan başla" → kartın adı → kesim günü (son ödeme tahmin edilir)
  → bir taksitli harcama, ödeme planı yazarken görünür → "Planın hazır" (bu ay ödenecek ya da ilk ödeme, ardından
  gelecek bildirimin önizlemesiyle hatırlatma izni). Altı dokunuş ve bir tutar yeterli. Kart ve harcama gerçek kayıttır.
- **Kim görür:** yalnızca yeni kurulum. A/B bayrağı `onboarding_flow`: `control` eski giriş ekranını gösterir. Bayrak
  yoksa ya da gelmezse yeni akış açılır. SETUP.md → Analitik → Karşılama.
- **Ortak düzeltmeler:**
  - maaş adımı "her ay" açık gelir;
  - döviz alışı gelir sayılmaz;
  - "Ülkeni seç" seçeneği eklendi;
  - girişsiz notu ilk 72 saat gizli, sonra sakin renkte;
  - hatırlatma teklifinde "Şimdi değil" 3 gün erteler.
- **Ölçüm:**
  - karşılama hunisi olayları ve `activation_reached`;
  - bayrak yüklenmeden maruz kalma yazılmıyor;
  - deneme kolu her olayda (`$feature/onboarding_flow`).

## Yol haritası

Kural: deneme sürerken ilk haftanın davranışını değiştiren bir şey yayınlanmaz, yoksa ilk hafta geri dönüşü okunamaz.
Ya denemeden önce ya bitince yayınlanır.

### Şimdi (2–4 hafta, küçük PR'lar)

1. **Bildirimler v2** (etki yüksek, çaba orta):
   - Bildirime dokununca ilgili ekran açılır ve `notification_opened` yazılır.
   - Kesim gününden bir gün önce: "Yarın Bonus kesimi: bugünkü harcama 20 Ara'da, yarından sonrakiler 20 Oca'da ödenir".
   - Pazartesi haftalık özet; boş haftada gönderilmez.
   - Dosyalar: `Hatirlatma.swift`, `CashFollowApp.swift`, Ayarlar → Bildirimler.
2. **Etkinleşmeyenleri kurtarma** (etki orta-yüksek, çaba küçük):
   - Başlarken bitmediyse 1. ve 3. gün bir yerel bildirim; en fazla iki kez.
   - Akışı atlayanlara `.provisional` (sessiz) izin.
   - Metin değer anlatır, suçlamaz: "Kartını ekle; ilk ödeme gününü hatırlatayım".
3. **Temel vaadin ücretsiz tadı** (etki yüksek, bayrak `free_taste`):
   - Akış'ın ilk 2–3 ayı ücretsiz.
   - "Gelirini ekle" gibi kurulum içgörüleri ve ilk içgörü açık.
   - Veri yokken Varlığın seyri kilidi gösterilmez.
4. **Özet ve harcama formu:**
   - Satın alma formunda ücretsiz kullanıcıya ödeme planı (`simulate_purchase` zaten veriyor). "Alabilir miyim?"
     kilidi Kaydet'e benzemeyen küçük bir kart olur.
   - Başlarken gizlenip Özet boş kalınca "Harcama ekle / Başlarken'i göster" kartı.
   - Hatırlatma teklifi "Bu ay ödenecek"in hemen altına, bildirim önizlemesiyle.

### Sonra (1–3 ay)

5. **Kilide uyan ödeme ekranı, sonra "aha"dan sonra yumuşak ödeme ekranı denemesi.** Ayrıca 7 günlük ile 1 aylık
   deneme süresi karşılaştırılır. Gelir için en büyük kaldıraç: deneme çoğunlukla ilk gün başlıyor.
6. **Hesabı değerli anda iste, Sign in with Apple ile:**
   - Türkiye'de ilk karttan sonra "Harcamalar kendiliğinden gelsin mi?" → hesap → banka e-postaları. Elle girişin en
     güçlü çaresi bu.
   - 10 kayıttan sonra ya da 7. gün yedekleme önerisi.
7. **Nakit açığı uyarısı:** bakiye sıfırın altına düşecekse iki gün önce bildirim, ayda en fazla bir kez
   (`Motor.cash`).
8. **App Intents / Kısayollar:** "Bu ay ne ödeyeceğim?" ve "Harcama ekle". Siri, Spotlight, eylem düğmesi ve Cüzdan
   otomasyonu buradan gelir.
9. **Web eşitliği:**
   - Başlarken paneli;
   - veri yokken sıfırlı panellerin gizlenmesi;
   - "Çevrimdışı devam et"in gerçek bir düğme olması;
   - iPhone'la aynı olay adları.
10. **Ölçüm boşlukları:**
    - `assistant_tool_called`;
    - hesapsız abonelerin `entitlement_changed` olayı;
    - kişi özellikleri (kart sayısı, gelir var mı, hatırlatma açık mı, Premium).

### Daha sonra (3+ ay ya da altyapı / hukuk gerekir)

11. **"Bu ay ödenecek" widget'ı** (WidgetKit): ikinci paket kimliği, App Group ve imza işi gerekir.
12. **Kesim günü mutabakatı ve seri:** "Bankandaki tutar 8.420 ₺ mi?" sorusu ve "4 ekstre üst üste zamanında" rozeti.
13. **Hedefe göre Başlarken** ("Neyi takip etmek istersin?") bir deneme kolu olarak.
14. **Örnek veriyle gezinme:** yalnızca akışın ilk ekranında kapatma oranı yüksek çıkarsa. Bellekte tutulur, gerçek
    veriye yazılmaz.
15. **Yaşam döngüsü e-postası:** Worker cron ve Brevo. Önce gizlilik metni, abonelikten çıkma bağlantısı ve İYS
    incelemesi gerekir.
16. **Mağaza:** StoreKit geri kazanma teklifleri; ücretsiz kart sınırının 2'den 3'e çıkması denenir.
17. **Ülkeler:** Brezilya, Kore, Meksika ve Hindistan `para.js` ülkelerine eklenir.
18. **Uzaktan bildirim (APNs):** sunucudan tetiklenen olay gerekene kadar ertelenir; gizlilikteki "yalnızca cihazda"
    sözünü değiştirir.

## Ölçüm

- **Etkinleşme (A1):** ilk 24 saatte ödeme planı görünür oldu (`activation_reached`).
- **Birincil karar ölçüsü: ilk hafta geri dönüş (W1).** Akış kartı ve harcamayı kendisi yazdığı için etkinleşme
  tek başına karar vermez.
- **Örneklem:** W1 %20'den %23'e çıksın diye kol başına yaklaşık 2.900 kişi gerekir, A1 %30'dan %35'e için yaklaşık 1.400.
  - Kurulum az gelirse karar A1'e göre verilir; W1 en fazla 2 puan düşebilir.
  - Kazanınca 30–60 gün %10 kontrol kolu tutulur (D30, denemeden ödemeye geçiş).
- **Koruma ölçüleri:**
  - 24 saat içinde kart / harcama düzeltme (kesim günü aceleyle yanlış girildi mi);
  - hatırlatma reddi;
  - 7 günde hatırlatmayı kapatma;
  - çökme.

## Karar bekleyenler

- PostHog'da `onboarding_flow` bayrağı açılsın mı? Önerilen adımlar:
  1. Önce 1–2 hafta kontrol tabanı toplanır.
  2. Sonra en az 14 gün 50/50 (iki ekstre dönemi).
  3. Bayrak açılmazsa herkes yeni akışı görür.
- Son ödeme günü tahmini (Türkiye'de kesim + 10, başka ülkede + 21) uygun mu? Aynı ekranda değiştirilebiliyor.
- Satın alma formunda ücretsiz kullanıcıya ödeme planı gösterilsin mi? Dürüstlük düzeltmesi, ama "Alabilir miyim?"
  ödeme ekranı görüntülenmesini azaltabilir.
- TestFlight'ta herkes yeni akışı görsün mü (bayrak koşulu)?

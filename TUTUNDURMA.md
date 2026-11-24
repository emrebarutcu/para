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

## Ürün çalışmasından yapılanlar (1.1.0)

Kasım 2026'daki ürün çalışması ("daha basit, alımlı, kolay, alışkanlık yapan") ilk açılıştan sonrasına baktı: ikinci
haftada ve üçüncü ayda uygulama neden açılsın. Karar gerektirmeyenler bu sürümde yapıldı; aşağıdaki yol haritasında
karşılıkları işaretli.

- **Özet'in tepesi yön gösterir.** "Bu ay ödenecek" ayın ilerlemesiyle (ödenen / kalan, sıradaki gün), gelecek ay bu aya
  göre hafifliyor mu, taksitlerin bittiği ay. Hesap ortak: `icgoru.js` → `progress`, `lastInstallment`.
- **Kayıt yazdırmaz.** Harcama formunda işyeri önerileri (kart, taksit ve kategori de dolar), "Yine", + düğmesinde son
  üç işyeri; kaydın sonucu kısa bantta. `icgoru.js` → `merchants`.
- **Ödül.** Biten taksidin kutlaması (kart ve bildirim), kayıtta ve ödemede başarı titreşimi. `icgoru.js` → `finishing`.
- **Geri çağıran nedenler.** Kesim gününden bir gün önce bildirim, ayın ilk günü ay özeti (`monthSummary`); bildirime
  dokununca ilgili sekme ve `notification_opened`.
- **Ödeme ekranı** çekirdek vaatle ve kullanıcının kendi 12 ayıyla açılır; yapay zekâ asistanı özellik listesinde.
- **Web** iPhone'un sadeliğine yaklaştı: değer-önce karşılama, Başlarken, 4 bloklu Özet, 5 sekme.

Karara bırakılanlar (ücretsiz / ücretli sınırı, widget ve Kısayollar, karşılama denemesi, web'den satın alma, "dene,
sonra karar ver" işleri) ayrı yürüyor. Bu sürüm ilk haftanın davranışını değiştirir: karşılama denemesi açılacaksa
aşağıdaki kural gereği bu sürümden sonra, yeni tabanla başlatılmalı.

## Karşılama denetimi (23 Kasım 2026, 1.3.5)

PostHog'daki karşılama hunisi (`onboarding_*`, `activation_reached`; 9–23 Kasım, `variant: default`). Örneklem çok küçük:
sayılar yön gösterir, karar vermez.

- **Ham huninin üçte biri gerçek değildi.** 36 "yeni kurulum"un 13'ü CI simülatörüydü (`-oz-denetim`, `-zeka-dene`:
  yayınlanmamış 1.3.x, iOS 26.5 / 27.2, kişi başına üç olay). Biri de geliştiricinin cihazı. Ham veride ilk ekranı yalnızca
  %50 geçiyor görünüyordu; gerçekte %82. Düzeltildi: simülatör olay göndermez (SETUP.md → Analitik).
- **Gerçek huni (22 kişi):**

  | Adım | Gören | Geçen | Not |
  |------|------:|------:|-----|
  | Giriş (ülke, "Hesap açmadan başla") | 22 | 18 | 2'si "Hesabım var"a dokundu, 2'si çıktı |
  | Kart | 18 | 11 | 4 "Kredi kartım yok", **6 ✕ ile kapattı (5'i Türkiye dışı)** |
  | Kesim günü | 11 | 10 | 1 "Bilmiyorum" |
  | Harcama | 15 | 7 | 6 "Şimdilik atla", 2 çıktı. **Türkiye'de kartı giren 5 kişinin hiçbiri bitirmedi**, Türkiye dışında 4/4 |
  | "Planın hazır" | 7 | – | hatırlatma teklifini gören 4 kişinin **4'ü "Şimdi değil"** |

  - Etkinleşme (`activation_reached`): 10 / 22 (%45). 3'ü akıştan sonra, uygulamanın içinde.
  - Akıştan hatırlatma izni veren hiç yok. İlk hafta ölçüsü için kohort henüz çok genç.
- **Ekran ekran:**
  - Giriş: gerekli (ülke para birimini belirler); tek karar; ülke çoğunlukla doğru önceden seçili (`started_without_account`
    → `country` dille uyuşuyor).
  - Kart: değer katıyor ama Türkiye dışında en büyük kayıp. Neden bilinmiyor: ✕'te adımda geçen süre yazılmıyordu.
  - Kesim: gerekli, iyi geçiliyor.
  - Harcama: aha'nın tek kapısı. Türkiye'de başlık evet / hayır sorusuydu ("Taksitle aldığın bir şey var mı?"), cevap
    "hayır" olunca "Şimdilik atla" doğal seçenekti. Hatırlamak da yük (tutar, taksit, ne zaman).
  - "Planın hazır": hatırlatma teklifi "Bir harcama daha ekle"nin altındaydı. Altta yalnızca "Hatırlat / Şimdi değil"
    vardı, teklif ise ekranın aşağısında kalıyordu.
  - İzinler: yalnızca bildirim, bağlam içinde, önizlemeyle (doğru yer). ATT yok. Paywall akışta yok, kilitte açılır (doğru).
- **Yapılanlar (1.3.5):**
  - Simülatör ve CI analitiği kapalı (`Analitik.otomasyon`, denemek için `-analitik`).
  - Türkiye'de harcama başlığı iş söyler: "Taksitli bir alışverişini yaz", altında "Yaklaşık tutar yeter; sonra
    düzeltebilirsin." Taksit ikincil olan ülkelerde soru kaldı (orada bitiriliyordu).
  - Hatırlatma teklifi "Planın hazır"da tutarın hemen altında.
  - Ölçüm: `onboarding_closed` ve `onboarding_step_skipped`'a `seconds`, `onboarding_aha_viewed`'e `reminder_offered`.
- **Nasıl okunur (A/B yok, önce / sonra):** kohort sınırı 1.3.5'in App Store'a çıktığı gün (`$app_version`).
  - Birincil: ilk hafta geri dönüş (1–7. günde `app_opened`).
  - Adım ölçüleri: Türkiye'de harcama adımı bitirme (`onboarding_step_completed` purchase / `onboarding_step_viewed`
    purchase; ülke `started_without_account` → `country`'den); hatırlatma kabulü (`reminders_enabled` source onboarding /
    `onboarding_aha_viewed` reminder_offered = true).
  - Eşik: her kohortta en az 30 kişi bu adıma gelmeden yorum yapılmaz. Bugünkü hızla (günde 1–2 gerçek kurulum) 3–4 hafta.
  - Koruma: 24 saatte harcama düzeltme (yaklaşık tutar yanlış kaydı artırır mı), `onboarding_closed` purchase.
- **Karara bırakılanlar (uygulanmadı):**
  1. *Kart adımında Türkiye dışı ✕*: kart / kesim yerine önce harcamayla başlayan yol (BNPL ve banka kartı kullananlar).
     Önce yeni `seconds` verisi beklenmeli (anında mı kapatıyorlar, uğraşınca mı?).
  2. *Harcamayı atlayan kartlı kullanıcı*: akış bitiyor, "Planın hazır" ve hatırlatma hiç görünmüyor. Kesim günü bilindiği
     için "kesimden sonraki alışverişin şu gün ödenir" ekranı ve hatırlatma teklifi gösterilebilir (yeni ekran: karar).
  3. *Sign in with Apple* ve "Hesabım var" yolu: girişte 2 / 22 hesap yoluna gitti; asıl kayıp burada değil, öncelik düşük.
  4. *Ücretsiz / ücretli sınırı*: akışta paywall yok; ilk gün kilitlere çarpma (`paywall_shown` → `reason`) ayrı incelenmeli.
  5. *PostHog ayarları* (kullanıcı değiştirir): "Discard client IP data" proje ayarında kapalı görünüyor (`anonymize_ips:
     false`), SETUP.md açık olmasını istiyor. Test hesabı süzgecine (cohort 688252) eski CI kişileri eklenebilir.

## Karşılamada Premium: yapay zekâ asistanı (1.4.0)

Kullanıcı kararı (24 Kasım 2026): karşılamada Premium'a, özellikle yapay zekâ asistanına yönlendirme.

- **Yer:** "Planın hazır"dan sonra ayrı bir ekran. Yalnızca Premium'u olmayan ve "Planın hazır"ı gören kullanıcıya
  çıkar (etkinleşmeden sonra). Hatırlatma sorusu aynı ekranda kalır, onunla yarışmaz. "Önce değer, sonra ödeme ekranı"
  kuralına uyar. Harcamayı atlayan kullanıcı bu ekranı görmez.
- **İçerik:** "Kartlarını yapay zekâya sor", kullanıcının kendi sıradaki ödemesiyle örnek soru ve cevap. Altında üç
  madde: ekstreden taksit ekleme, cümleyle kayıt, almadan önce sorma. Not: asistan Premium'da ve hesap ister.
  "Premium'u gör" ödeme ekranını açar; orada asistan özelliklerde ilk sırada. "Şimdi değil" ve ✕ akışı bitirir.
- **Not:** ödeme ekranındaki yapay zekâ başlığı ve örnek sohbet daha önce çekirdek vaat için kaldırılmıştı (UX.md →
  Kaldırılanlar). Bu ekran ödeme ekranının yerine geçmez, ondan önce gelir.
- **Ölçüm (önce / sonra, A/B yok):**
  - `onboarding_step_viewed` assistant → `onboarding_step_completed` assistant `method: paywall`;
  - `paywall_shown` `reason: onboarding_ai` → `purchase_completed`, deneme başlangıcı;
  - ilk hafta geri dönüş (birincil) 1.3.5 kohortuyla karşılaştırılır. Fazladan bir ekran ve erken ödeme ekranı geri
    dönüşü düşürebilir;
  - koruma ölçüleri: `onboarding_closed` assistant, hatırlatma kabulü (bu ekrandan önce sorulur, etkilenmemeli),
    7 günde silme / geri gelmeme.
- **Açık soru:** asistan hesap istiyor, karşılama ise hesapsız başlıyor. Premium alıp asistanı bağlamak isteyen
  kullanıcı Ayarlar → Hesap'a gitmeli. Sign in with Apple bu adımı kısaltır (karar bekliyor).

## Yol haritası

Karşılama denemesi yapılmadığı için (aşağıda "Verilen kararlar") ilk haftayı değiştiren işler beklemeden yayınlanır;
etkileri önce / sonra kohortlarıyla okunur.

### Şimdi (2–4 hafta, küçük PR'lar)

1. **Bildirimler v2** (etki yüksek, çaba orta):
   - ✓ (1.1.0) Bildirime dokununca ilgili sekme açılır ve `notification_opened` yazılır.
   - ✓ (1.1.0) Kesim gününden bir gün önce: "Yarın Bonus kesimi" — yarına kadarki ve sonraki alışverişin son ödeme günü.
   - ✓ (1.1.0) Taksit bitince ve ayın ilk günü ay özeti (çalışmadan; haftalık yerine aylık ritim).
   - Pazartesi haftalık özet; boş haftada gönderilmez. (Açık: ay özeti yeterli mi, ölçüme göre.)
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
8. **App Intents / Kısayollar** (yapıldı, 1.2.0): "Bu ay ne ödeyeceğim?" ve "Harcama ekle". Siri, Spotlight, eylem düğmesi ve Cüzdan
   otomasyonu buradan gelir.
9. **Web eşitliği:** ✓ (1.1.0)
   - Başlarken paneli;
   - veri yokken sıfırlı panellerin gizlenmesi;
   - "Çevrimdışı devam et"in gerçek bir düğme olması ("Hesap açmadan başla", karşılamanın birincil düğmesi);
   - iPhone'la aynı olay adları (`started_without_account`, `onboarding_step_opened`, `onboarding_hidden`, `purchase_added`).
10. **Ölçüm boşlukları:** (`notification_opened` ve `purchase_added`'ın `source` alanı 1.1.0'da eklendi)
    - `assistant_tool_called`;
    - hesapsız abonelerin `entitlement_changed` olayı;
    - kişi özellikleri (kart sayısı, gelir var mı, hatırlatma açık mı, Premium).

### Daha sonra (3+ ay ya da altyapı / hukuk gerekir)

11. **"Bu ay ödenecek" widget'ı** (WidgetKit): ikinci paket kimliği, App Group ve imza işi gerekir.
12. **Kesim günü mutabakatı ve seri:** "Bankandaki tutar 8.420 ₺ mi?" sorusu ve "4 ekstre üst üste zamanında" rozeti.
    (Biten taksidin kutlaması 1.1.0'da geldi; mutabakat ve seri açık.)
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

## Verilen kararlar (13 Kasım 2026)

- **İyi haber içgörüleri ücretsiz:** serbest nakit, son taksit, bugünün kartı (`icgoru.js` `FREE`). Biri Özet'in tepesinde
  tek satır (`headline`); sıralama uyarı → iyi haber → bilgi. Uyarılar ve öneriler Premium'da.
- **Ücretsizde 2 kişi** (kullanıcı ve eşi gibi biri); kart sınırı 2 kaldı.
- **Kısayollar ve widget öne alındı:** sıra App Intents ("Harcama ekle", "Bu ay ne ödeyeceğim?") → banka SMS'i ve Cüzdan
  otomasyon rehberi (tetikleyiciler gerçek cihazda doğrulanmadan yazılmaz) → WidgetKit (küçük, orta, kilit ekranı).
- **Karşılama denemesi yapılmıyor:** yeni akış herkese açık, `onboarding_flow` okunmaz; önce / sonra kohortlarıyla
  ölçülür. "Deneme sürerken ilk haftayı değiştiren şey yayınlanmaz" kuralı kalktı.
- **Web'den satın alma şimdi yok:** web kilitlerinde App Store bağlantısı ve (geniş ekranda) QR var.
- **Asistanda özet okuması ücretsiz** (`get_overview`: bu ay ödenecek, sıradaki ödemeler); öbür araçlar ve yazma Premium.
- **Akış'ın ilk 2 ayı ücretsiz** (bu ay ve sonraki ay; 14 Kasım): sonrası ve iPhone'da 12 aylık grafik Premium. Bayrak
  `free_taste`: `off` kolu kapatır, bayrak yoksa açık.
- **Denemeler (15 Kasım):** tek satırla kayıt yapıldı (`taksit.js` `parseLine`; 31 örnek cümle testte). Kartlar ve Varlıklar
  tek "Durum" sekmesinde birleşti (PostHog'daki `tab_viewed` paylarına bakılmadan; `tab_viewed` hâlâ `cards` / `assets`
  ayrı yazar, etkisi oradan izlenir). Ekstre yükleme yapılmadı: kullanıcı yormadan asistana (MCP) yönlendirilir —
  + menüsünde "Ekstreden ekle", Harcamalar'da bir kez görünen ipucu, asistan ekranında kopyalanan hazır istek;
  asistanın yönergesinde ekstre okuma kuralları (`mcp/tools.js`).

## Karar bekleyenler

- Son ödeme günü tahmini (Türkiye'de kesim + 10, başka ülkede + 21) uygun mu? Aynı ekranda değiştirilebiliyor.
- Satın alma formunda ücretsiz kullanıcıya ödeme planı gösterilsin mi? Dürüstlük düzeltmesi, ama "Alabilir miyim?"
  ödeme ekranı görüntülenmesini azaltabilir.

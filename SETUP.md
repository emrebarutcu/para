# CashFollow — Kurulum

## 1. Supabase (cloud sync)

1. [supabase.com](https://supabase.com) → New project oluştur
2. **SQL Editor** → `supabase/tablolar.sql` dosyasını çalıştır. Kişiler (`people`), kartlar (`cards`),
   harcamalar (`purchases`), varlık hareketleri (`entries`) ve borçlar (`debts`: kişiyle borç / alacak, banka kredisi
   ve bunların ödemeleri, kart ekstresi ödemeleri `card_id` ile; `kind` ile ayrılır) ayrı tablolardır; her kullanıcı
   yalnızca kendi satırlarını görür (RLS). Kartın ekstre takibi `cards.track_since` / `cards.track_off`, ödeme modu
   `cards.manual_since` sütunlarındadır (bölüm 4 → Borçlar ve alacaklar).
   Dosya daha önce çalıştırıldıysa yeniden çalıştırmak eksik tabloyu ve sütunları ekler.

   **Eski kurulumdan geçiş** (veri `cashflow_data`'da tek JSON olarak duruyorsa): aynı dosya, yeni sürüm yayınlanmadan
   **önce** bir kez çalıştırılır. Herkesin JSON'unu tablolara taşır (`cashflow_data` silinmez) ve geçiş döneminde
   önbellekteki eski sürümün yazdıklarını tablolara aktaran bir tetikleyici kurar. Sonuç dosyanın sonundaki kontrol
   sorgusu (yorum içinde) ayrıca çalıştırılarak görülür; bütün cihazlar yeni sürüme geçince tetikleyici kaldırılabilir (dosyadaki açıklamaya bak).

3. **Settings → API** sayfasından al:
   - Project URL
   - anon/public key

4. `config.js` dosyasını aç, değerleri yapıştır:

```js
window.SUPABASE_URL      = 'https://xyzxyz.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGci...';
```

### Giriş e-postaları (Brevo SMTP)

Kayıt doğrulama ve şifre sıfırlama e-postalarını Supabase gönderir. Hazır e-posta servisi yalnızca Supabase
organizasyonundaki ekip üyelerine ve saatte birkaç e-posta gönderdiği için kendi SMTP'miz tanımlıdır: **Brevo**
(ücretsiz planda günde 300 e-posta). Gönderen `noreply@cashfollow.app`; Brevo kök alan adında doğrulanır (DKIM `brevo1/brevo2._domainkey`,
DMARC `_dmarc`). Geri dönen e-postalar `mail.cashfollow.app`'e (Brevo'ya CNAME) gider; kök alan adındaki Cloudflare Email
Routing MX'i (banka e-postaları, bölüm 6) ve SPF'i olduğu gibi kalır.

1. **Brevo → Senders, Domains & Dedicated IPs → Domains → Add a domain** → `cashfollow.app`. Brevo'nun verdiği
   doğrulama, DKIM ve DMARC kayıtları Cloudflare DNS'e eklenir (CNAME'ler proxy'siz, gri bulut) → **Authenticate**.
2. **Senders → Add a sender**: `CashFollow`, `noreply@cashfollow.app`.
3. **Ayarlar → SMTP & API → SMTP**: **Generate SMTP key** (API key değil). Aynı sayfadaki **Login** kullanıcı adıdır.
4. **Supabase → Authentication → Emails → SMTP Settings** → Enable custom SMTP:
   sender `noreply@cashfollow.app` / `CashFollow`, host `smtp-relay.brevo.com`, port `587`,
   username Brevo'daki Login, password SMTP key.
5. **Authentication → Rate Limits**: özel SMTP'de e-posta sınırı saatte 30'dur, gerekirse artırılır.
6. **E-posta şablonları** `supabase/eposta-sablonlari/`'ndadır. `sh supabase/sablonlar.sh` (SUPABASE_ACCESS_TOKEN ile) hepsini
   konularıyla Supabase'e yükler; elle de Authentication → Emails → Templates'te **Message body**'ye (Source) ve **Subject**'e
   yapıştırılabilir:

   | Supabase şablonu | Dosya | Konu |
   | --- | --- | --- |
   | Confirm signup | `hesap-dogrulama.html` | CashFollow hesabını doğrula |
   | Reset password | `sifre-sifirlama.html` | CashFollow şifreni sıfırla |
   | Change email address | `eposta-degisikligi.html` | CashFollow e-posta adresini değiştir |

   Bağlantılar Supabase'in adresine değil uygulamaya gider: `{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=…`. Uygulama
   (`sync.js` → `handleEmailLink`) bağlantıyı `verifyOtp` ile doğrular; şifre sıfırlamada yeni şifre formunu açar. Gönderenle
   bağlantının alan adı aynı olduğu için spam filtrelerine daha az takılır, bağlantıya önceden tıklayan e-posta tarayıcıları
   da tek kullanımlık bağlantıyı tüketemez. **Site URL** `https://cashfollow.app` olmalı (bölüm 2); logo
   `{{ .SiteURL }}/icon-192.png`'den gelir. Şablonlardaki "1 saat geçerlidir" Supabase'in varsayılan süresidir
   (Authentication → Providers → Email → Email OTP Expiration).

E-posta gelmezse önce **Brevo → Transactional → Email logs**'a bakılır. Uygulama kayıttan sonra ve doğrulanmamış hesapla
girişte "Doğrulama e-postasını yeniden gönder" gösterir; adres zaten kayıtlıysa (Supabase bu durumda başarılı döner ama
e-posta göndermez) kayıt yerine girişe yönlendirir.

## 2. Yayın (Cloudflare Workers → cashfollow.app)

Site, `para` adlı bir Cloudflare Worker'dır (Workers Builds, ayarları `wrangler.jsonc`): statik dosyalar kök dizinden sunulur
(`.assetsignore`'dakiler hariç), yalnızca MCP adresleri Worker kodundan geçer (`mcp/worker.js`).

1. Cloudflare → **Workers & Pages** → Create → **Import a repository** → `emrebarutcu/para`, Worker adı `para`
   (adı `wrangler.jsonc`'teki `name` ile aynı olmalı), build komutu boş, deploy komutu `npx wrangler deploy`
2. Worker → Settings → **Domains & Routes** → `cashfollow.app` (ve istersen `www.cashfollow.app`)
3. Supabase → Authentication → **URL Configuration**: Site URL `https://cashfollow.app`, Redirect URLs'e `https://cashfollow.app/**`

`main`'e her birleştirmede site kendiliğinden yayınlanır. Güvenlik ve önbellek başlıkları `_headers` dosyasında.
Netlify'da da çalışır (`netlify.toml`); yeni adres yerleştikten sonra eski site kapatılabilir.

### Sürüm

Uygulamanın sürümü `version.js`'tedir (`MAJOR.MINOR.PATCH`, ör. `1.4.2`) ve Ayarlar'ın altında görünür. `main`'e açılan
her PR sürümü artırır:

```sh
scripts/surum.sh          # PATCH: 1.4.2 → 1.4.3
scripts/surum.sh minor    # MINOR: 1.4.2 → 1.5.0
scripts/surum.sh major    # MAJOR: 1.4.2 → 2.0.0
```

Hangisinin artacağı, değişikliğin kodun dışında kalan ve bizim yönetmediğimiz şeyleri bozup bozmadığına göre seçilir:
cihazlarda önbellekte kalan eski sürümler (aynı tablolara yazmayı sürdürürler), Supabase şeması, asistanların çağırdığı
MCP araçları ve kullanıcının mevcut verisinin anlamı.

| | Ne zaman | Örnek |
| --- | --- | --- |
| **MAJOR** | Eski sürümü bozan ya da yayından önce elle SQL gerektiren şema değişikliği; MCP aracının kaldırılması, adının ya da parametre / cevap biçiminin uyumsuz değişmesi; mevcut verideki tutarları ya da ödeme tarihlerini değiştiren hesaplama kuralı (kesim / son ödeme, taksitin düştüğü ay); bir özelliğin ya da içe aktarma biçiminin kaldırılması | JSON'dan ayrı tablolara geçiş |
| **MINOR** | Geriye uyumlu yeni yetenek: yeni sekme ya da özellik, yeni MCP aracı ya da isteğe bağlı parametre, eklemeli şema değişikliği (yeni tablo, varsayılanı olan sütun), veri ve davranışı aynı bırakan büyük arayüz değişikliği | Varlıklar sekmesi, banka e-postaları, giriş penceresi |
| **PATCH** | Yeni yetenek yok: hata düzeltmesi, metin, stil, performans, belgeler, yalnızca altyapı (Worker paketleme, önbellek başlıkları) | Çıkışta verinin temizlenmesi |

Bir PR'da birden fazla değişiklik varsa en yükseği belirler; kararsız kalınırsa yükseği seçilir. MAJOR'da bu dosyaya
yükseltme notu (çalıştırılacak SQL, MCP kullananların dikkat edeceği) yazılır. Mağaza sürümü (App Store
`CFBundleShortVersionString`) gönderim anındaki web sürümüdür; Google Play `versionCode`'u ondan üretilir:
`MAJOR × 1000000 + MINOR × 1000 + PATCH` (ör. `1.4.2` → `1004002`).

`.github/workflows/surum.yml` ("Sürüm" denetimi) sürüm main'dekinden büyük değilse PR'ı kırmızıya çeker.
GitHub → Settings → Branches → `main` kuralında şu ikisi açılmalı: **Require status checks to pass** (altında **Sürüm**)
ve **Require branches to be up to date before merging**. İkincisi olmazsa paralel iki PR aynı sürümü yazıp ikisi de
birleşebilir (aynı satırdaki aynı değişiklik git'te çakışma sayılmaz); PR main'i alınca denetim yeniden çalışır,
aynı sürüm yakalanır ve sürüm yeniden artırılır.

Service worker önbelleğinin adı sürümden gelir; yeni sürüm yayınlanınca cihazlardaki eski dosyalar kendiliğinden yenilenir.

### Yükseltme notları

- **5.0.0** — Borçlar sekmesi: kişilerle borç / alacak, banka kredisi, kart borcu ve kartta diğer kişilerin payları
  (alacak); "Varlık = Özvarlık + Borç"; kart ve borçta ödeme modu (otomatik ya da elle **Ödendi**). Yeni tablo `debts`
  (kart ekstresi ödemeleri `debts.card_id` ile) ve yeni sütunlar `cards.track_since`, `cards.track_off`,
  `cards.manual_since`. Yayından **önce** `supabase/tablolar.sql` yeniden çalıştırılır (`sh supabase/sql.sh
  supabase/tablolar.sql`; yalnızca eksik tabloyu, sütunları ve kısıtları ekler; 5.0 önizlemesi için çalıştırıldıysa
  yeniden çalıştırılır); tablo ve sütunlar yoksa yeni sürüm eşitleyemez. 5.0'a geçen cihaz ilk eşitlemede bütün
  satırları yeniden çeker (SCHEMA 6; 5.0 önizlemesiyle eşitlemiş cihaz da bir kez). Mevcut verinin anlamı değişir:
  5.0'ın ilk açıldığı gün bütün kartlar o günden takibe girer; bundan sonra son ödeme günü geçen ekstreler, son ödeme
  gününün ertesi günü ilk kişinin TL varlık bakiyesinden düşer (otomatik mod, varsayılan); kullanıcının kartlarında
  diğer kişilerin sonraki taksitleri onlardan alacak olur. Kart ödemesini elle nakit harcama (ya da tekrarlayan çıkış)
  olarak girenlerde bundan sonraki ekstreler iki kez düşer: bu kayıtlar (tekrarlayansa sonraki tekrarları) silinmeli ya
  da o kartın takibi kart formunda kapatılmalı. Takip başlamadan ödenmiş ekstreler düşülmez; ilk açılışta bakiye
  değişmez. Önbellekteki 4.x sürümleri borçları görmez ve takip sütunlarına dokunmaz (upsert yalnızca gönderilen
  sütunları değiştirir): bakiyeleri borç hareketleri ve düşülen ekstreler olmadan gösterir, kişi ya da kart silerken
  borçlarını / kart ödemelerini silmez (5.0 sahibi olmayan kaydı göstermez); 4.x'te eklenen kart, 5.0'ın onu ilk
  gördüğü günden takiptedir. Yeni sürüm etkinleşince aynı cihazda açık kalan 4.x sekmeleri yeniden yüklenir (service
  worker, yalnızca ana sürüm değişince); eski kod yeni verinin üstüne yazmaz. Takip tarihi yalnızca uzak veri gerçekten
  çekildikten sonra yazılır, başka cihazın önceki tarihi ezilmez. Özet'te "Kalan borç" artık "Kalan ödeme" (tutar aynı). MCP: yeni araçlar `list_debts`,
  `get_debt`, `add_debt`, `update_debt`, `delete_debt`, `pay_debt`, `delete_debt_payment`; `update_card`'a isteğe bağlı
  `track_statements`, `track_since`, `auto_pay`, `add_card`'a `auto_pay`; cevaplara eklenenler: `get_assets` →
  `receivablesTry`, `debtsTry`, `totalAssetsTry`, `netWorthTry`, `untrackedCardDebtTry`, `cardTracking`; `list_cards` →
  `tracking` (`autoPay`, `unpaid`, `overdue`), `statement`, `payments`; `update_card` / `delete_card` →
  `balanceChangeTry`; `delete_card` → `deletedPayments`; `get_overview` → `debts` (`unpaidCardStatements`), kartlarda
  `autoPay`; `list_debts` → `cardCredit`; `list_people` → `owesUser`; `delete_person` → `deletedDebts`,
  `deletedCardPayments`, `deletedSharePayments`; `import_data` → `debts`; `export_data`
  borçları da verir. **Uyumsuz:** `get_assets` TL bakiyesi artık takipteki kartların ödenen ekstrelerini düşer ve borç
  hareketlerini içerir; takipte kart varken `paylar` içgörüsü yerine `alacak` gelir.
- **4.0.0** — Tek çıkış formu ve her N gün / hafta / ayda bir tekrar. Yeni sütunlar: `purchases.asset`,
  `purchases.repeat_count`, `purchases.repeat_every`, `purchases.repeat_unit`, `entries.repeat_every`,
  `entries.repeat_unit`. Yayından **önce** `supabase/tablolar.sql` yeniden çalıştırılır (`sh supabase/sql.sh
  supabase/tablolar.sql`; yalnızca eksik sütunları ekler); sütunlar yoksa yeni sürüm eşitleyemez. Mevcut verinin anlamı
  değişir: kartsız (nakit) harcamalar artık TL varlık bakiyesinden düşer. Önbellekteki 3.x sürümleri yeni sütunları
  yazmaz, olduğu gibi bırakır; tekrarlayan harcamayı tek seferlik, döviz harcamasını TL gösterir. 4.0'a geçen cihaz ilk
  eşitlemede bütün satırları yeniden çeker. MCP: harcama araçlarına isteğe bağlı `asset`, `repeat`, `repeat_every`,
  `repeat_unit`; varlık araçlarına `repeat_every`, `repeat_unit`. **Uyumsuz:** cevaplardaki `repeat.every` artık sayı
  (`"month"` yerine; birim `repeat.unit`'te); `get_assets` nakit harcamaları düşer.
- **3.0.0** — Harcama kategorisi (`purchases.category`, `purchases.category_by`). Yayından **önce**
  `supabase/tablolar.sql` yeniden çalıştırılır (`sh supabase/sql.sh supabase/tablolar.sql`; yalnızca eksik sütunları
  ekler); sütunlar yoksa yeni sürüm eşitleyemez. Önbellekteki 2.x sürümleri kategoriyi yazmaz, olduğu gibi bırakır
  (upsert yalnızca gönderilen sütunları değiştirir). 3.0'a geçen cihaz ilk eşitlemede bütün satırları yeniden çeker.
  MCP: harcama araçlarına isteğe bağlı `category`, cevaplara `category` / `categoryName`; yeni araçlar `get_insights`,
  `spending_by_category`, `simulate_purchase`. Kaldırılan ya da uyumsuz değişen araç yok.
- **2.0.0** — Kartın eski kesim / son ödeme günleri (`cards.history`) ve tekrarlayan varlık hareketleri
  (`entries.repeat_count`). Yayından **önce** `supabase/tablolar.sql` yeniden çalıştırılır
  (`sh supabase/sql.sh supabase/tablolar.sql`; zararsızdır, yalnızca eksik sütunları ekler); sütunlar yoksa yeni sürüm
  eşitleyemez. Önbellekteki 1.x sürümleri yeni sütunları yazmaz, olduğu gibi bırakır: kartın bütün ödemelerini bugünkü
  günlerle, tekrarlayan hareketi tek seferlik gösterir. 2.0'a geçen cihaz ilk eşitlemede bütün satırları yeniden çeker
  (eşitleme tabanı yeni satır biçimine çevrilir), 1.x'in görmediği eski günler ve tekrarlar böylece cihaza gelir.
  MCP: `update_card` günler değişince, karttaki harcamaları etkiliyorsa `transition` ister (araç seçenekleri hata olarak
  döndürür, asistan kullanıcıya sorup yeniden çağırır); varlık araçlarına isteğe bağlı `repeat` parametresi, cevaplara
  `repeat` alanı eklendi; `get_assets` tekrarlayan hareketin yalnızca tarihi gelmiş tekrarlarını sayar.

## 3. Mobil (iPhone / Android)

**iPhone (Safari):**  
Paylaş butonu → "Ana Ekrana Ekle"

**Android (Chrome):**  
Menü → "Uygulamayı yükle" ya da adres çubuğundaki install simgesi

---

Sync çalışma mantığı (`sync.js`, `tablo.js`): Veri cihazda localStorage'da durur, uygulama çevrimdışı da çalışır.
Giriş yapmamış kullanıcıya ilk açılışta giriş / kayıt penceresi çıkar; altındaki "Çevrimdışı devam et" seçilirse
pencere bir daha çıkmaz (`para.offline`), Özet'in üstünde verilerin yalnızca bu cihazda durduğunu söyleyen bir not görünür.
Girişsiz kullanımın verisi `cashflow.v1`'de, hesabınki `cashflow.v1.<kullanıcı id>`'de durur. Girişsizken veri girilmiş
cihazda giriş yapılınca kullanıcı seçer: **Hesabıma taşı** (önce hesaptaki veri çekilir, cihazdakiler eklenir; aynı id'li
kayıt bir kez, aynı adlı kişi ve aynı son 4 haneli / aynı adlı kart birleşir, kartta erken takip tarihi kalır —
`Tablo.combine`) ya da **Sil, hesabımdakilerle devam et**. Seçilene kadar cihazdaki veri silinmez, pencere her girişte
yeniden çıkar.
Her kayıttan 1.5s sonra yalnızca değişen kişi / kart / harcama / varlık hareketi / borç satırları yazılır (borç, alacak,
kredi ve ödemeleri tek tabloda, `debts`; ödeme borcundan önce yazılabilir, sıra önemsizdir); silinenler satırdan kalkmaz,
`deleted_at` ile işaretlenir. Uygulama açılınca, öne gelince ve başka cihaz (ya da asistan) yazınca (Realtime)
son okumadan beri değişen satırlar çekilir. Aynı anda farklı kayıtlar değişirse hepsi korunur; aynı kayıt iki
cihazda değişirse sonra yazan kazanır. Hiç eşitlenmemiş cihazda buluttaki veri esastır.

## 4. Kartlar ve nakit akışı

Uygulama altı sekmeden oluşur: **Özet** (bu ayın ödemesi, içgörüler, dönemlik nakit grafiği, sıradaki ödemeler,
kişiler, kategoriler, aylık grafik),
**Akış** (ödemeler ay ay, tarih + kart bazında, borç ve kredi ödemeleri her ayın altında ayrı; "Tablo" görünümü Excel'deki
ay × kişi özeti), **Harcamalar** (mobilde "Harcama"), **Kartlar**, **Borçlar** ve **Varlıklar**. Yeni harcama
(Varlıklar'da yeni hareket, Borçlar'da borç ya da alacak) `+` düğmesiyle eklenir; içe/dışa aktarma ve tema ayarlardadır.

Özet'in üstündeki tutar yine kart ve nakit taksitleridir; borç ve kredi taksitleri altında ayrı satırdadır
("+ ₺5.500 borç ödemesi", dokununca Borçlar) ve sıradaki ödemelere karışır. Eski "Kalan borç"un adı **Kalan ödeme**
oldu, tutarı aynı (seçilen aydan başlayarak ödenecek kart ve nakit taksitleri); kişilerde "borç yok" yerine "kalan yok".

**Kartlar** sekmesinde her kart için ad, limit, hesap kesim günü ve son ödeme günü girilir.
Harcama eklerken tarih ve kart seçilir (ya da "Nakit / banka kartı"):

- Kesim günü dahil o güne kadarki harcama o ayın ekstresine, sonrası bir sonraki ayın ekstresine girer.
- Ekstre, son ödeme günü kesimden sonraysa aynı ay, değilse bir sonraki ay ödenir
  (ör. kesim 12 / son ödeme 22 → 12 Eki ekstresi 22 Eki'de; kesim 25 / son ödeme 5 → 25 Eki ekstresi 5 Kas'ta).
- Taksitler sonraki ekstrelere birer ay kayarak düşer. Ay kısaysa gün ayın son gününe çekilir.
- Nakit harcama kendi gününde ödenir.
- Kartın kesim ya da son ödeme günü değiştirilirken karttaki harcamalar etkileniyorsa uygulama arada kalanların ne
  olacağını sorar: **açık ekstre eski günlerle kesilsin** (yeni günler sonraki ekstreden başlar), **yeni günler hemen
  başlasın** (kesilmiş ekstreler kalır, henüz kesilmemişler yeni günlere göre bir ekstreye girer) ya da **günleri yanlış
  girmiştim** (şimdiki günlerle hesaplananlar, geçmiş dahil, yeni günlerle; daha önceki gün değişiklikleri kalır). Kesilmiş ekstrelerin günleri kartta saklanır (`history`).

Kart limiti, bugünden sonra ödenecek taksitlerin toplamıyla dolar; elle ödenen kartta (aşağıda) ödenmemiş geçmiş
ekstreler de limitte kalır, ön ödeme düşülür (`B.cardUsed`).

Harcama formu sade tutulur: görünen yalnızca tutar (Türkçe yazım: `1.250,50`), ne alındığı (önceki harcamalardan öneri),
taksit ("Diğer" ile istenen sayı; taksitliyse "Yazdığım tutar taksit başına" kutusu) ve kart; altta tek satır özet
(taksit × tutar, toplam, ilk ödeme). Tarih (varsayılan bugün; Bugün / Dün kısayolu), kategori (kendiliğinden önerilir;
emin olunamazsa "… olabilir" önerisine dokunulur) ve kişi (tek kişide gizli) tek satırdır, dokununca açılır. Başka bir
kartla ilk ödeme en az 10 gün daha geç geliyorsa tek satır ipucu çıkar, dokununca o kart seçilir. Uyarı yalnızca kart
limiti aşılıyorsa. Düzenlemede ödenen / kalan taksit ve açılır ödeme planı; **Kopyala** aynı harcamayı bugünün
tarihiyle yeni harcama olarak açar. Kategori elle seçilmediyse kaydedince verilir: kullanıcının aynı işyerine önceki
seçimi hemen, modelin önerisi kayıttan sonra (açıklama değiştiyse önceki otomatik kategori yenilenir; elle seçilen
kategoriye dokunulmaz).

### Varlıklar: TL, dolar, euro, gram altın

**Varlıklar** sekmesinde tarihli girişler (maaş, döviz ya da altın alımı) ve çıkışlar tutulur. Çıkış harcamadır: tek
form, harcama formu. Varlık formunda **Çıkış** seçilince yazılanlar harcama formuna taşınır; harcama formunda kart, taksit,
tekrar ve **Varlık** (TL, dolar, euro, gram altın) seçilir. Döviz ve altın harcaması kartsız ve peşindir, TL ödeme
akışına girmez. Kartsız (nakit) harcamalar ödendikçe o varlığın bakiyesinden düşer ve Varlıklar'daki listede çıkış olarak
görünür. Eski sürümlerden kalan çıkış hareketleri de harcama formunda açılır; kaydedilince harcamaya dönüşür.
Miktar varlığın kendi birimindedir (altında gram); bakiye girişlerden nakit harcamalar düşülerek bulunur, borç
hareketleri ve takipteki kartların ödenen ekstreleri de bakiyeye işler (aşağıda). Her varlığın ve toplamın TL karşılığı
güncel satış kuruyla gösterilir. Üstteki **Varlık** alacakları da içerir ("₺3.000 alacak dahil"; ayrıca **Alacak**
kutusu), altındaki "= Özvarlık + Borç" satırı Borçlar'a götürür.

Giriş de harcama da tekrarlanabilir (maaş, kira, abonelik, haftalık market): formdaki **Tekrar** ile günde, haftada,
ayda bir ya da **Diğer**le her N gün / hafta / ayda bir (`tekrar.js`); süresiz ya da N kez. Aylık tekrar ilk tarihin
gününde düşer (ay kısaysa ayın son günü); bakiyeye yalnızca tarihi gelmiş tekrarlar girer. Tekrarlayan harcamanın her
tekrarı kendi tarihiyle ayrı bir alışveriştir (kartlıysa kendi ekstresine, taksitliyse kendi taksitleriyle); kart
limitine yalnızca tarihi gelmiş tekrarlar girer. Süresiz tekrarı durdurmak için kaç kez, işlenen tekrar sayısına çekilir
(hiç işlenmediyse kayıt silinir).

Kurlar sitenin Worker'ından gelir: `GET /api/kur` → `{ rates: { TRY, USD, EUR, GAU }, updatedAt, source }`
(`mcp/kur.js`). Kaynak [Truncgil](https://finans.truncgil.com) (Türkiye piyasası, gram altın dahil); erişilemezse
dolar / euro open.er-api.com'dan, gram altın gold-api.com'un ons fiyatından hesaplanır (Kapalıçarşı farkı olmaz).
Sonuç 10 dakika önbellekte tutulur; uygulama son alınan kuru cihazda saklar, çevrimdışıyken onu kullanır.
Ek ayar ya da anahtar gerekmez.

### Borçlar ve alacaklar

**Borçlar** sekmesi (`borc.js`) kart borcunu, kişilerle borç / alacağı ve banka kredilerini bir arada gösterir:
**Borçlarım** ve **Alacaklarım** diye ikiye ayrılır, kapananlar altta açılır listededir. Tutarlar güncel kurla TL'dir,
Tümü ya da tek kişi için hesaplanır:

- **Eldeki**: varlık bakiyeleri (Varlıklar'daki); borç hareketleri ve takipteki kartların ödenen ekstreleri dahil.
- **Alacak**: başlamış alacakların kalanı, diğer kişilerin takipteki kartlardaki payı (ödedikleri düşülerek) ve kartta
  artı bakiye (kart borcundan fazla ödenen).
- **Varlık** = Eldeki + Alacak.
- **Borç**: takipteki kartların ödenmemiş taksitleri (bütün kişilerinki), nakit harcamaların kalan taksitleri, kredilerin
  ve kişilere borçların kalanı, fazla ödenmiş kart payları.
- **Özvarlık** = Varlık − Borç.

Borçlar'ın ve Varlıklar'ın üstünde **Varlık = Özvarlık + Borç** yazar. Borç almak, ödemek, borç vermek, tahsil etmek ve
ekstrenin ödenmesi Özvarlık'ı değiştirmez (para bir yerden çıkıp ötekine girer); değiştiren harcamalar ve kredinin faiz ve
masrafıdır.

**Kart borcu** kaydedilmez, harcamalardan gelir: kartın ödenmemiş taksitleri (Kartlar'daki bekleyen borç). Borçlarım'da
her kart için bu ekstre (kesildiyse son ödeme günüyle, değilse dönem içi), toplam kalan ve kişi payları görünür. Kartta
diğer kişiler için yapılan harcamaların taksitleri onlardan **alacaktır**: Alacaklarım'da kişi başına ödemesi gelen,
sonraki ve toplam. **Ödendi** (kişi ödedi) payın tamamını ya da bir kısmını kapatır (ödenen ilk kişinin TL varlığına
girer, taksitleri ilk taksitten başlayarak kapatır); fazla ödenen pay borca geçer. Paylaşım düğmesi kişiye taksitlerini,
ödediğini ve kalanını metin olarak verir.

**Kart takibi kendiliğindendir.** Yeni sürüm ilk açıldığı gün bütün kartlar o günden takibe girer (`cards.track_since`),
sonra eklenen kart eklendiği günden. Takipteki kartın bu tarihten sonra gelen ekstresi, son ödeme gününün ertesi günü ilk
kişinin TL varlığından düşer (kartları ilk kişi öder; ekstreyi ayrıca çıkış olarak girmek gerekmez); kartta diğer kişilerin
bu tarihten sonraki taksitleri alacak olur, öncekiler ödenmiş sayılır. Takip başlayınca Borçlar'da bir kez bilgi şeridi
çıkar (`para.trackNotice`); ilk kişinin hiç TL girişi yoksa açılış bakiyesi önerilir (**Bakiye gir**).
Kart formunda tek seçim vardır, **Ekstre ödemesi**: **Otomatik** (varsayılan, yukarıdaki gibi), **Ben işaretlerim**
(elle ödeme, aşağıda) ve **Hesaba katılmasın**. Seçimin altında seçili seçeneğin anlamı her zaman yazar; kayıtlı kartta
seçim değişince ikinci satır kaydın etkisini söyler ("Kaydedince: …"). Kartın borcu formda etiketli satırlarla görünür
(Gecikmiş / Son gün bugün / Ekstre kesildi ya da Bu dönemki harcamalar · kesim · son ödeme / Kart borcu / kişilerin
harcamaları, kart borcuna dahil); kartın ödeme formunun durumu da aynı satırlardır. Kullanıcının ödemediği kart (ör.
eşinin kartı) **Hesaba katılmasın** ile takipten çıkar (`cards.track_off`), düşülmüş ekstreleri (kart ödemeleri dahil)
TL bakiyesine geri döner ve **her yerde dışarıdadır**: Borçlar'da başlığında toplam olmayan "Hesaba katılmayan kartlar"
grubunda soluk; Özet'in "Bu ay ödenecek" kutusu, sonraki ay, Kalan ödeme, Aylık ödemeler grafiği ve Kişiler'in ay
toplamları, Borçlar'ın "Bu ay ödenecek"i, Nakit grafiği, içgörüler (`icgoru.js` ödeme akışı, düzenli ödemeler, kart
önerisi, limit uyarısı), harcama formundaki kart önerisi ve asistanın `get_overview` / `get_cashflow` (`notCounted`) /
`list_people` / `simulate_purchase`'ı onu saymaz (`app.js` ve `mcp/tools.js` `cashflow`: ekstre olayları `ignored`,
etkilenen ay yeniden toplanır); ödeme penceresini de uzatmaz (`lastPaymentIndex`). Özet'te "Son taksit" ödenecek bir şey
kalan son aydır, hesaba katılan süresiz tekrarlayan harcama varsa "Süresiz" (asistanda `lastPaymentMonth` null,
`endless`); Akış, takvim ve ekstre ayrıntısında soluk "hesaba katılmıyor" etiketiyle görünür, Sıradaki ödemeler'de
yoktur; Kartlar sekmesindeki kutusunda "Hesaba katılmıyor" yazar. Yeniden hesaba katılan kart bugünden takibe girer.
Formda tarih yoktur: takibin geçmiş bir günden başlaması asistanla girilir (`update_card` `track_since`).

**Aynı gün kuralı**: kartta bugün tarihli kart ödemesi varsa (`B.cardPaidToday`) yeni başlangıç yarındır; uyarı çıkmaz,
önizleme gri bir satırla söyler. Yeniden hesaba katılan kartın takibi yarın başlar (bugünkü ödeme, ödediği ekstreyle
birlikte takipten önce kalır; bugünden başlasa sonraki ekstreleri kapatırdı). Otomatikten **Ben işaretlerim**'e geçişte
`manual_since` yarındır (bugünden başlasa o güne kadar ödenmiş sayılan ekstrelerde erimiş ödeme ikinci kez düşerdi;
yarından başlayınca bugün otomatikteki hâliyle aynıdır); kart o gün otomatik gibi görünür (`manualCard`: elle mod bugün
ya da önce başlamış olmalı). Asistanda da aynı (`update_card`; açıkça `track_since` = bugün verilirse hata).

**Kartın ödeme modu**: **Ben işaretlerim** seçilirse (`cards.manual_since` = bugün; takibe aynı kayıtta giren kartta
takibin başladığı gün) o günden sonraki ekstreler **Ödendi** ile kart ödemesi kaydedilene kadar borçta kalır, son ödeme
günü geçince "2 gün gecikti", son günde "Son gün bugün" görünür; öncekiler ödenmiş kalır. Kart ödemesi (`debts.card_id`)
kayıt gününde ilk kişinin TL varlığından düşer; yalnızca **Ben işaretlerim** kartına, elle modun başladığı gün ile bugün
arasındaki bir tarihe girilir. Ödeme formu günü gelmiş ekstrelerin (yoksa kesilmiş ekstrenin) tamamıyla dolu açılır,
değiştirilebilir: ödemeler en eski ödenmemiş ekstreden başlayarak kapatır, kısmi ödemede kalan borçta (günü geçmişse
gecikmiş) ve limitte kalır, fazlası sonraki ekstreleri önceden kapatır (önizleme söyler); kart borcunu da aşarsa karta
fazla ödenmiş olur (Alacaklarım'da "Fazla ödenen kartlar"; varlıktır, Alacak'a girer, sonraki ekstrelerden düşülür).
Borçlarım'da kart satırı ödenmemiş tutarı ve gecikmeyi (ya da sıradaki ekstreyi) yazar, günü gelmiş ya da kesilmiş
ekstrede satır içi **Ödendi** vardır. **Ekstre ayrıntısı** her kartta durumu yazar: Ben işaretlerim'de ödendi / kısmen /
gecikti / son gün bugün / kesildi (Ödendi ile) ya da henüz kesilmedi; Otomatik'te hangi gün ödenmiş sayıldığı ya da
sayılacağı; hesaba katılmayan kartta ve takipten önceki ekstrede TL bakiyesini etkilemediği. Takvim rozetleri "ödendi",
"son gün bugün", "gecikti" (yalnızca gecikti kırmızı). Otomatiğe dönünce ödenmemiş geçmiş ekstreler ödenmiş sayılır
(form önizlemede söyler); kaydedilmiş ödemelerin bir kısmı otomatikte ödenmiş sayılan önceki ekstrelerde eriyecekse
(elle modun başından sonraki erken ödeme) dönülmez: form son ödeme günü gelmemiş ekstreler için kaydedilen erken ödemeyi
tutarıyla söyler ("“Otomatik”e geçilemiyor: … ₺X erken ödeme kaydettin … Önce “Kart ödemelerin”den bu ödemeyi sil ya da
₺X kadar azalt"); engel yalnızca son günü bugün olan ekstrenin ödemesindense "Yarın geçebilirsin" der. Kart ödemeleri
Borçlarım'daki satırdan ya da kart formundaki "Kart ödemelerin"den açılıp düzeltilir, silinir. Ben işaretlerim kartında
Nakit grafiği ekstre yerine kaydedilen ödemeleri kendi gününde, ödenmemiş günü gelmiş ekstreleri bugünde düşer; Sıradaki
ödemeler ve Bu ay ödenecek ödenmemiş ekstreleri sayar (gecikmişler "gecikti" ile en üstte), ödenmiş kısmı düşer; geciken
ekstre `borc-vade` içgörüsünde de çıkar (tek gecikmiş kayıt kart ekstresiyse başlık "Bonus ekstresi gecikti").

**Kişiyle borç / alacak** (formda Borç aldım / Borç verdim): karşı taraf serbest metindir (kişiler listesinde olması
gerekmez), kayıt bir kişinin varlığına aittir (varsayılan ilk kişi, tek kişide sorulmaz). Geri ödeme tek sefer (vadesiz
ya da vadeli) ya da taksitlidir. Ödeme ve tahsilat varsayılan olarak elle kaydedilir (satır içi **Ödendi**, kısmi
olabilir); ödemeler taksitleri ilk taksitten başlayarak kapatır, vadesi ya da günü geçip kapanmamış tutar gecikmiştir
("3 gün gecikti"; geçmiş tarihli kayıtta da). Vadeli ya da taksitlide **Taksitler tarihinde ödenmiş sayılsın** seçilirse
taksitler, kredideki gibi, tarihinde kendiliğinden ödenir; gecikme olmaz, satırda Ödendi görünmez (yalnızca formdan ara
ödeme). **Mod kilidi**: kayıt tarihi ile bugün arasında taksiti olan borçta ve kredide bu kutu değiştirilemez,
kilitlenir ve nedenini yazar (değiştirmek geçmiş taksitleri yeniden yorumlardı: ödenmiş sayılan gecikmiş olur ya da
kaydedilen ödemeler ikinci kez düşer). Kalanın tümü ödenince borç kendiliğinden kapanır (Kapananlar). Kalanı silmek
(bağışlamak) için borç formunun durum satırında **Borcu kapat** vardır (onay sorar, bugünle kapatır); kapanmış kayıtta
orada **Yeniden aç** çıkar. Formun altında kapatma ya da ödeme düğmesi yoktur (Sil ve Kaydet; geniş ekranda Vazgeç de);
ödeme Borçlar'daki satırdan (**Ödendi**) ya da formdaki Ödemeler başlığından (**+ Ödeme**) eklenir; tamamı ödenmiş ya da
kapanmış borca ödeme eklenmez, önceki ödemeleri düzeltilir. Kapanmış borcun ödemesi silinince borç yeniden açılır; kalan
sessizce silinmez. Borç alınan para kayıt tarihinde varlığa girer, verilen çıkar; "Para varlığıma girdi / çıktı"
kapatılırsa (önceden alınmış borcu bakiyeyi bozmadan girmek için) yalnızca borç / alacak eklenir.

**Banka kredisi**: taksit sayısı, taksit tutarı (ya da toplam), ilk taksit tarihi ve çekilen tutar. Taksitler varsayılan
olarak tarihinde kendiliğinden ödenir (**Taksitler tarihinde ödenmiş sayılsın** işaretli); ek ödeme sondaki taksitlerden
düşer (ödeme günündeki taksit dahil; formda **+ Ara ödeme**), kalanın tümü ödenince kredi biter. Kutu kapatılırsa
(`debts.auto_pay` false) kredi kişiyle borç gibi elle ödenir: satır içi **Ödendi**, ödemeler ilk taksitten başlayarak
kapatır, günü geçen taksit gecikir. Çekilen tutar yalnızca ilk taksitten önceki bir günde girilir. Çekilen tutar varlığa
girer, borç faiz dahil kalan taksitlerin toplamıdır: aradaki fark (**faiz ve masraf**) kredi başlarken Özvarlık'tan bir
kez düşer, form aylık faizi yaklaşık gösterir. Ortasından girilen kredinin kayıt tarihinden önceki taksitleri (iki modda
da) önceden ödenmiş sayılır, varlığa etkisi olmaz.

**Döviz ve altın**: borç ve alacak dolar, euro ya da gram altın da olabilir. Hareketleri o varlığın bakiyesini değiştirir,
toplamlarda güncel kurla TL'dir (kuru alınamayan varlık sayılmaz, altta yazar).

**Ne zaman ödenmiş sayılır:** otomatik modda kart ekstresi ve taksit gününün ertesi günü; o gün hâlâ "bugün
ödenecek"tir (Nakit grafiğindeki kart kuralı gibi). Elle modda kaydedilen ödemenin gününde (Ödendi). Nakit grafiği
gecikmiş ya da bugün beklenen tahsilatı alınmış saymaz. Borç alma / verme, ödeme ve tahsilat kendi gününde. İleri
tarihli borç ya da alacak o güne kadar başlamamıştır: Borç'a, Alacak'a ve bakiyeye girmez.

Nakit grafiği borç hareketlerini de sayar; Girdi ve çıktılar'da bunlar gün başlığında işarettir, toplama girmez
(aşağıda). Kişi silinince borç / alacakları ve ödemeleri de silinir; kart silinince kart ödemeleri de silinir, o karttan
düşülmüş ekstreler TL bakiyesine geri döner (onay metni tutarı ve ödeme sayısını söyler).

### Kategoriler ve içgörüler

Harcamaların kategorisi vardır (`kategori.js`: Market, Yeme-içme, Ulaşım, Alışveriş, Elektronik, Ev, Faturalar, Sağlık ve
bakım, Eğitim, Eğlence, Seyahat, Diğer). Formda seçilir; kullanıcının seçtiği kategori öğrenilir (`category_by = 'user'`):
aynı işyerinin sonraki harcamasına (farklı yazılışı dahil: "MIGROS TICARET A.S." / "Migros Ticaret A.Ş. 0042") aynı
kategori verilir. Sabit bir işyeri sözlüğü yoktur; öğrenilmemiş işyerine dil modeli kategori önerir
(`category_by = 'ai'`, aşağıda: bulutta ya da cihazda). Kullanıcı düzeltirse düzeltmesi öğrenilir.

Özet'teki **Nakit** grafiği bir dönemin toplam varlığını gün gün gösterir. Dönem, seçilen başlangıç gününden (Bugün, süren
tekrarlayan bir TL girişinin günü — ör. maaş günü — ya da ayın herhangi bir günü) bir ay sonrasının bir gün öncesine kadar
sürer; oklarla önceki / sonraki döneme geçilir, tarih aralığına dokununca bugünün dönemine dönülür. Hareketler bütün varlık
hareketleri (tekrarlayanın her tekrarı kendi gününde, tarihi gelmemiş tek seferlik hareket de kendi gününde), kart / nakit
ödemeleri (elle ödenen kartta ekstre yerine kaydedilen kart ödemeleri; ödenmemiş günü gelmiş ekstreler bugünde),
döviz / altın harcamaları ve borç hareketleridir (borç alma / verme, ödeme, tahsilat, kredi taksiti, kart payı ödemesi;
elle ödenecek borcun beklenen ödemesi kendi gününde, gecikmişse bugün); döviz ve altın güncel kurla TL'ye çevrilir, kuru
alınamayan varlık sayılmaz (altta yazar). **Varlık** görünümü bugüne bağlıdır: bugünün sonu, bugüne kadarki toplam
varlıktan (Varlıklar'daki bakiyeler) bugün ödenecekler (kart ekstresi, ödenmemiş ekstre, kredi taksiti) düşülerek
bulunur; sonraki günler hareketlerle ileri, önceki günler geri taşınır.
**Dönem net** görünümü dönem başında sıfırdan başlar, girdi / çıktı / net toplamlarını gösterir. Sıfırın altı kırmızıdır;
üzerine gelince (ya da odaklanıp ok tuşlarıyla) o günün hareketleri görünür. Seçimler cihazda saklanır
(`para.cashStart`, `para.cashMode`).

Özet'teki **Girdi ve çıktılar** bir dönemin hareketlerini liste ya da takvim olarak gösterir. **Başlangıç** ile dönem
ayın 1'i yerine başka bir günden başlatılabilir: dönem o günden bir ay sonrasının bir gün öncesine kadar sürer (bu ayda
bugünü içeren dönem); liste, takvim ve girdi / çıktı / net toplamları bu döneme göredir. Seçim cihazda saklanır
(`para.timelineStart`).
Satırlar varlık hareketleri ve harcamalardır: harcama alındığı gün görünür (kartı ya da nakit / döviz / altın; taksitli
alışveriş tamamıyla, taksit sayısıyla; tekrarlayanın her tekrarı kendi gününde), dokununca düzenlenir. Tarihi bilinmeyen
(içe aktarılmış) harcama satır olmaz. Kart ödemeleri satır değildir: ödeme gününün başlığında işaret olarak durur
(takvimde günün altında renkli nokta, üzerine gelince tutarı); dokununca ödemenin ayrıntısı açılır. Toplamlar varlık
hareketleri ve harcamalardandır, kart ödemeleri harcamalarla zaten sayıldığından toplama girmez. Borç hareketleri (borç
alma / verme, ödeme, tahsilat, kredi taksiti, kart payı ödemesi) de kart ödemeleri gibi gün başlığında işarettir, dokununca
borç açılır; para el değiştirir, gelir ya da gider değildir, toplama girmez. Toplama giren tek borç kalemi kredinin faiz ve
masrafıdır (çekildiği gün, çıktı olarak).

Özet'te **İçgörüler** (`icgoru.js`, model gerekmez; MCP `get_insights` aynısını döndürür): bu ayın serbest nakdi ya da
açık veren ilk ay (gelir ve sabit giderler varlıklardaki tekrarlayan giriş / çıkışlardan; borç ve kredi taksitleri
ödemelere girer, borç alınan para gelir sayılmaz), önümüzdeki 6 ayın taksit / gelir oranı, dolmak üzere olan limitler,
yaklaşan ödeme sıçraması, bir kategoride önceki 3 ayın ortalamasının üstüne çıkan harcama, bugünkü alışverişte ilk
ödemesi en geç gelen kart, düzenli ödemeler (her ay aynı işyerine peşin ödeme, tekrarlayan çıkışlar), geciken ya da 7 gün
içinde gelen borç ödemeleri ve elle ödenen kartların geciken ekstreleri (`borc-vade`), ödemesi gelmiş kart payları ve
geciken alacaklar (`alacak`), diğer kişilerin bu ayki payı (`paylar`; yalnızca hiç takipte kart yoksa, varsa yerine
`alacak` çıkar), son taksitin ayı. `borc-vade` ve `alacak`a dokununca Borçlar açılır. Altında ayın harcamaları kategoriye göre (harcama tarihine göre; taksitli alışveriş
tamamıyla alındığı aya). Kişiler listesinde diğer kişilerin yanındaki düğme o kişinin ayın taksitlerini, kart ve
tarihleriyle paylaşım menüsüne (yoksa WhatsApp'a) metin olarak verir (kart payı varsa ödediği ve kalanıyla); kişinin alt
satırında alacağı ve geciken kısmı yazar.
Harcama formu, başka bir kartla ilk ödeme en az 10 gün daha geç geliyorsa söyler.

### Kategori önerisi: bulut ve cihaz

Ayarlar → **Yapay zekâ** → **Kategori önerisi**: **Bulut** (varsayılan), **Cihazda** ya da **Kapalı** (`yz.js`). İkisi de aynı
sıralamayı kullanır (`kategori.js`): açıklama, her kategorinin anlam kelimelerine (Türkçe ve İngilizce, işyeri adı
değil) ve kullanıcının kategorisini seçtiği son 64 harcamaya olan benzerliğe göre sıralanır. Açıklama temizlenerek gider
(`Kategori.clean`: tarih / tutar gibi sayılar, parantez içi notlar ve "taksit" sözleri atılır). Güveni `Kategori.SURE`'un
(0,3) altındaki tahmin kendiliğinden verilmez; formda "emin değilim · … olabilir" önerisine dokunup seçilir.

**Bulut** — giriş yapmış kullanıcılara. Sitenin Worker'ı `POST /api/kategori` (`mcp/kategori.js`):
`Authorization: Bearer <Supabase oturum anahtarı>` (MCP'deki gibi doğrulanır), gövde `{ items: [açıklama…] (≤ 50),
examples: [{ text, id }] (≤ 64) }`, cevap `{ model, results: [{ category, confidence }] }`. Vektörler
[Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) `@cf/baai/bge-m3` ile (`wrangler.jsonc` → `ai`
bağlaması; hesapta Workers AI açık olmalı). Veri saklanmaz; vektörler yalnızca Worker örneğinin belleğinde önbellekte.
Kullanıcı başına dakikada 300 açıklama sınırı (Worker örneği içinde). Maliyet: günde 10.000 neuron ücretsiz, bge-m3
milyon token başına 1.075 neuron; bir açıklama ~10–20 token, yani ücretsiz kota günde yüz binlerce öneriye yeter.
PR önizlemelerinde (`previews`) AI bağlaması yok; uç orada 503 döner, uygulama öneri göstermez.

Ölçüm (115 harcamalık, test markalarını hiç görmemiş deneme): bge-m3'te güveni ≥ 0,3 olan tahminlerin %96'sı doğru,
harcamaların %59'u eşiği geçiyor (cls ya da mean havuzlamada aynı). qwen3-embedding-0.6b daha çok atıyor ama doğru oranı
%85'te kaldı.

**Cihazda** — internetsiz ve verinin cihazdan çıkmaması için (mobil uygulama için de). Küçük, çok dilli model
([multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small), 8 bit ONNX, ~135 MB) tarayıcıda
[transformers.js](https://huggingface.co/docs/transformers.js) ile çalışır: seçilince bir kez Hugging Face'ten indirilir,
tarayıcının önbelleğinde kalır. `yz-worker.js`'te (Web Worker, WASM) çalışır; harcama formu açılınca önceden yüklenir,
5 dakika kullanılmazsa bellek bırakılır. Başka seçeneğe geçince model ve vektörler silinir. Service worker yalnızca
kendi `cashfollow-<sürüm>` önbelleklerini temizler; model sürüm güncellemesinde silinmez. Vektörler cihazda saklanır
(Cache Storage `yz-vektor`). Ölçümler (tek çekirdek WASM): öneri başına 12–50 ms; model önbellekten açılırken ilk
öneri ~3 sn; aynı denemede güveni ≥ 0,3 olanların %91'i doğru, harcamaların %57'si eşiği geçiyor.

Neden metin üreten bir model değil: 0.3–1 milyar parametreli modeller (Gemma 3 270M / 1B, Qwen 2.5 0.5B, Qwen 3 0.6B)
aynı denemede %13–38 doğru buldu, 300–800 MB indirme ve telefonda öneri başına saniyeler gerektirdi.

Açılışta, eşitlemeden sonra ve e-postadan harcama eklenince kategorisiz harcamalar en yeniden başlayarak ayrılır
(bulutta 25'erli istekler). Mobil uygulamada: web görünümüyle (Capacitor gibi) paketlenirse bu kod olduğu gibi çalışır;
yerel (native) uygulamada aynı ONNX dosyası ONNX Runtime Mobile ile çalıştırılır, sıralama `kategori.js`'teki gibidir.

## 5. Taksitler Excel'ini içe aktarma

Ayarlar → **İçe aktar** → `.xlsx` dosyasını seç. Başlık satırında **Ürün** olan her sayfa bir kişi olarak alınır
(sayfa adı = kişi adı); sütunlar: `Ürün`, `Ekstre`, `Taksit`, `Toplam` ve/veya `Taksit Tutarı`,
isteğe bağlı `Orijinal Tutar`. Excel'de harcama tarihi olmadığı için satırlar ilk karta, ödeme
ayıyla eklenir (`Ekstre` ayındaki taksit bir sonraki ay ödenir, `Taksit` kadar sürer). Hiç kart
yoksa özet sayfasındaki `22 Ekim` gibi başlıklardan son ödeme günü okunarak yeni bir kart açılır.
Aynı kişinin daha önce Excel'den aktarılan kayıtları yenileriyle değiştirilir; uygulamada tarihle
girilen harcamalara dokunulmaz. Yılsız ay adları (ör. `Eylül`) içinde bulunulan yıla oturtulur;
bir sonraki aydan ilerideyse geçen yıla sayılır.

## 6. Banka e-postalarından otomatik harcama

Her kullanıcıya özel bir adres verilir (`<12 hane>@INBOX_DOMAIN`, Ayarlar → **Banka e-postaları**). Kullanıcı bunu
bankasına harcama bildirim adresi olarak girer. Alan adına gelen e-postaları Cloudflare Email Worker (`workers/eposta`)
karşılar, düz metne çevirir ve Supabase'deki kutusuna yazar; telefonun açık olması gerekmez. CashFollow açıldığında
(açıksa anında, Realtime ile) okunmamış e-postalardan tutar, tarih, taksit, işyeri ve kartın son 4 hanesi çıkarılır,
harcama son 4 hanesi eşleşen karta, ilk kişi adına eklenir.

### Bir kez yapılacak kurulum

1. **Supabase → SQL Editor**: `supabase/eposta.sql` dosyasını çalıştır
   (`inbox_addresses`, `inbox_messages`, Realtime yayını ve yalnızca service role'ün çağırabildiği `ingest_email`).
2. **Alan adı**: Cloudflare DNS'inde yönetilen bir alan adı (şu an `cashfollow.app`); `config.js` → `window.INBOX_DOMAIN`.
   Alan adı başka bir firmadan alındıysa Cloudflare'e site olarak eklenip ad sunucuları Cloudflare'inkilerle değiştirilir.
3. **Worker**:
   ```sh
   cd workers/eposta
   npm install          # yalnızca wrangler
   npx wrangler login
   npx wrangler secret put SUPABASE_SERVICE_KEY   # Supabase → Settings → API Keys → secret (service_role)
   npm run deploy
   ```
   `wrangler.toml` içindeki `SUPABASE_URL` projeninkiyle aynı olmalı. Testler: `npm test`.
   Komut satırı yerine panelden de kurulabilir (Worker'ın bağımlılığı yok): `workers/eposta/src/index.js`'in içeriğini
   Cloudflare → Workers & Pages → Create → Hello World worker → **Edit code**'a yapıştır, Deploy et;
   Settings → Variables and Secrets'a `SUPABASE_URL` (Text) ve `SUPABASE_SERVICE_KEY` (Secret) ekle.
4. **Cloudflare → Email → Email Routing**: alan adında Email Routing'i aç (MX/SPF kayıtlarını Cloudflare ekler),
   **Routing rules → Catch-all address → Send to a Worker → `para-eposta`**.

### Kullanıcı tarafı

1. **Kartlar** sekmesinde her kartın son 4 hanesini gir. Tek kartın varsa son 4 hane okunamayan e-postalar da ona eklenir.
2. Ayarlar → **Banka e-postaları**'ndaki adresi kopyala, bankanın internet/mobil şubesinde bildirim e-posta adresi yap.
3. Banka adresi doğrulamak için e-posta gönderirse Harcamalar → "E-postadan gelenler" altında görünür;
   **Göster** ile açılıp bağlantıya dokunulur.

Worker yalnızca 12 onaltılık haneli adresleri kabul eder; kayıtlı olmayan adrese ve 2 MB'tan büyük e-postalara
ret döner. Aynı e-posta iki kez gelirse ikincisi yok sayılır (`Message-ID`).
Tutarı, tarihi ya da kartı okunamayan, yabancı para birimli ve iade/iptal e-postaları kendiliğinden eklenmez;
**Harcamalar** sekmesinde *Ekle* (form doldurulmuş açılır), *Göster* ya da *Yok say* ile beklerler.
Ayarlar'daki "Bir e-postayı dene" alanına bir bildirim yapıştırıp neyin okunduğunu görebilirsin.
Adres yenilenirse eskisine gelen e-postalar reddedilir.

## 7. Yapay zekâ asistanları (MCP)

CashFollow, `https://cashfollow.app/mcp` adresinde bir [MCP](https://modelcontextprotocol.io) sunucusu sunar.
Claude, ChatGPT, Claude Code gibi MCP destekleyen asistanlar, giriş yapmış kullanıcının adına ön yüzdeki
çekirdek işlemlerin hepsini yapabilir:

| Alan | Araçlar |
| --- | --- |
| Özet / akış | `get_overview` (bu ay, gelecek ay, kalan, yaklaşan ödemeler, ayrıca borç / kredi ödemeleri ve elle ödenen kartların ödenmemiş ekstreleri: `debts.unpaidCardStatements`), `get_cashflow` (ay ay ödemeler, kişi / kart toplamları) |
| Harcamalar | `list_purchases`, `get_purchase` (taksit takvimi), `add_purchase` (`dry_run` ile önizleme), `update_purchase`, `delete_purchase` |
| Kartlar | `list_cards` (kullanılan / kalan limit, ekstre takibi ve ödeme modu, sıradaki ekstre; elle ödenen kartta `unpaid`, `overdue`, kart ödemeleri), `add_card` (eklendiği günden takipte; `auto_pay` false: elle ödenir), `update_card` (takip: `track_statements`, `track_since`; ödeme modu `auto_pay`, erken ödeme varken otomatiğe dönüş hata döner; kartta bugün ödeme varsa yeniden takip ve elle mod yarın başlar), `delete_card` (kart ödemeleriyle) |
| Kişiler | `list_people` (kart payı alacağı), `add_person`, `rename_person`, `delete_person` |
| Varlıklar | `get_assets` (TL / dolar / euro / gram altın bakiyeleri, güncel kurla TL karşılığı; alacak, borç, Varlık, Özvarlık), `list_entries`, `add_entry`, `update_entry`, `delete_entry` |
| Borçlar / alacaklar | `list_debts` (Eldeki / Alacak / Borç / Varlık / Özvarlık toplamları, kart borçları ve kişi payları, nakit taksitler, kart payları, borçlar), `get_debt` (ödeme planı), `add_debt` (borç aldım / verdim / kredi; tek tutar ya da taksitli; `auto_pay`: kredide varsayılan true, kişiyle borçta false; `dry_run` ile önizleme), `update_debt` (kapatma dahil; kayıt tarihi ile bugün arasında taksiti olanda `auto_pay` değişmez, hata döner), `delete_debt` (ödemeleriyle), `pay_debt` (ödeme / tahsilat; kart payı için `person`; elle ödenen kartın ekstresi için `card`: `amount` verilmezse ödemesi gelen (yoksa kesilmiş ekstre), kısmi olabilir; `close` kendiliğinden ödenen borcu bugünle kapatır), `delete_debt_payment` (kart ödemesi dahil; kapanmış borcu yeniden açar: `reopened`) |
| Banka e-postaları | `get_inbox_address`, `renew_inbox_address`, `list_inbox`, `check_inbox`, `add_inbox_purchase`, `dismiss_inbox_email`, `try_bank_email` |
| İçgörüler | `get_insights` (Özet'teki içgörüler), `spending_by_category` (ay ay kategori dağılımı), `simulate_purchase` (kaydetmeden: ödeme planı, aylara ve serbest nakde etkisi, kartların karşılaştırması) |
| Yedek | `export_data` (kişiler, kartlar, harcamalar, varlık hareketleri ve borçlar; Ayarlar → Dışa aktar ile aynı), `import_data` |

Ödeme tarihleri ve borç hesapları uygulamayla aynı kodla (`taksit.js`, `borc.js`, `eposta.js`) hesaplanır; doğrulama
kuralları formlardakiyle aynıdır.
Sunucu `mcp/server.js`, sitenin Worker'ında çalışır (`mcp/worker.js`, `wrangler.jsonc`); `main`'e birleştirince sitenin
yanında kendiliğinden yayınlanır. Testler: `cd mcp && npm test`.

**Güvenlik:** Asistanlar Supabase OAuth 2.1 ile yetki alır. Kullanıcı `cashfollow.app/oauth/consent` sayfasında giriş yapıp
izin verir; asistan, kullanıcının kendi erişim token'ıyla çalışır ve RLS onu yalnızca kendi verisiyle sınırlar.
MCP sunucusunda gizli anahtar yoktur. İzinler uygulamada Ayarlar → **Yapay zekâ asistanları**'ndan görülüp kaldırılabilir.

### Bir kez yapılacak kurulum

1. **Supabase → Authentication → OAuth Server**:
   - OAuth 2.1 server'ı **aç**
   - **Authorization Path**: `/oauth/consent` (Site URL `https://cashfollow.app` olmalı — bkz. 2. bölüm)
   - **Allow dynamic client registration**: **aç** (Claude / ChatGPT kendini kaydeder; kapalıysa her asistan için
     Authentication → OAuth Apps'ten elle istemci açılır, Claude'un dönüş adresi `https://claude.ai/api/mcp/auth_callback`)
2. (Önerilir) **Supabase → Settings → JWT Keys**: asimetrik imzalama anahtarına (ES256/RS256) geç.

Asistanın yaptığı değişiklik açık uygulamada anında görünür: tablolar `supabase/tablolar.sql` ile Realtime yayınına eklenir.

Kontrol: `https://bffqfhgctlgexjdyvaup.supabase.co/.well-known/oauth-authorization-server/auth/v1` JSON döndürmeli
(şu an `OAuth server is disabled` döner — 1. adım yapılınca düzelir).

### Kullanıcı tarafı

Uygulamada Ayarlar → **Yapay zekâ** → **Tek tıkla ekle** (`app.js` → `AI_CLIENTS`): **Claude** düğmesi Claude'un resmi
kurulum bağlantısıyla ([install link](https://claude.com/docs/connectors/building/directory-vs-custom#custom-connector-install-link))
"Özel bağlayıcı ekle" penceresini ad ve adres dolu açar, kullanıcı onaylar. ChatGPT ve Gemini'de adresi dolduran bir
bağlantı yok: **ChatGPT** ve **Gemini** düğmeleri adresi panoya kopyalar, ekleneceği sayfayı açar
(`chatgpt.com/plugins` → + → Add custom MCP server; `gemini.google.com/apps` → Custom apps → Add a custom app; Gemini'de
özel uygulamalar şimdilik ABD'de, kişisel hesapla ve İngilizce) ve ne yapılacağını yazar. Elle:

- **Claude (claude.ai / masaüstü / mobil)**: Ayarlar → Bağlayıcılar → **Özel bağlayıcı ekle** → `https://cashfollow.app/mcp`
- **ChatGPT**: [chatgpt.com/plugins](https://chatgpt.com/plugins) → + → **Add custom MCP server** → `https://cashfollow.app/mcp`, kimlik doğrulama OAuth
- **Gemini**: [gemini.google.com/apps](https://gemini.google.com/apps) → Custom apps → **Add a custom app** → `https://cashfollow.app/mcp`
- **Claude Code**: `claude mcp add --transport http cashfollow https://cashfollow.app/mcp`, sonra `/mcp` ile giriş

Bağlanırken CashFollow izin sayfası açılır; giriş yapıp **İzin ver**'e dokunulur. Sonra "Telefonu 6 taksitle Bonus karta ekle",
"Kasımda kime ne kadar ödeyeceğim?", "Bekleyen banka e-postalarını işle" gibi istekler doğrudan yapılabilir.

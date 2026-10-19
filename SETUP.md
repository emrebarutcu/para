# CashFollow — Kurulum

## 1. Supabase (cloud sync)

1. [supabase.com](https://supabase.com) → New project oluştur
2. **SQL Editor** → `supabase/tablolar.sql` dosyasını çalıştır. Kişiler (`people`), kartlar (`cards`),
   harcamalar (`purchases`) ve varlık hareketleri (`entries`) ayrı tablolardır; her kullanıcı yalnızca kendi
   satırlarını görür (RLS). Dosya daha önce çalıştırıldıysa yeniden çalıştırmak eksik tabloyu ekler.

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
kayıt bir kez, aynı adlı kişi ve aynı son 4 haneli / aynı adlı kart birleşir — `Tablo.combine`) ya da **Sil, hesabımdakilerle
devam et**. Seçilene kadar cihazdaki veri silinmez, pencere her girişte yeniden çıkar.
Her kayıttan 1.5s sonra yalnızca değişen kişi / kart / harcama / varlık hareketi satırları yazılır; silinenler satırdan kalkmaz,
`deleted_at` ile işaretlenir. Uygulama açılınca, öne gelince ve başka cihaz (ya da asistan) yazınca (Realtime)
son okumadan beri değişen satırlar çekilir. Aynı anda farklı kayıtlar değişirse hepsi korunur; aynı kayıt iki
cihazda değişirse sonra yazan kazanır. Hiç eşitlenmemiş cihazda buluttaki veri esastır.

## 4. Kartlar ve nakit akışı

Uygulama beş sekmeden oluşur: **Özet** (bu ayın ödemesi, sıradaki ödemeler, kişiler, aylık grafik),
**Akış** (ödemeler ay ay, tarih + kart bazında; "Tablo" görünümü Excel'deki ay × kişi özeti),
**Harcamalar**, **Kartlar** ve **Varlıklar**. Yeni harcama (Varlıklar'da yeni hareket) `+` düğmesiyle eklenir;
içe/dışa aktarma ve tema ayarlardadır.

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
  girmiştim** (geçmiş dahil hepsi yeni günlerle). Kesilmiş ekstrelerin günleri kartta saklanır (`history`).

Kart limiti, bugünden sonra ödenecek taksitlerin toplamıyla dolar.

### Varlıklar: TL, dolar, euro, gram altın

**Varlıklar** sekmesinde tarihli giriş / çıkış hareketleri tutulur (maaş, döviz ya da altın alımı, harcama, satış).
Miktar varlığın kendi birimindedir (altında gram); bakiye hareketlerin toplamıdır. Her varlığın ve toplamın TL
karşılığı güncel satış kuruyla gösterilir.

Hareket her ay tekrarlanabilir (maaş, kira, aidat): formdaki **Tekrar** ile belirli sayıda ay ya da süresiz. Tekrarlar
ilk tarihin gününde düşer (ay kısaysa ayın son günü); bakiyeye yalnızca tarihi gelmiş tekrarlar girer. Süresiz
tekrarı durdurmak için ay sayısı işlenen tekrar sayısına çekilir.

Kurlar sitenin Worker'ından gelir: `GET /api/kur` → `{ rates: { TRY, USD, EUR, GAU }, updatedAt, source }`
(`mcp/kur.js`). Kaynak [Truncgil](https://finans.truncgil.com) (Türkiye piyasası, gram altın dahil); erişilemezse
dolar / euro open.er-api.com'dan, gram altın gold-api.com'un ons fiyatından hesaplanır (Kapalıçarşı farkı olmaz).
Sonuç 10 dakika önbellekte tutulur; uygulama son alınan kuru cihazda saklar, çevrimdışıyken onu kullanır.
Ek ayar ya da anahtar gerekmez.

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
| Özet / akış | `get_overview` (bu ay, gelecek ay, kalan, yaklaşan ödemeler), `get_cashflow` (ay ay ödemeler, kişi / kart toplamları) |
| Harcamalar | `list_purchases`, `get_purchase` (taksit takvimi), `add_purchase` (`dry_run` ile önizleme), `update_purchase`, `delete_purchase` |
| Kartlar | `list_cards` (kullanılan / kalan limit), `add_card`, `update_card`, `delete_card` |
| Kişiler | `list_people`, `add_person`, `rename_person`, `delete_person` |
| Varlıklar | `get_assets` (TL / dolar / euro / gram altın bakiyeleri, güncel kurla TL karşılığı), `list_entries`, `add_entry`, `update_entry`, `delete_entry` |
| Banka e-postaları | `get_inbox_address`, `renew_inbox_address`, `list_inbox`, `check_inbox`, `add_inbox_purchase`, `dismiss_inbox_email`, `try_bank_email` |
| Yedek | `export_data`, `import_data` |

Ödeme tarihleri uygulamayla aynı kodla (`taksit.js`, `eposta.js`) hesaplanır; doğrulama kuralları formlardakiyle aynıdır.
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

- **Claude (claude.ai / masaüstü / mobil)**: Ayarlar → Bağlayıcılar → **Özel bağlayıcı ekle** → `https://cashfollow.app/mcp`
- **ChatGPT**: Ayarlar → Uygulamalar → geliştirici modunda yeni uygulama → `https://cashfollow.app/mcp`, kimlik doğrulama OAuth
- **Claude Code**: `claude mcp add --transport http cashfollow https://cashfollow.app/mcp`, sonra `/mcp` ile giriş

Bağlanırken CashFollow izin sayfası açılır; giriş yapıp **İzin ver**'e dokunulur. Sonra "Telefonu 6 taksitle Bonus karta ekle",
"Kasımda kime ne kadar ödeyeceğim?", "Bekleyen banka e-postalarını işle" gibi istekler doğrudan yapılabilir.

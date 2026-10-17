# Para — Kurulum

## 1. Supabase (cloud sync)

1. [supabase.com](https://supabase.com) → New project oluştur
2. **SQL Editor** → şu sorguyu çalıştır:

```sql
create table cashflow_data (
  user_id uuid references auth.users primary key,
  data    jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table cashflow_data enable row level security;

create policy "own data" on cashflow_data
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

3. **Settings → API** sayfasından al:
   - Project URL
   - anon/public key

4. `config.js` dosyasını aç, değerleri yapıştır:

```js
window.SUPABASE_URL      = 'https://xyzxyz.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGci...';
```

## 2. Netlify (hosting)

1. [netlify.com](https://netlify.com) → ücretsiz hesap aç
2. Dashboard → **"Add new site" → "Deploy manually"**
3. `cashflow` klasörünü drag & drop et
4. Bitti — sana bir `*.netlify.app` URL verir

> **Özel domain** bağlamak istersen Netlify → Domain settings'ten ücretsiz ekleyebilirsin.

## 3. Mobil (iPhone / Android)

**iPhone (Safari):**  
Paylaş butonu → "Ana Ekrana Ekle"

**Android (Chrome):**  
Menü → "Uygulamayı yükle" ya da adres çubuğundaki install simgesi

---

Sync çalışma mantığı: Her kayıtta Supabase'e 1.5s gecikmeli yazar.  
Giriş yapınca uzak veri daha yeniyse otomatik çeker. Çevrimdışıyken localStorage'dan çalışır.

## 4. Kartlar ve nakit akışı

Uygulama dört sekmeden oluşur: **Özet** (bu ayın ödemesi, sıradaki ödemeler, kişiler, aylık grafik),
**Akış** (ödemeler ay ay, tarih + kart bazında; "Tablo" görünümü Excel'deki ay × kişi özeti),
**Harcamalar** ve **Kartlar**. Yeni harcama `+` düğmesiyle eklenir; içe/dışa aktarma ve tema ayarlardadır.

**Kartlar** sekmesinde her kart için ad, limit, hesap kesim günü ve son ödeme günü girilir.
Harcama eklerken tarih ve kart seçilir (ya da "Nakit / banka kartı"):

- Kesim günü dahil o güne kadarki harcama o ayın ekstresine, sonrası bir sonraki ayın ekstresine girer.
- Ekstre, son ödeme günü kesimden sonraysa aynı ay, değilse bir sonraki ay ödenir
  (ör. kesim 12 / son ödeme 22 → 12 Eki ekstresi 22 Eki'de; kesim 25 / son ödeme 5 → 25 Eki ekstresi 5 Kas'ta).
- Taksitler sonraki ekstrelere birer ay kayarak düşer. Ay kısaysa gün ayın son gününe çekilir.
- Nakit harcama kendi gününde ödenir.

Kart limiti, bugünden sonra ödenecek taksitlerin toplamıyla dolar.

## 5. Taksitler Excel'ini içe aktarma

Ayarlar → **İçe aktar** → `.xlsx` dosyasını seç. Başlık satırında **Ürün** olan her sayfa bir kişi olarak alınır
(sayfa adı = kişi adı); sütunlar: `Ürün`, `Ekstre`, `Taksit`, `Toplam` ve/veya `Taksit Tutarı`,
isteğe bağlı `Orijinal Tutar`. Excel'de harcama tarihi olmadığı için satırlar ilk karta, ödeme
ayıyla eklenir (`Ekstre` ayındaki taksit bir sonraki ay ödenir, `Taksit` kadar sürer). Hiç kart
yoksa özet sayfasındaki `22 Ekim` gibi başlıklardan son ödeme günü okunarak yeni bir kart açılır.
Aynı kişinin daha önce Excel'den aktarılan kayıtları yenileriyle değiştirilir; uygulamada tarihle
girilen harcamalara dokunulmaz. Yılsız ay adları (ör. `Eylül`) içinde bulunulan yıla oturtulur;
bir sonraki aydan ilerideyse geçen yıla sayılır.

## 6. iCloud (CloudKit) ile senkronizasyon

Veriler kullanıcının kendi iCloud hesabındaki **özel veritabanında** tutulur (iCloud depolama
kotasından düşer; senin sunucuna ya da Supabase'e gitmez). Web'de bunun tek resmî yolu CloudKit JS'tir.

**Gerekenler:** ücretli **Apple Developer Program** üyeliği (CloudKit konteyneri ve API anahtarı için).

1. [developer.apple.com](https://developer.apple.com/account) → Certificates, Identifiers & Profiles →
   Identifiers → **+** → **iCloud Containers** → örn. `iCloud.com.ornek.para` oluştur.
2. [CloudKit Console](https://icloud.developer.apple.com) → bu konteyner → **Tokens & Keys** →
   **API Tokens** → **+**:
   - Sign-in Callback: **Post Message**
   - Allowed Origins: sitenin adresi (örn. `https://para.pages.dev`, kendi alan adın) ve
     denemek için `http://localhost:3100`
3. `config.js`:

```js
window.ICLOUD_CONTAINER = 'iCloud.com.ornek.para';
window.ICLOUD_API_TOKEN = '...';
window.ICLOUD_ENV       = 'development';   // ilk denemede
```

4. Uygulamada Ayarlar → Bulut → **iCloud** satırındaki Apple düğmesiyle giriş yap. Development
   ortamında ilk kayıtta `ParaState` kayıt türü (alanlar: `data` String, `version` Int(64))
   otomatik oluşur.
5. CloudKit Console → **Schema** → **Deploy Schema Changes…** ile şemayı Production'a yayınla,
   sonra `ICLOUD_ENV = 'production'` yap ve siteyi yeniden yayınla.

**Çalışma mantığı:** Her kayıtta iCloud'a 1,5 sn gecikmeli yazılır; uygulama öne geldiğinde
iCloud'daki daha yeni veri çekilir (son yazan kazanır). Bir cihaz bu iCloud hesabına ilk kez
bağlanırken iki tarafta da farklı veri varsa hangisinin kullanılacağı sorulur.
iCloud ile e-posta senkronizasyonu aynı anda açık olamaz. E-postadaki veriyi iCloud'a taşımak için:
e-postayla girişliyken **Dışa aktar** → e-posta hesabından çık → iCloud'a bağlan → **İçe aktar**.

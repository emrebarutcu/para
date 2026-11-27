# Etiketler

Tasarım taslağı (27 Kasım 2026). Henüz kodlanmadı. Sıra ve kararlar kullanıcıyla netleşince `SETUP.md`'ye taşınır.

## Ne

Harcamaya serbest adlı, birden fazla etiket: "Maldivler", "Düğün", "Ev tadilatı", "İş seyahati". Kategoriden farkı:
kategori tektir ve sabit listeden gelir (*ne* alındı). Etiket kullanıcınındır, birden fazla olur ve bir olayı ya da projeyi
toplar (*neden* alındı). Asıl soru: **"Maldivler gezisi bize kaça mal oldu?"**

Kapsam yalnızca harcamalar (`purchases`). Nakit harcama da bir harcama olduğu için (kartsız, `asset` TL / USD / EUR / GAU)
gezide dövizle ödenenler de girer. Varlık hareketleri ve borçlar ilk turda yok.

## Kullanıcı akışı

1. **Etiket ekleme (formda):** Harcama formunda kategorinin altında "Etiketler" alanı. Yazınca var olan etiketler önerilir
   (en son kullanılan önce), Enter / virgül yeni etiket yapar. Etiketler çip olarak görünür, ✕ ile çıkar.
2. **Toplu etiketleme:** Etiketin sayfasında "Harcama ekle": tarih aralığı seçilir (ör. 3–10 Mart), o aralıktaki
   harcamalar işaretli gelir, kullanıcı istemediklerini çıkarır. Gezi sonradan etiketlenirken tek tek uğraştırmaz.
3. **Etkin etiket (gezi modu):** "Maldivler'i 10 Mart'a kadar yeni harcamalara ekle". Bu sürede formdan, banka
   e-postasından, SMS'ten ve asistandan gelen her harcama etiketi alır; formda çip hazır gelir, çıkarılabilir.
4. **Süzme:** Harcamalar'ın filtresinde (iPhone `HarcamaFiltresi`, web filtre) "Etiket". Listenin üstünde toplam.
5. **Etiketler sayfası:** Harcamalar'ın üstünden ya da Ayarlar'dan. Her etiket: ad, toplam, harcama sayısı, tarih aralığı.
   Yeniden adlandırma, birleştirme ("maldiv" + "Maldivler"), silme (harcamalar kalır, yalnızca etiket çıkar).
6. **Etiket raporu (bir etikete dokununca):**
   - **Toplam maliyet** ve harcama sayısı; ilk ve son harcama tarihi, gün sayısı, günlük ortalama.
   - **Ödenen / kalan:** taksitli harcamalarda bugüne kadar ödenen ve kalan, son taksidin ayı ("Maldivler Ağustos'ta biter").
   - **Dağılım:** kategoriye (uçak, otel, yeme-içme), kişiye (sen / eşin), karta ve nakde göre.
   - **Para birimi:** dövizle ödenenler kendi biriminde de görünür ("1.240 $ + 86.500 ₺"); toplam ana para birimine
     bugünün kuruyla çevrilir (kategori dağılımıyla aynı kural: `icgoru.js` `categoryBreakdown`). Not olarak yazılır.
   - **Bütçe** (isteğe bağlı): "Maldivler 150.000 ₺"; harcandıkça kalan, aşılacaksa uyarı. `YAPILACAKLAR.md` → Bütçe
     ayırma'daki "tek seferlik bütçe" bununla aynı şeydir: etiket bütçesi o maddenin ilk adımı olur.
   - Harcamaların listesi, dışa aktarma (CSV).

Toplam, harcamanın **tamamıdır** (taksitlerin hepsi, gelecektekiler dahil): soru "neye mal oldu", "bu ay ne ödedim" değil.
Tekrarlayan harcamada etiket bütün tekrarlara geçer; raporda bugüne kadarki tekrarlar sayılır.

## Veri modeli

**Önerilen: `purchases.tags text[]`** (adlar, harcamanın satırında).

```sql
-- supabase/gecis/<sürüm>.sql ve tablolar.sql
create or replace function etiketler_gecerli(t text[]) returns boolean language sql immutable as $$
  select t is null or (cardinality(t) between 1 and 10
    and not exists (select 1 from unnest(t) x where length(x) not between 1 and 40 or x ~ '[,\n\r\t]'))
$$;
alter table purchases add column if not exists tags text[] check (etiketler_gecerli(tags));
create index if not exists purchases_tags on purchases using gin (tags) where deleted_at is null;
notify pgrst, 'reload schema';
```

Neden ayrı tablo + bağlantı tablosu değil:
- Eşitleme satır satırdır (`tablo.js`, `sync.js`, `mcp/supabase.js`). Etiket harcamanın satırında olunca harcamayla birlikte
  eşitlenir; sıra, yabancı anahtar ya da yarım kalan bağlantı sorunu olmaz.
- **Eski sürümler bozulmaz:** yazma `resolution=merge-duplicates` ile yalnızca gönderilen sütunları değiştirir. Etiketi
  bilmeyen eski iPhone / web bir harcamayı düzenlerse `tags`'e dokunmaz. Bu yüzden değişiklik eklemelidir → **MINOR**.
- Asistan için doğal: `add_purchase({ ..., tags: ["Maldivler"] })`.
- Bedeli: yeniden adlandırma ve birleştirme o etiketteki bütün satırları yazar. Seyrek bir işlem, sorun değil.

Kurallar (`tablo.js`, ortak):
- Kimlik büyük / küçük harf ve boşluk duyarsız (`T.normalize`; Türkçe İ/ı dahil): "maldivler" ile "Maldivler" aynı
  etikettir. Görünen ad, o etiketin en son kullanılan yazılışıdır.
- Harcama başına en fazla 10, ad en fazla 40 karakter, virgül ve satır sonu yok.
- `SCHEMA` 9 → 10 (`purchases.tags`); `rekey` eski tabanı çevirir.

**İkinci tur: `tags` tablosu (yalnızca etiketin ayarları).** Bütçe, renk, etkin etiketin bitiş günü ve arşiv cihazlar
arasında eşitlenmeli. Satır kimliği etiketin normalize adı; harcamalar yine adla bağlanır:

```sql
create table if not exists tags (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null check (length(id) between 1 and 40),   -- normalize ad
  name text not null, color smallint, budget numeric check (budget > 0), asset text,
  active_until date, archived boolean not null default false,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz, primary key (user_id, id)
);
```

## Kod: nereye ne

| Yer | İş |
| --- | --- |
| `etiket.js` (yeni, ortak UMD) | Ad temizleme / normalize, öneri (son kullanılan), `summary(state, tag, today, rates)`: toplam, ödenen / kalan, dağılımlar, birimler, tarih aralığı. `taksit.js` ve `icgoru.js`'i kullanır. `kopru.js` ve `index.html`'e eklenir. |
| `tablo.js` | `purchases.tags` okuma / yazma, `SCHEMA = 10` |
| `mcp/tools.js` | `PURCHASE_FIELDS.tags` (add / update), `list_purchases` → `tag`; yeni `list_tags`, `tag_summary`, `rename_tag` (birleştirme de), `tag_purchases` (toplu ekle / çıkar, tarih aralığıyla) |
| `eposta.js`, iPhone SMS | Etkin etiket varsa gelen harcamaya eklenir (ikinci tur) |
| iPhone | `Ekle.swift` etiket alanı, `HarcamaFiltresi` etiket, yeni `EtiketlerEkrani.swift` ve rapor, `Ornek.swift`'e örnek etiket ("Kapadokya"), `OzDenetim` |
| Web | `app.js` form, filtre, Etiketler sayfası ve rapor |
| `dil/*.json` | Yeni metinler 9 dile |
| Testler | `mcp/test/etiket.test.js`, `ios/test` köprü, `scripts/tutarlilik.cjs`'e etiket toplamı = süzülmüş harcamaların toplamı |

## Premium ile birleşme

Bugünkü çizgi (`SETUP.md` → Abonelik): **veriyi girmek ücretsiz, sayı sınırı var (2 kart, 2 kişi); analiz, plan ve
asistan Premium.** Etiket aynı çizgiye oturur.

| | Ücretsiz | Premium |
| --- | --- | --- |
| Harcamaya etiket ekleme, süzme | ✓ | ✓ |
| Farklı etiket sayısı | **2** | Sınırsız |
| Etiketin toplamı ve harcama sayısı | ✓ | ✓ |
| Etiket raporu (ödenen / kalan, kategori · kişi · kart dağılımı, birimler, günlük ortalama) | Kilitli önizleme | ✓ |
| Toplu etiketleme (tarih aralığı), birleştirme | — | ✓ |
| Etkin etiket (gezi modu; e-posta / SMS dahil) | — | ✓ |
| Etiket bütçesi ve uyarısı | — | ✓ |
| Asistan: `list_tags`, `tag_summary`, `tag_purchases` | — | ✓ (zaten: `FREE_TOOLS` yalnızca `get_overview`) |
| CSV dışa aktarma | — | ✓ |

Gerekçe:
- **Toplamı kilitlemiyoruz.** Kullanıcı veriyi kendisi girdi; "Maldivler kaça mal oldu"nun tek sayısını saklamak güveni
  kırar ve kötü yorum getirir. Ücretsiz tat, Akış'taki 3 ay gibi: sayı açık, derinlik kilitli.
- **2 etiket** "2 kart, 2 kişi" ile aynı dil ve bir geziyi rahatça denetir; ikinci geziden / projeden sonra kilit gelir.
  Sınır *farklı etiket* sayısıdır, etiketli harcama sayısı değil.
- **Abonelik bitince:** var olan etiketler ve harcamalardaki etiketler kalır, eklenmeye devam edilebilir; yalnızca yeni
  (3.) etiket açılamaz, rapor kilitlenir (kart / kişi kuralıyla aynı: "Sınırı aşan eski kart ve kişiler kalır").
- **Kilit noktaları** (`paywall_shown` → `reason`): `tags` (3. etiket), `tag_report` (rapor önizlemesi),
  `tag_active` (gezi modu), `tag_budget`. Kilit başına dönüşüm zaten ölçülüyor (1.5.0'dan beri satın alma olaylarında
  `reason`).
- **Ödeme ekranı** (`PremiumEkrani.swift`): özellik listesine "Etiketler: gezinin, düğünün, tadilatın tam maliyeti".
  `tag_report`'tan açılınca başlık o kullanıcının kendi etiketiyle ("Maldivler raporunun tamamı"), 12 aylık
  önizlemedeki gibi kendi verisi bulanık görünür.
- **Web** aynı sınırları uygular (`FREE_TAGS = 2`, `premiumLock(..., "tags")`), satın alma iPhone'da.
- Sabitler: iPhone `Abonelik.ucretsizEtiket = 2`, web `FREE_TAGS = 2`. İstenirse PostHog bayrağıyla (`free_tags`)
  değiştirilebilir; A/B için kullanıcı sayısı şimdilik yetmez (`TUTUNDURMA.md`).

Analitik: `tag_added` (`source`: form / bulk / active / email / sms / assistant; `tag_count`), `tag_report_viewed`,
`tag_active_set`. Kişi özelliği: etiket sayısı.

## Sürüm ve yayın

- Eklemeli şema + yeni MCP araçları + isteğe bağlı parametreler → **MINOR** (1.5.3 → 1.6.0).
- Yayından önce `sh supabase/sql.sh supabase/gecis/1.6.0.sql` (yeni istemci `tags` yazar; sütun yoksa yazma düşer).
- Mağaza: sürüm notları 10 dilde, ödeme ekranı ekran görüntüsü (`-galeri 7`) ve isterseniz etiket raporu için yeni galeri.

## Aşamalar (her biri ayrı PR, web + iPhone + asistan birlikte)

1. **Temel (1.6.0):** `purchases.tags`, formda etiket, süzme, Etiketler sayfası (toplam + sayı), rapor, ücretsiz 2 etiket
   sınırı ve rapor kilidi, asistan araçları.
2. **Toplu etiketleme ve yönetim:** tarih aralığından ekleme, yeniden adlandırma / birleştirme.
3. **`tags` tablosu:** etkin etiket (form, e-posta, SMS), etiket bütçesi ve içgörü ("Maldivler bütçesinin %80'i").

## Açık sorular

- Ücretsiz sınır 2 mi, 3 mü? (Öneri: 2, kart / kişiyle aynı.)
- Etiket raporu girişsiz (yalnızca cihazda) kullanıcıda da olsun mu? (Öneri: evet; Premium cihazdaki abonelikten de gelir.)
- Varlık hareketleri (ör. gezide döviz bozdurma, iade) ikinci turda etiketlenebilsin mi?

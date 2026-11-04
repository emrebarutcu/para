# CashFollow — Claude için çalışma notları

Kredi kartı taksitleri, nakit akışı, borçlar ve varlıklar. Üç yüz, tek hesap mantığı:

- **Web** (`index.html`, `app.js`, `sync.js`, `dil-sayfa.js`, `styles.css`) — cashfollow.app, Cloudflare Workers (`mcp/worker.js`).
- **iPhone** (`ios/`) — SwiftUI; hesap kuralları web'in JS modülleri, JavaScriptCore'da (`ios/js/kopru.js`, `Cekirdek/Motor.swift`).
- **Asistan** (MCP, `mcp/`) — `mcp/tools.js` araçları; iPhone da veriyi bu araçlarla okur / yazar.
- Ortak modüller (DOM'suz, UMD): `dil.js para.js tekrar.js taksit.js varlik.js borc.js kategori.js eposta.js icgoru.js nakit.js tablo.js`.
- Veri: Supabase (tablolar `supabase/tablolar.sql`, geçişler `supabase/gecis/`). Ayrıntılı kurulum ve sürüm kuralları: `SETUP.md`.

## Kurallar

- Kod, tanımlayıcılar ve yorumlar Türkçe. Görünen metin Türkçe yazılır ve çevrilir:
  Swift'te `L("…")` (yer tutucu `{0}`), JS'te `L("…")` / `D.t("…")`. İngilizcesi `dil/en.json`; `node scripts/dil.mjs` eksik
  çeviriyi gösterir (CI'da da çalışır). Web Türkçe / İngilizce: tarayıcı Türkçe değilse İngilizce (`dil-sayfa.js`;
  `index.html`'in sabit metinleri de sözlükten çevrilir, `data-tr` olanlar Türkçe kalır). Asistan şimdilik yalnızca Türkçe.
- Sürüm: `version.js`, `sw.js` ve Xcode `MARKETING_VERSION` birlikte, `sh scripts/surum.sh [patch|minor|major]` ile. Hangisi
  olacağı ve MAJOR'da yükseltme notu: `SETUP.md` → Sürüm.
- `main`'e kullanıcı onayı olmadan birleştirme yapılmaz; iş `claude/…` dallarında, PR ile.
- Gizli anahtarlar (`SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_*`) ortamda durur; değerleri yazdırılmaz, dosyaya ya da commit'e girmez.
- Kullanıcıyla Türkçe konuşulur; yanıtlar kısa, telefondan okunabilir.

## Komutlar

```sh
# Testler (saniyeler)
(cd mcp && node --test test/*.test.js)        # asistan araçları
node --test ios/test/*.test.mjs                # iPhone köprüsü (JavaScriptCore benzeri ortam)
node scripts/dil.mjs                           # çeviriler
node scripts/yerel.mjs & node scripts/tutarlilik.cjs -v   # web: hesapların birbirini tutması (Playwright)

# iPhone (Mac, Xcode)
xcodebuild -project ios/CashFollow.xcodeproj -scheme CashFollow -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO build -quiet
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/CashFollow.app
xcrun simctl launch booted app.cashfollow.ios -oz-denetim          # öz-denetim → Documents/oz-denetim.txt
xcrun simctl launch booted app.cashfollow.ios -ornek -sekme 0      # örnek veriyle (Uygulama/Ornek.swift)
#   -ulke US -AppleLanguages "(en)" -AppleLocale en_US  → İngilizce, ABD örnek verisi
#   -bos → verisi olmayan yeni kullanıcı; -galeri 1…6 → grafikler ve formlar; -tur sekme0,galeri3 → ekran turu

# Supabase SQL (yayından önce gereken geçişler)
sh supabase/sql.sh supabase/gecis/<sürüm>.sql
```

GitHub Actions: `ios.yml` (derleme + öz-denetim), `ekran.yml` (ekran görüntüleri → `ekran-goruntuleri` dalı; elle
çalıştırınca koyu tema seçilebilir), `testflight.yml` (elle, `main`'den: TestFlight'a yükler), `sql.yml`, `surum.yml`.

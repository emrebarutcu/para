# CashFollow — app marketing context

Bu dosya `.claude/skills/` altındaki ASO ve pazarlama skill'lerinin ortak bağlamıdır. Kaynaklar: `SETUP.md`, `magaza/`,
`TUTUNDURMA.md`. Bilinmeyen alanlar "[bilinmiyor]" diye bırakıldı; doldurulmadan tahmin yazılmaz.

## App Overview
- **App Name:** CashFollow (tr: "CashFollow: Taksit Takibi", en-US: "CashFollow: BNPL Bill Tracker")
- **App ID (Apple):** 6829311425 (`https://apps.apple.com/app/id6829311425`), paket `app.cashfollow.ios`
- **App ID (Google Play):** yok (Android uygulaması yok; web uygulaması cashfollow.app her tarayıcıda çalışır)
- **Category:** Finance; **Secondary:** Productivity
- **Platform:** iOS (SwiftUI) + web (cashfollow.app)
- **Price Model:** Freemium. Ücretsiz sürüm + CashFollow Premium (haftalık / aylık / yıllık otomatik yenilenen abonelik, StoreKit 2; fiyat ve deneme App Store Connect'te)
- **Launch Date:** [bilinmiyor]
- **Current Version:** `version.js` (web) ve Xcode `MARKETING_VERSION`; birlikte `sh scripts/surum.sh` ile

## Value Proposition
- **Problem:** Kredi kartı taksitleri, ekstreler ve borçlar farklı kartlara ve aylara dağılıyor; hangi ay ne ödeneceği belirsiz.
- **Target Audience:** Birden çok kredi kartı ve taksidi olan, ödeme planını görmek isteyen bireyler (Türkiye ana pazar; BNPL / Pay in 4 kullanan ABD, UK ve Avrupa kullanıcıları). [kesin demografi bilinmiyor]
- **Unique Differentiator:** Her kartın hesap kesim ve son ödeme gününe göre ekstre hesabı; "Bunu alabilir miyim?"; banka şifresi gerekmez (banka e-postası / SMS ile yarı otomatik kayıt); Claude / ChatGPT / Gemini asistan bağlantısı; gizlilik: takip yok.
- **Elevator Pitch:** "Kartlarındaki taksitler, ekstreler ve son ödeme günleri ay ay tek planda; almadan önce sor: alabilir miyim?"

## Competitors
[bilinmiyor — kullanıcıdan istenecek. Kümeler: taksit / kart takibi, harcama ve bütçe uygulamaları, BNPL takipçileri.]

## Current ASO State
- **Title / Subtitle / Keywords:** `magaza/<dil>.md` (10 dil: tr, en-US, en-GB, de-DE, fr-FR, es-ES, it, nl-NL, ja, ar-SA)
- **Rating:** [bilinmiyor — App Store Connect]
- **Primary Keywords:** [bilinmiyor — App Store Connect → Analytics → Sources]

## Goals
- Birincil geri dönüş ölçüsü: ilk hafta geri dönüş (1–7. günde `app_opened`), ikincil: etkinleşme (`activation_reached`). Hedef sayılar [bilinmiyor].

## Resources
- **Budget:** [bilinmiyor]; ücretli edinme belgelenmemiş
- **Team:** [bilinmiyor]
- **Tools:** PostHog (olaylar, bayraklar), App Store Connect, MetricKit (çökmeler); GitHub Actions: `ios.yml`, `ekran.yml`, `testflight.yml`, `magaza.yml`
- **Constraints:** "Takip yok" App Privacy duruşu (atıf SDK'sı, IDFA, ATT yok); olaylarda kişisel veri yok; kullanıcı analitiği kapatabilir; `main`'e kullanıcı onayı olmadan birleştirme yok.

## Markets
- **Primary:** Türkiye
- **Secondary:** ABD, UK, Almanya, Fransa, İspanya, İtalya, Hollanda, Japonya, Suudi Arabistan (mağaza dilleri)
- **Languages:** tr, en, de, fr, es, it, nl, ja, ko, pt-BR (uygulama); mağaza metni yukarıdaki 10 dilde. Asistan şimdilik yalnızca Türkçe.

import SwiftUI
import StoreKit

// CashFollow Premium ödeme ekranı, uygulamanın kendi görünümüyle (zemin, beyaz kartlar, siyah ana düğme; açık ve koyu
// temada): başlık açan kilidin vaadi, altında kullanıcının kendi önümüzdeki 12 ayı (ücretsiz aylar koyu, gerisi gri ve
// kilitli), Premium'un faydaları (en fazla 5, açan kilidinki ilk sırada) ve güven notu, alt alta üç plan (yıllık seçili;
// tasarruf, aylık karşılık ve deneme StoreKit'ten), altta sabit düğme. Fiyat, dönem, denemenin bittiği tarih,
// kendiliğinden yenilenme, Kullanım Koşulları, Gizlilik Politikası ve geri yükleme düğmenin altında (App Store yönergesi
// 3.1.2). neden: hangi kilitten açıldığı (analitik). Fiyatlar App Store'dan; örnek modunda Türkiye'de lira, öbür
// ülkelerde dolar. Kasım 2026: önceki koyu, parlak degradeli, yan yana üç kutulu tasarım şablon gibi duruyordu ve uzun
// para birimlerinde kutulara sığmıyordu.
struct PremiumEkrani: View {
    var neden = "settings"
    @EnvironmentObject private var abonelik: Abonelik
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    @State private var secili = Abonelik.kimlikler[0]
    @State private var denemeUygun: Set<String> = []
    @State private var asistan = false
    @State private var aylar: [Akis.Ay] = []   // kullanıcının önümüzdeki 12 ayı (önizleme)

    // Ekranda bir plan: App Store ürünü ya da (örnek modunda) örnek
    struct Plan: Identifiable {
        let id: String
        let ad: String
        let fiyat: String
        let donem: String
        var aylikKarsilik: String? // aya düşen (yıllık ve haftalıkta; karşılaştırma için)
        var deneme: String?        // "7 gün"
        var denemeBitis: Date?     // ücretin başlayacağı gün
        var rozet: String?         // "%52 tasarruf"
        var urun: Product?
    }

    // Faydalar: en fazla 5 madde (taranabilsin), açan kilidinki ilk sırada. Bütün liste Ayarlar → CashFollow Premium'da
    private struct Fayda { let anahtar: String; let metin: String }
    private var faydalar: [Fayda] {
        let hepsi = [
            Fayda(anahtar: "cash_flow", metin: L("Önümüzdeki 12 ayın ödeme planı")),
            Fayda(anahtar: "afford", metin: L("Almadan önce sor: alabilir miyim?")),
            Fayda(anahtar: "insights", metin: L("Sıkışacağın ayı önceden gösteren uyarılar")),
            Fayda(anahtar: "limit", metin: L("Sınırsız kart ve kişi")),
            Fayda(anahtar: "assistant", metin: L("Yapay zekâ asistanı: Claude, ChatGPT, Gemini")),
            Fayda(anahtar: "net_worth", metin: L("Varlığının aylar içindeki seyri")),
            Fayda(anahtar: "payoff", metin: L("Kart borcunun ne zaman biteceği")),
            Fayda(anahtar: "tags", metin: L("Etiketler: gezinin, düğünün tam maliyeti")),
        ]
        let anahtar: String
        switch neden {
        case "card_limit", "person_limit": anahtar = "limit"
        case "onboarding_ai": anahtar = "assistant"
        case "tag_report": anahtar = "tags"
        default: anahtar = neden
        }
        let one = hepsi.filter { $0.anahtar == anahtar }
        return Array((one + hepsi.prefix(5).filter { $0.anahtar != anahtar }).prefix(5))
    }

    // Başlık ve alt başlık: hangi kilitten gelindiyse onun vaadi (Kasım 2026: herkese aynı başlık çıkıyordu; en çok Akış
    // kilidinden geliniyor). Bilinmeyen nedende çekirdek vaat
    private var baslik: (String, String) {
        switch neden {
        case "cash_flow":
            return (L("Önümüzdeki 12 ayın tek ekranda"), L("Her ayın ödeme günleri, içindeki taksitler ve paranın yetip yetmeyeceği."))
        case "afford":
            return (L("Almadan önce sor"), L("Taksitin hangi aya düşeceği, paranın yetip yetmeyeceği ve ilk ödemesi en geç gelen kart."))
        case "assistant", "onboarding_ai":
            return (L("Kartlarını yapay zekâya sor"), L("Claude, ChatGPT ya da Gemini harcamanı eklesin, ekstreni okusun, sorularını yanıtlasın."))
        case "card_limit":
            return (L("Bütün kartların tek planda"), L("Ücretsiz sürümde {0} kart var; Premium'da kart ve kişi sınırı yok.", Abonelik.ucretsizKart))
        case "person_limit":
            return (L("Evdekilerin harcamaları da burada"), L("Ücretsiz sürümde {0} kişi var; Premium'da kişi ve kart sınırı yok.", Abonelik.ucretsizKisi))
        case "net_worth":
            return (L("Varlığının seyrini gör"), L("Paranın, dövizinin ve altınının aylar içinde nasıl değiştiği."))
        case "insights":
            return (L("Sıkışacağın ayı önceden gör"), L("Açık verecek ay, yükselen harcama ve fırsatlar için uyarılar."))
        case "payoff":
            return (L("Kart borcunu planla"), L("Hangi ay ne kadar ödersen borcun ne zaman biter."))
        case "tags", "tag_report":
            return (L("Gezinin tam maliyetini gör"), L("Sınırsız etiket; ne kadarı ödendi, ne kadar kaldı, kategoriye, kişiye ve karta göre dağılım. Ücretsiz sürümde {0} etiket var.", Abonelik.ucretsizEtiket))
        default:
            return (L("Önümüzdeki 12 ayı gör, almadan önce sor"), L("Her ayın ödemesi, paranın yetip yetmeyeceği, ilk ödemesi en geç gelen kart."))
        }
    }

    var body: some View {
        ScrollView {
            // Pro Max'te üç plan da düğmenin üstünde, kaydırmadan görünür (ekran görüntüsüyle denetlendi)
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(baslik.0).font(.system(size: 28, weight: .bold)).foregroundStyle(Tema.metin)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.trailing, 40)   // kapatma düğmesi
                    Text(baslik.1).font(.body).foregroundStyle(Tema.metin2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 4)
                if aylar.contains(where: { $0.total > 0.004 }) { onizleme }
                faydaKarti
                if abonelik.premium { premiumAcik } else { planlar }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 12)
        }
        .scrollIndicators(.hidden)
        .background(Tema.zemin.ignoresSafeArea())
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Tema.metin2)
                    .frame(width: 34, height: 34).background(Tema.yuzey3, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L("Kapat"))
            .padding(.top, 14)
            .padding(.trailing, 16)
        }
        .safeAreaInset(edge: .bottom) { if !abonelik.premium { altCubuk } }
        .alert(L("Satın alınamadı"), isPresented: Binding(get: { abonelik.hata != nil }, set: { if !$0 { abonelik.hata = nil } })) {
            Button(L("Tamam"), role: .cancel) {}
        } message: { Text(abonelik.hata ?? "") }
        .sheet(isPresented: $asistan) { AsistanEkrani() }
        // Satın almadan kapatılırsa: hangi kilitten açıldığı ve son seçili plan
        .onDisappear {
            if !abonelik.premium { Analitik.olay("paywall_closed", ["reason": neden, "plan": secili.components(separatedBy: ".").last ?? secili]) }
        }
        .task {
            Analitik.olay("paywall_shown", ["reason": neden])
            aylar = (try? model.read("get_cashflow", ["months": 12, "include_items": false]) as Akis)?.months ?? []
            await abonelik.urunleriYukle()
            var uygun: Set<String> = []
            for u in abonelik.urunler where await u.subscription?.isEligibleForIntroOffer == true { uygun.insert(u.id) }
            denemeUygun = uygun
        }
    }

    // ── Kullanıcının kendi 12 ayı ───────────────────────────────────────────

    // Önümüzdeki 12 ayın ödemeleri çubuklarla, uygulamanın kartında: ücretsiz aylar (Özet'te ve Akış'ta zaten gördüğü
    // tutarlar) koyu, sonrakiler gri ve kilitli. Kilitli olanın kendi verisi olduğunu gösterir; tutar yazılmaz.
    private var onizleme: some View {
        let enBuyuk = max(aylar.map(\.total).max() ?? 0, 1)
        return Kart(dolgu: 16) {
            KartBasligi(baslik: L("Senin önümüzdeki 12 ayın")) {
                Label(L("Premium"), systemImage: "lock.fill").font(.caption.weight(.semibold)).foregroundStyle(Tema.metin3)
            }
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(Array(aylar.enumerated()), id: \.offset) { i, a in
                    let acik = i < Abonelik.tatAy
                    VStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(acik ? Tema.metin : Tema.yuzey3)
                            .frame(height: max(4, CGFloat(50 * a.total / enBuyuk)))
                        Text(Bicim.date(a.month + "-01").map { $0.formatted(Bicim.tarih.month(.narrow)) } ?? "")
                            .font(.system(size: 10, weight: .medium)).foregroundStyle(acik ? Tema.metin2 : Tema.metin3).lineLimit(1).fixedSize()
                    }
                    .frame(maxWidth: .infinity, alignment: .bottom)
                }
            }
            .frame(height: 68, alignment: .bottom)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("Senin önümüzdeki 12 ayın"))
    }

    // Faydalar kartı ve altında güven notu (sosyal kanıt yerine; uydurma puan ya da kullanıcı sayısı yazılmaz)
    private var faydaKarti: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kart(dolgu: 16) {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(faydalar, id: \.anahtar) { f in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(Tema.iyi)
                            Text(f.metin).font(.subheadline).foregroundStyle(Tema.metin).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            Text(L("Banka şifresi istemez · Reklam ve izleme yok")).font(.footnote).foregroundStyle(Tema.metin3)
                .padding(.horizontal, 4)
        }
    }

    // ── Planlar ─────────────────────────────────────────────────────────────

    private var secim: Plan? { planListesi.first { $0.id == secili } }

    // Planlar alt alta, tam genişlikte: fiyat sağda tek satır. Yan yana üç kutuda uzun para birimleri (₺1.999,99,
    // Rp 649.000) ve uzun plan adları (Wöchentlich) sığmıyordu
    @ViewBuilder private var planlar: some View {
        let liste = planListesi
        if liste.isEmpty {
            Text(L("Fiyatlar App Store'dan alınamadı. Bağlantını kontrol edip yeniden dene."))
                .font(.subheadline).foregroundStyle(Tema.metin2)
        } else {
            VStack(spacing: 6) {
                ForEach(liste) { p in planSatiri(p) }
            }
        }
    }

    // Seçili satır koyu çerçeveli, solda dolu daire. Adın yanında tasarruf (yeşil), altında aylık karşılık ve deneme.
    // Ödenecek tutar (fiyat) satırın en belirgin rakamı (3.1.2)
    private func planSatiri(_ p: Plan) -> some View {
        let sec = p.id == secili
        let alt = [p.aylikKarsilik.map { L("ayda {0}", $0) } ?? L("her ay ödenir"), p.deneme.map { L("{0} ücretsiz", $0) }]
            .compactMap { $0 }.joined(separator: " · ")
        let sekil = RoundedRectangle(cornerRadius: Tema.yaricapOrta, style: .continuous)
        return Button { withAnimation(.snappy(duration: 0.2)) { secili = p.id } } label: {
            HStack(spacing: 12) {
                Image(systemName: sec ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22)).foregroundStyle(sec ? Tema.metin : Tema.cizgi2)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(p.ad).font(.body.weight(.semibold)).foregroundStyle(Tema.metin)
                        if let r = p.rozet { Text(r).font(.footnote.weight(.semibold)).foregroundStyle(Tema.iyi).lineLimit(1) }
                    }
                    Text(alt).font(.footnote).foregroundStyle(Tema.metin2).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Text(p.fiyat).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(Tema.metin)
                    .lineLimit(1).minimumScaleFactor(0.7).layoutPriority(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Tema.yuzey, in: sekil)
            .overlay(sekil.strokeBorder(sec ? Tema.metin : Tema.cizgi, lineWidth: sec ? 1.5 : 1))
            .contentShape(sekil)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(sec ? .isSelected : [])
    }

    // Altta sabit: uygulamanın ana düğmesi (Kaydet gibi siyah), fiyat ve yenilenme satırı, geri yükleme ve bağlantılar
    private var altCubuk: some View {
        let p = secim
        return VStack(spacing: 10) {
            Button { if let u = p?.urun { Task { await abonelik.satinAl(u, neden: neden) } } } label: {
                ZStack {
                    Text(p?.deneme.map { L("{0} ücretsiz dene", $0) } ?? L("Abone ol")).opacity(abonelik.calisiyor ? 0 : 1)
                    if abonelik.calisiyor { ProgressView().tint(Tema.ustMetin) }
                }
                .font(.body.weight(.semibold))
                .foregroundStyle(Tema.ustMetin)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(Tema.metin, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(abonelik.calisiyor || (p?.urun == nil && Ornek.premium == nil))
            if let p {
                Text(kisaAciklama(p)).font(.caption).foregroundStyle(Tema.metin2).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 18) {
                Button(L("Geri yükle")) { Task { await abonelik.geriYukle() } }
                Link(L("Koşullar"), destination: Yapilandirma.kosullar)
                Link(L("Gizlilik"), destination: Yapilandirma.gizlilik)
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(Tema.metin3)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 4)
        .background {
            // Üstü saydamdan zemine: kaydırılan içerik düğmenin altına yumuşak girer
            LinearGradient(stops: [.init(color: Tema.zemin.opacity(0), location: 0), .init(color: Tema.zemin, location: 0.08)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        }
    }

    // Fiyat, dönem, deneme ve kendiliğinden yenilenme (App Store yönergesi 3.1.2). Denemede ücretin başlayacağı gün
    // yazılır: "ne zaman ödeyeceğim" kaygısı denemeye başlamayı en çok durduran şey
    private func kisaAciklama(_ p: Plan) -> String {
        if p.deneme != nil, let bitis = p.denemeBitis {
            let gun = bitis.formatted(Bicim.tarih.day().month(.wide))
            return L("Bugün ödeme yok: {0} tarihine kadar ücretsiz, sonra {1} / {2}. Kendiliğinden yenilenir; o tarihten önce iptal edersen ücret alınmaz.",
                     gun, p.fiyat, p.donem)
        }
        return L("{0} / {1}.", p.fiyat, p.donem) + " " + L("Kendiliğinden yenilenir, istediğin zaman iptal et.")
    }

    // ── Premium açıkken ──────────────────────────────────────────────────────

    private var premiumAcik: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(L("Premium açık. Teşekkürler!"), systemImage: "checkmark.seal.fill").foregroundStyle(Tema.iyi).font(.body.weight(.semibold))
            AltKaydet(eksik: nil, baslik: L("Yapay zekâ asistanını bağla")) { asistan = true }
        }
        .padding(.top, 6)
    }

    // Planlar App Store ürünlerinden; örnek modunda ABD fiyatlarıyla (ekran görüntüsü, App Store incelemesi)
    private var planListesi: [Plan] {
        if Ornek.premium != nil {
            // Türkiye örneğinde uzun yazılan lira fiyatları (sığma denemesi; gerçek fiyat App Store'dan gelir). ABD:
            // App Store incelemesinin istediği görüntü (en-ucretsiz-galeri7, -ulke US) dolarla
            let f = Ornek.ulke == "TR" ? ["₺1.999,99", "₺166,67", "₺349,99", "₺149,99", "₺649,96"]
                                       : ["$39.99", "$3.33", "$6.99", "$2.99", "$12.96"]
            return [
                Plan(id: Abonelik.kimlikler[0], ad: L("Yıllık"), fiyat: f[0], donem: L("yıl"), aylikKarsilik: f[1],
                     deneme: L("{0} gün", 7), denemeBitis: Calendar.current.date(byAdding: .day, value: 7, to: .now),
                     rozet: L("%{0} tasarruf", 52)),
                Plan(id: Abonelik.kimlikler[1], ad: L("Aylık"), fiyat: f[2], donem: L("ay")),
                Plan(id: Abonelik.kimlikler[2], ad: L("Haftalık"), fiyat: f[3], donem: L("hafta"), aylikKarsilik: f[4]),
            ]
        }
        let aylik = abonelik.urunler.first { $0.subscription?.subscriptionPeriod.unit == .month && $0.subscription?.subscriptionPeriod.value == 1 }
        return abonelik.urunler.compactMap { u in
            guard let s = u.subscription else { return nil }
            let d = s.subscriptionPeriod
            var p = Plan(id: u.id, ad: Self.planAdi(d), fiyat: u.displayPrice, donem: Self.donemAdi(d), urun: u)
            if let ay = Self.aySayisi(d), abs(ay - 1) > 0.01 {
                p.aylikKarsilik = (u.price / Decimal(ay)).formatted(u.priceFormatStyle)
            }
            if d.unit == .year, let a = aylik, a.price > 0 {
                let oran = 1 - NSDecimalNumber(decimal: u.price).doubleValue / (NSDecimalNumber(decimal: a.price).doubleValue * 12)
                if oran >= 0.1 { p.rozet = L("%{0} tasarruf", Int((oran * 100).rounded())) }
            }
            if let o = s.introductoryOffer, o.paymentMode == .freeTrial, denemeUygun.contains(u.id) {
                p.deneme = Self.sure(o.period)
                p.denemeBitis = Self.bitis(o.period)
            }
            return p
        }
    }

    // Dönemdeki ay (aylık karşılık): yıl 12, hafta 12/52
    private static func aySayisi(_ d: Product.SubscriptionPeriod) -> Double? {
        switch d.unit {
        case .year: return 12 * Double(d.value)
        case .month: return Double(d.value)
        case .week: return 12.0 / 52 * Double(d.value)
        default: return nil
        }
    }

    // Deneme bugün başlarsa ücretin alınacağı gün
    private static func bitis(_ d: Product.SubscriptionPeriod) -> Date? {
        let birim: Calendar.Component
        switch d.unit {
        case .day: birim = .day
        case .week: birim = .weekOfYear
        case .month: birim = .month
        default: birim = .year
        }
        return Calendar.current.date(byAdding: birim, value: d.value, to: .now)
    }

    private static func planAdi(_ d: Product.SubscriptionPeriod) -> String {
        switch d.unit {
        case .year: return L("Yıllık")
        case .month: return L("Aylık")
        case .week: return L("Haftalık")
        default: return L("Günlük")
        }
    }

    private static func donemAdi(_ d: Product.SubscriptionPeriod) -> String {
        switch d.unit {
        case .year: return L("yıl")
        case .month: return L("ay")
        case .week: return L("hafta")
        default: return L("gün")
        }
    }

    // Ücretsiz deneme süresi: "7 gün", "1 ay"
    private static func sure(_ d: Product.SubscriptionPeriod) -> String {
        switch d.unit {
        case .day: return L("{0} gün", d.value)
        case .week: return L("{0} gün", d.value * 7)
        case .month: return L("{0} ay", d.value)
        default: return L("{0} yıl", d.value)
        }
    }
}

// Premium'a ait bölümün yerine: başlık, kısa açıklama, "Premium'a geç" (ödeme ekranını açar)
struct PremiumKilidi: View {
    let baslik: String
    let aciklama: String
    let neden: String
    @State private var acik = false

    var body: some View {
        Kart {
            KartBasligi(baslik: baslik) {
                Label(L("Premium"), systemImage: "lock.fill").font(.caption.weight(.semibold)).foregroundStyle(Tema.metin2)
            }
            Text(aciklama).font(.subheadline).foregroundStyle(Tema.metin2)
            AltKaydet(eksik: nil, baslik: L("Premium'a geç")) { acik = true }
        }
        .sheet(isPresented: $acik) { PremiumEkrani(neden: neden) }
    }
}

// Yeni kart formu: ücretsiz sürümde en fazla Abonelik.ucretsizKart kart; fazlası için ödeme ekranı
struct YeniKart: View {
    @EnvironmentObject private var model: Model
    @EnvironmentObject private var abonelik: Abonelik

    var body: some View {
        let sayi = ((try? model.read("list_cards") as KartListesi)?.cards.count) ?? 0
        if abonelik.premium || sayi < Abonelik.ucretsizKart {
            KartFormu(card: nil)
        } else {
            PremiumEkrani(neden: "card_limit")
        }
    }
}

// Ayarlar'ın üstü: Premium durumu, abone olma, yönetme, geri yükleme, yapay zekâ asistanı. Pencereleri Ayarlar açar
// (AyarlarEkrani.Sayfa): bölüme bağlanan pencere listede her satıra ayrı bağlanıp kapanır.
struct PremiumBolumu: View {
    @EnvironmentObject private var abonelik: Abonelik
    @Binding var sayfa: AyarlarEkrani.Sayfa?
    @Binding var yonet: Bool

    var body: some View {
        Section {
            if abonelik.premium {
                Satir(title: L("Abonelik durumu"), value: durum)
                if abonelik.cihaz != nil { Button(L("Aboneliği yönet")) { yonet = true } }
            } else {
                Text(L("Ücretsiz sürüm: {0} kart, {1} kişi. Premium'da yapay zekâ asistanı (Claude, ChatGPT), sınırsız kart ve kişi, Akış, Alabilir miyim?, içgörüler ve Varlığın seyri.", Abonelik.ucretsizKart, Abonelik.ucretsizKisi))
                    .font(.footnote).foregroundStyle(.secondary)
                Button(L("Premium'a geç")) { sayfa = .premium }.font(.body.weight(.semibold))
                Button(L("Satın alımları geri yükle")) { Task { await abonelik.geriYukle() } }
            }
            Button { sayfa = .asistan } label: { Label(L("Yapay zekâ asistanı"), systemImage: "sparkles") }
        } header: { Text(L("CashFollow Premium")) }
    }

    private var durum: String {
        if let t = abonelik.cihaz {
            let ad = t.productID.hasSuffix("yearly") ? L("Yıllık") : t.productID.hasSuffix("monthly") ? L("Aylık") : L("Haftalık")
            guard let e = t.expirationDate else { return ad }
            let gun = e.formatted(Bicim.tarih.day().month(.wide).year())
            return abonelik.yenilenecek == false ? L("{0} · {1} tarihinde biter", ad, gun) : L("{0} · {1} tarihinde yenilenir", ad, gun)
        }
        if abonelik.sunucu?.source == "grandfathered" { return L("Ömür boyu (ilk kullanıcı)") }
        if let s = abonelik.sunucu?.expires_at, let e = ISO8601DateFormatter.tam.date(from: s) ?? ISO8601DateFormatter().date(from: s) {
            return L("{0} tarihine kadar", e.formatted(Bicim.tarih.day().month(.wide).year()))
        }
        return L("Açık")
    }
}

private extension ISO8601DateFormatter {
    // Supabase zaman damgası: 2026-11-02T12:00:00.123+00:00
    static let tam: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

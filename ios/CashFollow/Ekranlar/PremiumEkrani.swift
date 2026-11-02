import SwiftUI
import StoreKit

// CashFollow Premium ödeme ekranı: neler açılır, üç plan (yıllık seçili; ücretsiz deneme ve süresi StoreKit'ten),
// kendiliğinden yenilenme açıklaması, Kullanım Koşulları, Gizlilik Politikası, geri yükleme (App Store yönergesi 3.1.2).
// neden: hangi kilitten açıldığı (analitik). Fiyatlar App Store'dan; örnek modunda ABD fiyatları.
struct PremiumEkrani: View {
    var neden = "settings"
    @EnvironmentObject private var abonelik: Abonelik
    @Environment(\.dismiss) private var dismiss
    @State private var secili = Abonelik.kimlikler[0]
    @State private var denemeUygun: Set<String> = []

    // Ekranda bir plan: App Store ürünü ya da (örnek modunda / ürünler gelmeden) örnek
    struct Plan: Identifiable {
        let id: String
        let ad: String
        let fiyat: String
        let donem: String
        var alt: String?
        var deneme: String?
        var tasarruf: String?
        var urun: Product?
    }

    private static let ozellikler: [(String, String)] = [
        ("creditcard", L("Sınırsız kart ve kişi")),
        ("calendar", L("Akış: önümüzdeki ayların ödeme planı")),
        ("cart", L("Alabilir miyim?: alışverişin bütçene etkisi")),
        ("lightbulb", L("İçgörüler")),
        ("chart.line.uptrend.xyaxis", L("Varlığın seyri")),
        ("percent", L("Kart borcu geri ödeme planı")),
        ("sparkles", L("Asistan bağlantısı (Claude, ChatGPT)")),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Image(systemName: "star.circle.fill").font(.system(size: 40)).foregroundStyle(Tema.marka)
                        Text(L("CashFollow Premium")).font(.system(size: 30, weight: .bold))
                        Text(L("Bütün özellikler; sınırsız kart ve kişi.")).foregroundStyle(Tema.metin2)
                    }
                    Kart {
                        ForEach(Self.ozellikler, id: \.1) { simge, ad in
                            Label { Text(ad) } icon: { Image(systemName: simge).foregroundStyle(Tema.marka) }
                                .font(.subheadline)
                        }
                    }
                    if abonelik.premium {
                        Kart { Label(L("Premium açık. Teşekkürler!"), systemImage: "checkmark.seal.fill").foregroundStyle(Tema.iyi) }
                    } else {
                        planlar
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Tema.zemin)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Kapat")) { dismiss() } } }
            .alert(L("Satın alınamadı"), isPresented: Binding(get: { abonelik.hata != nil }, set: { if !$0 { abonelik.hata = nil } })) {
                Button(L("Tamam"), role: .cancel) {}
            } message: { Text(abonelik.hata ?? "") }
        }
        .task {
            Analitik.olay("paywall_shown", ["reason": neden])
            await abonelik.urunleriYukle()
            var uygun: Set<String> = []
            for u in abonelik.urunler where await u.subscription?.isEligibleForIntroOffer == true { uygun.insert(u.id) }
            denemeUygun = uygun
        }
    }

    @ViewBuilder private var planlar: some View {
        let liste = planListesi
        VStack(spacing: 10) {
            ForEach(liste) { p in planSatiri(p) }
        }
        if liste.isEmpty {
            Text(L("Fiyatlar App Store'dan alınamadı. Bağlantını kontrol edip yeniden dene."))
                .font(.subheadline).foregroundStyle(Tema.metin3)
        }
        let p = liste.first { $0.id == secili }
        AltKaydet(eksik: p == nil ? L("Plan seç") : nil, baslik: p?.deneme.map { L("{0} ücretsiz dene", $0) } ?? L("Abone ol")) {
            if let u = p?.urun { Task { await abonelik.satinAl(u) } }
        }
        .disabled(abonelik.calisiyor || (p?.urun == nil && Ornek.premium == nil))
        .overlay { if abonelik.calisiyor { ProgressView() } }
        if let p {
            Text((p.deneme.map { L("{0} ücretsiz, sonra {1} / {2}.", $0, p.fiyat, p.donem) } ?? L("{0} / {1}.", p.fiyat, p.donem))
                 + " " + L("Abonelik, dönem bitmeden en az 24 saat önce iptal edilmezse kendiliğinden yenilenir; ödeme Apple hesabından alınır. iPhone Ayarlar'ında adına dokunup Abonelikler'den yönetebilir ya da iptal edebilirsin."))
                .font(.caption).foregroundStyle(Tema.metin3)
        }
        VStack(spacing: 10) {
            Button(L("Satın alımları geri yükle")) { Task { await abonelik.geriYukle() } }
            HStack(spacing: 18) {
                Link(L("Kullanım koşulları"), destination: Yapilandirma.kosullar)
                Link(L("Gizlilik politikası"), destination: Yapilandirma.gizlilik)
            }
        }
        .font(.footnote.weight(.medium)).foregroundStyle(Tema.metin2)
        .frame(maxWidth: .infinity)
    }

    private func planSatiri(_ p: Plan) -> some View {
        let sec = p.id == secili
        return Button { secili = p.id } label: {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: sec ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(sec ? Tema.metin : Tema.metin3)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(p.ad).font(.body.weight(.semibold))
                        if let t = p.tasarruf {
                            Text(t).font(.caption2.weight(.bold)).foregroundStyle(Tema.marka)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(Tema.marka.opacity(0.14), in: Capsule())
                        }
                    }
                    if let d = p.deneme { Text(L("{0} ücretsiz", d)).font(.caption.weight(.semibold)).foregroundStyle(Tema.iyi) }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(p.fiyat) / \(p.donem)").font(.subheadline.weight(.semibold)).monospacedDigit()
                    if let a = p.alt { Text(a).font(.caption).foregroundStyle(Tema.metin3) }
                }
            }
            .foregroundStyle(Tema.metin)
            .padding(14)
            .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(sec ? Tema.metin : Tema.cizgi2, lineWidth: sec ? 2 : 1))
        }
        .buttonStyle(.plain)
    }

    // Planlar App Store ürünlerinden; örnek modunda ABD fiyatlarıyla (ekran görüntüsü, App Store incelemesi)
    private var planListesi: [Plan] {
        if Ornek.premium != nil {
            return [
                Plan(id: Abonelik.kimlikler[0], ad: L("Yıllık"), fiyat: "$39.99", donem: L("yıl"), alt: L("ayda {0}", "$3.33"),
                     deneme: L("{0} gün", 7), tasarruf: L("%{0} tasarruf", 52)),
                Plan(id: Abonelik.kimlikler[1], ad: L("Aylık"), fiyat: "$6.99", donem: L("ay")),
                Plan(id: Abonelik.kimlikler[2], ad: L("Haftalık"), fiyat: "$2.99", donem: L("hafta")),
            ]
        }
        let aylik = abonelik.urunler.first { $0.subscription?.subscriptionPeriod.unit == .month && $0.subscription?.subscriptionPeriod.value == 1 }
        return abonelik.urunler.compactMap { u in
            guard let s = u.subscription else { return nil }
            var p = Plan(id: u.id, ad: Self.planAdi(s.subscriptionPeriod), fiyat: u.displayPrice, donem: Self.donemAdi(s.subscriptionPeriod), urun: u)
            if s.subscriptionPeriod.unit == .year {
                p.alt = L("ayda {0}", (u.price / 12).formatted(u.priceFormatStyle))
                if let a = aylik, a.price > 0 {
                    let oran = 1 - NSDecimalNumber(decimal: u.price).doubleValue / (NSDecimalNumber(decimal: a.price).doubleValue * 12)
                    if oran >= 0.1 { p.tasarruf = L("%{0} tasarruf", Int((oran * 100).rounded())) }
                }
            }
            if let o = s.introductoryOffer, o.paymentMode == .freeTrial, denemeUygun.contains(u.id) { p.deneme = Self.sure(o.period) }
            return p
        }
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

// Ayarlar'ın üstü: Premium durumu, abone olma, yönetme, geri yükleme
struct PremiumBolumu: View {
    @EnvironmentObject private var abonelik: Abonelik
    @State private var odeme = false
    @State private var yonet = false

    var body: some View {
        Section {
            if abonelik.premium {
                Satir(title: L("Durum"), value: durum)
                if abonelik.cihaz != nil { Button(L("Aboneliği yönet")) { yonet = true } }
            } else {
                Text(L("Ücretsiz sürüm: {0} kart, yalnızca sen. Premium'da sınırsız kart ve kişi, Akış, Alabilir miyim?, içgörüler, Varlığın seyri ve asistan bağlantısı.", Abonelik.ucretsizKart))
                    .font(.footnote).foregroundStyle(.secondary)
                Button(L("Premium'a geç")) { odeme = true }.font(.body.weight(.semibold))
                Button(L("Satın alımları geri yükle")) { Task { await abonelik.geriYukle() } }
            }
        } header: { Text(L("CashFollow Premium")) }
        .sheet(isPresented: $odeme) { PremiumEkrani(neden: "settings") }
        .manageSubscriptionsSheet(isPresented: $yonet)
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

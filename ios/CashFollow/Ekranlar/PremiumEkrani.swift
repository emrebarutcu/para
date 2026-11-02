import SwiftUI
import StoreKit

// CashFollow Premium ödeme ekranı. Üstte yapay zekâ asistanı (Claude, ChatGPT ile örnek sohbet), hemen altında üç plan
// (yıllık seçili; ücretsiz deneme ve süresi StoreKit'ten), öteki Premium özellikleri, altta sabit düğme. Kendiliğinden
// yenilenme açıklaması, Kullanım Koşulları, Gizlilik Politikası ve geri yükleme (App Store yönergesi 3.1.2).
// neden: hangi kilitten açıldığı (analitik). Fiyatlar App Store'dan; örnek modunda ABD fiyatları.
struct PremiumEkrani: View {
    var neden = "settings"
    @EnvironmentObject private var abonelik: Abonelik
    @Environment(\.dismiss) private var dismiss
    @State private var secili = Abonelik.kimlikler[0]
    @State private var denemeUygun: Set<String> = []
    @State private var asistan = false

    // Ekranda bir plan: App Store ürünü ya da (örnek modunda) örnek
    struct Plan: Identifiable {
        let id: String
        let ad: String
        let fiyat: String
        let donem: String
        var haftalik: String?      // haftaya düşen (karşılaştırma için)
        var deneme: String?        // "7 gün"
        var rozet: String?         // "%52 tasarruf"
        var urun: Product?
    }

    private static let ozellikler: [(simge: String, ad: String)] = [
        ("calendar", L("Akış")),
        ("cart", L("Alabilir miyim?")),
        ("lightbulb", L("İçgörüler")),
        ("chart.line.uptrend.xyaxis", L("Varlığın seyri")),
        ("percent", L("Borç planı")),
        ("creditcard", L("Sınırsız kart ve kişi")),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                kapak
                VStack(alignment: .leading, spacing: 18) {
                    if abonelik.premium { premiumAcik } else { planlar }
                    Text(L("Premium'da ayrıca")).font(.system(size: 17, weight: .semibold)).padding(.top, 4)
                    Kart {
                        LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], spacing: 14) {
                            ForEach(Self.ozellikler, id: \.ad) { o in
                                Label { Text(o.ad).lineLimit(1).minimumScaleFactor(0.85) } icon: { Image(systemName: o.simge).foregroundStyle(Tema.marka) }
                                    .font(.subheadline.weight(.medium))
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 20)
                .padding(.bottom, 20)
            }
        }
        .ignoresSafeArea(edges: .top)
        .background(Tema.zemin)
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(.white.opacity(0.85))
                    .frame(width: 30, height: 30).background(.black.opacity(0.35), in: Circle())
            }
            .accessibilityLabel(L("Kapat"))
            .padding(14)
        }
        .safeAreaInset(edge: .bottom) { if !abonelik.premium { altCubuk } }
        .alert(L("Satın alınamadı"), isPresented: Binding(get: { abonelik.hata != nil }, set: { if !$0 { abonelik.hata = nil } })) {
            Button(L("Tamam"), role: .cancel) {}
        } message: { Text(abonelik.hata ?? "") }
        .sheet(isPresented: $asistan) { AsistanEkrani() }
        .task {
            Analitik.olay("paywall_shown", ["reason": neden])
            await abonelik.urunleriYukle()
            var uygun: Set<String> = []
            for u in abonelik.urunler where await u.subscription?.isEligibleForIntroOffer == true { uygun.insert(u.id) }
            denemeUygun = uygun
        }
    }

    // ── Kapak: yapay zekâ asistanı ───────────────────────────────────────────

    private var kapak: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(L("CashFollow Premium"), systemImage: "sparkles").font(.footnote.weight(.semibold)).foregroundStyle(Tema.marka)
            Text(L("Paranı yapay zekâyla yönet")).font(.system(size: 32, weight: .bold)).foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 8) {
                balon(L("Bu ay ne kadar ödeyeceğim?"), ben: true)
                balon(L("{0} · 2 kart, 3 nakit ödeme", Bicim.tl(4598.91)), ben: false)
                balon(L("6 taksitle telefon ekle, {0}", Bicim.tl(1200, fraction: false)), ben: true)
                balon(L("Eklendi · ayda {0}", Bicim.tl(200, fraction: false)), ben: false)
            }
            .padding(.top, 4)
            HStack(spacing: 8) {
                ForEach(["Claude", "ChatGPT", "Gemini"], id: \.self) { ad in
                    Text(ad).font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.85))
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(.white.opacity(0.1), in: Capsule())
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 58)
        .padding(.bottom, 26)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack {
                Color(red: 0.035, green: 0.04, blue: 0.055)
                RadialGradient(colors: [Tema.marka.opacity(0.5), .clear], center: .topTrailing, startRadius: 10, endRadius: 380)
                RadialGradient(colors: [Tema.seri(0).opacity(0.22), .clear], center: .bottomLeading, startRadius: 10, endRadius: 320)
            }
        }
    }

    private func balon(_ metin: String, ben: Bool) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            if ben {
                Spacer(minLength: 44)
            } else {
                Image(systemName: "sparkles").font(.caption2.weight(.bold)).foregroundStyle(.white)
                    .frame(width: 24, height: 24).background(Tema.marka, in: Circle())
            }
            Text(metin).font(.subheadline).foregroundStyle(ben ? Color.black : Color.white)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(ben ? Color.white : Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .fixedSize(horizontal: false, vertical: true)
            if !ben { Spacer(minLength: 28) }
        }
    }

    // ── Planlar ─────────────────────────────────────────────────────────────

    private var secim: Plan? { planListesi.first { $0.id == secili } }

    @ViewBuilder private var planlar: some View {
        let liste = planListesi
        if liste.isEmpty {
            Text(L("Fiyatlar App Store'dan alınamadı. Bağlantını kontrol edip yeniden dene."))
                .font(.subheadline).foregroundStyle(Tema.metin3)
        } else {
            HStack(alignment: .top, spacing: 10) {
                ForEach(liste) { p in planKutusu(p) }
            }
            .padding(.top, 8)
        }
    }

    private func planKutusu(_ p: Plan) -> some View {
        let sec = p.id == secili
        // Rozet: ücretsiz deneme, yoksa tasarruf
        let rozet = p.deneme.map { L("{0} ücretsiz", $0) } ?? p.rozet
        return Button { secili = p.id } label: {
            VStack(spacing: 4) {
                Text(p.ad).font(.subheadline.weight(.semibold))
                Text(p.fiyat).font(.system(size: 21, weight: .bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                if let h = p.haftalik { Text(L("haftada {0}", h)).font(.caption2).foregroundStyle(Tema.metin3).lineLimit(1).minimumScaleFactor(0.8) }
            }
            .foregroundStyle(Tema.metin)
            .frame(maxWidth: .infinity, minHeight: 96)
            .padding(.horizontal, 6)
            .padding(.top, rozet == nil ? 0 : 6)
            .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(sec ? Tema.marka : Tema.cizgi2, lineWidth: sec ? 2.5 : 1))
            .overlay(alignment: .top) {
                if let r = rozet {
                    Text(r).font(.caption2.weight(.bold)).foregroundStyle(.white).lineLimit(1)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Tema.marka, in: Capsule())
                        .offset(y: -10)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // Altta sabit: düğme, kısa fiyat satırı, geri yükleme ve bağlantılar
    private var altCubuk: some View {
        let p = secim
        return VStack(spacing: 8) {
            Button { if let u = p?.urun { Task { await abonelik.satinAl(u) } } } label: {
                ZStack {
                    Text(p?.deneme.map { L("{0} ücretsiz dene", $0) } ?? L("Abone ol")).opacity(abonelik.calisiyor ? 0 : 1)
                    if abonelik.calisiyor { ProgressView().tint(.white) }
                }
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Tema.marka, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(abonelik.calisiyor || (p?.urun == nil && Ornek.premium == nil))
            if let p {
                Text(kisaAciklama(p)).font(.caption).foregroundStyle(Tema.metin2).multilineTextAlignment(.center)
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
        .background(Tema.zemin.shadow(.drop(color: .black.opacity(0.08), radius: 12, y: -4)))
    }

    // Fiyat, dönem, deneme ve kendiliğinden yenilenme (App Store yönergesi 3.1.2)
    private func kisaAciklama(_ p: Plan) -> String {
        (p.deneme.map { L("{0} ücretsiz, sonra {1} / {2}.", $0, p.fiyat, p.donem) } ?? L("{0} / {1}.", p.fiyat, p.donem))
            + " " + L("Kendiliğinden yenilenir, istediğin zaman iptal et.")
    }

    // ── Premium açıkken ──────────────────────────────────────────────────────

    private var premiumAcik: some View {
        Kart {
            Label(L("Premium açık. Teşekkürler!"), systemImage: "checkmark.seal.fill").foregroundStyle(Tema.iyi).font(.body.weight(.semibold))
            AltKaydet(eksik: nil, baslik: L("Yapay zekâ asistanını bağla")) { asistan = true }
        }
    }

    // Planlar App Store ürünlerinden; örnek modunda ABD fiyatlarıyla (ekran görüntüsü, App Store incelemesi)
    private var planListesi: [Plan] {
        if Ornek.premium != nil {
            return [
                Plan(id: Abonelik.kimlikler[0], ad: L("Yıllık"), fiyat: "$39.99", donem: L("yıl"), haftalik: "$0.77",
                     deneme: L("{0} gün", 7), rozet: L("%{0} tasarruf", 52)),
                Plan(id: Abonelik.kimlikler[1], ad: L("Aylık"), fiyat: "$6.99", donem: L("ay"), haftalik: "$1.61"),
                Plan(id: Abonelik.kimlikler[2], ad: L("Haftalık"), fiyat: "$2.99", donem: L("hafta")),
            ]
        }
        let aylik = abonelik.urunler.first { $0.subscription?.subscriptionPeriod.unit == .month && $0.subscription?.subscriptionPeriod.value == 1 }
        return abonelik.urunler.compactMap { u in
            guard let s = u.subscription else { return nil }
            let d = s.subscriptionPeriod
            var p = Plan(id: u.id, ad: Self.planAdi(d), fiyat: u.displayPrice, donem: Self.donemAdi(d), urun: u)
            if let hafta = Self.haftaSayisi(d), hafta > 1 { p.haftalik = (u.price / Decimal(hafta)).formatted(u.priceFormatStyle) }
            if d.unit == .year, let a = aylik, a.price > 0 {
                let oran = 1 - NSDecimalNumber(decimal: u.price).doubleValue / (NSDecimalNumber(decimal: a.price).doubleValue * 12)
                if oran >= 0.1 { p.rozet = L("%{0} tasarruf", Int((oran * 100).rounded())) }
            }
            if let o = s.introductoryOffer, o.paymentMode == .freeTrial, denemeUygun.contains(u.id) { p.deneme = Self.sure(o.period) }
            return p
        }
    }

    // Dönemdeki hafta (fiyat karşılaştırması): yıl 52, ay 52/12
    private static func haftaSayisi(_ d: Product.SubscriptionPeriod) -> Double? {
        switch d.unit {
        case .year: return 52 * Double(d.value)
        case .month: return 52.0 / 12 * Double(d.value)
        case .week: return Double(d.value)
        default: return nil
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
    @State private var asistan = false

    var body: some View {
        Section {
            if abonelik.premium {
                Satir(title: L("Durum"), value: durum)
                if abonelik.cihaz != nil { Button(L("Aboneliği yönet")) { yonet = true } }
            } else {
                Text(L("Ücretsiz sürüm: {0} kart, yalnızca sen. Premium'da yapay zekâ asistanı (Claude, ChatGPT), sınırsız kart ve kişi, Akış, Alabilir miyim?, içgörüler ve Varlığın seyri.", Abonelik.ucretsizKart))
                    .font(.footnote).foregroundStyle(.secondary)
                Button(L("Premium'a geç")) { odeme = true }.font(.body.weight(.semibold))
                Button(L("Satın alımları geri yükle")) { Task { await abonelik.geriYukle() } }
            }
            Button { asistan = true } label: { Label(L("Yapay zekâ asistanı"), systemImage: "sparkles") }
        } header: { Text(L("CashFollow Premium")) }
        .sheet(isPresented: $odeme) { PremiumEkrani(neden: "settings") }
        .sheet(isPresented: $asistan) { AsistanEkrani() }
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

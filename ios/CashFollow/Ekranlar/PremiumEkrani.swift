import SwiftUI
import StoreKit

// CashFollow Premium ödeme ekranı (her temada koyu): başlık uygulamanın çekirdek vaadi ("Önümüzdeki 12 ayı gör, almadan
// önce sor"), altında kullanıcının kendi önümüzdeki 12 ayı (ilk iki ay açık: zaten gördüğü tutarlar; gerisi bulanık),
// Premium'un özellikleri (yapay zekâ asistanı da burada), üç plan (yıllık seçili; ücretsiz deneme ve süresi
// StoreKit'ten), altta sabit düğme. Fiyat, dönem,
// kendiliğinden yenilenme, Kullanım Koşulları, Gizlilik Politikası ve geri yükleme düğmenin altında (App Store yönergesi
// 3.1.2). neden: hangi kilitten açıldığı (analitik). Fiyatlar App Store'dan; örnek modunda ABD fiyatları.
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
        var haftalik: String?      // haftaya düşen (karşılaştırma için)
        var deneme: String?        // "7 gün"
        var rozet: String?         // "%52 tasarruf"
        var urun: Product?
    }

    private static let ozellikler = [L("Akış"), L("Alabilir miyim?"), L("İçgörüler"), L("Varlığın seyri"), L("Borç planı"), L("Sınırsız kart"),
                                     L("Sınırsız kişi"), L("Yapay zekâ asistanı")]
    private static let zemin = Color(red: 0.035, green: 0.04, blue: 0.055)

    var body: some View {
        // Büyük ekranda artan boşluk bölümler arasına eşit dağılır; planlar düğmenin hemen üstünde
        GeometryReader { alan in
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Label(L("CashFollow Premium"), systemImage: "sparkles").font(.footnote.weight(.semibold)).foregroundStyle(Tema.marka)
                    Text(L("Önümüzdeki 12 ayı gör, almadan önce sor")).font(.system(size: 30, weight: .bold)).foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(L("Her ayın ödemesi, paranın yetip yetmeyeceği, ilk ödemesi en geç gelen kart."))
                        .font(.subheadline.weight(.medium)).foregroundStyle(.white.opacity(0.55))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if aylar.contains(where: { $0.total > 0.004 }) { onizleme }
                Spacer(minLength: 0)
                LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], spacing: 10) {
                    ForEach(Self.ozellikler, id: \.self) { ad in
                        Label { Text(ad).lineLimit(1).minimumScaleFactor(0.85) } icon: {
                            Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(Tema.marka)
                        }
                        .font(.subheadline).foregroundStyle(.white.opacity(0.85))
                    }
                }
                Spacer(minLength: 0)
                if abonelik.premium { premiumAcik } else { planlar }
            }
            .padding(.horizontal, 20)
            .padding(.top, 38)
            .padding(.bottom, 16)
            .frame(minHeight: alan.size.height, alignment: .top)
        }
        .scrollIndicators(.hidden)
        }
        .background {
            ZStack {
                Self.zemin
                RadialGradient(colors: [Tema.marka.opacity(0.42), .clear], center: .topTrailing, startRadius: 10, endRadius: 420)
                RadialGradient(colors: [Tema.seri(0).opacity(0.18), .clear], center: .leading, startRadius: 10, endRadius: 360)
            }
            .ignoresSafeArea()
        }
        .environment(\.colorScheme, .dark)
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.footnote.weight(.bold)).foregroundStyle(.white.opacity(0.8))
                    .frame(width: 30, height: 30).background(.white.opacity(0.12), in: Circle())
            }
            .accessibilityLabel(L("Kapat"))
            .padding(14)
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

    // Önümüzdeki 12 ayın ödemeleri çubuklarla: bu ay ve gelecek ay açık (Özet'te zaten gördüğü tutarlar), sonraki aylar
    // bulanık. Kilitli olanın kendi verisi olduğunu gösterir; tutar yazılmaz.
    private var onizleme: some View {
        let enBuyuk = max(aylar.map(\.total).max() ?? 0, 1)
        return VStack(alignment: .leading, spacing: 12) {
            Text(L("Senin önümüzdeki 12 ayın")).font(.footnote.weight(.semibold)).foregroundStyle(.white.opacity(0.6))
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(Array(aylar.enumerated()), id: \.offset) { i, a in
                    VStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(i < 2 ? Color.white : Tema.marka)
                            .frame(height: max(4, CGFloat(92 * a.total / enBuyuk)))
                            .blur(radius: i < 2 ? 0 : 5)
                        Text(Bicim.date(a.month + "-01").map { $0.formatted(Bicim.tarih.month(.narrow)) } ?? "")
                            .font(.system(size: 9, weight: .semibold)).foregroundStyle(.white.opacity(i < 2 ? 0.75 : 0.4)).lineLimit(1).fixedSize()
                    }
                    .frame(maxWidth: .infinity, alignment: .bottom)
                }
            }
            .frame(height: 116, alignment: .bottom)
        }
        .padding(14)
        .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(.white.opacity(0.1), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("Senin önümüzdeki 12 ayın"))
    }

    // ── Planlar ─────────────────────────────────────────────────────────────

    private var secim: Plan? { planListesi.first { $0.id == secili } }

    @ViewBuilder private var planlar: some View {
        let liste = planListesi
        if liste.isEmpty {
            Text(L("Fiyatlar App Store'dan alınamadı. Bağlantını kontrol edip yeniden dene."))
                .font(.subheadline).foregroundStyle(.white.opacity(0.6))
        } else {
            HStack(alignment: .top, spacing: 10) {
                ForEach(liste) { p in planKutusu(p) }
            }
            .padding(.top, 6)
        }
    }

    // Seçili plan beyaz; rozet: ücretsiz deneme, yoksa tasarruf
    private func planKutusu(_ p: Plan) -> some View {
        let sec = p.id == secili
        let rozet = p.deneme.map { L("{0} ücretsiz", $0) } ?? p.rozet
        return Button { withAnimation(.snappy(duration: 0.2)) { secili = p.id } } label: {
            VStack(spacing: 4) {
                Text(p.ad).font(.subheadline.weight(.semibold))
                Text(p.fiyat).font(.system(size: 22, weight: .bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                Text(p.haftalik.map { L("haftada {0}", $0) } ?? " ").font(.caption2).opacity(0.55).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(sec ? Color.black : Color.white)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 6)
            .padding(.top, 22)
            .padding(.bottom, 16)
            .background(sec ? Color.white : Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(sec ? 0 : 0.14), lineWidth: 1))
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

    // Altta sabit: düğme, fiyat ve yenilenme satırı, geri yükleme ve bağlantılar
    private var altCubuk: some View {
        let p = secim
        return VStack(spacing: 10) {
            Button { if let u = p?.urun { Task { await abonelik.satinAl(u) } } } label: {
                ZStack {
                    Text(p?.deneme.map { L("{0} ücretsiz dene", $0) } ?? L("Abone ol")).opacity(abonelik.calisiyor ? 0 : 1)
                    if abonelik.calisiyor { ProgressView().tint(.white) }
                }
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Tema.marka, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(abonelik.calisiyor || (p?.urun == nil && Ornek.premium == nil))
            if let p {
                Text(kisaAciklama(p)).font(.caption).foregroundStyle(.white.opacity(0.6)).multilineTextAlignment(.center)
            }
            HStack(spacing: 18) {
                Button(L("Geri yükle")) { Task { await abonelik.geriYukle() } }
                Link(L("Koşullar"), destination: Yapilandirma.kosullar)
                Link(L("Gizlilik"), destination: Yapilandirma.gizlilik)
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(.white.opacity(0.45))
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 4)
        .background {
            // Üstü saydamdan koyuya: kaydırılan içerik düğmenin altına yumuşak girer, planların üstüne taşmaz
            LinearGradient(stops: [.init(color: Self.zemin.opacity(0), location: 0), .init(color: Self.zemin, location: 0.06)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        }
    }

    // Fiyat, dönem, deneme ve kendiliğinden yenilenme (App Store yönergesi 3.1.2)
    private func kisaAciklama(_ p: Plan) -> String {
        (p.deneme.map { L("{0} ücretsiz, sonra {1} / {2}.", $0, p.fiyat, p.donem) } ?? L("{0} / {1}.", p.fiyat, p.donem))
            + " " + L("Kendiliğinden yenilenir, istediğin zaman iptal et.")
    }

    // ── Premium açıkken ──────────────────────────────────────────────────────

    private var premiumAcik: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(L("Premium açık. Teşekkürler!"), systemImage: "checkmark.seal.fill").foregroundStyle(Tema.marka).font(.body.weight(.semibold))
            Button { asistan = true } label: {
                Text(L("Yapay zekâ asistanını bağla")).font(.body.weight(.semibold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                    .background(Tema.marka, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 6)
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

// Ayarlar'ın üstü: Premium durumu, abone olma, yönetme, geri yükleme, yapay zekâ asistanı. Pencereleri Ayarlar açar
// (AyarlarEkrani.Sayfa): bölüme bağlanan pencere listede her satıra ayrı bağlanıp kapanır.
struct PremiumBolumu: View {
    @EnvironmentObject private var abonelik: Abonelik
    @Binding var sayfa: AyarlarEkrani.Sayfa?
    @Binding var yonet: Bool

    var body: some View {
        Section {
            if abonelik.premium {
                Satir(title: L("Durum"), value: durum)
                if abonelik.cihaz != nil { Button(L("Aboneliği yönet")) { yonet = true } }
            } else {
                Text(L("Ücretsiz sürüm: {0} kart, yalnızca sen. Premium'da yapay zekâ asistanı (Claude, ChatGPT), sınırsız kart ve kişi, Akış, Alabilir miyim?, içgörüler ve Varlığın seyri.", Abonelik.ucretsizKart))
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

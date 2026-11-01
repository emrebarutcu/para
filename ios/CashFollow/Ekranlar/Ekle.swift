import SwiftUI

// Her sekmede + düğmesi, bulunduğun ekranın işini doğrudan açar (ara seçici yok):
//   Özet, Akış, Harcamalar → dokununca Harcama formu; basılı tutunca bütün eklemeler
//   Varlıklar              → dokununca kısa menü: Gelir, Döviz / altın, Fon / hisse; altında "Diğer"
//   Borçlar                → dokununca kısa menü: Borç verdim, Borç aldım, Kredi, Kredi kartı; altında "Diğer"
// Seçilen iş kendi formunda açılır; "Vazgeç" kapatır.
//
// Kapsam (her ekleme işi her sekmeden yapılabilir):
//   Harcama            → add_purchase: kartla ya da nakit, peşin / taksitli, her ay tekrarlayan (abonelik, kira)
//   Gelir              → add_entry (ana para birimi, giriş): maaş, kira geliri; her ay tekrarlanabilir
//   Döviz / altın      → add_entry: alış / satış, ana para biriminden ödendi mi
//   Fon / hisse        → add_entry (yalnızca Türkiye): alış / satış
//   Borç verdim / aldım, Kredi → add_debt
//   Kredi kartı        → add_card
// Nakit harcama ayrı bir seçenek değildir: Harcama'da "Nakit" seçilir (ana para birimi bakiyesinden düşer).

enum EkleSecim: Hashable, Identifiable {
    case harcama
    case hareket(HareketTuru)
    case borc(String)      // borrowed, lent, loan
    case kart

    var id: String {
        switch self {
        case .harcama: return "harcama"
        case .hareket(let t): return "hareket." + t.rawValue
        case .borc(let t): return "borc." + t
        case .kart: return "kart"
        }
    }
}

// Hangi sekmedeyiz: + düğmesinin ilk işi buna göre
enum EkleBaglam {
    case harcama, varlik, borc
}

extension View {
    // Sekmenin sağ altına + düğmesi
    func ekleDugmesi(_ baglam: EkleBaglam) -> some View { modifier(EkleDugmesi(baglam: baglam)) }
}

private struct EkleDugmesi: ViewModifier {
    @EnvironmentObject private var model: Model
    let baglam: EkleBaglam
    @State private var secim: EkleSecim?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottomTrailing) {
                dugme
                    .padding(.trailing, 18)
                    .padding(.bottom, 14)
            }
            .sheet(item: $secim) { EkleFormu(secim: $0) }
    }

    @ViewBuilder private var dugme: some View {
        switch baglam {
        case .harcama:
            // Dokun: harcama; basılı tut: diğerleri
            Menu {
                Section { harcamaDugmesi }
                Section("Para") { paraDugmeleri }
                Section("Borç") { borcDugmeleri }
            } label: {
                YuzenSimge()
            } primaryAction: {
                secim = .harcama
            }
            .accessibilityLabel("Harcama ekle")
            .accessibilityHint("Basılı tutunca gelir, döviz, borç ya da kart eklenir")
        case .varlik:
            Menu {
                Section { paraDugmeleri }
                Section("Diğer") {
                    harcamaDugmesi
                    borcDugmeleri
                }
            } label: { YuzenSimge() }
            .accessibilityLabel("Ekle: gelir, döviz / altın, fon / hisse")
        case .borc:
            Menu {
                Section { borcDugmeleri }
                Section("Diğer") {
                    harcamaDugmesi
                    paraDugmeleri
                }
            } label: { YuzenSimge() }
            .accessibilityLabel("Ekle: borç, kredi ya da kart")
        }
    }

    private var harcamaDugmesi: some View {
        Button { secim = .harcama } label: { Label("Harcama", systemImage: "cart") }
    }

    @ViewBuilder private var paraDugmeleri: some View {
        Button { secim = .hareket(.gelir) } label: { Label("Gelir", systemImage: "arrow.down.circle") }
        Button { secim = .hareket(.doviz) } label: { Label("Döviz / altın", systemImage: "dollarsign.circle") }
        if model.marketsAllowed {
            Button { secim = .hareket(.piyasa) } label: { Label("Fon / hisse", systemImage: "chart.line.uptrend.xyaxis") }
        }
    }

    @ViewBuilder private var borcDugmeleri: some View {
        Button { secim = .borc("lent") } label: { Label("Borç verdim", systemImage: "arrow.up.right.circle") }
        Button { secim = .borc("borrowed") } label: { Label("Borç aldım", systemImage: "arrow.down.left.circle") }
        Button { secim = .borc("loan") } label: { Label("Kredi", systemImage: "building.columns") }
        Button { secim = .kart } label: { Label("Kredi kartı", systemImage: "creditcard") }
    }
}

// Seçilen işin formu
struct EkleFormu: View {
    let secim: EkleSecim

    var body: some View {
        switch secim {
        case .harcama: HarcamaFormu()
        case .hareket(let t): HareketFormu(tur: t)
        case .borc(let t): BorcFormu(baslangic: t)
        case .kart: KartFormu(card: nil)
        }
    }
}

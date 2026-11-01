import SwiftUI

// Bütün sekmelerde aynı + düğmesi. Dokununca "Ne eklemek istiyorsun?" seçicisi açılır; seçilen iş aynı pencerede kendi
// formuna dönüşür (pencere üstüne pencere açılmaz, "Vazgeç" hepsini kapatır).
//
// Seçenekler ve kapsadıkları (her ekleme işi buradan yapılabilir):
//   Harcama            → add_purchase: kartla ya da nakit, peşin / taksitli, her ay tekrarlayan (abonelik, kira)
//   Gelir              → add_entry (ana para birimi, giriş): maaş, kira geliri; her ay tekrarlanabilir
//   Döviz / altın      → add_entry: alış / satış, ana para biriminden ödendi mi
//   Fon / hisse        → add_entry (yalnızca Türkiye): alış / satış
//   Borç verdim / aldım, Kredi → add_debt
//   Kart               → add_card
// Nakit harcama ayrı bir seçenek değildir: Harcama'da "Nakit" seçilir (ana para birimi bakiyesinden düşer).

enum EkleSecim: Hashable {
    case harcama
    case hareket(HareketTuru)
    case borc(String)      // borrowed, lent, loan
    case kart
}

extension View {
    // Sekmenin sağ altına + düğmesi ve ekleme akışı
    func ekleDugmesi() -> some View { modifier(EkleDugmesi()) }
}

private struct EkleDugmesi: ViewModifier {
    @State private var acik = false

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottomTrailing) {
                Button { acik = true } label: { YuzenSimge() }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Ekle")
                    .accessibilityHint("Harcama, gelir, döviz, borç ya da kart ekle")
                    .padding(.trailing, 18)
                    .padding(.bottom, 14)
                    .sensoryFeedback(.impact(weight: .light), trigger: acik) { _, yeni in yeni }
            }
            .sheet(isPresented: $acik) { EkleAkisi() }
    }
}

// Seçici → form; seçince pencere tam boya çıkar
struct EkleAkisi: View {
    @State private var secim: EkleSecim?
    @State private var boy: PresentationDetent = .medium

    var body: some View {
        Group {
            switch secim {
            case nil:
                EkleSecici { s in
                    boy = .large
                    withAnimation(.snappy(duration: 0.25)) { secim = s }
                }
            case .harcama:
                HarcamaFormu()
            case .hareket(let t):
                HareketFormu(tur: t)
            case .borc(let t):
                BorcFormu(baslangic: t)
            case .kart:
                KartFormu(card: nil)
            }
        }
        .presentationDetents(secim == nil ? [.medium, .large] : [.large], selection: $boy)
        .presentationDragIndicator(secim == nil ? .visible : .hidden)
    }
}

// "Ne eklemek istiyorsun?": en sık iş (Harcama) en üstte ve büyük; diğerleri gruplu, her biri bir satır açıklamalı
struct EkleSecici: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let sec: (EkleSecim) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Button { sec(.harcama) } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "cart")
                                .font(.system(size: 20, weight: .semibold))
                                .frame(width: 44, height: 44)
                                .background(Tema.ustMetin.opacity(0.15), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Harcama").font(.headline)
                                Text("Kartla ya da nakit; taksit, abonelik, kira").font(.subheadline).opacity(0.75)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.subheadline.weight(.semibold)).opacity(0.6)
                        }
                        .foregroundStyle(Tema.ustMetin)
                        .padding(14)
                        .background(Tema.metin, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    grup("Para") {
                        satir("Gelir", "Maaş, kira geliri; her ay tekrarlanabilir", "arrow.down.circle") { sec(.hareket(.gelir)) }
                        satir("Döviz / altın", "Aldın ya da sattın", "dollarsign.circle") { sec(.hareket(.doviz)) }
                        if model.marketsAllowed {
                            satir("Fon / hisse", "TEFAS fonu ya da Borsa İstanbul hissesi", "chart.line.uptrend.xyaxis") { sec(.hareket(.piyasa)) }
                        }
                    }
                    grup("Borç") {
                        satir("Borç verdim", "Birine verdiğin, geri alacağın para", "arrow.up.right.circle") { sec(.borc("lent")) }
                        satir("Borç aldım", "Birinden aldığın, geri ödeyeceğin para", "arrow.down.left.circle") { sec(.borc("borrowed")) }
                        satir("Kredi", "Bankadan kredi; aylık taksitleri", "building.columns") { sec(.borc("loan")) }
                    }
                    grup("Kart") {
                        satir("Kredi kartı", "Kesim ve son ödeme günüyle", "creditcard") { sec(.kart) }
                    }
                }
                .padding(16)
            }
            .background(Tema.zemin)
            .navigationTitle("Ne eklemek istiyorsun?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } } }
        }
    }

    private func grup<C: View>(_ baslik: String, @ViewBuilder _ icerik: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(baslik).font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3).padding(.horizontal, 4)
            VStack(spacing: 0) { icerik() }
                .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }

    private func satir(_ ad: String, _ aciklama: String, _ simge: String, _ eylem: @escaping () -> Void) -> some View {
        Button(action: eylem) {
            HStack(spacing: 12) {
                Image(systemName: simge)
                    .font(.system(size: 17))
                    .foregroundStyle(Tema.metin2)
                    .frame(width: 36, height: 36)
                    .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(ad).font(.body.weight(.semibold)).foregroundStyle(Tema.metin)
                    Text(aciklama).font(.footnote).foregroundStyle(Tema.metin3)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

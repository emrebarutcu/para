import SwiftUI
import UIKit

// Web'in görünümü (styles.css): arayüz tek renkli (siyah / beyaz), renk yalnızca veriye — kişilere ve kartlara — ait.
// Renkler web'deki değişkenlerle aynı (--bg, --surface, --text, --s1…--s8); açık ve koyu temada ayrı.
enum Tema {
    static let zemin = dyn(0xf5f6f8, 0x0b0c10)       // --bg
    static let yuzey = dyn(0xffffff, 0x14161c)       // --surface
    static let yuzey2 = dyn(0xf2f3f6, 0x1b1e26)      // --surface-2
    static let yuzey3 = dyn(0xe7e9ee, 0x252934)      // --surface-3
    static let cizgi = dyn(0xe7e9ee, 0x22252e)       // --line
    static let cizgi2 = dyn(0xd6d9e1, 0x323643)      // --line-2
    static let metin = dyn(0x10131a, 0xeef0f4)       // --text (aynı zamanda --primary)
    static let metin2 = dyn(0x4a5163, 0xa7adbb)      // --text-2
    static let metin3 = dyn(0x8a90a0, 0x6c7283)      // --text-3
    static let ustMetin = dyn(0xffffff, 0x0b0c10)    // --on-primary
    static let tehlike = dyn(0xd43c4b, 0xf06b78)     // --danger
    static let uyari = dyn(0xb7791f, 0xe3a646)       // --warn
    static let iyi = dyn(0x13915c, 0x3fcf8e)         // --ok
    static let nakit = dyn(0x9aa0ae, 0x5d6373)       // --cash
    static let marka = Renk.hex(0x1baf7a)            // logodaki yeşil

    private static let seriAcik = [0x2a78d6, 0xeb6834, 0x1baf7a, 0xeda100, 0xe87ba4, 0x008300, 0x6250d6, 0xe34948]
    private static let seriKoyu = [0x3987e5, 0xd95926, 0x199e70, 0xc98500, 0xd55181, 0x008300, 0x9085e9, 0xe66767]
    private static let seriler = (0..<8).map { dyn(seriAcik[$0], seriKoyu[$0]) }
    // Kişi / kart rengi: kayıttaki color (0…7)
    static func seri(_ i: Int) -> Color { seriler[((i % 8) + 8) % 8] }

    static let yaricap: CGFloat = 24      // --r-xl
    static let yaricapOrta: CGFloat = 14  // --r

    static func dyn(_ acik: Int, _ koyu: Int) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? ui(koyu) : ui(acik) })
    }
    private static func ui(_ v: Int) -> UIColor {
        UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

// ── Sayfa ve kart ─────────────────────────────────────────────────────────────

// Sekmenin gövdesi: gri zemin üzerinde alt alta kartlar (web: main > .card)
struct Sayfa<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) { content() }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 96)   // yüzen + düğmesi ve sekme çubuğu
        }
        .background(Tema.zemin)
        .scrollContentBackground(.hidden)
    }
}

// Beyaz, köşeleri yuvarlak, hafif gölgeli kart (web: .card)
struct Kart<Content: View>: View {
    var dolgu: CGFloat = 18
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content() }
            .padding(dolgu)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: Tema.yaricap, style: .continuous))
            .overlay {
                if scheme == .dark {
                    RoundedRectangle(cornerRadius: Tema.yaricap, style: .continuous).strokeBorder(Tema.cizgi, lineWidth: 1)
                }
            }
            .shadow(color: .black.opacity(scheme == .dark ? 0.3 : 0.06), radius: 15, y: 10)
    }
}

// Kartın başlığı; sağda isteğe bağlı bağlantı / düğme (web: .card-head)
struct KartBasligi<Sag: View>: View {
    let baslik: String
    var alt: String? = nil
    @ViewBuilder var sag: () -> Sag

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(baslik).font(.system(size: 17, weight: .semibold)).foregroundStyle(Tema.metin)
            if let alt { Text(alt).font(.subheadline).foregroundStyle(Tema.metin3) }
            Spacer(minLength: 8)
            sag()
        }
    }
}

extension KartBasligi where Sag == EmptyView {
    init(_ baslik: String, alt: String? = nil) { self.init(baslik: baslik, alt: alt) { EmptyView() } }
}

// Kart dışındaki bölüm başlığı (web: .section-title)
struct BolumBasligi: View {
    let baslik: String
    var body: some View {
        Text(baslik).font(.system(size: 17, weight: .semibold)).foregroundStyle(Tema.metin).padding(.horizontal, 4).padding(.top, 6)
    }
}

// Kart içindeki ayırıcı çizgi
struct Ayirici: View {
    var body: some View { Rectangle().fill(Tema.cizgi).frame(height: 1) }
}

// ── Tutarlar ─────────────────────────────────────────────────────────────────

// Büyük tutar: simge küçük ve gri, kuruş gri (web: .hero-amount)
struct BuyukTutar: View {
    let deger: Double
    var boyut: CGFloat = 48
    var renk: Color = Tema.metin

    var body: some View {
        let p = parcala(deger)
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            if !p.isaret.isEmpty { Text(p.isaret).font(.system(size: boyut * 0.8, weight: .bold)).foregroundStyle(renk) }
            Text(p.simge).font(.system(size: boyut * 0.45, weight: .semibold)).foregroundStyle(Tema.metin3)
                .alignmentGuide(.firstTextBaseline) { _ in boyut * 0.66 }   // simge üstte (web'deki gibi)
            Text(p.tam).font(.system(size: boyut, weight: .bold)).tracking(-1).foregroundStyle(renk)
            Text(p.kesir).font(.system(size: boyut * 0.5, weight: .medium)).foregroundStyle(Tema.metin3)
        }
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Bicim.tl(deger))
    }

    private func parcala(_ v: Double) -> (isaret: String, simge: String, tam: String, kesir: String) {
        let tam = abs(v).rounded(.down)
        let kurus = Int(((abs(v) - tam) * 100).rounded())
        let tamMetin = (kurus == 100 ? tam + 1 : tam).formatted(.number.locale(Bicim.locale).precision(.fractionLength(0)))
        return (v < 0 ? "−" : "", Bicim.homeSymbol, tamMetin, "," + String(format: "%02d", kurus == 100 ? 0 : kurus))
    }
}

// Etiket + değer; büyük tutarın altındaki satırda yan yana, aralarında çizgi (web: .hero-stats)
struct Istatistik: Identifiable {
    let id = UUID()
    let etiket: String
    let deger: String
    var renk: Color = Tema.metin
}

struct IstatistikSatiri: View {
    let ogeler: [Istatistik]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(ogeler.enumerated()), id: \.element.id) { i, o in
                if i > 0 { Rectangle().fill(Tema.cizgi).frame(width: 1).padding(.horizontal, 10) }
                VStack(alignment: .leading, spacing: 3) {
                    Text(o.etiket).font(.footnote).foregroundStyle(Tema.metin3).lineLimit(1)
                    Text(o.deger).font(.subheadline.weight(.semibold)).foregroundStyle(o.renk).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

// Gri kutucuk içinde etiket + değer (web: .stat-tile)
struct Kutucuk: View {
    let etiket: String
    let deger: String
    var renk: Color = Tema.metin

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(etiket).font(.footnote).foregroundStyle(Tema.metin3).lineLimit(2)
            Text(deger).font(.subheadline.weight(.semibold)).foregroundStyle(renk).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// ── Satırlar ─────────────────────────────────────────────────────────────────

// Gün ve haftanın günü (web: .date-badge)
struct TarihRozeti: View {
    let tarih: String   // YYYY-MM-DD
    var gec = false

    var body: some View {
        let d = Bicim.date(tarih)
        VStack(spacing: 0) {
            Text(d.map { String(Bicim.takvim.component(.day, from: $0)) } ?? "–")
                .font(.system(size: 19, weight: .bold)).monospacedDigit()
            Text(d.map { $0.formatted(Bicim.tarih.weekday(.abbreviated)).uppercased(with: Bicim.locale) } ?? "")
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(gec ? Tema.tehlike : Tema.metin3)
        }
        .foregroundStyle(gec ? Tema.tehlike : Tema.metin)
        .frame(width: 46, height: 50)
        .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// Kişinin baş harfi, kendi renginde (web: .avatar)
struct Avatar: View {
    let ad: String
    let renk: Color
    var boyut: CGFloat = 36

    var body: some View {
        Text(String(ad.prefix(1)).uppercased(with: Bicim.locale))
            .font(.system(size: boyut * 0.42, weight: .semibold))
            .foregroundStyle(renk)
            .frame(width: boyut, height: boyut)
            .background(renk.opacity(0.14), in: Circle())
            .overlay(Circle().strokeBorder(renk.opacity(0.55), lineWidth: 1.5))
    }
}

// Renkli nokta + ad (kişi / kart lejantı)
struct RenkliAd: View {
    let ad: String
    let renk: Color
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(renk).frame(width: 7, height: 7)
            Text(ad).lineLimit(1)
        }
        .font(.footnote).foregroundStyle(Tema.metin2)
    }
}

// Kartın ince satır ayırıcıları: liste satırları arasında çizgi
struct SatirListesi<Veri: RandomAccessCollection, Satir: View>: View where Veri.Element: Hashable {
    let veri: Veri
    @ViewBuilder let satir: (Veri.Element) -> Satir

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(veri.enumerated()), id: \.element) { i, x in
                if i > 0 { Ayirici() }
                satir(x).padding(.vertical, 11)
            }
        }
    }
}

// ── Seçiciler ────────────────────────────────────────────────────────────────

// Gri zeminde seçili parçası beyaz olan seçici (web: .seg)
struct Secici<Deger: Hashable>: View {
    @Binding var secim: Deger
    let ogeler: [(Deger, String)]
    var tamGenislik = true

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(ogeler.enumerated()), id: \.offset) { _, o in
                let d = o.0, ad = o.1
                Button {
                    withAnimation(.snappy(duration: 0.2)) { secim = d }
                } label: {
                    Text(ad)
                        .font(.subheadline.weight(secim == d ? .semibold : .medium))
                        .foregroundStyle(secim == d ? Tema.metin : Tema.metin2)
                        .lineLimit(1)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 12)
                        .frame(maxWidth: tamGenislik ? .infinity : nil)
                        .background {
                            if secim == d {
                                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Tema.yuzey)
                                    .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// Yuvarlak filtre düğmesi: "Tümü 9", "● Ben 8" (web: .chip)
struct Cip: View {
    let ad: String
    var sayi: Int? = nil
    var renk: Color? = nil
    let secili: Bool
    let eylem: () -> Void

    var body: some View {
        Button(action: eylem) {
            HStack(spacing: 6) {
                if let renk { Circle().fill(renk).frame(width: 8, height: 8) }
                Text(ad).font(.subheadline.weight(.semibold))
                if let sayi { Text("\(sayi)").font(.subheadline).foregroundStyle(secili ? Tema.ustMetin.opacity(0.7) : Tema.metin3) }
            }
            .foregroundStyle(secili ? Tema.ustMetin : Tema.metin)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(secili ? Tema.metin : Tema.yuzey, in: Capsule())
            .overlay(Capsule().strokeBorder(secili ? Color.clear : Tema.cizgi2, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// Küçük kenarlıklı düğme (web: .btn-ghost.btn-sm)
struct KucukDugme: View {
    let ad: String
    var simge: String? = nil
    let eylem: () -> Void

    var body: some View {
        Button(action: eylem) {
            HStack(spacing: 5) {
                if let simge { Image(systemName: simge).font(.footnote.weight(.semibold)) }
                Text(ad).font(.subheadline.weight(.medium))
            }
            .foregroundStyle(Tema.metin)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Tema.cizgi2, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// + simgesi, siyah yuvarlatılmış kare (menülü düğmelerde de)
struct YuzenSimge: View {
    var body: some View {
        Image(systemName: "plus")
            .font(.system(size: 24, weight: .medium))
            .foregroundStyle(Tema.ustMetin)
            .frame(width: 58, height: 58)
            .background(Tema.metin, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: .black.opacity(0.22), radius: 12, y: 6)
    }
}

// Sağ altta siyah yuvarlak + düğmesi (web: .fab)
struct YuzenDugme: View {
    let etiket: String
    let eylem: () -> Void

    var body: some View {
        Button(action: eylem) {
            Image(systemName: "plus")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(Tema.ustMetin)
                .frame(width: 58, height: 58)
                .background(Tema.metin, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .shadow(color: .black.opacity(0.22), radius: 12, y: 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(etiket)
        .padding(.trailing, 18)
        .padding(.bottom, 14)
    }
}

extension View {
    // Sekmenin sağ altına + düğmesi
    func yuzenDugme(_ etiket: String, _ eylem: @escaping () -> Void) -> some View {
        overlay(alignment: .bottomTrailing) { YuzenDugme(etiket: etiket, eylem: eylem) }
    }

    // Gezinme çubuğu sayfa zemininde
    func sayfaZemini() -> some View {
        toolbarBackground(Tema.zemin, for: .navigationBar)
    }

    // Formlar da web'in zemininde
    func formZemini() -> some View {
        scrollContentBackground(.hidden).background(Tema.zemin)
    }
}

// Sığmayanı alt satıra geçiren dizilim (lejantlar, kişi payları). HStack + fixedSize genişliği aşınca bütün sayfa
// sağa taşıyordu.
struct Akan: Layout {
    var aralik: CGFloat = 12
    var satirAraligi: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let r = diz(proposal.width ?? .infinity, subviews)
        return CGSize(width: proposal.width ?? r.genislik, height: r.yukseklik)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let r = diz(bounds.width, subviews)
        for (i, p) in r.yerler.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: ProposedViewSize(r.boyutlar[i]))
        }
    }

    private func diz(_ genislik: CGFloat, _ subviews: Subviews) -> (yerler: [CGPoint], boyutlar: [CGSize], genislik: CGFloat, yukseklik: CGFloat) {
        var yerler: [CGPoint] = [], boyutlar: [CGSize] = []
        var x: CGFloat = 0, y: CGFloat = 0, satir: CGFloat = 0, enGenis: CGFloat = 0
        for s in subviews {
            var b = s.sizeThatFits(.unspecified)
            b.width = min(b.width, genislik)
            if x > 0, x + b.width > genislik {
                x = 0
                y += satir + satirAraligi
                satir = 0
            }
            yerler.append(CGPoint(x: x, y: y))
            boyutlar.append(b)
            x += b.width + aralik
            satir = max(satir, b.height)
            enGenis = max(enGenis, x - aralik)
        }
        return (yerler, boyutlar, enGenis, y + satir)
    }
}

// Formun altındaki büyük Kaydet: eksik varsa onu yazar ve pasiftir (üstteki Kaydet'e uzanmak gerekmez)
struct AltKaydet: View {
    let eksik: String?
    var baslik = "Kaydet"
    let eylem: () -> Void

    var body: some View {
        Button(action: eylem) {
            Text(eksik ?? baslik)
                .font(.body.weight(.semibold))
                .foregroundStyle(eksik == nil ? Tema.ustMetin : Tema.metin3)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(eksik == nil ? Tema.metin : Tema.yuzey3, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(eksik != nil)
        .animation(.snappy(duration: 0.2), value: eksik)
    }
}

import SwiftUI
import UIKit

// Kısa bildirim bandı: bir işin sonucu ekranın üstünde birkaç saniye görünür. Harcama kaydedilince form sessizce
// kapanmaz: "Kaydedildi · ilk ödeme 20 Kasım" ve ödemenin düştüğü ayın toplamı önce → sonra (HarcamaFormu). Bant
// AnaEkran'ın üstünde durur (form kapanırken görünür), dokununca ya da süresi dolunca kapanır.
@MainActor
final class Bant: ObservableObject {
    struct Mesaj: Identifiable, Equatable {
        let id = UUID()
        let baslik: String
        var alt: String? = nil
    }

    static let shared = Bant()
    @Published private(set) var mesaj: Mesaj?
    private var zamanlayici: Task<Void, Never>?

    static func goster(_ m: Mesaj, sure: Double = 4.5) { shared.goster(m, sure: sure) }

    private func goster(_ m: Mesaj, sure: Double) {
        guard Ornek.tur == nil, Ornek.galeri == nil else { return }   // ekran görüntülerinde yok
        zamanlayici?.cancel()
        withAnimation(.snappy(duration: 0.3)) { mesaj = m }
        UIAccessibility.post(notification: .announcement, argument: [m.baslik, m.alt].compactMap { $0 }.joined(separator: ". "))
        zamanlayici = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(sure * 1_000_000_000))
            guard !Task.isCancelled else { return }
            withAnimation(.snappy(duration: 0.3)) { self?.mesaj = nil }
        }
    }

    func kapat() {
        zamanlayici?.cancel()
        withAnimation(.snappy(duration: 0.3)) { mesaj = nil }
    }
}

struct BantGorunumu: View {
    @ObservedObject private var bant = Bant.shared

    var body: some View {
        ZStack(alignment: .top) {
            if let m = bant.mesaj {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").font(.body).foregroundStyle(Tema.iyi)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.baslik).font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin)
                        if let alt = m.alt { Text(alt).font(.footnote).foregroundStyle(Tema.metin2).monospacedDigit() }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background { KartZemini(yaricap: 18, cizgi: true, golge: 0.16) }
                .padding(.horizontal, 16).padding(.top, 6)
                .contentShape(Rectangle())
                .onTapGesture { bant.kapat() }
                .accessibilityElement(children: .combine)
                .transition(.move(edge: .top).combined(with: .opacity))
                .id(m.id)
            }
        }
    }
}

// Başarı titreşimi: harcama eklendi, ödeme kaydedildi (Puanlama.olumluAn çağırır)
@MainActor
enum Titresim {
    static func basari() {
        guard Ornek.tur == nil, Ornek.galeri == nil else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

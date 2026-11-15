import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// Banka mesajını telefondaki model de okur (Apple Intelligence, FoundationModels; iOS 26 ve sonrası, destekleyen
// iPhone'larda ve açıksa). Model mesajın harcama bildirimi olup olmadığını, işyerini ve tutarı söyler; kurallar
// (eposta.js) sayıları ayrıca okur ve ikisi karşılaştırılır (eposta.js sms): uyuşmazsa harcama eklenmez, onaya düşer.
// Mesaj telefondan çıkmaz, maliyeti yoktur. Model yoksa, kapalıysa, dili desteklemiyorsa ya da 7 saniyede yanıt
// vermezse nil döner: yalnızca kurallar çalışır.
@MainActor
enum MesajZekasi {
    enum Durum {
        case hazir    // model kullanılabilir
        case kapali   // cihaz destekliyor ama Apple Intelligence kapalı ya da model henüz inmedi
        case yok      // cihaz desteklemiyor (ya da iOS 26'dan eski)
    }

    static var durum: Durum {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return .hazir
            case .unavailable(.deviceNotEligible): return .yok
            case .unavailable: return .kapali
            @unknown default: return .kapali
            }
        }
        #endif
        return .yok
    }

    static func oku(_ metin: String) async -> Mesajlar.Ipucu? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), durum == .hazir {
            let okuma = Task { () -> Mesajlar.Ipucu in
                let oturum = LanguageModelSession(instructions: yonerge)
                let c = try await oturum.respond(to: metin, generating: BankaMesajiOkuma.self,
                                                 options: GenerationOptions(sampling: .greedy)).content
                let isyeri = c.isyeri.trimmingCharacters(in: .whitespacesAndNewlines)
                let tutar = c.tutar.trimmingCharacters(in: .whitespacesAndNewlines)
                return Mesajlar.Ipucu(purchase: c.harcama, merchant: isyeri.isEmpty ? nil : isyeri, amount: tutar.isEmpty ? nil : tutar)
            }
            let sure = Task {
                try? await Task.sleep(nanoseconds: 7_000_000_000)
                okuma.cancel()
            }
            defer { sure.cancel() }
            return try? await okuma.value
        }
        #endif
        return nil
    }

    private static let yonerge = """
    Türkiye'deki bankaların gönderdiği SMS mesajlarını okuyorsun. Mesajın, kartla yapılmış ve tamamlanmış bir harcamanın \
    bildirimi olup olmadığını söyle. Öyleyse işyerinin adını ve harcamanın tutarını mesajda yazdığı gibi çıkar. Mesajda \
    yazmayan bir şeyi yazma.
    """
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
struct BankaMesajiOkuma {
    @Guide(description: "Mesaj kartla yapılmış, tamamlanmış bir harcamayı bildiriyorsa true. Şifre ya da doğrulama kodu, ekstre, borç, karta ödeme, iade, havale ya da kampanya mesajıysa false.")
    var harcama: Bool
    @Guide(description: "Harcamanın yapıldığı işyerinin adı, mesajda yazdığı gibi. Yoksa boş.")
    var isyeri: String
    @Guide(description: "Harcamanın tutarı, mesajda yazdığı gibi (örnek: 1.250,00). Yoksa boş.")
    var tutar: String
}
#endif

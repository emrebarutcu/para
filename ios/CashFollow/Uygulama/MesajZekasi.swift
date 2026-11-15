import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// Banka mesajını telefondaki model de okur (Apple Intelligence, FoundationModels; iOS 26 ve sonrası, destekleyen
// iPhone'larda ve açıksa). Model mesajın harcama bildirimi olup olmadığını, işyerini ve tutarı söyler; kurallar
// (eposta.js) sayıları ayrıca okur ve ikisi karşılaştırılır (eposta.js sms): uyuşmazsa harcama eklenmez, onaya düşer.
// Mesaj telefondan çıkmaz, maliyeti yoktur. Model yoksa, kapalıysa, dili desteklemiyorsa ya da 10 saniyede yanıt
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
                try? await Task.sleep(nanoseconds: UInt64(sureSiniri * 1_000_000_000))
                okuma.cancel()
            }
            defer { sure.cancel() }
            do {
                let i = try await okuma.value
                sonHata = nil
                return i
            } catch {
                sonHata = String(describing: error)
                return nil
            }
        }
        #endif
        return nil
    }

    // Modelin yanıtı için beklenen en uzun süre (saniye): model ilk çağrıda yüklenir, sonrakiler hızlıdır
    private static var sureSiniri: Double = 10
    // Son okumanın hatası ("Bir mesajı dene" ve "-zeka-dene" günlüğü gösterir: model neden yanıt vermedi)
    private(set) static var sonHata: String?

    // "-zeka-dene": modelin örnek banka mesajlarını nasıl okuduğu Documents/zeka-deneme.txt dosyasına yazılır (CI: ios.yml,
    // bilgi için; simülatör Mac'in modelini kullanır). Sonuç sınanmaz: model sürümden sürüme değişir, CI'da olmayabilir.
    // Mesajlar bankaların yazış biçimine benzetilmiş örneklerdir.
    static func denemeIfRequested() {
        guard CommandLine.arguments.contains("-zeka-dene") else { return }
        let ornekler = [
            "1234 ile biten kartinizla 15.11.2026 14:32 tarihinde MIGROS TICARET A.S. isyerinden 450,00 TL tutarinda harcama yapilmistir. Kalan limit: 12.345,67 TL",
            "Bonus Kartinizla (***1234) 15.11.2026 tarihinde A101 den 125,50 TL lik islem gerceklestirilmistir. Kullanilabilir limitiniz 8.000,00 TL.",
            "Maximum Kartınızla 15.11.2026 14:32’de TRENDYOL’dan 1.299,90 TL tutarında 3 taksitli alışveriş yapılmıştır.",
            "X Bank ***1234: 15.11.2026 STARBUCKS 185,00 TL. Bilgi icin 4440000",
            "MIGROS isyerindeki 450,00 TL tutarindaki isleminiz icin sifreniz: 123456. Sifrenizi kimseyle paylasmayin.",
            "1234 ile biten kartinizin 10.11.2026 tarihli ekstresi kesilmistir. Donem borcu 12.345,67 TL, son odeme tarihi 20.11.2026.",
            "Kredi kartiniza 5.000,00 TL odeme yapilmistir.",
            "Hesabiniza 15.11.2026 tarihinde AHMET YILMAZ tarafindan 2.500,00 TL havale gelmistir.",
        ]
        let dosya = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("zeka-deneme.txt")
        try? FileManager.default.removeItem(at: dosya)
        Task {
            var satirlar = ["model: \(durum), dil: \(Locale.current.identifier)"]
            sureSiniri = 40   // deneme: CI makinesi yavaştır, modelin ne dediği görülsün
            for m in ornekler {
                let bas = Date()
                let i = await oku(m)
                let sure = String(format: "%.1f sn", Date().timeIntervalSince(bas))
                let okunan = i.map { "harcama=\($0.purchase) işyeri=\($0.merchant ?? "-") tutar=\($0.amount ?? "-")" }
                    ?? "yanıt yok (\(sonHata?.prefix(160) ?? "-"))"
                satirlar.append("\(okunan) [\(sure)] ← \(m.prefix(70))")
            }
            satirlar.append("ZEKA-DENEME BITTI")
            try? satirlar.joined(separator: "\n").write(to: dosya, atomically: true, encoding: .utf8)
        }
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

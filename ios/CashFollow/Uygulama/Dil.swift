import Foundation

// Uygulamanın dili: telefon Türkçe ise Türkçe, değilse İngilizce. Metinler kodda Türkçe yazılır ve L("…") ile
// gösterilir; İngilizcesi dil/en.json'da (web modülleriyle aynı sözlük, dil.js). Değişken yerleri {0}, {1}…:
//   L("{0} taksit", 6) → "6 installments"
// Sözlükte olmayan metin Türkçe kalır; scripts/dil.mjs (CI) her L("…") için çeviri var mı denetler.
enum Dil {
    static let ingilizce: Bool = !(Locale.preferredLanguages.first ?? "tr").lowercased().hasPrefix("tr")
    static var kod: String { ingilizce ? "en" : "tr" }

    // dil/en.json (uygulama paketinde js/en.json; Web modülleri adımı kopyalar)
    static let sozlukJSON: String = {
        guard ingilizce, let url = Bundle.main.url(forResource: "en", withExtension: "json", subdirectory: "js"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "{}" }
        return text
    }()
    private static let sozluk: [String: String] = {
        (try? JSONSerialization.jsonObject(with: Data(sozlukJSON.utf8))) as? [String: String] ?? [:]
    }()

    static func cevir(_ tr: String, _ args: [Any]) -> String {
        var s = ingilizce ? (sozluk[tr] ?? tr) : tr
        for (i, a) in args.enumerated() { s = s.replacingOccurrences(of: "{\(i)}", with: "\(a)") }
        return s
    }
}

// Görünen metin: Türkçe yazılır, telefonun diline göre gösterilir
func L(_ tr: String, _ args: Any...) -> String { Dil.cevir(tr, args) }

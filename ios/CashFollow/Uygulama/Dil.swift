import Foundation

// Uygulamanın dili: telefonun tercih ettiği dillerden ilk desteklenen (Dil.diller), hiçbiri değilse İngilizce. Metinler
// kodda Türkçe yazılır ve L("…") ile gösterilir; çevirileri dil/<kod>.json'da (web modülleriyle aynı sözlükler, dil.js).
// Değişken yerleri {0}, {1}…:
//   L("{0} taksit", 6) → "6 installments"
// Çeviri sırası: dilin sözlüğü → İngilizce sözlük → Türkçe. scripts/dil.mjs (CI) her L("…") için her sözlükte çeviri
// var mı denetler.
enum Dil {
    static let diller = ["tr", "en", "de", "fr", "es", "it", "nl", "ja", "ko", "pt"]   // dil.js → LANGS ile aynı

    // Seçilen dilin kodu: "de-DE" → "de", "pt-PT" → "pt"
    static let kod: String = {
        for p in Locale.preferredLanguages {
            let c = String(p.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first ?? "")
            if diller.contains(c) { return c }
        }
        return "en"
    }()
    // Türkçe değil: Türkçeye özel yazım (ekler, "%45", kısa para adları) yerine yerel biçim
    static let turkceDegil: Bool = kod != "tr"

    // dil/<kod>.json ve dil/en.json (uygulama paketinde js/; Web modülleri adımı kopyalar)
    private static func oku(_ ad: String) -> String? {
        guard let url = Bundle.main.url(forResource: ad, withExtension: "json", subdirectory: "js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }
    static let sozlukJSON: String = turkceDegil ? (oku(kod) ?? "{}") : "{}"
    static let yedekJSON: String = turkceDegil && kod != "en" ? (oku("en") ?? "{}") : "{}"
    private static func cozumle(_ s: String) -> [String: String] {
        (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: String] ?? [:]
    }
    private static let sozluk = cozumle(sozlukJSON)
    private static let yedek = cozumle(yedekJSON)

    static func cevir(_ tr: String, _ args: [Any]) -> String {
        var s = tr
        if turkceDegil {
            if let t = sozluk[tr], !t.isEmpty { s = t } else if let t = yedek[tr], !t.isEmpty { s = t }
        }
        for (i, a) in args.enumerated() { s = s.replacingOccurrences(of: "{\(i)}", with: "\(a)") }
        return s
    }
}

// Görünen metin: Türkçe yazılır, telefonun diline göre gösterilir
func L(_ tr: String, _ args: Any...) -> String { Dil.cevir(tr, args) }

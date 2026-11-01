import SwiftUI

// Tutar ve tarih biçimleri (web'deki gibi Türkçe)
enum Bicim {
    static let locale = Locale(identifier: "tr_TR")

    // Hesabın ana para birimi (ülkesinden; Model.applyCountry ayarlar). tl() ana para biriminde yazar.
    static var home = "TRY"
    static var homeSymbol = "₺"
    static var homeShort = "TL"

    static func tl(_ v: Double, fraction: Bool = true) -> String {
        v.formatted(.currency(code: home).locale(locale).precision(.fractionLength(fraction ? 2 : 0)))
    }

    // Varlığın kendi biriminde: "100 $", "12,500 gr", fon / hissede adet
    static func amount(_ v: Double, asset: String) -> String {
        if asset == home { return tl(v) }
        if asset == "GAU" { return v.formatted(.number.locale(locale).precision(.fractionLength(0...3))) + " gr" }
        if asset.count == 3, asset.allSatisfy(\.isUppercase) { return v.formatted(.currency(code: asset).locale(locale)) }
        return v.formatted(.number.locale(locale).precision(.fractionLength(0...4))) + " adet"
    }

    static func percent(_ v: Double) -> String {
        (v >= 0 ? "+" : "") + (v / 100).formatted(.percent.locale(locale).precision(.fractionLength(0...2)))
    }

    // Gün anahtarlarıyla aynı saat dilimindeki takvim; grafikler eksen ve ay gruplarını bununla kurar
    static let takvim: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = Yapilandirma.timeZone
        c.locale = locale
        return c
    }()
    static var tarih: Date.FormatStyle { Date.FormatStyle(locale: locale, calendar: takvim, timeZone: Yapilandirma.timeZone) }

    // "YYYY-MM-DD" (Türkiye günü) ↔ Date
    private static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = Yapilandirma.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static func date(_ key: String) -> Date? { dayFormat.date(from: key) }
    static func key(_ date: Date) -> String { dayFormat.string(from: date) }

    // "20 Kasım", başka yılsa "20 Kasım 2027"
    static func day(_ key: String?) -> String {
        guard let key, let d = date(key) else { return "—" }
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = Yapilandirma.timeZone
        f.dateFormat = key.prefix(4) == Bicim.key(Date()).prefix(4) ? "d MMMM" : "d MMMM yyyy"
        return f.string(from: d)
    }

    // "2026-11" → "Kasım 2026"
    static func month(_ ym: String?) -> String {
        guard let ym, let d = date(ym + "-01") else { return "—" }
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = Yapilandirma.timeZone
        f.dateFormat = "LLLL yyyy"
        return f.string(from: d)
    }

    // Bugünden kaç gün sonra: "bugün", "yarın", "5 gün sonra", "3 gün geçti"
    static func relative(_ key: String) -> String {
        guard let d = date(key), let today = date(Bicim.key(Date())) else { return "" }
        let n = Calendar(identifier: .gregorian).dateComponents([.day], from: today, to: d).day ?? 0
        switch n {
        case 0: return "bugün"
        case 1: return "yarın"
        case 2...: return "\(n) gün sonra"
        default: return "\(-n) gün geçti"
        }
    }

    // Ayın günü iyelik ekiyle (web: dayWithSuffix): 1'i, 6'sı, 15'i, 20'si, 30'u
    static func gunEki(_ n: Int) -> String {
        let last = n % 10
        let ek = last > 0 ? ["i", "si", "ü", "ü", "i", "sı", "si", "i", "u"][last - 1] : (n == 20 ? "si" : "u")
        return "\(n)'\(ek)"
    }

    // Kullanıcının yazdığı tutar: "1.234,56", "1234.56", "1234"
    static func parse(_ s: String) -> Double? {
        let t = s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: homeSymbol, with: "").replacingOccurrences(of: "₺", with: "").replacingOccurrences(of: " ", with: "")
        guard !t.isEmpty else { return nil }
        let normalized = t.contains(",") ? t.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".") : t
        return Double(normalized)
    }
}

// Web'in renkleri (styles.css)
enum Renk {
    static let vurgu = hex(0x1baf7a)
    static let gider = hex(0xd43c4b)
    static let gelir = hex(0x13915c)
    static let uyari = hex(0xb7791f)
    // Kişi ve kart renkleri (--s1…--s8; kayıttaki color)
    static let seri = [0x2a78d6, 0xeb6834, 0x1baf7a, 0xeda100, 0xe87ba4, 0x008300, 0x6250d6, 0xe34948].map(hex)

    static func hex(_ v: Int) -> Color {
        Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

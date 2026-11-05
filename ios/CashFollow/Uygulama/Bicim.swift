import SwiftUI

// Tutar ve tarih biçimleri: Türkçede web'deki gibi (tr_TR), diğer dillerde uygulamanın dili ve telefonun bölgesiyle
// (en_US: $1,234.56, Nov 20; de_DE: 1.234,56 $, 20. Nov.; ja_JP: 11月20日)
enum Bicim {
    static let locale: Locale = {
        guard Dil.turkceDegil else { return Locale(identifier: "tr_TR") }
        let bolge = Locale.current.region?.identifier
        return Locale(identifier: bolge.map { "\(Dil.kod)_\($0)" } ?? Dil.kod)
    }()

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
        if asset == "GAU" { return v.formatted(.number.locale(locale).precision(.fractionLength(0...3))) + (Dil.turkceDegil ? " g" : " gr") }
        if asset.count == 3, asset.allSatisfy(\.isUppercase) { return v.formatted(.currency(code: asset).locale(locale)) }
        return L("{0} adet", v.formatted(.number.locale(locale).precision(.fractionLength(0...4))))
    }

    // Kart adı: kartsız ödemeler araçlardan "Nakit" diye gelir (veri değeri; karşılaştırmalar bununla), gösterirken çevrilir
    static func kartAdi(_ s: String) -> String { s == "Nakit" ? L("Nakit") : s }

    // Ülke ve para birimi adı: İngilizcede telefonun dilinde (Apple'ın adları), Türkçede para.js'teki ad
    static func ulkeAdi(_ code: String, _ tr: String) -> String {
        Dil.turkceDegil ? (Locale.current.localizedString(forRegionCode: code) ?? tr) : tr
    }
    static func paraAdi(_ code: String, _ tr: String) -> String {
        if code == "GAU" { return L("Gram altın") }
        return Dil.turkceDegil ? (Locale.current.localizedString(forCurrencyCode: code).map { $0.prefix(1).uppercased() + $0.dropFirst() } ?? tr) : tr
    }

    // Tam sayı yüzde: Türkçede "%45", İngilizcede "45%"
    static func yuzde(_ n: Int) -> String { Dil.turkceDegil ? "\(n)%" : "%\(n)" }
    // Ondalıklı oran (APR): "24.99%", "%24,99"
    static func oran(_ v: Double) -> String {
        let s = v.formatted(.number.locale(locale).grouping(.never).precision(.fractionLength(0...2)))
        return Dil.turkceDegil ? "\(s)%" : "%\(s)"
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
        let sablon = key.prefix(4) == Bicim.key(Date()).prefix(4) ? "dMMMM" : "dMMMMyyyy"
        f.dateFormat = Dil.turkceDegil ? DateFormatter.dateFormat(fromTemplate: sablon, options: 0, locale: locale) : (sablon == "dMMMM" ? "d MMMM" : "d MMMM yyyy")
        return f.string(from: d)
    }

    // "2026-11" → "Kasım 2026"
    static func month(_ ym: String?) -> String {
        guard let ym, let d = date(ym + "-01") else { return "—" }
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = Yapilandirma.timeZone
        f.dateFormat = Dil.turkceDegil ? DateFormatter.dateFormat(fromTemplate: "yMMMM", options: 0, locale: locale) : "LLLL yyyy"
        return f.string(from: d)
    }

    // Bugünden kaç gün sonra: "bugün", "yarın", "5 gün sonra", "3 gün geçti"
    static func relative(_ key: String) -> String {
        guard let d = date(key), let today = date(Bicim.key(Date())) else { return "" }
        let n = Calendar(identifier: .gregorian).dateComponents([.day], from: today, to: d).day ?? 0
        switch n {
        case 0: return L("bugün")
        case 1: return L("yarın")
        case 2...: return L("{0} gün sonra", n)
        default: return L("{0} gün geçti", -n)
        }
    }

    // Ayın günü iyelik ekiyle (web: dayWithSuffix): 1'i, 6'sı, 15'i, 20'si, 30'u; diğer dillerde sayı (ek cümlede:
    // "Am {0}. des Monats", "毎月{0}日")
    static func gunEki(_ n: Int) -> String {
        if Dil.turkceDegil && Dil.kod != "en" { return "\(n)" }
        if Dil.turkceDegil {   // 1st, 2nd, 3rd, 4th, 11th, 21st
            let ek = (11...13).contains(n % 100) ? "th" : ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"][n % 10]
            return "\(n)\(ek)"
        }
        let last = n % 10
        let ek = last > 0 ? ["i", "si", "ü", "ü", "i", "sı", "si", "i", "u"][last - 1] : (n == 20 ? "si" : "u")
        return "\(n)'\(ek)"
    }

    // Kullanıcının yazdığı tutar: "1.234,56", "1234.56", "1234"; ondalık ayırıcısı nokta olan bölgede (ABD) "1,234.56"
    static func parse(_ s: String) -> Double? {
        // Para işaretleri, boşluklar (Fransızcanın binlik boşluğu da) ve İsviçre'nin binlik kesmesi atılır
        let t = String(String.UnicodeScalarView(s.replacingOccurrences(of: homeSymbol, with: "").unicodeScalars.filter {
            !$0.properties.isWhitespace && $0.properties.generalCategory != .currencySymbol && $0 != "'" && $0 != "’"
        }))
        guard !t.isEmpty else { return nil }
        let normalized: String
        if locale.decimalSeparator == "." {
            normalized = t.replacingOccurrences(of: ",", with: "")
        } else {
            normalized = t.contains(",") ? t.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".") : t
        }
        return Double(normalized)
    }
}

// Web'in renkleri (styles.css)
// Eski adlar: web'in renkleri (Tema). Vurgu web'deki gibi siyah / beyaz; renk yalnızca veride.
enum Renk {
    static var vurgu: Color { Tema.metin }
    static var gider: Color { Tema.tehlike }
    static var gelir: Color { Tema.iyi }
    static var uyari: Color { Tema.uyari }
    // Kişi ve kart renkleri (--s1…--s8; kayıttaki color)
    static let seri = (0..<8).map { Tema.seri($0) }

    static func hex(_ v: Int) -> Color {
        Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

import Foundation

// Web'deki config.js ile aynı değerler (anon / publishable anahtar herkese açıktır; veriyi RLS korur)
enum Yapilandirma {
    static let supabaseURL = URL(string: "https://bffqfhgctlgexjdyvaup.supabase.co")!
    static let supabaseKey = "sb_publishable_KoF5Tfi74v8RSWvszPeuxQ_LWwKZGDo"
    // Kurlar (/api/kur), fon ve hisse fiyatları (/api/fiyat); e-postadaki doğrulama bağlantıları da buraya gelir
    static let site = URL(string: "https://cashfollow.app")!
    static let timeZone = TimeZone(identifier: "Europe/Istanbul")!
}

import Foundation

// Web'deki config.js ile aynı değerler (anon / publishable anahtar herkese açıktır; veriyi RLS korur)
enum Yapilandirma {
    static let supabaseURL = URL(string: "https://bffqfhgctlgexjdyvaup.supabase.co")!
    static let supabaseKey = "sb_publishable_KoF5Tfi74v8RSWvszPeuxQ_LWwKZGDo"
    // Kurlar (/api/kur), fon ve hisse fiyatları (/api/fiyat); e-postadaki doğrulama bağlantıları da buraya gelir
    static let site = URL(string: "https://cashfollow.app")!
    static let gizlilik = URL(string: "https://cashfollow.app/privacy.html")!
    static let kosullar = URL(string: "https://cashfollow.app/terms.html")!
    // Günler cihazın saat diliminde (ABD'de akşam "bugün" yarına kaymasın); hesaba da yazılır (Model.refresh)
    static var timeZone: TimeZone { .current }
}

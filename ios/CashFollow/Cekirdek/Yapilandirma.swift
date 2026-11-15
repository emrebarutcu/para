import Foundation

// Web'deki config.js ile aynı değerler (anon / publishable anahtar herkese açıktır; veriyi RLS korur)
enum Yapilandirma {
    static let supabaseURL = URL(string: "https://bffqfhgctlgexjdyvaup.supabase.co")!
    static let supabaseKey = "sb_publishable_KoF5Tfi74v8RSWvszPeuxQ_LWwKZGDo"
    // Kurlar (/api/kur), fon ve hisse fiyatları (/api/fiyat); e-postadaki doğrulama bağlantıları da buraya gelir
    static let site = URL(string: "https://cashfollow.app")!
    static let gizlilik = URL(string: "https://cashfollow.app/privacy.html")!
    static let kosullar = URL(string: "https://cashfollow.app/terms.html")!
    static let destek = URL(string: "https://cashfollow.app/support.html")!
    // Banka e-postalarının geldiği alan adı (config.js INBOX_DOMAIN): "<adres>@cashfollow.app"
    static let inboxDomain = "cashfollow.app"
    // Ürün analitiği ve A/B (PostHog, ABD bölgesi). Proje anahtarı herkese açıktır (phc_…); boşken analitik kapalı
    static let posthogKey = "phc_sEWqvuL259ZcLYGHQXWpnusXvLPMRPF8L4SvAsWHWfPY"
    static let posthogHost = URL(string: "https://us.i.posthog.com")!
    // Banka mesajları için hazır kısayol (Ayarlar → Banka mesajları → "Kısayolu ekle"): içinde yalnızca CashFollow'un
    // "Banka mesajından harcama ekle" eylemi vardır, girişi Kısayol Girdisi'dir. iCloud bağlantısı Kısayollar'dan
    // (Paylaş → iCloud Bağlantısını Kopyala) alınır; uygulama kısayolu kendisi oluşturamaz, bağlantıyı da üretemez.
    // Boşken düğme görünmez ve kurulum eylem seçilerek anlatılır. Ad, kısayola Kısayollar'da verilen addır (otomasyonun
    // son adımında listeden bu adla seçilir). "-kisayol <adres>": ekran görüntüsünde düğmeli hâli göstermek için.
    static let mesajKisayoluAdi = "CashFollow Banka Mesajı"
    static var mesajKisayolu: URL? {
        let a = CommandLine.arguments
        if let i = a.firstIndex(of: "-kisayol"), i + 1 < a.count { return URL(string: a[i + 1]) }
        return nil   // kısayol paylaşılınca: URL(string: "https://www.icloud.com/shortcuts/…")
    }
    // Günler cihazın saat diliminde (ABD'de akşam "bugün" yarına kaymasın); hesaba da yazılır (Model.refresh)
    static var timeZone: TimeZone { .current }
}

import Foundation

// Uygulama ayarları (Supabase app_config: anahtar → değer; supabase/gecis/1.3.0.sql). Sürüm çıkarmadan değiştirilebilen,
// herkese açık değerler: herkes okur (girişsiz de, publishable anahtarla), yalnızca Supabase panelinden yazılır.
// Her açılışta okunur (Model.refresh) ve bu telefonda saklanır: çevrimdışıyken son okunan kullanılır.
//   sms_shortcut_url   Ayarlar → Banka mesajları → "Kısayolu ekle"nin açtığı hazır kısayol (Yapilandirma.mesajKisayolu)
enum UzakAyar {
    private static let anahtar = "uzak.ayarlar"

    static func deger(_ k: String) -> String? {
        (UserDefaults.standard.dictionary(forKey: anahtar) as? [String: String])?[k]
    }

    // app_config'i okur ve saklar; ağ yoksa ya da tablo henüz yoksa son okunan kalır
    static func yenile() async {
        var c = URLComponents(string: Yapilandirma.supabaseURL.absoluteString + "/rest/v1/app_config")!
        c.queryItems = [URLQueryItem(name: "select", value: "key,value")]
        var req = URLRequest(url: c.url!, timeoutInterval: 10)
        req.setValue(Yapilandirma.supabaseKey, forHTTPHeaderField: "apikey")
        guard let cevap = try? await URLSession.shared.data(for: req),
              (cevap.1 as? HTTPURLResponse)?.statusCode == 200,
              let satirlar = try? JSONSerialization.jsonObject(with: cevap.0) as? [[String: Any]] else { return }
        var d: [String: String] = [:]
        for s in satirlar {
            if let k = s["key"] as? String, let v = s["value"] as? String, !v.isEmpty { d[k] = v }
        }
        UserDefaults.standard.set(d, forKey: anahtar)
    }

    // Kısayol bağlantısı yalnızca iCloud'daki bir kısayolsa kullanılır (tabloya yanlış ya da başka bir adres yazılırsa
    // düğme hiç görünmez, uygulama başka bir sayfa açmaz)
    static func kisayolAdresi(_ s: String?) -> URL? {
        guard let s = s?.trimmingCharacters(in: .whitespacesAndNewlines), let u = URL(string: s),
              u.scheme == "https", ["www.icloud.com", "icloud.com"].contains(u.host ?? ""),
              u.path.hasPrefix("/shortcuts/"), u.path.count > "/shortcuts/".count else { return nil }
        return u
    }
}

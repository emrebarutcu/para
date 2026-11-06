import Foundation
import UIKit

// Ürün analitiği ve A/B denemeleri (PostHog, HTTP API; SDK yok). Anahtar Yapilandirma.posthogKey'de; boşsa hiçbir şey
// gönderilmez. Olaylar tutar, ad, açıklama gibi kullanıcının girdiği bilgileri içermez: yalnızca ne yapıldığı ("harcama
// eklendi, 6 taksit, kartla") ve uygulama sürümü, dil, ülke, cihaz. Kimlik rastgele bir cihaz kimliğidir; giriş yapınca
// hesabın kimliğiyle birleştirilir (web'deki olaylarla aynı kişi). PostHog IP adresinden konum çıkarmaz ($geoip_disable).
// Ayarlar → "Kullanım verisi gönder" kapatılabilir. Abonelik yenileme, iptal ve iadeleri sunucu gönderir (mcp/abonelik.js).
//
// A/B: bayrak("deneme_adi") PostHog'daki özellik bayrağının değerini (ör. "control", "test") verir; ilk okumada
// $feature_flag_called olayı gider, deneme sonuçları bununla ölçülür. Bayraklar yüklenmeden okunursa olay gitmez.
// İlk açılışta bayrak henüz gelmemiş olabilir: bayrakBekle en fazla birkaç saniye bekler. Kullanıcının girdiği deneme
// kolu (kolAyarla) sonraki her olaya "$feature/<bayrak>" olarak eklenir (PostHog denemesi bununla çözümlenir).
enum Analitik {
    private static let kuyrukSiniri = 20
    private static var kuyruk: [[String: Any]] = []
    private static var bayraklar: [String: Any] = [:]
    private static var bildirilen: Set<String> = []
    private static var yuklendi = false
    private static var ulke = "TR"

    static var acik: Bool {
        get { !UserDefaults.standard.bool(forKey: "analitik.kapali") }
        set { UserDefaults.standard.set(!newValue, forKey: "analitik.kapali"); if !newValue { kuyruk.removeAll() } }
    }
    private static var etkin: Bool { acik && !Yapilandirma.posthogKey.isEmpty && !CommandLine.arguments.contains("-ornek") }

    // Rastgele cihaz kimliği (kişisel bilgi değil); giriş yapınca hesabın kimliği kullanılır
    private static var kimlik: String {
        if let k = UserDefaults.standard.string(forKey: "analitik.kimlik") { return k }
        let k = UUID().uuidString.lowercased()
        UserDefaults.standard.set(k, forKey: "analitik.kimlik")
        return k
    }
    private static var hesap: String? {
        get { UserDefaults.standard.string(forKey: "analitik.hesap") }
        set { UserDefaults.standard.set(newValue, forKey: "analitik.hesap") }
    }
    private static var kim: String { hesap ?? kimlik }

    private static var surum: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    // Girilen deneme kolları: bayrak → kol (ilk açılış akışı gibi bir kez seçilenler)
    private static var kollar: [String: String] {
        get { UserDefaults.standard.dictionary(forKey: "analitik.kollar") as? [String: String] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: "analitik.kollar") }
    }

    static func kolAyarla(_ bayrak: String, _ kol: String) {
        var k = kollar
        k[bayrak] = kol
        kollar = k
    }

    // Her olayla giden bilgiler
    private static var ortak: [String: Any] {
        var p: [String: Any] = [
            "$app_version": surum,
            "$os": "iOS", "$os_version": UIDevice.current.systemVersion, "$device_type": "Mobile",
            "platform": "ios", "lang": Dil.kod, "country": ulke, "$lib": "cashfollow-ios", "$geoip_disable": true,
        ]
        for (b, k) in kollar { p["$feature/\(b)"] = k }
        return p
    }

    static func ulkeAyarla(_ kod: String) { ulke = kod }

    // Olay: ad İngilizce, küçük harf ve alt çizgiyle (purchase_added); özellikler tutar / ad içermez
    static func olay(_ ad: String, _ ozellik: [String: Any] = [:]) {
        guard etkin else { return }
        var p = ortak
        for (k, v) in ozellik { p[k] = v }
        p["distinct_id"] = kim
        kuyruk.append(["event": ad, "properties": p, "timestamp": ISO8601DateFormatter().string(from: Date())])
        if kuyruk.count >= kuyrukSiniri || ad == "app_opened" { gonder() }
    }

    // Giriş yapınca: cihaz kimliğiyle yapılanlar hesaba bağlanır (web'deki olaylarla birleşir)
    static func girisYapti(_ userId: String) {
        guard hesap != userId else { return }
        let onceki = kim
        hesap = userId
        guard etkin else { return }
        kuyruk.append(["event": "$identify", "properties": ["distinct_id": userId, "$anon_distinct_id": onceki], "timestamp": ISO8601DateFormatter().string(from: Date())])
        gonder()
        Task { await bayraklariYukle() }
    }

    static func cikisYapti() {
        hesap = nil
        Task { await bayraklariYukle() }
    }

    // Kuyruktaki olayları gönder (uygulama arka plana geçince de çağrılır)
    static func gonder() {
        guard etkin, !kuyruk.isEmpty else { return }
        let parti = kuyruk
        kuyruk.removeAll()
        Task.detached {
            var req = URLRequest(url: Yapilandirma.posthogHost.appendingPathComponent("batch/"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["api_key": Yapilandirma.posthogKey, "batch": parti])
            _ = try? await URLSession.shared.data(for: req)   // gönderilemezse kaybolur (analitik, kritik değil)
        }
    }

    // ── A/B: özellik bayrakları ───────────────────────────────────────────────

    static func bayraklariYukle() async {
        guard etkin else { return }
        var req = URLRequest(url: Yapilandirma.posthogHost.appendingPathComponent("flags/").appending(queryItems: [URLQueryItem(name: "v", value: "2")]))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "api_key": Yapilandirma.posthogKey, "distinct_id": kim,
            "person_properties": ["platform": "ios", "lang": Dil.kod, "country": ulke, "app_version": surum],
        ])
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let flags = json["flags"] as? [String: Any] {
            var out: [String: Any] = [:]
            for (k, v) in flags {
                guard let f = v as? [String: Any], f["enabled"] as? Bool == true else { continue }
                out[k] = (f["variant"] as? String) ?? true
            }
            await MainActor.run { bayraklar = out; yuklendi = true }
        } else if let flags = json["featureFlags"] as? [String: Any] {
            await MainActor.run { bayraklar = flags.filter { ($0.value as? Bool) != false }; yuklendi = true }
        }
    }

    static var bayraklarYuklendi: Bool { yuklendi }

    // Bayrak henüz yüklenmediyse en fazla `sure` saniye beklenir (ilk açılış); gelmezse ya da analitik kapalıysa nil
    @MainActor
    static func bayrakBekle(_ ad: String, sure: Double = 1.5) async -> String? {
        guard etkin else { return nil }
        if !yuklendi {
            Task { await bayraklariYukle() }
            let son = Date().addingTimeInterval(sure)
            while !yuklendi, Date() < son { try? await Task.sleep(nanoseconds: 100_000_000) }
        }
        return yuklendi ? bayrak(ad) : nil
    }

    // Bayrağın değeri: deneme kolu ("control", "test"…), açık bayrakta "true", kapalı ya da bilinmiyorsa nil
    static func bayrak(_ ad: String) -> String? {
        let deger = bayraklar[ad].map { ($0 as? String) ?? "true" }
        if etkin, yuklendi, !bildirilen.contains(ad) {
            bildirilen.insert(ad)
            olay("$feature_flag_called", ["$feature_flag": ad, "$feature_flag_response": deger ?? false])
        }
        return deger
    }
}

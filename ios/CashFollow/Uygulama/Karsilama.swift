import Foundation

// İlk açılış akışı (Ekranlar/KarsilamaEkrani.swift): yeni kullanıcı hesap açmadan başlar, kartını ve bir harcamasını
// girer, "bu ay ne ödeyeceğini" ilk dakikada görür; hesap isteğe bağlı ("Hesabım var, giriş yap", Ayarlar).
//
// Kim görür: yalnızca yeni kurulum (karsilama.ilkAcilis > 0). Uygulamayı daha önce kullanmış olan (cihaz kimliği,
// ülke, girişsiz seçimi ya da Anahtar Zinciri'nde oturum var) eski giriş ekranını görür ve denemeye girmez.
// A/B: PostHog bayrağı "onboarding_flow" — "control" giriş ekranı (GirisEkrani), başka her değer yeni akış. Bayrak
// en fazla 1,5 saniye beklenir; gelmezse (çevrimdışı, analitik kapalı) yeni akış ("fallback", çözümlemeden çıkarılır).
// Bayrağı %100 "control" yapmak yeni akışı uzaktan kapatır.
//
// Olaylar (ad İngilizce, tutar / ad içermez; SETUP.md → Analitik → Karşılama hunisi): onboarding_started (deneme
// girişi, iki kolda bir kez), onboarding_step_viewed / _completed / _skipped, onboarding_aha_viewed, onboarding_closed,
// onboarding_completed (iki kolda bir kez), activation_reached (ödeme planı ilk kez göründü; nereden girildiği fark etmez).
@MainActor
enum Karsilama {
    static let surum = 1
    static let bayrakAdi = "onboarding_flow"
    private static let d = UserDefaults.standard

    // Uygulama açılışında bir kez: yeni kurulumda ilk açılışın zamanı, daha önce kullanılmışsa 0
    static func baslat() {
        guard d.object(forKey: "karsilama.ilkAcilis") == nil else { return }
        let eski = ["analitik.kimlik", "puan.songun", "para.ulke", "para.offline"].contains { d.object(forKey: $0) != nil }
            || Auth.stored() != nil
        d.set(eski ? 0 : Date().timeIntervalSince1970, forKey: "karsilama.ilkAcilis")
    }

    static var ilkAcilis: Double { d.double(forKey: "karsilama.ilkAcilis") }
    static var yeniKurulum: Bool { ilkAcilis > 0 }
    // İlk açılıştan bu yana 72 saat geçmedi: Özet'teki "Verilerin yalnızca bu telefonda" notu bu sürede gösterilmez
    static var yeni: Bool { yeniKurulum && Date().timeIntervalSince1970 - ilkAcilis < 72 * 3600 }
    // Denemedeki kol: eylem, control, default (bayrak tanımlı değil), fallback (bayrak gelmedi); denemede değilse nil
    static var varyant: String? { d.string(forKey: "karsilama.varyant") }
    private static var bitti: Bool { d.object(forKey: "karsilama.bitis") != nil }

    // Hangi karşılama: "eylem" yeni akış, "control" giriş ekranı, "returning" daha önce kullanılmış ya da akışı bitirmiş
    // (deneme dışı; örneğin akıştan giriş yapıp sonra çıkış yapan giriş ekranını görür). Bayrak beklemeden belli
    // olanlar hemen (kapı boş kare göstermez); belli değilse nil
    static var hazirKol: String? {
        if CommandLine.arguments.contains("-karsilama") { return "eylem" }   // simülatörde denemek için
        if bitti || !yeniKurulum { return "returning" }
        if let v = varyant { return v == "control" ? "control" : "eylem" }
        return nil
    }

    static func kolSec() async -> String {
        if let k = hazirKol { return k }
        let bayrak = await Analitik.bayrakBekle(bayrakAdi)
        let v = bayrak ?? (Analitik.bayraklarYuklendi ? "default" : "fallback")
        d.set(v, forKey: "karsilama.varyant")
        if let bayrak { Analitik.kolAyarla(bayrakAdi, bayrak) }
        olay("onboarding_started", ["entry": "first_open"])
        return v == "control" ? "control" : "eylem"
    }

    // Akışın olayları: sürüm ve kol her olayda; denemede olmayanınki gönderilmez
    static func olay(_ ad: String, _ ozellik: [String: Any] = [:]) {
        guard let v = varyant else { return }
        var p = ozellik
        p["flow_version"] = surum
        p["variant"] = v
        Analitik.olay(ad, p)
    }

    // Akış bitti (yeni akışta son düğme, giriş ekranında kapanınca): bir kez
    static func bitir(yol: String, _ ozellik: [String: Any] = [:]) {
        guard !bitti, varyant != nil else { return }
        d.set(Date().timeIntervalSince1970, forKey: "karsilama.bitis")
        d.set(surum, forKey: "karsilama.surum")
        var p = ozellik
        p["path"] = yol
        olay("onboarding_completed", p)
    }

    // Etkinleşme: ödeme planı ilk kez görünür oldu (kalan taksit ya da sıradaki ödeme var). Yeni kurulumda bir kez;
    // verinin akıştan, formdan, web'den ya da asistandan gelmesi fark etmez. Akış açıkken Özet denetlemez: akış
    // "Planın hazır" ekranında kendisi denetler (akista: true)
    static func etkinlesmeyiDenetle(_ model: Model, akista: Bool = false) {
        guard yeniKurulum, varyant != nil, !d.bool(forKey: "analitik.etkinlesti"), Ornek.tur == nil,
              akista || !model.showWelcome,
              let o = try? model.read("get_overview") as Ozet,
              o.remainingTotal > 0.004 || !o.upcomingPayments.isEmpty else { return }
        d.set(true, forKey: "analitik.etkinlesti")
        let dakika = Int((Date().timeIntervalSince1970 - ilkAcilis) / 60)
        let kart = (try? model.read("list_cards") as KartListesi)?.cards.isEmpty == false
        olay("activation_reached", ["definition": "plan_visible", "minutes_since_first_open": min(max(dakika, 0), 10080),
                                    "via_flow": akista, "has_card": kart])
    }

    // Varsayılan ülke: kayıtlı, yoksa telefonun bölgesi (listedeyse), yoksa aynı para birimli ilk ülke; hiçbiri değilse
    // boş — kullanıcı seçer (desteklenmeyen bölgede sessizce Türkiye / TL başlamaz)
    nonisolated static func varsayilanUlke(kayitli: String?, bolge: String?, paraBirimi: String?, ulkeler: [Sabitler.Ulke]) -> String {
        if let k = kayitli, ulkeler.contains(where: { $0.code == k }) { return k }
        if let b = bolge?.uppercased(), ulkeler.contains(where: { $0.code == b }) { return b }
        if let p = paraBirimi?.uppercased(), let u = ulkeler.first(where: { $0.currency == p }) { return u.code }
        return ""
    }

    // Son ödeme gününün tahmini: kesimden 10 gün sonra (Türkiye), başka ülkede 21 gün; aynı ekranda değiştirilebilir
    nonisolated static func sonOdemeGunu(kesim: Int, ulke: String) -> Int {
        ((kesim + (ulke == "TR" ? 10 : 21) - 1) % 30) + 1
    }

    // "Ne zaman aldın?": n ay önceki bugün (ay sonu kısa ayda son güne düşer)
    nonisolated static func tarih(ayOnce: Int, bugun: Date = Date()) -> Date {
        Calendar(identifier: .gregorian).date(byAdding: .month, value: -ayOnce, to: bugun) ?? bugun
    }
}

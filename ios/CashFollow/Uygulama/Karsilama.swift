import Foundation
import UserNotifications

// İlk açılış akışı (Ekranlar/KarsilamaEkrani.swift): yeni kullanıcı hesap açmadan başlar, kartını ve bir harcamasını
// girer, "bu ay ne ödeyeceğini" ilk dakikada görür; hesap isteğe bağlı ("Hesabım var, giriş yap", Ayarlar).
//
// Kim görür: yalnızca yeni kurulum (karsilama.ilkAcilis > 0). Uygulamayı daha önce kullanmış olan (cihaz kimliği,
// ülke, girişsiz seçimi ya da Anahtar Zinciri'nde oturum var) eski giriş ekranını görür.
// A/B denemesi yok (Kasım 2026 kararı: kol başına ~2.900 kurulum gerekiyordu): her yeni kurulum yeni akışı görür, bayrak
// beklenmez; etki önce / sonra kohortlarıyla ölçülür (TUTUNDURMA.md → Ölçüm). "onboarding_flow" bayrağı okunmaz.
//
// Olaylar (ad İngilizce, tutar / ad içermez; SETUP.md → Analitik → Karşılama hunisi): onboarding_started (deneme
// girişi, iki kolda bir kez), onboarding_step_viewed / _completed / _skipped, onboarding_aha_viewed, onboarding_closed,
// onboarding_completed (iki kolda bir kez), activation_reached (ödeme planı ilk kez göründü; nereden girildiği fark etmez).
@MainActor
enum Karsilama {
    static let surum = 1
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
    // Akışa giren yeni kurulum: "default" (deneme yokken hep bu; eski sürümlerden control / fallback kalmış olabilir);
    // akışa girmediyse nil
    static var varyant: String? { d.string(forKey: "karsilama.varyant") }
    private static var bitti: Bool { d.object(forKey: "karsilama.bitis") != nil }

    // Hangi karşılama: "eylem" yeni akış, "returning" daha önce kullanılmış ya da akışı bitirmiş (örneğin akıştan giriş
    // yapıp sonra çıkış yapan giriş ekranını görür). Olay yazmadan belli olanlar; ilk açılışta nil (kolSec başlatır)
    static var hazirKol: String? {
        if CommandLine.arguments.contains("-karsilama") { return "eylem" }   // simülatörde denemek için
        if bitti || !yeniKurulum { return "returning" }
        return varyant == nil ? nil : "eylem"
    }

    static func kolSec() async -> String {
        if let k = hazirKol { return k }
        d.set("default", forKey: "karsilama.varyant")
        olay("onboarding_started", ["entry": "first_open"])
        return "eylem"
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
        guard yeniKurulum, varyant != nil, !etkinlesti, Ornek.tur == nil, !model.ornekGezinti,
              akista || !model.showWelcome,
              let o = try? model.read("get_overview") as Ozet,
              o.remainingTotal > 0.004 || !o.upcomingPayments.isEmpty else { return }
        d.set(true, forKey: "analitik.etkinlesti")
        kurtarmayiSil()
        let dakika = Int((Date().timeIntervalSince1970 - ilkAcilis) / 60)
        let kart = (try? model.read("list_cards") as KartListesi)?.cards.isEmpty == false
        olay("activation_reached", ["definition": "plan_visible", "minutes_since_first_open": min(max(dakika, 0), 10080),
                                    "via_flow": akista, "has_card": kart])
    }

    static var etkinlesti: Bool { d.bool(forKey: "analitik.etkinlesti") }

    // ── Etkinleşmeyeni geri çağırma (TUTUNDURMA.md → yol haritası 2) ───────────────────────────────────────────────
    // Ödeme planını görmeden çıkan yeni kurulum: ilk açılıştan 1 ve 3 gün sonra akşam birer yerel bildirim (en fazla iki;
    // zamanları ilk açılışa bağlı, yeniden kurulunca çoğalmaz). İzin sorulmadıysa sessiz (.provisional) izin alınır:
    // iOS bir şey sormaz, bildirim Bildirim Merkezi'ne sessizce düşer; "Hatırlat" sonra asıl izni yine sorar
    // (Bildirimler.izinIste). Plan görünür olunca (etkinlesmeyiDenetle) ikisi de silinir. Açılışta ve arka plana
    // geçerken kurulur (CashFollowApp). Dokununca kartı yoksa kart adımı açılır (BildirimTemsilcisi → kartEkle).
    private static let kurtarmaEki = "kurtarma-"
    static let kurtarmaGunleri = [1, 3]

    static func kurtarmayiKur(_ model: Model) async {
        guard yeniKurulum, varyant != nil, !etkinlesti, Ornek.tur == nil, Ornek.galeri == nil,
              !CommandLine.arguments.contains("-ornek") else { return }
        let c = UNUserNotificationCenter.current()
        var durum = await c.notificationSettings().authorizationStatus
        if durum == .notDetermined {
            _ = try? await c.requestAuthorization(options: [.alert, .sound, .badge, .provisional])
            durum = await c.notificationSettings().authorizationStatus
            if durum == .provisional { olay("onboarding_nudge_permission", ["status": "provisional"]) }
        }
        guard durum == .authorized || durum == .provisional || durum == .ephemeral else { return }
        let simdi = Date()
        for gun in kurtarmaGunleri {
            guard let zaman = kurtarmaZamani(ilkAcilis: ilkAcilis, gun: gun), zaman > simdi else { continue }
            let i = UNMutableNotificationContent()
            if gun == kurtarmaGunleri.first {
                i.title = L("Kartını ekle; ilk ödeme gününü hatırlatayım")
                i.body = L("Kartın ve bir taksitin yeter: bu ay ne ödeyeceğini bir dakikada gör.")
            } else {
                i.title = L("Bu ay kartına ne kadar ödeyeceksin?")
                i.body = L("Kartının adını ve kesim gününü gir; ödeme günlerini CashFollow hesaplasın.")
            }
            i.sound = .default
            i.threadIdentifier = "kurtarma"
            i.userInfo = ["sekme": 0, "tur": "onboarding_nudge", "gun": gun, "kart": true]
            try? await c.add(UNNotificationRequest(identifier: "\(kurtarmaEki)\(gun)", content: i,
                                                   trigger: UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: zaman), repeats: false)))
        }
    }

    static func kurtarmayiSil() {
        let c = UNUserNotificationCenter.current()
        c.removePendingNotificationRequests(withIdentifiers: kurtarmaGunleri.map { "\(kurtarmaEki)\($0)" })
    }

    // İlk açılış gününden n gün sonra, 19.30 (yerel saat)
    nonisolated static func kurtarmaZamani(ilkAcilis: Double, gun: Int, takvim: Calendar = .current) -> Date? {
        guard ilkAcilis > 0 else { return nil }
        let ilk = takvim.startOfDay(for: Date(timeIntervalSince1970: ilkAcilis))
        guard let g = takvim.date(byAdding: .day, value: gun, to: ilk) else { return nil }
        return takvim.date(bySettingHour: 19, minute: 30, second: 0, of: g)
    }

    // Kart adı adımındaki hazır adlar: ülkede en çok kullanılan kartlar / bankalar (marka adları çevrilmez). Listede
    // olmayan ülkede yok; kullanıcı yazar
    nonisolated static func kartOnerileri(ulke: String) -> [String] {
        switch ulke {
        case "TR": return ["Bonus", "World", "Axess", "Maximum", "Paraf", "CardFinans", "Bankkart", "Advantage"]
        case "US": return ["Chase", "Amex", "Capital One", "Citi", "Discover", "Apple Card", "Bank of America", "Wells Fargo"]
        case "GB": return ["Amex", "Barclaycard", "HSBC", "Lloyds", "NatWest", "Santander", "Capital One", "Monzo"]
        case "DE", "AT": return ["Sparkasse", "Amex", "Barclays", "DKB", "ING", "Commerzbank", "Deutsche Bank", "Advanzia"]
        case "FR": return ["BNP Paribas", "Crédit Agricole", "Société Générale", "Boursorama", "LCL", "Caisse d'Epargne", "Amex"]
        case "ES": return ["Santander", "BBVA", "CaixaBank", "Sabadell", "ING", "Bankinter", "Amex"]
        case "IT": return ["Intesa Sanpaolo", "UniCredit", "Nexi", "Fineco", "BPER", "Amex"]
        case "NL": return ["ING", "ABN AMRO", "Rabobank", "ICS", "bunq", "Amex"]
        case "BE": return ["KBC", "BNP Paribas Fortis", "Belfius", "ING", "Argenta", "Amex"]
        case "CA": return ["RBC", "TD", "Scotiabank", "BMO", "CIBC", "Amex"]
        case "AU": return ["CommBank", "Westpac", "ANZ", "NAB", "Amex"]
        case "JP": return ["楽天カード", "三井住友カード", "JCB", "イオンカード", "dカード", "PayPayカード", "Amex"]
        default: return []
        }
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

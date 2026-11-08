import Foundation
import UserNotifications

// Ödeme hatırlatmaları (yerel bildirim; sunucu yok). Kart ekstreleri, nakit taksitler, borç ve kredi taksitleri: ödeme
// gününden seçilen gün kadar önce, seçilen saatte. Bildirimler her açılışta ve veri değişince yeniden kurulur:
//   yakın ödemeler Özet'in hesabından (get_overview: elle ödenen kartın ödenmiş ekstresi düşer), sonrası Akış'tan
//   (get_cashflow, 3 ay); borç / kredi taksitleri get_overview → debts.upcoming.
// Aynı günün ödemeleri tek bildirimde. iOS en fazla 64 bekleyen bildirim tutar; en yakın 40 gün kurulur.
@MainActor
enum Hatirlatma {
    private static let onEk = "odeme-"
    private static let enFazla = 40
    private static let d = UserDefaults.standard

    static var acik: Bool {
        get { d.bool(forKey: "hatirlatma.acik") }
        set { d.set(newValue, forKey: "hatirlatma.acik") }
    }
    // Ödemeden kaç gün önce: 0 (aynı gün), 1, 2, 3, 7
    nonisolated static var gunOnce: Int {
        get { UserDefaults.standard.object(forKey: "hatirlatma.gun") as? Int ?? 1 }
        set { UserDefaults.standard.set(newValue, forKey: "hatirlatma.gun") }
    }
    // Saat: gece yarısından dakika (varsayılan 10.00)
    nonisolated static var dakika: Int {
        get { UserDefaults.standard.object(forKey: "hatirlatma.dakika") as? Int ?? 600 }
        set { UserDefaults.standard.set(newValue, forKey: "hatirlatma.dakika") }
    }
    // Özet'teki "hatırlatayım mı?" kartı cevaplandı ya da kapatıldı
    static var teklifBitti: Bool {
        get { d.bool(forKey: "hatirlatma.teklif") }
        set { d.set(newValue, forKey: "hatirlatma.teklif") }
    }

    static func izinDurumu() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    // İlk açılış akışında "Şimdi değil": Özet'teki teklif 3 gün gösterilmez (sonra bir kez daha sorulur)
    static var ertelendi: Bool { Date().timeIntervalSince1970 - d.double(forKey: "hatirlatma.ertelendi") < 3 * 86_400 }
    static func ertele(kaynak: String) {
        d.set(Date().timeIntervalSince1970, forKey: "hatirlatma.ertelendi")
        Analitik.olay("reminders_offer_dismissed", ["source": kaynak])
    }

    // Açmak için: izin istenir (ilk seferde iOS sorar; reddedildiyse false → Ayarlar'a yönlendirilir).
    // kaynak: onboarding (ilk açılış), overview_offer (Özet'teki teklif), settings
    static func ac(_ model: Model, kaynak: String = "overview_offer") async -> Bool {
        teklifBitti = true
        let izin = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        acik = izin
        Analitik.olay("reminders_enabled", ["granted": izin, "days_before": gunOnce, "source": kaynak])
        await kur(model)
        return izin
    }

    static func kapat() async {
        acik = false
        Analitik.olay("reminders_disabled")
        await temizle()
    }

    private static func temizle() async {
        let c = UNUserNotificationCenter.current()
        let eski = await c.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(onEk) }
        c.removePendingNotificationRequests(withIdentifiers: eski)
    }

    struct Kalem: Hashable { let tarih: String; let ad: String; let tutar: String }

    // Sıradaki ödemeler (bugün ve sonrası; gecikmişler hariç), tarihe göre
    static func odemeler(_ m: Motor?) -> [Kalem] {
        guard let m else { return [] }
        var list: [Kalem] = []
        var kartSonu = ""   // Özet'in kapsadığı son kart ödemesi; sonrası Akış'tan
        if let o = try? m.run("get_overview") as Ozet {
            for p in o.upcomingPayments where p.late != true && p.date >= o.today {
                list.append(Kalem(tarih: p.date, ad: Bicim.kartAdi(p.card), tutar: Bicim.tl(p.total)))
                kartSonu = max(kartSonu, p.date)
            }
            for b in o.debts?.upcoming ?? [] where b.late != true && b.date >= o.today && b.amount > 0 {
                list.append(Kalem(tarih: b.date, ad: b.description, tutar: Bicim.amount(b.amount, asset: b.asset)))
            }
            if let a = try? m.run("get_cashflow", ["months": 3]) as Akis {
                for p in a.months.flatMap(\.payments) where p.notCounted != true && p.date > kartSonu && p.total > 0.004 {
                    list.append(Kalem(tarih: p.date, ad: Bicim.kartAdi(p.card), tutar: Bicim.tl(p.total)))
                }
            }
        }
        return list.sorted { $0.tarih < $1.tarih }
    }

    // Bekleyen hatırlatmaları sıfırdan kurar (kapalıysa ya da izin yoksa yalnızca temizler)
    static func kur(_ model: Model) async {
        await temizle()
        guard acik, Ornek.tur == nil, Ornek.galeri == nil else { return }
        let durum = await izinDurumu()
        guard durum == .authorized || durum == .provisional else { return }
        let c = UNUserNotificationCenter.current()
        let gunler = Dictionary(grouping: odemeler(model.motor), by: \.tarih).sorted { $0.key < $1.key }
        var kurulan = 0
        for (tarih, kalemler) in gunler {
            guard kurulan < enFazla, let (zaman, kalan) = zamani(tarih) else { continue }
            let icerik = UNMutableNotificationContent()
            icerik.title = kalan == 0 ? L("Bugün ödeme günü") : kalan == 1 ? L("Yarın ödeme var") : L("{0} gün sonra ödeme var", kalan)
            var satirlar = kalemler.prefix(3).map { "\($0.ad) · \($0.tutar)" }
            if kalemler.count > 3 { satirlar.append(L("ve {0} ödeme daha", kalemler.count - 3)) }
            icerik.body = satirlar.joined(separator: "\n")
            icerik.sound = .default
            icerik.threadIdentifier = "odeme"
            let tetik = UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: zaman), repeats: false)
            try? await c.add(UNNotificationRequest(identifier: onEk + tarih, content: icerik, trigger: tetik))
            kurulan += 1
        }
    }

    // Bildirim zamanı: ödemeden gunOnce gün önce, seçilen saatte; o an geçtiyse ödeme gününe daha yakın ilk gelecek gün.
    // Ödeme gününe kalan gün de döner (başlık için)
    static func zamani(_ tarih: String, gunOnce: Int = gunOnce, dakika: Int = dakika, simdi: Date = Date()) -> (Date, Int)? {
        guard let gun = Bicim.date(tarih) else { return nil }
        let cal = Calendar.current
        for once in stride(from: gunOnce, through: 0, by: -1) {
            guard let g = cal.date(byAdding: .day, value: -once, to: cal.startOfDay(for: gun)),
                  let z = cal.date(bySettingHour: dakika / 60, minute: dakika % 60, second: 0, of: g) else { continue }
            if z > simdi { return (z, once) }
        }
        return nil
    }
}

import Foundation
import UserNotifications

// Ödeme hatırlatmaları (yerel bildirim; sunucu yok). Kart ekstreleri, nakit taksitler, borç ve kredi taksitleri: ödeme
// gününden seçilen gün kadar önce, seçilen saatte. Bildirimler her açılışta ve veri değişince yeniden kurulur:
//   yakın ödemeler Özet'in hesabından (get_overview: elle ödenen kartın ödenmiş ekstresi düşer), sonrası Akış'tan
//   (get_cashflow, 3 ay); borç / kredi taksitleri get_overview → debts.upcoming.
// Aynı günün ödemeleri tek bildirimde. iOS en fazla 64 bekleyen bildirim tutar; en yakın 40 gün kurulur.
// Aynı anahtarla (hatırlatmalar açıksa) üç bildirim daha, hepsi seçilen saatte ve Ayarlar'dan ayrı ayrı kapatılabilir:
//   kesim günü   hesap kesiminden bir gün önce: bugün alınan hangi gün, kesimden sonra alınan hangi gün ödenir
//   taksit bitişi  son taksidin ödendiği günün ertesi günü: "Koltuk takımı bitti", boşalan aylık tutar
//   ay özeti     ayın ilk günü: geçen ayın özeti hazır (AyOzetiEkrani)
// Bildirime dokununca ilgili sekme açılır (userInfo "sekme"; BildirimTemsilcisi) ve notification_opened yazılır ("tur").
@MainActor
enum Hatirlatma {
    private static let onEk = "odeme-"
    private static let kesimEki = "kesim-", bitisEki = "bitis-", ozetEki = "ayozeti-"
    private static let enFazla = 40
    private static let d = UserDefaults.standard

    // Ek bildirimler (varsayılan açık; hatırlatmalar kapalıysa hiçbiri gönderilmez)
    nonisolated static var kesim: Bool {
        get { UserDefaults.standard.object(forKey: "hatirlatma.kesim") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "hatirlatma.kesim") }
    }
    nonisolated static var bitis: Bool {
        get { UserDefaults.standard.object(forKey: "hatirlatma.bitis") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "hatirlatma.bitis") }
    }
    nonisolated static var ayOzeti: Bool {
        get { UserDefaults.standard.object(forKey: "hatirlatma.ayozeti") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "hatirlatma.ayozeti") }
    }

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
        let ekler = [onEk, kesimEki, bitisEki, ozetEki]
        let eski = await c.pendingNotificationRequests().map(\.identifier).filter { id in ekler.contains { id.hasPrefix($0) } }
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
            icerik.userInfo = ["sekme": 0, "tur": "payment"]   // Özet: sıradaki ödemeler
            try? await c.add(UNNotificationRequest(identifier: onEk + tarih, content: icerik, trigger: tetik(zaman)))
            kurulan += 1
        }
        await ekleriKur(model.motor, c)
    }

    private static func tetik(_ zaman: Date) -> UNCalendarNotificationTrigger {
        UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: zaman), repeats: false)
    }

    // Günün (YYYY-MM-DD) n gün öncesi / sonrası, seçilen saatte; geçmişse nil
    private static func saatinde(_ tarih: String, gun n: Int, simdi: Date = Date()) -> Date? {
        let cal = Calendar.current
        guard let gun = Bicim.date(tarih), let g = cal.date(byAdding: .day, value: n, to: cal.startOfDay(for: gun)),
              let z = cal.date(bySettingHour: dakika / 60, minute: dakika % 60, second: 0, of: g), z > simdi else { return nil }
        return z
    }

    private static func ayAdi(_ ym: String) -> String { AyOzetiEkrani.ayAdi(ym) }

    // Kesim günü, taksit bitişi ve ay özeti bildirimleri (kur'dan; eskileri temizlenmiş, izin var)
    private static func ekleriKur(_ motor: Motor?, _ c: UNUserNotificationCenter) async {
        guard let motor else { return }
        let bugun = Bicim.key(Date())
        if kesim {
            // Her kartın sıradaki kesimi, bir gün önce: "Yarın Bonus kesimi"
            for k in motor.cutoffs().prefix(8) {
                guard let zaman = saatinde(k.cut, gun: -1) else { continue }
                let i = UNMutableNotificationContent()
                i.title = L("Yarın {0} kesimi", k.card)
                i.body = L("Yarına kadarki alışveriş: son ödeme {0}. Sonrası: {1}.", Bicim.day(k.dueBefore), Bicim.day(k.dueAfter))
                i.sound = .default
                i.threadIdentifier = "kesim"
                i.userInfo = ["sekme": 3, "tur": "cutoff"]   // Kartlar
                try? await c.add(UNNotificationRequest(identifier: "\(kesimEki)\(k.card)-\(k.cut)", content: i, trigger: tetik(zaman)))
            }
        }
        if bitis, let son = Calendar.current.date(byAdding: .day, value: 60, to: Date()) {
            // Önümüzdeki iki ayda biten taksitler, son ödemenin ertesi günü
            for b in motor.finishing(from: bugun, to: Bicim.key(son)).prefix(10) {
                guard let zaman = saatinde(b.date, gun: 1) else { continue }
                let i = UNMutableNotificationContent()
                i.title = L("{0} bitti", b.desc)
                i.body = L("{0} ayından itibaren ayda {1} boşta.", ayAdi(b.freeFrom), Bicim.tl(b.monthly, fraction: false))
                i.sound = .default
                i.threadIdentifier = "bitis"
                i.userInfo = ["sekme": 0, "tur": "installment_finished"]   // Özet: kutlama kartı
                try? await c.add(UNNotificationRequest(identifier: bitisEki + b.id, content: i, trigger: tetik(zaman)))
            }
        }
        if ayOzeti {
            // Bu ayın özeti gelecek ayın ilk günü (veri değiştikçe yeniden kurulur; ay içinde ödeme yoksa gönderilmez)
            let ay = String(bugun.prefix(7))
            if let o = motor.monthSummary(ay), o.paid > 0.004, let zaman = saatinde(o.next.month + "-01", gun: 0) {
                let i = UNMutableNotificationContent()
                i.title = L("{0} özetin hazır", ayAdi(o.month))
                i.body = AyOzetiEkrani.tekSatir(o)
                i.sound = .default
                i.threadIdentifier = "ayozeti"
                i.userInfo = ["sekme": 0, "tur": "month_summary", "ozet": true]
                try? await c.add(UNNotificationRequest(identifier: ozetEki + o.month, content: i, trigger: tetik(zaman)))
            }
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

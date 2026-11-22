import BackgroundTasks
import SwiftUI
import UserNotifications

// Banka e-postaları arka planda (yalnızca Türkiye, girişli): uygulama kapalıyken iOS ara sıra uyandırır (en erken 15 dk
// sonra; ne zaman olacağına iOS karar verir, telefonun kullanımına göre). Yeni e-postalar işlenir; eklenen harcamalar ve
// onay bekleyen yeni e-postalar yerel bildirimle söylenir, dokununca Harcamalar açılır (BildirimTemsilcisi).
// Görev kimliği ve arka plan izni: ios/CashFollow-Info.plist.
@MainActor
enum EpostaBildirim {
    static let gorev = "app.cashfollow.ios.eposta"
    private static let d = UserDefaults.standard
    private static let bildirilenler = "eposta.bildirilen"   // bildirimi gönderilmiş ya da uygulamada görülmüş e-postalar

    // Ayarlar → Bildirimler (BildirimAyarlari), bankadan gelenler (e-posta ve SMS), ayrı ayrı; varsayılan açık, bildirim
    // izni yoksa bir şey gönderilmez. eklenince: harcama kendiliğinden eklendi. bekleyince: onay bekleyen bir harcama geldi
    // (1.3.0'dan önce ikisi tek ayardı: "eposta.bildirim"; bekleyince ilk okunuşta onun değerini alır)
    nonisolated static var eklenince: Bool {
        get { UserDefaults.standard.object(forKey: "eposta.bildirim") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "eposta.bildirim") }
    }
    nonisolated static var bekleyince: Bool {
        get { UserDefaults.standard.object(forKey: "eposta.bildirim.bekleyen") as? Bool ?? eklenince }
        set { UserDefaults.standard.set(newValue, forKey: "eposta.bildirim.bekleyen") }
    }
    // Biri açıksa arka planda bakılır
    nonisolated static var acik: Bool { eklenince || bekleyince }

    // Arka plan yenilemesi istenir (uygulama arka plana geçerken ve her çalışmada); koşul yoksa bekleyen istek silinir
    static func planla(_ model: Model) {
        guard acik, model.session != nil, model.bankEmailsAllowed, Ornek.tur == nil, Ornek.galeri == nil else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: gorev)
            return
        }
        let r = BGAppRefreshTaskRequest(identifier: gorev)
        r.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(r)   // simülatörde desteklenmez
    }

    // Arka plan görevi: eşitle, e-postaları işle, bildir
    static func calis(_ model: Model) async {
        planla(model)
        guard acik, let k = await model.epostaArkaPlan() else { return }
        await bildir(eklenen: k.eklenen, bekleyen: model.epostalar)
    }

    // Uygulamada görülen onay bekleyenler için sonradan bildirim gönderilmez
    static func goruldu(_ ids: [Int]) {
        guard !ids.isEmpty else { return }
        var once = d.array(forKey: bildirilenler) as? [Int] ?? []
        once.append(contentsOf: ids.filter { !once.contains($0) })
        d.set(Array(once.suffix(200)), forKey: bildirilenler)
    }

    // mesaj: banka mesajından (SMS; Mesajlar.swift) geldi, başlıklar ona göre
    static func bildir(eklenen: [Harcama], bekleyen: [Eposta], mesaj: Bool = false) async {
        let c = UNUserNotificationCenter.current()
        let izin = await c.notificationSettings().authorizationStatus
        guard izin == .authorized || izin == .provisional else { return }
        let once = Set(d.array(forKey: bildirilenler) as? [Int] ?? [])
        let yeni = bekleyen.filter { !once.contains($0.emailId) }

        if !eklenen.isEmpty, eklenince {
            let i = icerik()
            i.title = mesaj ? L("Banka mesajından eklendi")
                : eklenen.count == 1 ? L("E-postadan eklendi") : L("E-postadan {0} harcama eklendi", eklenen.count)
            var satirlar = eklenen.prefix(3).map(satir)
            if eklenen.count > 3 { satirlar.append(L("ve {0} harcama daha", eklenen.count - 3)) }
            i.body = satirlar.joined(separator: "\n")
            try? await c.add(UNNotificationRequest(identifier: "eposta-eklendi-\(eklenen[0].id)", content: i, trigger: nil))
        }
        // Kapalıyken gelenler de görüldü sayılır: sonradan açılınca eskiler için bildirim gitmez
        if !bekleyince { goruldu(yeni.map(\.emailId)) }
        if bekleyince, let ilk = yeni.first {
            let i = icerik()
            i.title = mesaj ? L("Bir banka mesajı onay bekliyor")
                : yeni.count == 1 ? L("Bir e-posta onay bekliyor") : L("{0} e-posta onay bekliyor", yeni.count)
            i.body = bekleyenSatiri(ilk)
            try? await c.add(UNNotificationRequest(identifier: "eposta-bekliyor-\(ilk.emailId)", content: i, trigger: nil))
            goruldu(yeni.map(\.emailId))
        }
    }

    private static func icerik() -> UNMutableNotificationContent {
        let i = UNMutableNotificationContent()
        i.sound = .default
        i.threadIdentifier = "eposta"
        i.userInfo = ["sekme": 2, "tur": "inbox"]   // Harcamalar
        return i
    }

    // "Migros · ₺450,00 · Bonus · 3 taksit"
    private static func satir(_ h: Harcama) -> String {
        var p = [h.description, Bicim.tl(h.total), Bicim.kartAdi(h.card)]
        if h.installments > 1 { p.append(L("{0} taksit", h.installments)) }
        return p.joined(separator: " · ")
    }

    private static func bekleyenSatiri(_ e: Eposta) -> String {
        if let v = e.verification { return v.gmail ? L("Gmail yönlendirme onayı: Onayla'ya dokun") : L("Bankan adresini doğrulamanı istiyor") }
        let ne = [e.parsed.merchant, e.parsed.amount.map { Bicim.tl($0) }].compactMap { $0 }.joined(separator: " · ")
        if e.needsReview?.hasPrefix("No card with last4") == true, let l = e.parsed.cardLast4 {
            return [L("•••• {0} hangi kartın?", l), ne].filter { !$0.isEmpty }.joined(separator: " ")
        }
        return ne.isEmpty ? (EpostaKarti.neden(e.needsReview, e.parsed) ?? (e.source == "sms" ? L("Banka mesajı") : L("Banka e-postası"))) : ne
    }
}

// Bildirime dokununca ilgili sekme açılır (userInfo "sekme": e-posta → Harcamalar, ödeme ve taksit bitişi → Özet, kesim
// günü → Kartlar), ay özeti bildirimi özeti de gösterir ("ozet"); notification_opened bildirimin türüyle yazılır ("tur").
// Uygulama önündeyken bildirim gösterilmez (willPresent yok: iOS'un varsayılanı).
final class BildirimTemsilcisi: NSObject, UNUserNotificationCenterDelegate {
    static let shared = BildirimTemsilcisi()

    // Tamamlama işleyicili biçim. async biçimi ana iş parçacığında çağrılmıyor ve uygulama bildirime dokununca "Call must
    // be made on main thread" ile çöküyordu (1.3.0); iş ana kuyrukta yapılır, işleyici de orada çağrılır.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let tur = info["tur"] as? String ?? "other", sekme = info["sekme"] as? Int, ozet = info["ozet"] as? Bool == true
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                Analitik.olay("notification_opened", ["kind": tur])
                if let sekme { Yonlendirici.shared.sekme = sekme }
                if info["kart"] as? Bool == true { Yonlendirici.shared.kartEkle = true }   // geri çağıran bildirim
                if ozet { Yonlendirici.shared.ayOzeti = true }
            }
            completionHandler()
        }
    }
}

// Açılacak sekme (bildirimden); AnaEkran dinler. Uygulama bildirimle açıldıysa da değer bekler, ekran gelince okunur.
// ayOzeti: ay özeti bildirimine dokunuldu (Özet'teki AyKapanisiKarti özeti açar).
@MainActor
final class Yonlendirici: ObservableObject {
    static let shared = Yonlendirici()
    @Published var sekme: Int?
    @Published var ayOzeti = false
    @Published var kartEkle = false   // etkinleşmeyeni geri çağıran bildirim (Karsilama.kurtarmayiKur): kart adımı açılır
    @Published var harcama: KisayolHarcamasi?   // "Harcama ekle" kısayolu: form bu taslakla açılır (Kisayollar.swift)
}

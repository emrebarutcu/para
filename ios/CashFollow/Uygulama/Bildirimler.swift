import UIKit
import UserNotifications

// Kullanıcının seçtiği bildirimler (Ayarlar → Bildirimler, BildirimAyarlari). Her tür ayrı açılıp kapanır; değerler
// bu telefonda durur (UserDefaults), bildirimler de burada kurulur. Zamanlanmış olanlar Hatirlatma'da (ödeme günü,
// hesap kesimi, taksit bitişi, ay özeti; hepsi seçilen saatte), bankadan gelenler EpostaBildirim'de (e-posta ve SMS ile
// eklenen ya da onay bekleyen harcama; uygulama kapalıyken). Bir tür ilk kez açılınca iOS izin sorar.
@MainActor
enum Bildirimler {
    enum Tur: String, CaseIterable, Identifiable {
        case odeme, kesim, bitis, ayOzeti, eklenen, bekleyen
        var id: String { rawValue }

        // Kullanım verisindeki adı (notification_setting_changed → kind; notification_opened'daki adlarla aynı)
        var analitik: String {
            switch self {
            case .odeme: return "payment"
            case .kesim: return "cutoff"
            case .bitis: return "installment_finished"
            case .ayOzeti: return "month_summary"
            case .eklenen: return "bank_added"
            case .bekleyen: return "bank_pending"
            }
        }
        // Seçilen saatte zamanlanan türler (saat ayarı bunlar için)
        var zamanli: Bool { self != .eklenen && self != .bekleyen }
    }

    static func acik(_ t: Tur) -> Bool {
        switch t {
        case .odeme: return Hatirlatma.acik
        case .kesim: return Hatirlatma.kesim
        case .bitis: return Hatirlatma.bitis
        case .ayOzeti: return Hatirlatma.ayOzeti
        case .eklenen: return EpostaBildirim.eklenince
        case .bekleyen: return EpostaBildirim.bekleyince
        }
    }

    // Ayarlar'da gösterilen türler: bankadan gelenler yalnızca banka e-postası / mesajı olan ülkelerde
    static func turler(banka: Bool) -> [Tur] { Tur.allCases.filter { banka || $0.zamanli } }

    // Bir türü açar ya da kapatır ve bildirimleri yeniden kurar. Açarken izin henüz sorulmadıysa sorulur; reddedilirse
    // seçim yine kaydedilir (iPhone Ayarları'ndan izin verilince çalışır). Dönen: bildirim izni var mı.
    @discardableResult
    static func ayarla(_ t: Tur, _ yeni: Bool, model: Model) async -> Bool {
        switch t {
        case .odeme: Hatirlatma.acik = yeni
        case .kesim: Hatirlatma.kesim = yeni
        case .bitis: Hatirlatma.bitis = yeni
        case .ayOzeti: Hatirlatma.ayOzeti = yeni
        case .eklenen: EpostaBildirim.eklenince = yeni
        case .bekleyen: EpostaBildirim.bekleyince = yeni
        }
        var izin = true
        if yeni { izin = await izinIste() }
        Analitik.olay("notification_setting_changed", ["kind": t.analitik, "enabled": yeni, "granted": izin])
        if t == .odeme {   // ilk açılış hunisindeki adlarla
            Hatirlatma.teklifBitti = true
            if yeni { Analitik.olay("reminders_enabled", ["granted": izin, "days_before": Hatirlatma.gunOnce, "source": "settings"]) }
            else { Analitik.olay("reminders_disabled") }
        }
        if t.zamanli { await Hatirlatma.kur(model) } else { EpostaBildirim.planla(model) }
        return izin
    }

    static func izinDurumu() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    // İzin sorulmadıysa sorar (iOS bir kez sorar); verilmişse true
    static func izinIste() async -> Bool {
        switch await izinDurumu() {
        case .authorized, .provisional, .ephemeral: return true
        case .notDetermined:
            return (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        default: return false
        }
    }

    // Ayarlar'daki satırın özeti: "4 açık" ya da "Kapalı"
    static func ozet(banka: Bool) -> String {
        let n = turler(banka: banka).filter { acik($0) }.count
        return n == 0 ? L("Kapalı") : L("{0} açık", n)
    }
}

import Foundation
import StoreKit
import UIKit

// App Store puanı: uygulama işe yaradıktan sonra, olumlu bir anda (harcama eklendi, ödeme kaydedildi) iOS'un puan
// penceresi istenir. Koşullar: en az 5 ayrı günde açıldı, en az 3 olumlu an, bu sürümde sorulmadı, son sorudan 120 gün
// geçti. iOS pencereyi yılda en fazla 3 kez gösterir; gösterip göstermemeye kendisi karar verir.
@MainActor
enum Puanlama {
    private static let d = UserDefaults.standard
    private static let gunSiniri = 5, anSiniri = 3, araGun = 120.0

    private static var surum: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    // Uygulama öne gelince: bugünün tarihi ayrı gün sayılır
    static func acildi() {
        let bugun = Bicim.key(Date())
        guard d.string(forKey: "puan.songun") != bugun else { return }
        d.set(bugun, forKey: "puan.songun")
        d.set(d.integer(forKey: "puan.gun") + 1, forKey: "puan.gun")
    }

    // Olumlu an: harcama eklendi, ödeme kaydedildi. Bir başarı titreşimi de verir (titresim: ilk açılış akışında ekran
    // kendi titreşimini verir)
    static func olumluAn(titresim: Bool = true) {
        if titresim { Titresim.basari() }
        d.set(d.integer(forKey: "puan.an") + 1, forKey: "puan.an")
        guard uygun() else { return }
        d.set(surum, forKey: "puan.surum")
        d.set(Date().timeIntervalSince1970, forKey: "puan.tarih")
        // Form kapanınca (pencere formun üstünde açılırsa kaybolur)
        Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard let sahne = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
            Analitik.olay("review_prompted")
            AppStore.requestReview(in: sahne)
        }
    }

    static func uygun(simdi: Date = Date()) -> Bool {
        guard !CommandLine.arguments.contains("-ornek"), Ornek.tur == nil else { return false }
        let son = d.double(forKey: "puan.tarih")
        return d.integer(forKey: "puan.gun") >= gunSiniri
            && d.integer(forKey: "puan.an") >= anSiniri
            && d.string(forKey: "puan.surum") != surum
            && (son == 0 || simdi.timeIntervalSince1970 - son >= araGun * 86_400)
    }
}

import AppIntents
import SwiftUI

// Kısayollar (App Intents): Siri, Spotlight, Kısayollar uygulaması ve eylem düğmesi; banka SMS'i ya da Cüzdan işlemiyle
// tetiklenen otomasyonlar da bunları çağırır (TUTUNDURMA.md → Verilen kararlar).
//   Harcama ekle           → uygulamayı açar, harcama formu verilen tutar / ad / taksitle dolu gelir; kaydı kullanıcı onaylar
//   Bu ay ne ödeyeceğim?   → uygulamayı açmadan söyler: bu ay ödenecek, ödenen ve kalan (get_overview; Özet'in tepesiyle aynı)
//   Banka mesajından harcama ekle → banka SMS'i otomasyonu metni verir, uygulamayı açmadan okunur ve eklenir (aşağıda)
// Başlık ve parametre adları Türkçe yazılır; çevirileri <dil>.lproj/Localizable.strings, Siri cümleleri AppShortcuts.strings
// (uygulamanın kendi sözlüğü burada kullanılamaz: sistem bu metinleri derleme zamanında okur). Söylenen cevap ise
// uygulamanın sözlüğünden çevrilir (dil/<kod>.json).

// "Harcama ekle" kısayolundan gelen taslak: AnaEkran formu bununla açar (Yonlendirici.harcama)
struct KisayolHarcamasi: Identifiable, Equatable {
    let id = UUID()
    var tutar: Double?
    var ad: String?
    var taksit: Int?
}

struct HarcamaEkleKisayolu: AppIntent {
    static var title: LocalizedStringResource = "Harcama ekle"
    static var description = IntentDescription("Harcama formunu açar. Tutar, ne alındığı ve taksit sayısı verilirse form dolu gelir.")
    static var openAppWhenRun = true

    @Parameter(title: "Tutar") var tutar: Double?
    @Parameter(title: "Ne alındı?") var ad: String?
    @Parameter(title: "Taksit sayısı") var taksit: Int?

    @MainActor
    func perform() async throws -> some IntentResult {
        Yonlendirici.shared.harcama = KisayolHarcamasi(tutar: tutar, ad: ad, taksit: taksit)
        Analitik.olay("shortcut_run", ["intent": "add_purchase", "filled": tutar != nil || ad != nil])
        return .result()
    }
}

struct BuAyKisayolu: AppIntent {
    static var title: LocalizedStringResource = "Bu ay ne ödeyeceğim?"
    static var description = IntentDescription("Bu ay ödenecek tutarı, ödeneni ve kalanı söyler.")
    static var openAppWhenRun = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication   // telefon kilitliyken söylenmez

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        let metin = Self.metin()
        Analitik.olay("shortcut_run", ["intent": "due_this_month"])
        return .result(value: metin, dialog: IntentDialog(stringLiteral: metin))
    }

    // Uygulama kilidi (Face ID) açıksa tutar söylenmez. Uygulama arka planda başlatıldıysa ekranın Model'i henüz yoktur:
    // yalnızca okumak için bir tane kurulur.
    @MainActor
    static func metin() -> String {
        if UserDefaults.standard.bool(forKey: "kilit.acik") { return L("Uygulama kilitli: tutarı görmek için CashFollow'u aç.") }
        let model = Model.etkin ?? Model()
        guard let o = try? model.read("get_overview") as Ozet else { return L("Okunamadı") }
        if o.dueThisMonth < 0.004 { return L("Bu ay ödemen yok.") }
        if let p = o.progress, p.paid > 0.004 {
            return L("Bu ay {0} ödenecek: {1} ödendi, kalan {2}.", Bicim.tl(o.dueThisMonth), Bicim.tl(p.paid), Bicim.tl(p.left))
        }
        return L("Bu ay {0} ödenecek.", Bicim.tl(o.dueThisMonth))
    }
}

struct CashFollowKisayollari: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: BuAyKisayolu(),
                    phrases: ["\(.applicationName) bu ay ne ödeyeceğim", "\(.applicationName) ile bu ayın ödemesi"],
                    shortTitle: "Bu ay ne ödeyeceğim?", systemImageName: "calendar")
        AppShortcut(intent: HarcamaEkleKisayolu(),
                    phrases: ["\(.applicationName) ile harcama ekle", "\(.applicationName) harcama ekle"],
                    shortTitle: "Harcama ekle", systemImageName: "plus.circle")
    }
}

// Kısayollar eylemi: "Banka mesajından harcama ekle". Kullanıcı Kısayollar'da bir kez otomasyon kurar (Mesaj → "TL"
// içerirse → Hemen Çalıştır → bu eylem, giriş: Kısayol Girdisi); içinde TL geçen her mesajın metni buraya verilir
// (Mesajlar.swift), harcama olmayanlar elenir. Uygulama öne gelmez. Kurulum adımları: Ayarlar → Banka mesajları
// (MesajAyarlari). iOS bir uygulamanın otomasyonu kendisinin kurmasına izin vermez (tetikleyici paylaşılamaz da): bu
// yüzden kurulum elle; tek sabit sözle ("TL") bütün bankaları yakalar, kullanıcıdan banka adı istenmez.
// Eylemin adı, açıklaması ve parametresi sistemin gösterdiği metinlerdir: çevirileri <dil>.lproj/Localizable.strings'te
// (InfoPlist.strings gibi; uygulamanın kendi sözlüğü dil/<kod>.json buraya ulaşmaz).
struct BankaMesajiEkle: AppIntent {
    static let title: LocalizedStringResource = "Banka mesajından harcama ekle"
    static let description = IntentDescription("Bankanın harcama mesajını okur ve CashFollow'a harcama olarak ekler. Mesaj telefonda okunur.")
    static let openAppWhenRun = false

    // Girdi bir önceki adımın (otomasyonda: gelen mesajın) çıktısına bağlanabilir; Kısayollar bunu kendiliğinden
    // yapmayabilir, o zaman kullanıcı alanı "Kısayol Girdisi"ne elle bağlar (kurulum adımlarında yazılı)
    @Parameter(title: "Mesaj", inputConnectionBehavior: .connectToPreviousIntentResult)
    var mesaj: String

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let sonuc = await Mesajlar.geldi(mesaj)
        return .result(value: sonuc.metin)
    }
}

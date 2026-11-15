import AppIntents

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

    @Parameter(title: "Mesaj")
    var mesaj: String

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let sonuc = await Mesajlar.geldi(mesaj)
        return .result(value: sonuc.metin)
    }
}

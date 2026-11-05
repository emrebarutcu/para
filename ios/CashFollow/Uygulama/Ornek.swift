import Foundation
import SwiftUI

// Örnek veriyle açılış (CI'da ekran görüntüleri: .github/workflows/ekran.yml). "-ornek" ile girişsiz, örnek veriyle açılır;
// "-sekme N" açılış sekmesi (0 Özet … 4 Varlıklar), "-galeri N" yalnızca grafikler (1: Nakit ve kategoriler,
// 2: aylık ödemeler ve Varlığın seyri, 3: harcama formu ve "Alabilir miyim?", 4: kredi formu, 5: döviz formu, 6: Ayarlar,
// 7: CashFollow Premium ödeme ekranı, 8: yapay zekâ asistanı; "-bos" ile verisiz). Örnek veride Premium açıktır, "-ucretsiz" ile ücretsiz sürüm
// (kilitler) görünür. Gerçek kullanımda hiçbiri yoktur.
enum Ornek {
    private static func deger(_ ad: String) -> Int? {
        let a = CommandLine.arguments
        guard let i = a.firstIndex(of: ad), i + 1 < a.count else { return nil }
        return Int(a[i + 1])
    }
    static var sekme: Int { deger("-sekme") ?? 0 }
    static var galeri: Int? { deger("-galeri") }
    // Örnek modunda Premium (App Store'a sorulmaz): açık, "-ucretsiz" ile kapalı; gerçek kullanımda nil
    static let premium: Bool? = CommandLine.arguments.contains("-ucretsiz") ? false : CommandLine.arguments.contains("-ornek") ? true : nil
    // "-tur galeri1,sekme0,…": ekran görüntüsü turu — tek açılışta ekranlar sırayla gösterilir (TurEkrani)
    static var tur: [String]? {
        let a = CommandLine.arguments
        guard let i = a.firstIndex(of: "-tur"), i + 1 < a.count else { return nil }
        return a[i + 1].split(separator: ",").map(String.init)
    }

    // "-ulke US": örnek veri ABD'de (dolar; tutarlar dolar ölçeğinde). Türkiye dışındaki her ülke (AE, SA…) aynı veriyi
    // kendi para biriminde kullanır.
    static var ulke: String {
        let a = CommandLine.arguments
        guard let i = a.firstIndex(of: "-ulke"), i + 1 < a.count else { return "TR" }
        return a[i + 1]
    }

    static func hazirlaIfRequested() {
        guard CommandLine.arguments.contains("-ornek") else { return }
        Auth.store(nil)
        Depo.offlineChosen = true
        Depo.offlineCountry = ulke
        Depo.cashDef = nil
        // "-bos": hiç verisi olmayan yeni kullanıcı (Başlarken kartı)
        let bos: [String: Any] = ["people": [["id": "ben", "name": ulke != "TR" ? "Me" : "Ben", "color": 0]], "cards": [], "installments": [], "entries": [], "debts": []]
        if let data = try? JSONSerialization.data(withJSONObject: CommandLine.arguments.contains("-bos") ? bos : ulke != "TR" ? veriUS() : veri()) {
            Depo.write(Depo.stateFile(nil), String(decoding: data, as: UTF8.self))
        }
    }

    // Bugünden n gün önce / sonra
    // Ayın verilen günündeki, bugünden önceki son tarih (kartın son ekstresinin son ödeme günü) ve ondan n gün önce
    private static func sonEkstre(_ gun: Int) -> Date {
        let cal = Calendar.current
        var c = cal.dateComponents([.year, .month], from: Date())
        c.day = gun
        let bu = cal.date(from: c) ?? Date()
        return bu < cal.startOfDay(for: Date()) ? bu : cal.date(byAdding: .month, value: -1, to: bu) ?? bu
    }
    private static func gunOnce(_ d: Date, _ n: Int) -> String {
        Bicim.key(Calendar.current.date(byAdding: .day, value: -n, to: d) ?? d)
    }

    private static func gun(_ n: Int) -> String {
        Bicim.key(Calendar(identifier: .gregorian).date(byAdding: .day, value: n, to: Date()) ?? Date())
    }

    private static func veri() -> [String: Any] {
        let harcama: (String, String, String?, Double, Int, Int, String) -> [String: Any] = { id, desc, card, total, count, gunOnce, cat in
            var p: [String: Any] = ["id": id, "personId": "ben", "desc": desc, "total": total, "count": count, "date": gun(-gunOnce),
                                    "category": cat, "categoryBy": "user"]
            if let card { p["cardId"] = card }
            return p
        }
        var es = harcama("p9", "Zara", "bonus", 3200, 2, 20, "alisveris")
        es["personId"] = "es"
        var kitap = harcama("p11", "Kitap", "bonus", 1200, 1, 5, "egitim")
        kitap["personId"] = "elif"
        var market = harcama("p12", "Market", "axess", 8325, 3, 15, "market")
        market["personId"] = "baba"
        var kira = harcama("p10", "Kira", nil, 25000, 1, 150, "ev")
        kira["repeat"] = 0
        return [
            "people": [["id": "ben", "name": "Ben", "color": 0], ["id": "es", "name": "Ayşe", "color": 1],
                       ["id": "elif", "name": "Elif", "color": 3], ["id": "baba", "name": "Hilal Baba", "color": 2]],
            "cards": [
                ["id": "bonus", "name": "Bonus", "limit": 60000, "cutoffDay": 10, "dueDay": 20, "color": 0, "trackSince": gun(-150)],
                ["id": "axess", "name": "Kuveyt Türk Sağlam Kart", "limit": 30000, "cutoffDay": 25, "dueDay": 5, "color": 2, "trackSince": gun(-150)],
            ],
            "installments": [
                harcama("p1", "iPhone", "bonus", 54000, 9, 40, "elektronik"),
                harcama("p2", "Migros", "bonus", 2400, 1, 12, "market"),
                harcama("p3", "Migros", "axess", 3100, 1, 40, "market"),
                harcama("p4", "Uçak bileti", "axess", 9600, 3, 25, "seyahat"),
                harcama("p5", "Restoran", "bonus", 1850, 1, 6, "yeme"),
                harcama("p6", "Opet", "axess", 2200, 1, 9, "ulasim"),
                harcama("p7", "Koltuk takımı", "bonus", 42000, 12, 70, "ev"),
                harcama("p8", "Netflix", "bonus", 230, 1, 3, "eglence"),
                es, kira, kitap, market,
            ],
            "entries": [
                ["id": "e1", "personId": "ben", "asset": "TRY", "amount": 85000, "desc": "Maaş", "date": gun(-150), "repeat": 0],
                ["id": "e2", "personId": "ben", "asset": "TRY", "amount": 120000, "desc": "Açılış bakiyesi", "date": gun(-151)],
                ["id": "e3", "personId": "ben", "asset": "USD", "amount": 1000, "desc": "Dolar alımı", "date": gun(-100), "price": 41.2, "settle": true],
                ["id": "e4", "personId": "ben", "asset": "GAU", "amount": 10, "desc": "Altın alımı", "date": gun(-60), "price": 5800, "settle": true],
            ],
            "debts": [
                // Kredide amount geri ödenecek toplamdır (taksit × sayı; add_debt amount_type per_installment bunu hesaplar)
                ["id": "d1", "kind": "loan", "personId": "ben", "party": "Ziraat", "asset": "TRY", "amount": 54000, "principal": 45000,
                 "date": gun(-80), "due": gun(-50), "count": 12],
                ["id": "d2", "kind": "person", "side": "receivable", "personId": "ben", "party": "Can", "asset": "TRY", "amount": 7500,
                 "principal": 7500, "date": gun(-30), "due": gun(15)],
            ],
        ]
    }

    // ABD örneği: dolar, ABD kartları (kesim / son ödeme), taksit planı (Amex Plan It gibi), maaş, kira, araba kredisi
    private static func veriUS() -> [String: Any] {
        let harcama: (String, String, String?, Double, Int, Int, String) -> [String: Any] = { id, desc, card, total, count, gunOnce, cat in
            var p: [String: Any] = ["id": id, "personId": "ben", "desc": desc, "total": total, "count": count, "date": gun(-gunOnce),
                                    "category": cat, "categoryBy": "user"]
            if let card { p["cardId"] = card }
            return p
        }
        var sam = harcama("p9", "Nike", "amex", 180, 1, 9, "alisveris")
        sam["personId"] = "sam"
        var kira = harcama("p10", "Rent", nil, 2400, 1, 150, "ev")
        kira["repeat"] = 0
        var spotify = harcama("p11", "Spotify", "chase", 11.99, 1, 120, "eglence")
        spotify["repeat"] = 0
        // Pay in 4 (Klarna, banka kartından) ve döner kredi: Chase elle ödeniyor (APR %24,99); son ekstresinin (son
        // ödeme günü 28) asgarisinden fazlası ödendi, kalanı faiziyle sonraki ekstreye devretti
        var dyson = harcama("p12", "Dyson Airwrap", nil, 499.99, 4, 10, "alisveris")
        dyson["bnpl"] = "klarna"
        let son = sonEkstre(28)
        var macbook = harcama("p13", "MacBook Air", "chase", 1299, 1, 0, "elektronik")
        macbook["date"] = gunOnce(son, 45)
        return [
            "people": [["id": "ben", "name": "Me", "color": 0], ["id": "sam", "name": "Sam", "color": 1]],
            "cards": [
                ["id": "chase", "name": "Chase Sapphire", "limit": 12000, "cutoffDay": 3, "dueDay": 28, "color": 0, "trackSince": gun(-150),
                 "manualSince": gunOnce(son, 20), "apr": 24.99],
                ["id": "amex", "name": "Amex Gold", "limit": 8000, "cutoffDay": 18, "dueDay": 12, "color": 2, "trackSince": gun(-150)],
            ],
            "installments": [
                harcama("p1", "iPhone 17 Pro", "amex", 1199, 12, 40, "elektronik"),
                harcama("p2", "Whole Foods", "chase", 142.35, 1, 4, "market"),
                harcama("p3", "Trader Joe's", "chase", 88.20, 1, 11, "market"),
                harcama("p4", "Delta flight", "chase", 486, 1, 25, "seyahat"),
                harcama("p5", "Chipotle", "amex", 24.80, 1, 2, "yeme"),
                harcama("p6", "Shell", "chase", 52.10, 1, 6, "ulasim"),
                harcama("p7", "IKEA sofa", "amex", 1350, 6, 70, "ev"),
                harcama("p8", "Netflix", "chase", 15.49, 1, 3, "eglence"),
                sam, kira, spotify, dyson, macbook,
            ],
            "entries": [
                ["id": "e1", "personId": "ben", "asset": "USD", "amount": 6200, "desc": "Paycheck", "date": gun(-150), "repeat": 0],
                ["id": "e2", "personId": "ben", "asset": "USD", "amount": 9500, "desc": "Opening balance", "date": gun(-151)],
            ],
            "debts": [
                // 48 × 465 $ (amount toplamdır)
                ["id": "d1", "kind": "loan", "personId": "ben", "party": "Ally Auto", "asset": "USD", "amount": 22320, "principal": 18000,
                 "date": gun(-120), "due": gun(-90), "count": 48],
                ["id": "d2", "kind": "person", "side": "receivable", "personId": "ben", "party": "Alex", "asset": "USD", "amount": 250,
                 "principal": 250, "date": gun(-12), "due": gun(10)],
                ["id": "d3", "kind": "payment", "personId": "ben", "cardId": "chase", "amount": 500, "date": gunOnce(son, 1)],
            ],
        ]
    }
}

// Grafiklerin bir arada görünümü (-galeri)
struct GrafikGalerisi: View {
    let sayfa: Int
    private var ulke: String { Ornek.ulke }

    var body: some View {
        if sayfa == 3 {
            HarcamaFormu(ornek: ulke != "TR" ? ("1800", "Refrigerator", 6) : ("36000", "Buzdolabı", 6))
        } else if sayfa == 4 {
            BorcFormu(baslangic: "loan")
        } else if sayfa == 5 {
            HareketFormu(tur: .doviz)
        } else if sayfa == 6 {
            AyarlarEkrani()
        } else if sayfa == 7 {
            PremiumEkrani(neden: "gallery")
        } else if sayfa == 8 {
            AsistanEkrani()
        } else {
            galeri
        }
    }

    private var galeri: some View {
        NavigationStack {
            Sayfa {
                if sayfa == 1 {
                    NakitKarti()
                    Okunan(tool: "spending_by_category", args: ["months": 3]) { (k: KategoriHarcamasi) in
                        KategoriKarti(months: k.months)
                    }
                } else {
                    Okunan(tool: "get_cashflow", args: ["months": 12, "include_items": false]) { (a: Akis) in AylikOdemeGrafigi(months: a.months) }
                    VarlikSeyriKarti()
                }
            }
            .navigationTitle(L("Grafikler"))
        }
    }
}

// Ekran görüntüsü turu (ekran.yml): her adımda ekranı gösterir, çizilince Documents/tur-hazir dosyasına adını yazar;
// iş akışı görüntüyü alıp dosyayı silince sonraki adıma geçer. Uygulama bir kez açılır, sabit bekleme yoktur.
struct TurEkrani: View {
    let adimlar: [String]
    @State private var i = 0
    @State private var sekme = 0

    private static let isaret: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("tur-hazir")
    }()

    var body: some View {
        let ad = adimlar[min(i, adimlar.count - 1)]
        Group {
            if ad.hasPrefix("galeri"), let n = Int(ad.dropFirst(6)) {
                GrafikGalerisi(sayfa: n)
            } else {
                Sekmeler(sekme: $sekme)
            }
        }
        .id(ad.hasPrefix("galeri") ? ad : "sekmeler")
        .task(id: i) { await adim(ad) }
    }

    private func adim(_ ad: String) async {
        if ad.hasPrefix("sekme"), let n = Int(ad.dropFirst(5)) { sekme = n }
        // Çizilsin, veriler (araçlar, grafikler) yüklensin; ilk adımda soğuk başlangıç için biraz daha
        try? await Task.sleep(for: .milliseconds(i == 0 ? 2500 : 1200))
        try? ad.write(to: Self.isaret, atomically: true, encoding: .utf8)
        while FileManager.default.fileExists(atPath: Self.isaret.path) {
            try? await Task.sleep(for: .milliseconds(100))
        }
        if i + 1 < adimlar.count { i += 1 }
    }
}

import Foundation
import SwiftUI
import UIKit

// Örnek veriyle açılış (CI'da ekran görüntüleri: .github/workflows/ekran.yml). "-ornek" ile girişsiz, örnek veriyle açılır;
// "-sekme N" açılış sekmesi (0 Özet … 4 Varlıklar), "-galeri N" yalnızca grafikler (1: Nakit ve kategoriler,
// 2: aylık ödemeler ve Varlığın seyri, 3: harcama formu ve "Alabilir miyim?", 4: kredi formu, 5: döviz formu, 6: Ayarlar,
// 7: CashFollow Premium ödeme ekranı, 8: yapay zekâ asistanı, 9: Özet'te yeri gelince görünen kartlar — biten taksit,
// ay kapanışı; "-bos" ile verisiz). Örnek veride Premium açıktır, "-ucretsiz" ile ücretsiz sürüm
// (kilitler) görünür. Turda "tanitimN" (0…5) ilk açılış akışının N. ekranı (KarsilamaEkrani, cevaplar dolu; "-bos" ile);
// "tanitimNbos" o adımın cevabı boş (kart adı yazılmamış, kesim günü seçilmemiş).
// Gerçek kullanımda hiçbiri yoktur. Gerçek ilk açılış akışını simülatörde denemek: yeni kurulumda "-karsilama".
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

    // "-vitrin": mağaza görüntüleri — turun her adımı üstte tek cümlelik bir başlık, altında o ekranın görüntüsü bir
    // telefonun içinde (Vitrin). İki geçişte çekilir (ekran.yml "vitrin"): önce ekranların kendisi (bayraksız tur), iş
    // akışı görüntüleri Documents/vitrin/<adım>.png olarak uygulamaya koyar, sonra -vitrin turu başlıklı hâlini çizer.
    // Ekran canlı küçültülmez: küçültülen gezinme çubuğu sistemin kenar boşluklarını kaybediyor (büyük başlık kenara
    // yapışıyor); görüntüsü uygulamanın birebir kendisidir. Başlığı olmayan adım olduğu gibi çekilir. Başlıktaki "|"
    // satırın bölüneceği yerdir: her dilin çevirisi kendi yerini verir (son satırda tek sözcük kalmasın; Japoncada sözcük
    // arası boşluk yok). Bir satır 22 harfi geçmezse yazı küçülmez.
    static let vitrin = CommandLine.arguments.contains("-vitrin")
    static func vitrinBasligi(_ adim: String) -> String? {
        let b: String
        switch adim {
        case "sekme0": b = L("Bu ay ne|ödeyeceğini bil")
        case "galeri3": b = L("Almadan önce sor:|alabilir miyim?")
        case "sekme1": b = L("Önümüzdeki 12 ay|tek bakışta")
        case "sekme3": b = L("Kartlar, limitler,|borçlar tek yerde")
        case "sekme2": b = L("Her taksit|ne zaman bitiyor")
        case "sekme4": b = L("Neyin var,|nasıl değişiyor")
        default: return nil
        }
        return b.replacingOccurrences(of: "|", with: "\n")
    }
    static func vitrinGoruntusu(_ adim: String) -> UIImage? {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return UIImage(contentsOfFile: docs.appendingPathComponent("vitrin/\(adim).png").path)
    }

    // "-ulke US": örnek veri o ülkede (Türkiye dışında İngilizce adlar, tutarlar dolar ölçeğinde: veriUS)
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
        // "-mesaj": telefona gelmiş banka mesajları (SMS; Mesajlar.swift) kuyrukta: biri kartı sorulacak, biri emin
        // olunamayan. Harcamalar'da "Bankadan gelenler" kartı bunlarla görünür (bankaların yazışına benzetilmiş örnekler).
        Mesajlar.ornek(CommandLine.arguments.contains("-mesaj") ? [
            "5678 ile biten kartinizla \(tarih(-1)) tarihinde MIGROS dan 1.250,00 TL tutarinda harcama yapilmistir.",
            "X Bank ***5678: \(tarih(-2)) STARBUCKS 185,00 TL. Bilgi icin 4440000",
        ] : [])
    }

    // "17.10.2026": bugünden n gün sonrası (örnek banka mesajlarının tarihi)
    private static func tarih(_ n: Int) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "dd.MM.yyyy"
        return f.string(from: Calendar.current.date(byAdding: .day, value: n, to: Date()) ?? Date())
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

    // ABD örneği: dolar, ABD kartları (kesim / son ödeme), taksit planı (Amex Plan It gibi), maaş, kira, araba kredisi.
    // Başka ülkede (mağazanın yerel görüntüleri: -ulke DE -AppleLanguages (de)…) aynı veri o ülkenin para biriminde;
    // yalnızca ABD'ye özgü adlar yerine genel adlar (uygulamanın dilinde) ve dünya markaları; yende tutarlar 150, riyalde 4 katı.
    private static var yerel: Bool { ulke != "US" }
    static var olcek: Double { ulke == "JP" ? 150 : ulke == "SA" ? 4 : 1 }
    private static func tutar(_ x: Double) -> Double { olcek == 1 ? x : (x * olcek).rounded() }
    private static func veriUS() -> [String: Any] {
        // Ülkenin para birimi (gelir ve borçlar onunla yazılır; harcamalar zaten ana para biriminde)
        let para = Locale(identifier: "en_\(ulke)").currency?.identifier ?? "USD"
        let harcama: (String, String, String?, Double, Int, Int, String) -> [String: Any] = { id, desc, card, total, count, gunOnce, cat in
            var p: [String: Any] = ["id": id, "personId": "ben", "desc": desc, "total": tutar(total), "count": count, "date": gun(-gunOnce),
                                    "category": cat, "categoryBy": "user"]
            if let card { p["cardId"] = card }
            return p
        }
        var sam = harcama("p9", "Nike", "amex", 180, 1, 9, "alisveris")
        sam["personId"] = "sam"
        var kira = harcama("p10", yerel ? L("Kira") : "Rent", nil, 2400, 1, 150, "ev")
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
            "people": [["id": "ben", "name": L("Ben"), "color": 0], ["id": "sam", "name": "Sam", "color": 1]],
            "cards": [
                ["id": "chase", "name": yerel ? "Visa Platinum" : "Chase Sapphire", "limit": tutar(12000), "cutoffDay": 3, "dueDay": 28, "color": 0, "trackSince": gun(-150),
                 "manualSince": gunOnce(son, 20), "apr": 24.99],
                ["id": "amex", "name": "Amex Gold", "limit": tutar(8000), "cutoffDay": 18, "dueDay": 12, "color": 2, "trackSince": gun(-150)],
            ],
            "installments": [
                harcama("p1", "iPhone 17 Pro", "amex", 1199, 12, 40, "elektronik"),
                harcama("p2", yerel ? L("Market") : "Whole Foods", "chase", 142.35, 1, 4, "market"),
                harcama("p3", yerel ? "Amazon" : "Trader Joe's", "chase", 88.20, 1, 11, "market"),
                harcama("p4", yerel ? L("Uçak bileti") : "Delta flight", "chase", 486, 1, 25, "seyahat"),
                harcama("p5", yerel ? "Starbucks" : "Chipotle", "amex", 24.80, 1, 2, "yeme"),
                harcama("p6", "Shell", "chase", 52.10, 1, 6, "ulasim"),
                harcama("p7", yerel ? "IKEA" : "IKEA sofa", "amex", 1350, 6, 70, "ev"),
                harcama("p8", "Netflix", "chase", 15.49, 1, 3, "eglence"),
                sam, kira, spotify, dyson, macbook,
            ],
            "entries": [
                ["id": "e1", "personId": "ben", "asset": para, "amount": tutar(6200), "desc": yerel ? L("Maaş") : "Paycheck", "date": gun(-150), "repeat": 0],
                ["id": "e2", "personId": "ben", "asset": para, "amount": tutar(9500), "desc": yerel ? L("Açılış bakiyesi") : "Opening balance", "date": gun(-151)],
            ],
            "debts": [
                // 48 × 465 $ (amount toplamdır)
                ["id": "d1", "kind": "loan", "personId": "ben", "party": yerel ? L("Taşıt kredisi") : "Ally Auto", "asset": para, "amount": tutar(22320), "principal": tutar(18000),
                 "date": gun(-120), "due": gun(-90), "count": 48],
                ["id": "d2", "kind": "person", "side": "receivable", "personId": "ben", "party": "Alex", "asset": para, "amount": tutar(250),
                 "principal": tutar(250), "date": gun(-12), "due": gun(10)],
                ["id": "d3", "kind": "payment", "personId": "ben", "cardId": "chase", "amount": tutar(500), "date": gunOnce(son, 1)],
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
            HarcamaFormu(ornek: ulke == "TR" ? ("36000", "Buzdolabı", 6) : ulke == "US" ? ("1800", "Refrigerator", 6)
                         : (String(Int(1800 * Ornek.olcek)), L("Buzdolabı"), 6))
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
        } else if sayfa == 9 {
            yeriGelince
        } else if sayfa == 10 {
            NavigationStack { MesajAyarlari() }
        } else if sayfa == 11 {
            NavigationStack { BildirimAyarlari() }
        } else {
            galeri
        }
    }

    // Özet'te yeri gelince görünen kartlar, örnek değerlerle (gerçek veride tarihe bağlıdır): biten taksidin kutlaması,
    // "geçen ayın özeti hazır" ve ay kapanışının kartı
    private var yeriGelince: some View {
        let tr = ulke == "TR"
        let biten = BitenTaksit(id: "p7", desc: tr ? "Koltuk takımı" : "Sofa", date: "2026-10-20", monthly: tr ? 3500 : 180, count: 12, freeFrom: "2026-11")
        let market = AyOzeti.Kategori(id: "market", name: tr ? "Market" : "Groceries", value: tr ? 9200 : 460, average: tr ? 7400 : 380)
        let ozet = AyOzeti(month: "2026-10", paid: tr ? 49955 : 2480, previous: tr ? 52300 : 2610,
                           next: AyOzeti.Sonraki(month: "2026-11", total: tr ? 42075 : 2190), finished: [biten], freed: biten.monthly,
                           spent: tr ? 38200 : 1930, added: 14, top: market, rising: market)
        return NavigationStack {
            Sayfa {
                BitenTaksitKarti(bitenler: [biten], kapat: {})
                AyKapanisiKarti(ozet: ozet, ac: {}, kapat: {})
                AyOzetiKarti(ozet: ozet)
            }
            .navigationTitle(L("Özet"))
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
        let ekran = Group {
            if ad.hasPrefix("galeri"), let n = Int(ad.dropFirst(6)) {
                GrafikGalerisi(sayfa: n)
            } else if ad.hasPrefix("tanitim"), let n = Int(ad.dropFirst(7).prefix(while: \.isNumber)) {
                KarsilamaEkrani(baslangic: n, ornek: true, ornekBos: ad.hasSuffix("bos"))
            } else {
                Sekmeler(sekme: $sekme)
            }
        }
        .id(ad.hasPrefix("sekme") ? "sekmeler" : ad)
        Group {
            // Mağaza görüntüsü: başlığı olan adım başlığıyla ve ekranın önceden çekilmiş görüntüsüyle (Vitrin)
            if Ornek.vitrin, let baslik = Ornek.vitrinBasligi(ad) {
                Vitrin(baslik: baslik, goruntu: Ornek.vitrinGoruntusu(ad))
            } else {
                ekran
            }
        }
        .task(id: i) { await adim(ad) }
    }

    private func adim(_ ad: String) async {
        if ad.hasPrefix("sekme"), let n = Int(ad.dropFirst(5)) { sekme = n }
        // Çizilsin, veriler (araçlar, grafikler) yüklensin; ilk adımda soğuk başlangıç için biraz daha. Varlıklar'ın
        // seyri kur geçmişini ağdan okur: 1,2 saniyede her zaman yetişmiyor (grafik yerine yükleniyor işareti çekilmişti)
        let vitrinde = Ornek.vitrin && Ornek.vitrinBasligi(ad) != nil   // yalnızca hazır bir görüntü çizilir
        try? await Task.sleep(for: .milliseconds(vitrinde ? (i == 0 ? 1500 : 1000) : ad == "sekme4" ? 4500 : i == 0 ? 2500 : 1200))
        try? ad.write(to: Self.isaret, atomically: true, encoding: .utf8)
        while FileManager.default.fileExists(atPath: Self.isaret.path) {
            try? await Task.sleep(for: .milliseconds(100))
        }
        if i + 1 < adimlar.count { i += 1 }
    }
}

// Mağaza görüntüsü (-vitrin): koyu zeminde üstte tek cümlelik başlık, altında ekranın görüntüsü bir telefonun içinde
// (kenarlı, köşeleri yuvarlak). Başlığı uygulama çizdiği için her dilde ve yazıda (Arapça, Japonca) doğru dizilir; ayrı
// bir görüntü düzenleme aracı gerekmez. Durum çubuğu ve ana ekran çizgisi gizlenir (telefonun içindeki görüntüde var).
struct Vitrin: View {
    let baslik: String
    let goruntu: UIImage?
    private static var olcek: CGFloat { 0.74 }
    private static var kenar: CGFloat { 11 }        // telefonun kenarı (küçültülmeden önce)
    private static var altBosluk: CGFloat { 28 }
    private static var yaricap: CGFloat { 60 }

    var body: some View {
        GeometryReader { dis in
            let w = dis.size.width, h = dis.size.height + dis.safeAreaInsets.top + dis.safeAreaInsets.bottom
            let s = Self.olcek, k = Self.kenar * s, r = Self.yaricap * s
            // Telefonun üst kenarı: başlık bunun üstündeki boşlukta, Dynamic Island'ın altında durur
            let telefonUstu = h - Self.altBosluk - h * s - 2 * k
            ZStack(alignment: .top) {
                Color.black   // tepesi düz siyah: simülatörün çizdiği Dynamic Island görünmez
                RadialGradient(colors: [Tema.marka.opacity(0.55), Tema.marka.opacity(0)], center: UnitPoint(x: 0.5, y: 0.62),
                               startRadius: 0, endRadius: h * 0.52)
                Text(baslik)
                    .font(.system(size: 36, weight: .bold)).foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    // Satırları başlık verir ("|"): sığmayan satır alta kaymaz, yazı küçülür
                    .lineLimit(baslik.split(separator: "\n").count).minimumScaleFactor(0.7)
                    .frame(width: w - 48, height: max(telefonUstu - 66, 40))
                    .padding(.top, 58)
                Group {
                    if let goruntu { Image(uiImage: goruntu).resizable().interpolation(.high) } else { Tema.zemin }
                }
                .frame(width: w * s, height: h * s)
                .clipShape(RoundedRectangle(cornerRadius: r, style: .continuous))
                .padding(k)
                .background(Color(white: 0.09), in: RoundedRectangle(cornerRadius: r + k, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: r + k, style: .continuous).strokeBorder(Color.white.opacity(0.28), lineWidth: 1.5) }
                .padding(.top, telefonUstu)
            }
            .frame(width: w, height: h)
            .ignoresSafeArea()
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
    }
}

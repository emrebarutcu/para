import Foundation
import SwiftUI
import UIKit

// Örnek veriyle açılış (CI'da ekran görüntüleri: .github/workflows/ekran.yml). "-ornek" ile girişsiz, örnek veriyle açılır;
// "-sekme N" açılış sekmesi (0 Özet … 4 Varlıklar), "-galeri N" yalnızca grafikler (1: Nakit ve kategoriler,
// 2: aylık ödemeler ve Varlığın seyri, 3: harcama formu ve "Alabilir miyim?", 4: kredi formu, 5: döviz formu, 6: Ayarlar,
// 7: CashFollow Premium ödeme ekranı, 8: yapay zekâ asistanı, 9: Özet'te yeri gelince görünen kartlar — biten taksit,
// ay kapanışı; "-bos" ile verisiz). Örnek veride Premium açıktır, "-ucretsiz" ile ücretsiz sürüm
// (kilitler) görünür. Turda "tanitimN" (0…4) ilk açılış akışının N. ekranı (KarsilamaEkrani, cevaplar dolu; "-bos" ile);
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

    // "-vitrin": mağaza görüntüleri — turun her adımında üstte tek cümlelik bir başlık, altında ekran bir telefonun
    // içinde (Vitrin; ekran.yml "vitrin" turları, magaza/ayarlar.json → ekranlar). Başlığı olmayan adım olduğu gibi
    // çekilir. Başlıktaki "|" satırın bölüneceği yerdir: her dilin çevirisi kendi yerini verir (son satırda tek sözcük
    // kalmasın; Japoncada sözcük arası boşluk yok). Bir satır 22 harfi geçmezse yazı küçülmez.
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
            // Mağaza görüntüsü: başlığı olan adım başlığıyla ve küçültülmüş ekranla (Vitrin)
            if Ornek.vitrin, let baslik = Ornek.vitrinBasligi(ad) { Vitrin(baslik: baslik) { ekran } } else { ekran }
        }
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

// Mağaza görüntüsü (-vitrin): koyu zeminde üstte tek cümlelik başlık, altında ekran bir telefonun içinde küçültülmüş
// (kenarlı, köşeleri yuvarlak; saat ve pil çizimdir). Uygulamanın kendi çizimi olduğu için her dilde ve yazıda (Arapça,
// Japonca) doğru dizilir; ayrı bir görüntü düzenleme adımı gerekmez. Gerçek durum çubuğu ve ana ekran çizgisi gizlenir.
struct Vitrin<Icerik: View>: View {
    @EnvironmentObject private var model: Model
    @EnvironmentObject private var kilit: Kilit
    let baslik: String
    @ViewBuilder let icerik: () -> Icerik
    private static var olcek: CGFloat { 0.74 }
    private static var kenar: CGFloat { 11 }        // telefonun kenarı (küçültülmeden önce)
    private static var altBosluk: CGFloat { 28 }
    private static var yaricap: CGFloat { 60 }

    var body: some View {
        GeometryReader { dis in
            let ust = max(dis.safeAreaInsets.top, 54), alt = max(dis.safeAreaInsets.bottom, 21)
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
                SanalEkran(olcek: s, ust: ust, alt: alt,
                           icerik: AnyView(icerik().environmentObject(model).environmentObject(model.abonelik)
                                               .environmentObject(kilit).tint(Tema.metin)))
                    .frame(width: w * s, height: h * s)
                    .background(Tema.zemin)
                    .overlay(alignment: .top) {
                        durumCubugu.frame(width: w, height: ust).scaleEffect(s, anchor: .top)
                            .frame(width: w * s, height: ust * s, alignment: .top)
                    }
                    .overlay(alignment: .bottom) { Capsule().fill(Tema.metin).frame(width: 144 * s, height: 5 * s).padding(.bottom, 8 * s) }
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

    // Telefonun durum çubuğu (çizim): saat, Dynamic Island, sinyal ve pil
    private var durumCubugu: some View {
        ZStack {
            HStack {
                Text(verbatim: "9:41").font(.system(size: 17, weight: .semibold))
                Spacer()
                HStack(spacing: 6) {
                    Image(systemName: "cellularbars")
                    Image(systemName: "wifi")
                    Image(systemName: "battery.100percent")
                }
                .font(.system(size: 16, weight: .semibold))
            }
            .padding(.leading, 52).padding(.trailing, 38)
            Capsule().fill(Color.black).frame(width: 125, height: 37)
        }
        .foregroundStyle(Tema.metin)
        .frame(height: 37)
        .padding(.top, 14)
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

// Telefonun ekranı (Vitrin): içerik kendi UIHostingController'ında tam ekran boyutunda dizilir, görünümü UIKit dönüşümüyle
// küçültülür. SwiftUI'nin scaleEffect'iyle küçültülen gezinme çubuğu sistemin kenar boşluklarını kaybeder (büyük başlık
// ve arama kutusu kenara yapışır); ayrı bir denetleyicinin kökünde kenar boşluğu ve güvenli alan (durum çubuğu ve ana
// ekran çizgisi kadar) elle verilir, içerik gerçek telefondaki gibi dizilir. Ortam nesnelerini Vitrin aktarır.
private struct SanalEkran: UIViewControllerRepresentable {
    let olcek: CGFloat
    let ust: CGFloat
    let alt: CGFloat
    let icerik: AnyView

    func makeUIViewController(context: Context) -> SanalEkranKabi {
        let kap = SanalEkranKabi()
        let ev = UIHostingController(rootView: icerik)
        ev.view.backgroundColor = .clear
        kap.addChild(ev)
        kap.view.addSubview(ev.view)
        ev.didMove(toParent: kap)
        kap.ev = ev
        ayarla(kap)
        return kap
    }

    func updateUIViewController(_ kap: SanalEkranKabi, context: Context) {
        kap.ev?.rootView = icerik
        ayarla(kap)
    }

    private func ayarla(_ kap: SanalEkranKabi) {
        kap.olcek = olcek
        kap.ev?.additionalSafeAreaInsets = UIEdgeInsets(top: ust, left: 0, bottom: alt, right: 0)
        kap.ev?.view.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20)
        kap.view.setNeedsLayout()
    }
}

private final class SanalEkranKabi: UIViewController {
    var ev: UIHostingController<AnyView>?
    var olcek: CGFloat = 1

    // İçerik kabın 1 / ölçek katı boyutunda dizilir, ölçekle küçültülünce kabı tam doldurur
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let v = ev?.view, olcek > 0 else { return }
        let b = view.bounds
        v.bounds = CGRect(x: 0, y: 0, width: b.width / olcek, height: b.height / olcek)
        v.center = CGPoint(x: b.midX, y: b.midY)
        v.transform = CGAffineTransform(scaleX: olcek, y: olcek)
    }
}

import Foundation
import SwiftUI

// Örnek veriyle açılış (CI'da ekran görüntüleri: .github/workflows/ekran.yml). "-ornek" ile girişsiz, örnek veriyle açılır;
// "-sekme N" açılış sekmesi (0 Özet … 4 Varlıklar), "-galeri N" yalnızca grafikler (1: Nakit ve kategoriler,
// 2: aylık ödemeler ve Varlığın seyri, 3: harcama formu ve "Alabilir miyim?"). Gerçek kullanımda hiçbiri yoktur.
enum Ornek {
    private static func deger(_ ad: String) -> Int? {
        let a = CommandLine.arguments
        guard let i = a.firstIndex(of: ad), i + 1 < a.count else { return nil }
        return Int(a[i + 1])
    }
    static var sekme: Int { deger("-sekme") ?? 0 }
    static var galeri: Int? { deger("-galeri") }

    static func hazirlaIfRequested() {
        guard CommandLine.arguments.contains("-ornek") else { return }
        Auth.store(nil)
        Depo.offlineChosen = true
        Depo.offlineCountry = "TR"
        Depo.cashDef = nil
        if let data = try? JSONSerialization.data(withJSONObject: veri()) {
            Depo.write(Depo.stateFile(nil), String(decoding: data, as: UTF8.self))
        }
    }

    // Bugünden n gün önce / sonra
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
                ["id": "d1", "kind": "loan", "personId": "ben", "party": "Ziraat", "asset": "TRY", "amount": 4500, "principal": 45000,
                 "date": gun(-80), "due": gun(-50), "count": 12],
                ["id": "d2", "kind": "person", "side": "receivable", "personId": "ben", "party": "Can", "asset": "TRY", "amount": 7500,
                 "principal": 7500, "date": gun(-30), "due": gun(15)],
            ],
        ]
    }
}

// Grafiklerin bir arada görünümü (-galeri)
struct GrafikGalerisi: View {
    let sayfa: Int

    var body: some View {
        if sayfa == 3 {
            HarcamaFormu(ornek: ("36000", "Buzdolabı", 6))
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
            .navigationTitle("Grafikler")
        }
    }
}

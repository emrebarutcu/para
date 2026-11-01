import Foundation

// Simülatörde çekirdeğin denetimi (CI: .github/workflows/ios.yml). "-oz-denetim" ile açılınca diske dokunmadan web
// modüllerini ve araçları yükler, örnek veriyle araçları çağırır, cevapların Swift görünümlerine çözüldüğünü ve
// hesapların beklenen sonucu verdiğini denetler, sonucu yazıp çıkar.
enum OzDenetim {
    @MainActor
    static func runIfRequested() {
        guard CommandLine.arguments.contains("-oz-denetim") else { return }
        do {
            let m = try Motor()
            m.box.json = m.defaultState
            m.setRates(#"{"rates":{"TRY":1,"USD":40,"EUR":45,"GAU":4000},"updatedAt":"2026-10-31T10:00:00Z","source":"denetim"}"#)
            try m.runJSON("add_card", ["name": "Bonus", "limit": 50000, "cutoff_day": 10, "due_day": 20, "last4": "1234"])
            try m.runJSON("add_person", ["name": "Ayşe"])
            let p: HarcamaSonucu = try m.run("add_purchase", ["description": "Telefon", "amount": 12000, "installments": 3,
                                                              "date": "2026-10-05", "card": "Bonus", "category": "elektronik"])
            try m.runJSON("add_entry", ["asset": "USD", "direction": "in", "amount": 100, "description": "Dolar",
                                        "date": "2026-10-01", "price": 40, "settle": true])
            try m.runJSON("add_entry", ["asset": "TRY", "direction": "in", "amount": 30000, "description": "Maaş",
                                        "date": "2026-10-01", "repeat": 0])
            let detail: Harcama = try m.run("get_purchase", ["id": p.purchase.id])
            try check(detail.payments?.map(\.date) == ["2026-10-20", "2026-11-20", "2026-12-20"], "taksit tarihleri: \(detail.payments ?? [])")
            let _: Ozet = try m.run("get_overview")
            let cards: KartListesi = try m.run("list_cards")
            try check(cards.cards.first?.limit == 50000 && cards.cards.first?.purchaseCount == 1, "kart: \(cards.cards)")
            let _: HarcamaListesi = try m.run("list_purchases", ["status": "all"])
            let assets: Varliklar = try m.run("get_assets")
            try check(assets.assets.first { $0.asset == "USD" }?.tryValue == 4000, "dolar: \(assets.assets)")
            let _: HareketListesi = try m.run("list_entries")
            let people: KisiListesi = try m.run("list_people")
            try check(people.people.map(\.name) == [L("Ben"), "Ayşe"], "kişiler: \(people.people)")   // ilk kişi telefonun dilinde (İngilizcede "Me")
            do {
                try m.runJSON("add_purchase", ["description": "x", "amount": -1])
                try check(false, "geçersiz tutar kabul edildi")
            } catch let e as AracHatasi where e.user {}
            // Yeni ekranlar: Akış, içgörüler, kategoriler, borçlar, grafikler
            try m.runJSON("add_debt", ["type": "loan", "party": "Banka", "amount": 2500, "installments": 12,
                                       "due_date": "2026-11-15", "date": "2026-10-15", "principal": 25000])
            try m.runJSON("add_debt", ["type": "lent", "party": "Can", "amount": 5000, "date": "2026-10-20", "due_date": "2026-11-20"])
            let akis: Akis = try m.run("get_cashflow", ["months": 3])
            try check(akis.months.count == 3, "akış: \(akis.months.count) ay")
            let _: Icgoruler = try m.run("get_insights")
            let _: KategoriHarcamasi = try m.run("spending_by_category", ["month": "2026-10"])
            let borclar: Borclar = try m.run("list_debts")
            try check(borclar.debts.count == 2 && borclar.cards.count == 1, "borçlar: \(borclar.debts.count)")
            let loan = borclar.debts.first { $0.type == "loan" }
            try m.runJSON("pay_debt", ["debt": loan?.id ?? "", "amount": 2500, "date": "2026-10-31"])
            let nakit = try m.cash(start: "1", shift: 0)
            try check(!nakit.days.isEmpty && nakit.any, "nakit: \(nakit.days.count) gün")
            let plan1 = try m.assetPlan(range: "3m")
            try check(plan1.span == 91 && plan1.codes == ["USD"], "varlık planı: \(plan1)")
            let seri = try m.asset(range: "3m", seriesJSON: #"{"USD":[["2026-08-01",38],["2026-10-01",40]]}"#)
            try check((seri?.points.count ?? 0) > 10, "varlığın seyri: \(seri?.points.count ?? 0) nokta")

            let plan = try m.changes(state: m.box.json, base: "{}")
            try check(plan.contains("\"upsert\"") && plan.contains("Telefon"), "eşitleme planı")
            try check(m.constants()?.categories.isEmpty == false, "kategoriler")
            try check(!m.isBlank(m.box.json) && m.isBlank(m.defaultState), "boş veri")
            // Harcama düzenleme ve kart günlerinin değişmesi (geçiş sorusu)
            let duz: HarcamaSonucu = try m.run("update_purchase", ["id": p.purchase.id, "description": "Telefon 2", "installments": 6])
            try check(duz.purchase.description == "Telefon 2" && duz.purchase.installments == 6, "harcama düzenleme")
            let kartId = cards.cards.first?.id ?? ""
            do {
                try m.runJSON("update_card", ["card": kartId, "cutoff_day": 15, "due_day": 25])   // arada harcama yoksa sorulmaz
            } catch let e as AracHatasi where e.user && e.message.contains("transition") {
                let secenek = KartFormu.secenekler(e.message)
                try check(!secenek.isEmpty, "geçiş seçenekleri: \(e.message)")
                try m.runJSON("update_card", ["card": kartId, "cutoff_day": 15, "due_day": 25, "transition": secenek[0].kod])
            }
            m.setCashDef(["TRY", "USD"])
            try check(try m.cash(start: "1", shift: 0).any, "nakit tanımı")
            m.setCashDef(nil)

            // Ülke: euro hesabında tutarlar ve kurlar euroya göre, fon / hisse yok (para.js)
            m.box.json = m.defaultState
            m.setHome(m.homeOf(country: "DE"))
            try m.runJSON("add_entry", ["asset": "EUR", "direction": "in", "amount": 1000, "description": "Gehalt", "date": "2026-10-01"])
            try m.runJSON("add_entry", ["asset": "USD", "direction": "in", "amount": 110, "description": "Geschenk", "date": "2026-10-01"])
            let eur: Varliklar = try m.run("get_assets")
            try check(eur.currency == "EUR" && abs(eur.totalTry - (1000 + 110.0 * 40 / 45)) < 0.01, "euro hesabı: \(eur.currency ?? "-") \(eur.totalTry)")
            try check(m.constants()?.markets == false && m.constants()?.assets.first?.code == "EUR", "euro formları")
            try check(m.homeOf(country: "GB") == "GBP", "ülke → para birimi")
            m.setHome("TRY")

            finish("OZ-DENETIM TAMAM", code: 0)
        } catch {
            finish("OZ-DENETIM HATA: \(error)", code: 1)
        }
    }

    // Sonuç hem konsola hem uygulamanın Documents/oz-denetim.txt dosyasına (CI konsolu her zaman yakalayamıyor)
    private static func finish(_ result: String, code: Int32) -> Never {
        print(result)
        fflush(stdout)
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try? Data((result + "\n").utf8).write(to: docs.appendingPathComponent("oz-denetim.txt"), options: .atomic)
        exit(code)
    }

    private static func check(_ ok: Bool, _ what: @autoclosure () -> String) throws {
        if !ok { throw AracHatasi(message: what(), user: false) }
    }
}

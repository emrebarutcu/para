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
            try check(people.people.map(\.name) == ["Ben", "Ayşe"], "kişiler: \(people.people)")
            do {
                try m.runJSON("add_purchase", ["description": "x", "amount": -1])
                try check(false, "geçersiz tutar kabul edildi")
            } catch let e as AracHatasi where e.user {}
            let plan = try m.changes(state: m.box.json, base: "{}")
            try check(plan.contains("\"upsert\"") && plan.contains("Telefon"), "eşitleme planı")
            try check(m.constants()?.categories.isEmpty == false, "kategoriler")
            try check(!m.isBlank(m.box.json) && m.isBlank(m.defaultState), "boş veri")
            print("OZ-DENETIM TAMAM")
            fflush(stdout)
            exit(0)
        } catch {
            print("OZ-DENETIM HATA: \(error)")
            fflush(stdout)
            exit(1)
        }
    }

    private static func check(_ ok: Bool, _ what: @autoclosure () -> String) throws {
        if !ok { throw AracHatasi(message: what(), user: false) }
    }
}

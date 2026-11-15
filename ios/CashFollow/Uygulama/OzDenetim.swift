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
            let donemler: KartDonemleri = try m.run("card_statements", ["card": cards.cards.first?.id ?? ""])
            try check(donemler.periods.count == 6 && donemler.periods.first?.current == true
                      && donemler.periods.flatMap(\.purchases).allSatisfy { $0.id == p.purchase.id }, "dönemler: \(donemler.periods)")
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
            // Ödeme hatırlatmaları: sıradaki ödemeler bugünden sonra ve sıralı; kredi taksiti de var; bildirim zamanı
            let hatirlat = Hatirlatma.odemeler(m), bugun = Bicim.key(Date())
            try check(hatirlat.allSatisfy { $0.tarih >= bugun } && hatirlat.map(\.tarih) == hatirlat.map(\.tarih).sorted()
                      && (bugun > "2027-10-15" || hatirlat.contains { $0.ad.hasPrefix("Banka") }), "hatırlatmalar: \(hatirlat)")
            let saat = { (s: String) in Calendar.current.date(from: DateComponents(year: 2026, month: 11, day: Int(s.prefix(2)), hour: Int(s.suffix(2)))) ?? Date() }
            let z = Hatirlatma.zamani("2026-11-20", gunOnce: 1, dakika: 600, simdi: saat("1909"))
            try check(z?.0 == saat("1910") && z?.1 == 1
                      && Hatirlatma.zamani("2026-11-20", gunOnce: 1, dakika: 600, simdi: saat("1911"))?.1 == 0
                      && Hatirlatma.zamani("2026-11-20", gunOnce: 1, dakika: 600, simdi: saat("2011")) == nil, "hatırlatma zamanı")
            // İlk açılış akışı: son ödeme günü tahmini, "n ay önce", varsayılan ülke (desteklenmeyen bölge boş kalır)
            try check(Karsilama.sonOdemeGunu(kesim: 10, ulke: "TR") == 20 && Karsilama.sonOdemeGunu(kesim: 25, ulke: "TR") == 5
                      && Karsilama.sonOdemeGunu(kesim: 3, ulke: "US") == 24, "son ödeme günü tahmini")
            let mart31 = Calendar(identifier: .gregorian).date(from: DateComponents(year: 2026, month: 3, day: 31, hour: 12)) ?? Date()
            try check(Bicim.key(Karsilama.tarih(ayOnce: 1, bugun: mart31)) == "2026-02-28", "ay önce: \(Bicim.key(Karsilama.tarih(ayOnce: 1, bugun: mart31)))")
            let ulkeler = m.constants()?.countries ?? []
            try check(Karsilama.varsayilanUlke(kayitli: nil, bolge: "DE", paraBirimi: "EUR", ulkeler: ulkeler) == "DE"
                      && Karsilama.varsayilanUlke(kayitli: nil, bolge: "BR", paraBirimi: "BRL", ulkeler: ulkeler) == ""
                      && Karsilama.varsayilanUlke(kayitli: "US", bolge: "DE", paraBirimi: "EUR", ulkeler: ulkeler) == "US"
                      && !Karsilama.varsayilanUlke(kayitli: nil, bolge: nil, paraBirimi: "EUR", ulkeler: ulkeler).isEmpty, "varsayılan ülke")
            // Özet'in tepesi ve kolaylıklar (icgoru.js; kopru.js): ilerleme, son taksit ayı, işyeri önerileri, biten taksit,
            // ay kapanışı, kesim günleri
            let tepe: Ozet = try m.run("get_overview")
            try check(tepe.progress != nil && (bugun > "2026-12-31" || tepe.lastInstallmentMonth == "2026-12"),
                      "özetin tepesi: \(String(describing: tepe.progress)) \(tepe.lastInstallmentMonth ?? "-")")
            let isyerleri = m.merchants()
            try check(isyerleri.map(\.desc) == ["Telefon"] && isyerleri.first?.count == 3 && isyerleri.first?.category == "elektronik"
                      && m.merchants("tel").count == 1 && m.merchants("yok").isEmpty, "işyeri önerileri: \(isyerleri)")
            let biten = m.finishing(from: "2026-12-01", to: "2026-12-31")
            try check(biten.map(\.desc) == ["Telefon"] && biten.first?.monthly == 4000 && biten.first?.freeFrom == "2027-01", "biten taksit: \(biten)")
            let kasim = m.monthSummary("2026-11")
            try check(kasim?.month == "2026-11" && kasim?.paid == 4000 && kasim?.previous == 4000 && kasim?.next.total == 4000
                      && kasim?.finished.isEmpty == true && m.monthSummary("2026-12")?.freed == 4000, "ay kapanışı: \(String(describing: kasim))")
            let kesimler = m.cutoffs()
            try check(kesimler.count == 1 && kesimler.first?.card == "Bonus" && kesimler.first?.cut.hasSuffix("-10") == true
                      && (kesimler.first?.dueBefore ?? "") < (kesimler.first?.dueAfter ?? ""), "kesim günleri: \(kesimler)")
            try check(!AyOzetiEkrani.tekSatir(kasim!).isEmpty, "ay özeti satırı")
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

            // Ülkeye göre özellikler (para.js features): Birleşik Krallık'ta Clearpay ve taksit ikinci planda, Japonya'da
            // taksit öne çıkar ve Pay in 4 yok
            m.box.json = m.defaultState
            try check(m.setCountry("GB") == "GBP", "ülke → para birimi (setCountry)")
            let gb = m.constants()
            try check(gb?.installments == "secondary" && gb?.bnplProviders?.map(\.id) == ["klarna", "clearpay", "paypal", "other"]
                      && gb?.apr == true && gb?.bankEmails == false, "Birleşik Krallık formları")
            m.setCountry("JP")
            let jp = m.constants()
            try check(jp?.installments == "primary" && jp?.bnpl == false && jp?.apr == true, "Japonya formları")

            // ABD: kartın APR'si (döner kredi) ve Pay in 4 (para.js features)
            m.box.json = m.defaultState
            m.setCountry("US")
            try check(m.constants()?.apr == true && m.constants()?.bnpl == true && m.constants()?.markets == false, "ABD formları")
            try m.runJSON("add_card", ["name": "Chase", "cutoff_day": 3, "due_day": 28, "apr": 24.99, "auto_pay": false])
            let us: HarcamaSonucu = try m.run("add_purchase", ["description": "Sneakers", "amount": 99.99, "card": "nakit",
                                                               "bnpl": "klarna", "date": "2026-11-01"])
            try check(us.purchase.installments == 4 && us.purchase.bnpl?.firstPayment == 25.02, "Pay in 4: \(String(describing: us.purchase.bnpl))")
            let usCards: KartListesi = try m.run("list_cards")
            try check(usCards.cards.first?.apr == 24.99 && usCards.cards.first?.tracking?.autoPay == false, "APR: \(usCards.cards)")
            let _: Borclar = try m.run("list_debts")
            try check(m.constants()?.bonus == false, "bonus ödemesi ABD'de yok")

            // Japonya: bonus ödemesi (ボーナス払い; para.js features bonus, taksit.js bonus)
            m.box.json = m.defaultState
            m.setCountry("JP")
            try check(m.constants()?.bonus == true && m.constants()?.bonusMonths == [8, 1], "Japonya: bonus ödemesi")
            try m.runJSON("add_card", ["name": "JCB", "cutoff_day": 15, "due_day": 10, "bonus_months": [7, 12]])
            let bonusluHarcama: HarcamaSonucu = try m.run("add_purchase", ["description": "テレビ", "amount": 98000, "card": "JCB",
                                                               "bonus": "twice", "date": "2026-10-05"])
            try check(bonusluHarcama.purchase.bonus?.schedule.map(\.date) == ["2026-12-10", "2027-07-10"], "bonus: \(String(describing: bonusluHarcama.purchase.bonus))")
            let jpCards: KartListesi = try m.run("list_cards")
            try check(jpCards.cards.first?.bonusMonths == [7, 12], "bonus ayları")
            m.setCountry("TR")

            // Banka e-postaları: Gmail yönlendirme onayı, deneme e-postası ve son e-posta Swift'te çözülür (EpostaListesi)
            let gmail = #"{"id":91,"sender":"forwarding-noreply@google.com","subject":"(#548123907) Gmail Forwarding Confirmation - Receive Mail from ali@gmail.com","received_at":"2026-10-17T10:00:00Z","body":"Confirmation code: 548123907\nhttps://mail-settings.google.com/mail/vf-%5BX%5D-Y"}"#
            let denemeE = #"{"id":92,"sender":"ben","subject":"CashFollow deneme","received_at":"2026-10-17T11:00:00.123456+00:00","body":"x"}"#
            m.setInbox(rows: "[\(gmail),\(denemeE)]", latest: "[\(denemeE)]")
            let kutu = try m.run("list_inbox") as EpostaListesi
            try check(kutu.emails.map { $0.kind ?? "" } == ["verification", "test"] && kutu.emails.first?.verification?.code == "548123907"
                      && kutu.lastEmail?.kind == "test" && Senkron.time(kutu.lastEmail?.receivedAt ?? "") != nil, "banka e-postaları: \(kutu)")
            m.setInbox(rows: "[]")

            // CashFollow Premium: hesabın satırı (tablo.js premium, köprüden), ürünler ve ücretsiz sürümün sınırları
            let gun: TimeInterval = 86_400
            let iso = { (d: Date) in ISO8601DateFormatter().string(from: d) }
            try check(m.premium(row: #"{"source":"grandfathered","status":"active","expires_at":null}"#), "Premium: ilk kullanıcı")
            try check(m.premium(row: #"{"source":"appstore","status":"active","expires_at":"\#(iso(Date().addingTimeInterval(7 * gun)))"}"#), "Premium: etkin")
            try check(!m.premium(row: #"{"source":"appstore","status":"active","expires_at":"\#(iso(Date().addingTimeInterval(-gun)))"}"#), "Premium: süresi bitmiş")
            try check(!m.premium(row: #"{"source":"appstore","status":"revoked","expires_at":null}"#) && !m.premium(row: nil), "Premium: iade / satır yok")
            try check(Abonelik.kimlikler.count == 3 && Abonelik.kimlikler.allSatisfy { $0.hasPrefix("app.cashfollow.ios.premium.") }, "Premium ürünleri")
            try check(Abonelik.ucretsizKart == 2 && Abonelik.ucretsizKisi == 1, "ücretsiz sürümün sınırları")

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

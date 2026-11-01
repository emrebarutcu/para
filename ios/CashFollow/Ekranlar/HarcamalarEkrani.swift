import SwiftUI

// Harcamalar: kişiye göre süzme, süren / biten taksitler, arama, ekleme ve silme (list_purchases, add_purchase,
// delete_purchase; web'deki Harcamalar sekmesi)
struct HarcamalarEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var search = ""
    @State private var kisi = ""                 // "" hepsi, yoksa kişinin kimliği
    @State private var kategori: KategoriSecimi? // kategoriye dokununca liste süzülür
    @State private var bitenler = false
    @State private var adding = false
    @State private var silinecek: Harcama?

    var body: some View {
        NavigationStack {
            Sayfa {
                Okunan(tool: "list_people") { (k: KisiListesi) in
                    if k.people.count > 1 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                Cip(ad: "Tümü", sayi: k.people.reduce(0) { $0 + $1.purchaseCount }, secili: kisi.isEmpty) { kisi = "" }
                                ForEach(k.people) { p in
                                    Cip(ad: p.name, sayi: p.purchaseCount, renk: model.kisiRengi(p.id), secili: kisi == p.id) { kisi = p.id }
                                }
                            }
                        }
                    }
                }
                if search.isEmpty {
                    Okunan(tool: "spending_by_category", args: ["months": 3]) { (k: KategoriHarcamasi) in
                        KategoriKarti(months: k.months, secili: kategori.map { $0.id }) { k in
                            withAnimation { kategori = kategori?.id == k.id ? nil : k }
                        }
                    }
                }
                if let k = kategori {
                    HStack {
                        Text("Kategori: \(k.ad)").font(.subheadline.weight(.semibold))
                        Spacer()
                        Button { withAnimation { kategori = nil } } label: { Image(systemName: "xmark.circle.fill") }
                            .foregroundStyle(Tema.metin3).accessibilityLabel("Kategori süzgecini kaldır")
                    }
                    .padding(.horizontal, 4)
                }
                liste(durum: "active", bos: search.isEmpty ? "Süren harcama yok" : "Bulunamadı")
                Button { withAnimation { bitenler.toggle() } } label: {
                    HStack {
                        Text("Biten harcamalar").font(.subheadline.weight(.semibold))
                        Image(systemName: "chevron.down").font(.caption.weight(.semibold)).rotationEffect(.degrees(bitenler ? 180 : 0))
                        Spacer()
                    }
                    .foregroundStyle(Tema.metin2).padding(.horizontal, 4).padding(.top, 4)
                }
                .buttonStyle(.plain)
                if bitenler { liste(durum: "done", bos: "Biten harcama yok") }
            }
            .navigationTitle("Harcamalar")
            .sayfaZemini()
            .navigationDestination(for: String.self) { id in HarcamaDetayi(id: id) }
            .searchable(text: $search, prompt: "Ara")
            .yenilenebilir(model)
            .yuzenDugme("Harcama ekle") { adding = true }
            .sheet(isPresented: $adding) { HarcamaFormu() }
            .confirmationDialog(silinecek.map { "\($0.description) ve bütün taksitleri silinsin mi?" } ?? "",
                                isPresented: Binding(get: { silinecek != nil }, set: { if !$0 { silinecek = nil } }), titleVisibility: .visible) {
                Button("Sil", role: .destructive) {
                    if let p = silinecek { try? model.write("delete_purchase", ["id": p.id]) }
                    silinecek = nil
                }
            }
        }
    }

    private func liste(durum: String, bos: String) -> some View {
        Okunan(tool: "list_purchases", args: args(durum), key: "\(durum)|\(search)|\(kisi)|\(kategori?.id ?? "-")") { (l: HarcamaListesi) in
            if l.purchases.isEmpty {
                Kart { Text(bos).foregroundStyle(Tema.metin3) }
            } else {
                Kart(dolgu: 14) {
                    SatirListesi(veri: l.purchases) { p in
                        NavigationLink(value: p.id) { HarcamaSatiri(p: p) }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button("Sil", systemImage: "trash", role: .destructive) { silinecek = p }
                            }
                    }
                }
            }
        }
    }

    private func args(_ durum: String) -> [String: Any] {
        var a: [String: Any] = ["status": durum, "limit": 500]
        if !search.trimmingCharacters(in: .whitespaces).isEmpty { a["search"] = search }
        if !kisi.isEmpty { a["person"] = kisi }
        if let k = kategori { a["category"] = k.id.map { $0 as Any } ?? NSNull() }
        return a
    }
}

// Seçilen kategori: id (kategorisizler için nil) ve adı
struct KategoriSecimi: Equatable {
    let id: String?
    let ad: String
}

// Web'deki harcama satırı: kişinin baş harfi, ad, kart · tarih, taksit · kategori; sağda aylık tutar ve kalan,
// taksitliyse ilerleme çubuğu
struct HarcamaSatiri: View {
    @EnvironmentObject private var model: Model
    let p: Harcama

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Avatar(ad: p.person, renk: model.kisiRengi(p.personId))
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(p.description).font(.body.weight(.semibold)).foregroundStyle(Tema.metin).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(tutar).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(Tema.metin)
                }
                HStack(spacing: 5) {
                    Image(systemName: p.cardId == nil ? "banknote" : "creditcard").font(.caption)
                        .foregroundStyle(p.cardId.map { model.kartRengi($0) } ?? Tema.nakit)
                    Text([p.card, p.date.map { Bicim.day($0) }].compactMap { $0 }.joined(separator: " · ")).lineLimit(1)
                    Spacer(minLength: 6)
                    if let sag = sagAlt { Text(sag).monospacedDigit() }
                }
                .font(.footnote).foregroundStyle(Tema.metin3)
                let alt = [p.repeat?.label ?? (p.installments > 1 ? "\(p.installments) taksit" : "Peşin"), p.categoryName].compactMap { $0 }
                Text(alt.joined(separator: " · ")).font(.footnote).foregroundStyle(Tema.metin3)
                if p.installments > 1, p.repeat == nil {
                    HStack(spacing: 8) {
                        Doluluk(used: Double(p.paidInstallments), limit: Double(p.installments), renk: Tema.metin2)
                            .frame(width: 90)
                        Text("\(p.paidInstallments)/\(p.installments) ödendi").font(.caption).foregroundStyle(Tema.metin3)
                    }
                }
            }
        }
        .contentShape(Rectangle())
    }

    private var tutar: String {
        if p.repeat != nil || p.installments > 1 { return Bicim.amount(p.perInstallment, asset: p.asset) + "/ay" }
        return Bicim.amount(p.total, asset: p.asset)
    }

    private var sagAlt: String? {
        if p.status == "done" { return "bitti" }
        if p.repeat != nil, let n = p.repeat?.nextDate { return "sonraki \(Bicim.day(n))" }
        if p.installments > 1 { return "kalan \(Bicim.amount(p.remainingAmount, asset: p.asset))" }
        if let n = p.nextPayment { return Bicim.relative(n.date) }
        return nil
    }
}

// Harcamanın bütün taksitleri (get_purchase)
struct HarcamaDetayi: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var confirm = false
    @State private var duzenle: Harcama?

    var body: some View {
        Okunan(tool: "get_purchase", args: ["id": id], key: id) { (p: Harcama) in
            Sayfa {
                Kart {
                    HStack(spacing: 12) {
                        Avatar(ad: p.person, renk: model.kisiRengi(p.personId), boyut: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.description).font(.title3.weight(.bold))
                            Text([p.person, p.card].joined(separator: " · ")).font(.subheadline).foregroundStyle(Tema.metin3)
                        }
                    }
                    BuyukTutar(deger: p.total, boyut: 40)
                    Ayirici()
                    IstatistikSatiri(ogeler: [
                        Istatistik(etiket: p.repeat != nil ? "Her ay" : "Taksit", deger: p.installments > 1 || p.repeat != nil ? Bicim.amount(p.perInstallment, asset: p.asset) : "Peşin"),
                        Istatistik(etiket: "Ödenen", deger: p.repeat != nil ? "—" : "\(p.paidInstallments)/\(p.installments)"),
                        Istatistik(etiket: "Kalan", deger: Bicim.amount(p.remainingAmount, asset: p.asset)),
                    ])
                }
                Kart {
                    VStack(spacing: 10) {
                        if let d = p.date { Satir(title: "Tarih", value: Bicim.day(d)) }
                        if let c = p.categoryName { Satir(title: "Kategori", value: c) }
                        if let cut = p.statementCutoff { Satir(title: "Ekstre kesimi", value: Bicim.day(cut)) }
                        if let r = p.repeat?.label { Satir(title: "Tekrar", value: r) }
                    }
                    .font(.subheadline)
                }
                if let odemeler = p.payments, !odemeler.isEmpty {
                    Kart(dolgu: 14) {
                        KartBasligi("Ödemeler")
                        SatirListesi(veri: odemeler) { x in
                            HStack(spacing: 12) {
                                TarihRozeti(tarih: x.date)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(x.no). taksit").font(.body.weight(.semibold))
                                    Text(x.paid ? "ödendi" : Bicim.relative(x.date)).font(.footnote).foregroundStyle(Tema.metin3)
                                }
                                Spacer()
                                Text(Bicim.amount(x.amount, asset: p.asset)).font(.body.weight(.semibold)).monospacedDigit()
                                    .foregroundStyle(x.paid ? Tema.metin3 : Tema.metin)
                                Image(systemName: x.paid ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(x.paid ? Tema.iyi : Tema.cizgi2)
                            }
                        }
                    }
                }
                Button(role: .destructive) { confirm = true } label: {
                    Text("Harcamayı sil").font(.body.weight(.semibold)).foregroundStyle(Tema.tehlike)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .navigationTitle(p.description)
            .toolbar {
                // Excel'den gelen tarihsiz kayıt web'de düzenlenir (kalan taksitler ve ilk ödeme ayı)
                if p.date != nil {
                    ToolbarItem(placement: .primaryAction) { Button("Düzenle") { duzenle = p } }
                }
            }
            .sheet(item: $duzenle) { HarcamaFormu(duzenle: $0) }
            .confirmationDialog("\(p.description) ve bütün taksitleri silinsin mi?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Sil", role: .destructive) {
                    try? model.write("delete_purchase", ["id": id])
                    dismiss()
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

// Yeni harcama (add_purchase) ya da düzenleme (update_purchase). Tutar en üstte; kart ve taksit çiplerle; "her ay"
// abonelik / kira için. Yeni harcamada "Alabilir miyim?" önizlemesi (simulate_purchase): ilk ödeme, o ayın ödemesi
// önce → sonra, boşta kalan nakit, kalan limit ve ilk ödemesi en geç gelen kart önerisi.
struct HarcamaFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    var duzenle: Harcama? = nil
    var ornek: (tutar: String, ad: String, taksit: Int)? = nil   // yalnızca ekran görüntüleri (-galeri 3)
    @AppStorage("harcama.sonKart") private var sonKart = ""
    @State private var yuklendi = false
    @State private var desc = ""
    @State private var amount = ""
    @State private var count = 1
    @State private var tekrar = false
    @State private var date = Date()
    @State private var card = "nakit"
    @State private var person = ""
    @State private var category = ""
    @State private var cards: [KartGorunumu] = []
    @State private var people: [Kisi] = []
    @State private var preview: HarcamaSonucu?
    @State private var sim: Simulasyon?
    @State private var error: String?
    @FocusState private var tutarOdak: Bool

    private let taksitler = [1, 2, 3, 6, 9, 12]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Kart {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(Bicim.homeSymbol).font(.system(size: 28, weight: .semibold)).foregroundStyle(Tema.metin3)
                            TextField("0", text: $amount)
                                .font(.system(size: 40, weight: .bold)).monospacedDigit()
                                .keyboardType(.decimalPad)
                                .focused($tutarOdak)
                        }
                        Ayirici()
                        TextField("Ne alındı? (ör. Migros)", text: $desc).font(.title3)
                    }

                    Kart {
                        etiket("Nereden")
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(cards) { c in
                                    Cip(ad: c.name, renk: model.kartRengi(c.id), secili: card == c.id) { card = c.id }
                                }
                                Cip(ad: "Nakit", renk: Tema.nakit, secili: card == "nakit") { card = "nakit" }
                            }
                        }
                        if !tekrar {
                            etiket("Taksit")
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(taksitler, id: \.self) { n in
                                        Cip(ad: n == 1 ? "Peşin" : "\(n)", secili: count == n) { count = n }
                                    }
                                    Menu {
                                        Picker("Taksit", selection: $count) {
                                            ForEach(2...60, id: \.self) { Text("\($0) taksit").tag($0) }
                                        }
                                    } label: {
                                        Text(taksitler.contains(count) ? "Diğer" : "\(count) taksit")
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(taksitler.contains(count) ? Tema.metin : Tema.ustMetin)
                                            .padding(.horizontal, 14).padding(.vertical, 8)
                                            .background(taksitler.contains(count) ? Tema.yuzey : Tema.metin, in: Capsule())
                                            .overlay(Capsule().strokeBorder(Tema.cizgi2, lineWidth: taksitler.contains(count) ? 1 : 0))
                                    }
                                }
                            }
                        }
                        if duzenle == nil {
                            Toggle("Her ay tekrarlar (abonelik, kira)", isOn: $tekrar.animation())
                                .font(.subheadline).tint(Tema.metin)
                        }
                    }

                    Kart {
                        DatePicker("Tarih", selection: $date, displayedComponents: .date)
                            .environment(\.locale, Bicim.locale)
                        if people.count > 1 {
                            Ayirici()
                            Picker("Kimin", selection: $person) {
                                ForEach(people) { p in Text(p.name).tag(p.id) }
                            }
                        }
                        Ayirici()
                        Picker("Kategori", selection: $category) {
                            Text("Otomatik").tag("")
                            ForEach(model.constants?.categories ?? []) { c in Text(c.name).tag(c.id) }
                        }
                    }
                    .font(.subheadline)
                    .tint(Tema.metin)

                    if duzenle == nil, let sim { AlabilirMiyim(sim: sim, secili: card, tekrar: tekrar, cards: cards) { card = $0 } }
                    else if let p = preview { duzenlemeOnizlemesi(p) }
                    HataMetni(text: error)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Tema.zemin)
            .navigationTitle(duzenle == nil ? "Harcama ekle" : "Harcamayı düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Kaydet", action: save).fontWeight(.semibold).disabled(!valid) }
            }
            .task { load() }
            .task(id: "\(desc)|\(amount)|\(count)|\(tekrar)|\(Bicim.key(date))|\(card)|\(person)") { dryRun() }
        }
    }

    private func etiket(_ s: String) -> some View {
        Text(s).font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3)
    }

    private func duzenlemeOnizlemesi(_ p: HarcamaSonucu) -> some View {
        Kart {
            KartBasligi("Ödeme planı")
            VStack(spacing: 8) {
                if let cut = p.preview?.statementCutoff { Satir(title: "Ekstre kesimi", value: Bicim.day(cut)) }
                Satir(title: "İlk ödeme", value: Bicim.day(p.preview?.firstPayment ?? p.purchase.nextPayment?.date))
                if count > 1 {
                    Satir(title: "Son ödeme", value: Bicim.day(p.preview?.lastPayment ?? p.purchase.lastPaymentDate))
                    Satir(title: "Taksit tutarı", value: Bicim.tl(p.purchase.perInstallment))
                }
            }
            .font(.subheadline)
        }
    }

    private var valid: Bool { !desc.trimmingCharacters(in: .whitespaces).isEmpty && (Bicim.parse(amount) ?? 0) > 0 }

    private func load() {
        cards = (try? model.read("list_cards") as KartListesi)?.cards ?? []
        people = (try? model.read("list_people") as KisiListesi)?.people ?? []
        if !yuklendi, let p = duzenle {
            desc = p.description
            amount = p.total.formatted(.number.locale(Bicim.locale).grouping(.never).precision(.fractionLength(0...2)))
            count = min(max(p.installments, 1), 60)
            date = p.date.flatMap(Bicim.date) ?? Date()
            card = p.cardId ?? "nakit"
            person = p.personId
            category = p.category ?? ""
        } else if !yuklendi, card == "nakit" {
            // Son kullanılan kart; yoksa ilk kart
            if cards.contains(where: { $0.id == sonKart }) || sonKart == "nakit" { card = sonKart }
            else if let first = cards.first { card = first.id }
            if let o = ornek { amount = o.tutar; desc = o.ad; count = o.taksit } else { tutarOdak = true }
        }
        yuklendi = true
        if person.isEmpty { person = people.first?.id ?? "ben" }
    }

    private var args: [String: Any] {
        var a: [String: Any] = [
            "description": desc.trimmingCharacters(in: .whitespaces), "amount": Bicim.parse(amount) ?? 0,
            "installments": tekrar ? 1 : count, "date": Bicim.key(date), "card": card, "person": person,
        ]
        if tekrar { a["repeat"] = 0 }
        if !category.isEmpty { a["category"] = category } else if duzenle?.category != nil { a["category"] = NSNull() }
        if let p = duzenle {
            a["id"] = p.id
            if p.asset != Bicim.home { a["asset"] = p.asset }
        }
        return a
    }

    private func dryRun() {
        guard (Bicim.parse(amount) ?? 0) > 0 else { preview = nil; sim = nil; return }
        var a = args
        a["id"] = nil
        if a["description"] as? String == "" { a["description"] = "Harcama" }
        if duzenle == nil {
            a["repeat"] = nil      // önizleme ilk ödemenin etkisini gösterir
            sim = try? model.read("simulate_purchase", a) as Simulasyon
        } else {
            a["dry_run"] = true
            preview = try? model.read("add_purchase", a) as HarcamaSonucu
        }
    }

    private func save() {
        do {
            _ = try model.write(duzenle == nil ? "add_purchase" : "update_purchase", args, as: HarcamaSonucu.self)
            if duzenle == nil { sonKart = card }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// "Alabilir miyim?": harcamanın ödemelere ve boşta kalan nakde etkisi; ilk ödemesi daha geç gelen kart önerisi
struct AlabilirMiyim: View {
    let sim: Simulasyon
    let secili: String
    let tekrar: Bool
    let cards: [KartGorunumu]
    let sec: (String) -> Void

    var body: some View {
        let p = sim.purchase
        let ilk = sim.months.first
        let enDusuk = sim.months.min { $0.freeCashAfter < $1.freeCashAfter }
        let nakitVar = sim.months.contains { abs($0.freeCashBefore) > 0.004 }
        let oneri = sim.cardsCompared.max { $0.daysUntilFirstPayment < $1.daysUntilFirstPayment }
        let seciliAd = cards.first { $0.id == secili }?.name
        Kart {
            KartBasligi(baslik: "Alabilir miyim?") {
                if let n = p.nextPayment { Text(Bicim.relative(n.date)).font(.footnote).foregroundStyle(Tema.metin3) }
            }
            VStack(spacing: 8) {
                Satir(title: "İlk ödeme", value: Bicim.day(p.nextPayment?.date ?? p.payments?.first?.date))
                if !tekrar, p.installments > 1 {
                    Satir(title: "Taksit", value: "\(Bicim.tl(p.perInstallment)) × \(p.installments)")
                    Satir(title: "Son ödeme", value: Bicim.day(p.lastPaymentDate))
                }
                if let ilk {
                    Satir(title: "\(Bicim.month(ilk.month)) ödemesi", value: "\(Bicim.tl(ilk.paymentsBefore, fraction: false)) → \(Bicim.tl(ilk.paymentsAfter, fraction: false))")
                }
                if let c = sim.card, c.limit > 0, let kalan = c.availableAfter {
                    Satir(title: "Kalan limit", value: Bicim.tl(kalan, fraction: false), color: kalan < 0 ? Tema.tehlike : Tema.metin)
                }
            }
            .font(.subheadline)
            if nakitVar, let d = enDusuk {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: d.freeCashAfter < 0 ? "exclamationmark.triangle" : "checkmark.circle")
                    Text(d.freeCashAfter < 0
                         ? "Gelirin ödemeleri karşılamıyor. En sıkışık ay \(Bicim.month(d.month)): \(Bicim.tl(d.freeCashAfter, fraction: false))"
                         : "Her ay gelirin ödemeleri karşılıyor; en sıkışık ay \(Bicim.month(d.month)), boşta \(Bicim.tl(d.freeCashAfter, fraction: false)) kalıyor.")
                }
                .font(.footnote)
                .foregroundStyle(d.freeCashAfter < 0 ? Tema.tehlike : Tema.iyi)
            }
            if !tekrar, let o = oneri, o.card != seciliAd, let id = cards.first(where: { $0.name == o.card })?.id,
               let su = sim.cardsCompared.first(where: { $0.card == seciliAd }), o.daysUntilFirstPayment - su.daysUntilFirstPayment >= 10 {
                Button { sec(id) } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "lightbulb")
                        Text("\(o.card) ile alırsan ilk ödeme \(Bicim.day(o.firstPayment)) (\(o.daysUntilFirstPayment) gün sonra)")
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 4)
                        Text("Seç").fontWeight(.semibold)
                    }
                    .font(.footnote)
                    .foregroundStyle(Tema.metin)
                    .padding(10)
                    .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

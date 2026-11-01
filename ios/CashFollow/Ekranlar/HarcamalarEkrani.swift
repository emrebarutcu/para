import SwiftUI

// Harcamalar: kişiye göre süzme, süren / biten taksitler, arama, ekleme ve silme (list_purchases, add_purchase,
// delete_purchase; web'deki Harcamalar sekmesi)
struct HarcamalarEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var status = "active"
    @State private var search = ""
    @State private var kisi = ""            // "" hepsi, yoksa kişinin kimliği
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
                Secici(secim: $status, ogeler: [("active", "Süren"), ("done", "Biten"), ("all", "Hepsi")])
                Okunan(tool: "list_purchases", args: args, key: "\(status)|\(search)|\(kisi)") { (l: HarcamaListesi) in
                    if l.purchases.isEmpty {
                        Kart { Text(search.isEmpty ? "Harcama yok" : "Bulunamadı").foregroundStyle(Tema.metin3) }
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

    private var args: [String: Any] {
        var a: [String: Any] = ["status": status, "limit": 500]
        if !search.trimmingCharacters(in: .whitespaces).isEmpty { a["search"] = search }
        if !kisi.isEmpty { a["person"] = kisi }
        return a
    }
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

// Yeni harcama (add_purchase) ya da düzenleme (update_purchase): ödeme tarihleri kartın kesim ve son ödeme gününden
// hesaplanır, kaydetmeden önce önizlenir
struct HarcamaFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    var duzenle: Harcama? = nil
    @State private var yuklendi = false
    @State private var desc = ""
    @State private var amount = ""
    @State private var count = 1
    @State private var date = Date()
    @State private var card = "nakit"
    @State private var person = ""
    @State private var category = ""
    @State private var cards: [KartGorunumu] = []
    @State private var people: [Kisi] = []
    @State private var preview: HarcamaSonucu?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Ne alındı", text: $desc)
                    TextField("Tutar (\(Bicim.homeSymbol))", text: $amount).keyboardType(.decimalPad)
                    Picker("Taksit", selection: $count) {
                        Text("Peşin").tag(1)
                        ForEach(2...60, id: \.self) { Text("\($0) taksit").tag($0) }
                    }
                    DatePicker("Tarih", selection: $date, displayedComponents: .date)
                        .environment(\.locale, Bicim.locale)
                }
                Section {
                    Picker("Kart", selection: $card) {
                        ForEach(cards) { c in Text(c.last4.map { "\(c.name) ··\($0)" } ?? c.name).tag(c.id) }
                        Text("Nakit / banka kartı").tag("nakit")
                    }
                    if people.count > 1 {
                        Picker("Kişi", selection: $person) {
                            ForEach(people) { p in Text(p.name).tag(p.id) }
                        }
                    }
                    Picker("Kategori", selection: $category) {
                        Text("Önceki harcamalardan").tag("")
                        ForEach(model.constants?.categories ?? []) { c in Text(c.name).tag(c.id) }
                    }
                }
                if let p = preview {
                    Section("Önizleme") {
                        if let cut = p.preview?.statementCutoff { Satir(title: "Ekstre kesimi", value: Bicim.day(cut)) }
                        Satir(title: "İlk ödeme", value: Bicim.day(p.preview?.firstPayment ?? p.purchase.nextPayment?.date))
                        if count > 1 {
                            Satir(title: "Son ödeme", value: Bicim.day(p.preview?.lastPayment ?? p.purchase.lastPaymentDate))
                            Satir(title: "Taksit tutarı", value: Bicim.tl(p.purchase.perInstallment))
                        }
                    }
                }
                HataMetni(text: error)
            }
            .navigationTitle(duzenle == nil ? "Harcama ekle" : "Harcamayı düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Kaydet", action: save).disabled(!valid) }
            }
            .task { load() }
            .task(id: "\(desc)|\(amount)|\(count)|\(Bicim.key(date))|\(card)|\(person)") { dryRun() }
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
        } else if !yuklendi, let first = cards.first, card == "nakit" {
            card = first.id
        }
        yuklendi = true
        if person.isEmpty { person = people.first?.id ?? "ben" }
    }

    private var args: [String: Any] {
        var a: [String: Any] = [
            "description": desc.trimmingCharacters(in: .whitespaces), "amount": Bicim.parse(amount) ?? 0,
            "installments": count, "date": Bicim.key(date), "card": card, "person": person,
        ]
        if !category.isEmpty { a["category"] = category } else if duzenle?.category != nil { a["category"] = NSNull() }
        if let p = duzenle {
            a["id"] = p.id
            if p.asset != Bicim.home { a["asset"] = p.asset }
        }
        return a
    }

    private func dryRun() {
        guard valid else { preview = nil; return }
        var a = args
        a["dry_run"] = true
        a["id"] = nil
        preview = try? model.read("add_purchase", a) as HarcamaSonucu
    }

    private func save() {
        do {
            _ = try model.write(duzenle == nil ? "add_purchase" : "update_purchase", args, as: HarcamaSonucu.self)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

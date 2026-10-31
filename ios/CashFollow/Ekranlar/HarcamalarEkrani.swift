import SwiftUI

// Harcamalar: süren / biten taksitler, arama, ekleme ve silme (list_purchases, add_purchase, delete_purchase)
struct HarcamalarEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var status = "active"
    @State private var search = ""
    @State private var adding = false

    var body: some View {
        NavigationStack {
            Okunan(tool: "list_purchases", args: args, key: "\(status)|\(search)") { (l: HarcamaListesi) in
                List {
                    Picker("Durum", selection: $status) {
                        Text("Süren").tag("active")
                        Text("Biten").tag("done")
                        Text("Hepsi").tag("all")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)

                    if l.purchases.isEmpty {
                        Text(search.isEmpty ? "Harcama yok" : "Bulunamadı").foregroundStyle(.secondary)
                    }
                    ForEach(l.purchases) { p in
                        NavigationLink(value: p.id) { HarcamaSatiri(p: p) }
                    }
                    .onDelete { idx in
                        for i in idx { try? model.write("delete_purchase", ["id": l.purchases[i].id]) }
                    }
                }
            }
            .navigationTitle("Harcamalar")
            .navigationDestination(for: String.self) { id in HarcamaDetayi(id: id) }
            .searchable(text: $search, prompt: "Ara")
            .yenilenebilir(model)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Harcama ekle")
                }
            }
            .sheet(isPresented: $adding) { HarcamaFormu() }
        }
    }

    private var args: [String: Any] {
        var a: [String: Any] = ["status": status, "limit": 500]
        if !search.trimmingCharacters(in: .whitespaces).isEmpty { a["search"] = search }
        return a
    }
}

struct HarcamaSatiri: View {
    let p: Harcama

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(p.description).lineLimit(1)
                Text([p.card, p.person, p.categoryName].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(p.installments > 1 ? "\(Bicim.amount(p.perInstallment, asset: p.asset)) × \(p.installments)" : Bicim.amount(p.total, asset: p.asset))
                    .monospacedDigit()
                if p.status == "active", let n = p.nextPayment {
                    Text(p.installments > 1 ? "\(p.paidInstallments)/\(p.installments) · \(Bicim.day(n.date))" : Bicim.day(n.date))
                        .font(.caption).foregroundStyle(.secondary)
                } else if p.status == "done" {
                    Text("Bitti").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}

// Harcamanın bütün taksitleri (get_purchase)
struct HarcamaDetayi: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var confirm = false

    var body: some View {
        Okunan(tool: "get_purchase", args: ["id": id], key: id) { (p: Harcama) in
            List {
                Section {
                    Satir(title: "Toplam", value: Bicim.amount(p.total, asset: p.asset))
                    Satir(title: "Kart", value: p.card)
                    Satir(title: "Kişi", value: p.person)
                    if let d = p.date { Satir(title: "Tarih", value: Bicim.day(d)) }
                    if let c = p.categoryName { Satir(title: "Kategori", value: c) }
                    if let cut = p.statementCutoff { Satir(title: "Ekstre kesimi", value: Bicim.day(cut)) }
                    if let r = p.repeat?.label { Satir(title: "Tekrar", value: r) }
                    Satir(title: "Kalan", value: Bicim.amount(p.remainingAmount, asset: p.asset))
                }
                Section("Ödemeler") {
                    ForEach(p.payments ?? [], id: \.self) { x in
                        HStack {
                            Image(systemName: x.paid ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(x.paid ? Renk.vurgu : .secondary)
                            Text("\(x.no). taksit")
                            Spacer()
                            VStack(alignment: .trailing) {
                                Text(Bicim.amount(x.amount, asset: p.asset)).monospacedDigit()
                                Text(Bicim.day(x.date)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section {
                    Button("Harcamayı sil", role: .destructive) { confirm = true }
                }
            }
            .navigationTitle(p.description)
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

// Yeni harcama (add_purchase): ödeme tarihleri kartın kesim ve son ödeme gününden hesaplanır, kaydetmeden önce önizlenir
struct HarcamaFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
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
                    TextField("Tutar (₺)", text: $amount).keyboardType(.decimalPad)
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
            .navigationTitle("Harcama ekle")
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
        if let first = cards.first, card == "nakit" { card = first.id }
        if person.isEmpty { person = people.first?.id ?? "ben" }
    }

    private var args: [String: Any] {
        var a: [String: Any] = [
            "description": desc.trimmingCharacters(in: .whitespaces), "amount": Bicim.parse(amount) ?? 0,
            "installments": count, "date": Bicim.key(date), "card": card, "person": person,
        ]
        if !category.isEmpty { a["category"] = category }
        return a
    }

    private func dryRun() {
        guard valid else { preview = nil; return }
        var a = args
        a["dry_run"] = true
        preview = try? model.read("add_purchase", a) as HarcamaSonucu
    }

    private func save() {
        do {
            _ = try model.write("add_purchase", args, as: HarcamaSonucu.self)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

import SwiftUI

// Kartlar: limit, kullanılan, sıradaki ödeme, bugün alışveriş yapılırsa ödemenin düşeceği gün (list_cards)
struct KartlarEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var editing: KartGorunumu?
    @State private var adding = false
    @State private var deleting: KartGorunumu?

    var body: some View {
        NavigationStack {
            Okunan(tool: "list_cards") { (l: KartListesi) in
                List {
                    if l.cards.isEmpty {
                        ContentUnavailableView("Kart yok", systemImage: "creditcard",
                                               description: Text("Kartı eklerken hesap kesim ve son ödeme gününü gir: taksitlerin hangi ay ödeneceği bunlardan hesaplanır."))
                    }
                    ForEach(l.cards) { c in
                        KartSatiri(c: c)
                            .contentShape(Rectangle())
                            .onTapGesture { editing = c }
                            .swipeActions {
                                Button("Sil", role: .destructive) { deleting = c }
                            }
                    }
                }
            }
            .navigationTitle("Kartlar")
            .yenilenebilir(model)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Kart ekle")
                }
            }
            .sheet(isPresented: $adding) { KartFormu(card: nil) }
            .sheet(item: $editing) { KartFormu(card: $0) }
            .confirmationDialog(deleteTitle, isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Sil", role: .destructive) {
                    if let c = deleting { try? model.write("delete_card", ["card": c.id]) }
                    deleting = nil
                }
            } message: {
                Text("Karttaki bütün harcamalar ve kaydedilen ekstre ödemeleri de silinir.")
            }
        }
    }

    private var deleteTitle: String {
        guard let c = deleting else { return "" }
        return c.purchaseCount > 0 ? "\(c.name) ve \(c.purchaseCount) harcaması silinsin mi?" : "\(c.name) silinsin mi?"
    }
}

struct KartSatiri: View {
    let c: KartGorunumu

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(c.name).font(.headline)
                if let l4 = c.last4 { Text("··\(l4)").foregroundStyle(.secondary) }
                Spacer()
                if let n = c.nextPayment {
                    VStack(alignment: .trailing) {
                        Text(Bicim.tl(n.amount)).monospacedDigit()
                        Text(Bicim.day(n.date)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if c.limit > 0 {
                Doluluk(used: c.used, limit: c.limit)
                HStack {
                    Text("Kullanılan \(Bicim.tl(c.used, fraction: false))")
                    Spacer()
                    Text("Kalan \(Bicim.tl(c.available ?? 0, fraction: false))")
                }
                .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Kullanılan \(Bicim.tl(c.used))").font(.caption).foregroundStyle(.secondary)
            }
            Text("Kesim \(c.cutoffDay) · Son ödeme \(c.dueDay) · Bugün alınan: \(Bicim.day(c.purchaseToday.dueDate))")
                .font(.caption).foregroundStyle(.secondary)
            if let t = c.tracking, !t.autoPay, t.overdue > 0 {
                Text("Geciken ekstre: \(Bicim.tl(t.overdue))").font(.caption).foregroundStyle(Renk.gider)
            }
        }
        .padding(.vertical, 4)
    }
}

// Kart ekleme (add_card) ve düzenleme (update_card: ad, limit, son 4 hane). Kesim / son ödeme günü değişince eski
// ekstrelerin ne olacağı sorulur (transition); bu yalnızca web'de.
struct KartFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let card: KartGorunumu?
    @State private var name = ""
    @State private var limit = ""
    @State private var cutoff = 10
    @State private var due = 20
    @State private var last4 = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Kart adı (ör. banka)", text: $name)
                    TextField("Limit (₺)", text: $limit).keyboardType(.decimalPad)
                    TextField("Son 4 hane (isteğe bağlı)", text: $last4).keyboardType(.numberPad)
                }
                Section {
                    Picker("Hesap kesim günü", selection: $cutoff) { ForEach(1...31, id: \.self) { Text("\($0)").tag($0) } }
                    Picker("Son ödeme günü", selection: $due) { ForEach(1...31, id: \.self) { Text("\($0)").tag($0) } }
                } footer: {
                    Text(card == nil
                         ? "Kesim günü dahil yapılan harcama o ayın ekstresine girer; ekstre son ödeme gününde ödenir."
                         : "Kesim ve son ödeme günü değişikliği, eski ekstrelerin ne olacağını sorduğu için cashfollow.app'te yapılır.")
                }
                .disabled(card != nil)
                HataMetni(text: error)
            }
            .navigationTitle(card == nil ? "Kart ekle" : "Kartı düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Kaydet", action: save).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                guard let c = card else { return }
                name = c.name
                limit = c.limit > 0 ? String(format: "%.0f", c.limit) : ""
                cutoff = c.cutoffDay
                due = c.dueDay
                last4 = c.last4 ?? ""
            }
        }
    }

    private func save() {
        var a: [String: Any] = ["name": name.trimmingCharacters(in: .whitespaces), "limit": Bicim.parse(limit) ?? 0, "last4": last4]
        do {
            if let c = card {
                a["card"] = c.id
                try model.write("update_card", a)
            } else {
                a["cutoff_day"] = cutoff
                a["due_day"] = due
                try model.write("add_card", a)
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

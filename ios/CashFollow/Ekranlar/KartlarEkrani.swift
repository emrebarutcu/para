import SwiftUI

// Kart satırı ve kart formu; kartlar Borçlar sekmesinde listelenir (BorclarEkrani)
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
    @State private var gecis: [Gecis] = []      // günler değişince sorulan seçenekler (update_card transition)
    @State private var soru = false

    // Kesim / son ödeme günü değişince arada kalan harcamalar (web'deki kart formuyla aynı seçenekler)
    struct Gecis: Hashable { let kod: String; let baslik: String; let aciklama: String }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Kart adı (ör. banka)", text: $name)
                    TextField("Limit (\(Bicim.homeSymbol))", text: $limit).keyboardType(.decimalPad)
                    TextField("Son 4 hane (isteğe bağlı)", text: $last4).keyboardType(.numberPad)
                }
                Section {
                    Picker("Hesap kesim günü", selection: $cutoff) { ForEach(1...31, id: \.self) { Text("\($0)").tag($0) } }
                    Picker("Son ödeme günü", selection: $due) { ForEach(1...31, id: \.self) { Text("\($0)").tag($0) } }
                } footer: {
                    Text(card == nil
                         ? "Kesim günü dahil yapılan harcama o ayın ekstresine girer; ekstre son ödeme gününde ödenir."
                         : "Günler değişirse arada kalan harcamaların ne olacağını sorarım.")
                }
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
            .confirmationDialog("Kartın günleri değişiyor", isPresented: $soru, titleVisibility: .visible) {
                ForEach(gecis, id: \.self) { g in Button(g.baslik) { save(transition: g.kod) } }
                Button("Vazgeç", role: .cancel) {}
            } message: {
                Text(gecis.map { "\($0.baslik): \($0.aciklama)" }.joined(separator: "\n\n"))
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

    private func save() { save(transition: nil) }

    private func save(transition: String?) {
        var a: [String: Any] = ["name": name.trimmingCharacters(in: .whitespaces), "limit": Bicim.parse(limit) ?? 0, "last4": last4]
        do {
            if let c = card {
                a["card"] = c.id
                if cutoff != c.cutoffDay || due != c.dueDay {
                    a["cutoff_day"] = cutoff
                    a["due_day"] = due
                }
                if let transition { a["transition"] = transition }
                do {
                    try model.write("update_card", a)
                } catch let e as AracHatasi where e.user && e.message.contains("transition") {
                    gecis = Self.secenekler(e.message)
                    if gecis.isEmpty { throw e }
                    soru = true
                    return
                }
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

    // Aracın sorusundan seçenekler ve tarihleri (mcp/tools.js transitionQuestion)
    static func secenekler(_ m: String) -> [Gecis] {
        func tarih(_ pattern: String) -> [String] {
            guard let r = try? NSRegularExpression(pattern: pattern),
                  let x = r.firstMatch(in: m, range: NSRange(m.startIndex..., in: m)) else { return [] }
            return (1..<x.numberOfRanges).compactMap { Range(x.range(at: $0), in: m).map { Bicim.day(String(m[$0])) } }
        }
        var out: [Gecis] = []
        if m.contains("\"old\":") {
            let d = tarih(#"cutoff (\d{4}-\d{2}-\d{2}), paid (\d{4}-\d{2}-\d{2})"#)
            out.append(Gecis(kod: "old", baslik: "Bu ekstre eski günlerle kesilsin",
                             aciklama: d.count == 2 ? "\(d[0]) kesilir, \(d[1]) tarihinde ödenir; sonraki ekstreler yeni günlerle." : "Açık ekstre eski günlerle; sonrakiler yeni günlerle."))
        }
        if m.contains("\"new\":") {
            let d = tarih(#"cut on (\d{4}-\d{2}-\d{2}), paid (\d{4}-\d{2}-\d{2})"#)
            out.append(Gecis(kod: "new", baslik: "Yeni günler hemen başlasın",
                             aciklama: d.count == 2 ? "Kesilmiş ekstreler değişmez; henüz kesilmemiş harcamalar \(d[0]) tarihinde kesilecek ekstreye girer, son ödeme \(d[1])." : "Kesilmiş ekstreler olduğu gibi kalır; bundan sonrakiler yeni günlerle."))
        }
        if m.contains("\"fix\":") {
            out.append(Gecis(kod: "fix", baslik: "Günleri yanlış girmiştim",
                             aciklama: "Geçmiş ekstreler dahil hepsi yeni günlerle yeniden hesaplanır. \(Bicim.homeShort) bakiyen değişebilir."))
        }
        return out
    }
}

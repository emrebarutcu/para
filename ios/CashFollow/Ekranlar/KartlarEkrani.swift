import SwiftUI

// Kart görseli ve kart formu; kartlar Borçlar sekmesinde listelenir (BorclarEkrani)

// Web'deki kart görseli: kartın renginde degrade, ad, kesim / son ödeme, kullanılabilir limit (ya da aşım), doluluk
struct KartGorseli: View {
    @EnvironmentObject private var model: Model
    let c: KartGorunumu

    var body: some View {
        let renk = model.kartRengi(c.id)
        let asim = c.limit > 0 && c.used > c.limit
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Text(c.name).font(.title3.weight(.bold))
                if let l4 = c.last4 { Text("•• \(l4)").font(.subheadline).opacity(0.75) }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text("Kesim \(c.cutoffDay)")
                    Text("Son ödeme \(c.dueDay)")
                }
                .font(.footnote.weight(.medium)).opacity(0.85)
            }
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 5, style: .continuous).fill(.white.opacity(0.35))
                    .frame(width: 34, height: 24)
                    .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(.white.opacity(0.4), lineWidth: 1))
                if asim {
                    Text("Limit aşıldı").font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.white.opacity(0.22), in: Capsule())
                }
                if let t = c.tracking, !t.autoPay, t.overdue > 0 {
                    Text("Geciken \(Bicim.tl(t.overdue, fraction: false))").font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.white.opacity(0.22), in: Capsule())
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(c.limit <= 0 ? "Kullanılan" : asim ? "Limit aşımı" : "Kullanılabilir limit").font(.footnote).opacity(0.85)
                Text(Bicim.tl(c.limit <= 0 ? c.used : asim ? c.used - c.limit : (c.available ?? 0)))
                    .font(.system(size: 28, weight: .bold)).monospacedDigit()
            }
            if c.limit > 0 {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.28))
                        Capsule().fill(.white).frame(width: max(4, g.size.width * min(c.used / c.limit, 1)))
                    }
                }
                .frame(height: 5)
            }
            HStack {
                if c.limit > 0 { Text("\(kisa(c.used)) / \(kisa(c.limit)) kullanıldı") }
                Spacer()
                if let n = c.nextPayment { Text("Son ödeme \(Bicim.day(n.date)) · \(Bicim.tl(n.amount, fraction: false))") }
            }
            .font(.caption.weight(.medium)).opacity(0.9).monospacedDigit()
        }
        .foregroundStyle(.white)
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            let sekil = RoundedRectangle(cornerRadius: Tema.yaricap, style: .continuous)
            sekil.fill(renk)
                .overlay(sekil.fill(LinearGradient(colors: [.white.opacity(0.14), .black.opacity(0.24)], startPoint: .topLeading, endPoint: .bottomTrailing)))
        }
        .shadow(color: renk.opacity(0.3), radius: 12, y: 8)
        .contentShape(RoundedRectangle(cornerRadius: Tema.yaricap, style: .continuous))
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

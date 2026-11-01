import SwiftUI

// Varlıklar: ana para birimi, döviz, gram altın, fon ve hisse (yalnızca Türkiye) bakiyeleri güncel kurla; hareketler (get_assets, list_entries)
struct VarliklarEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var adding = false

    var body: some View {
        NavigationStack {
            Okunan(tool: "get_assets") { (v: Varliklar) in
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Net varlık").font(.subheadline).foregroundStyle(.secondary)
                            Text(Bicim.tl(v.netWorthTry)).font(.largeTitle.weight(.semibold)).monospacedDigit()
                        }
                        .padding(.vertical, 4)
                        Satir(title: "Varlıklar", value: Bicim.tl(v.totalTry))
                        if v.receivablesTry > 0 { Satir(title: "Alacaklar", value: Bicim.tl(v.receivablesTry), color: Renk.gelir) }
                        if v.debtsTry > 0 { Satir(title: "Borçlar (kart dahil)", value: "−" + Bicim.tl(v.debtsTry), color: Renk.gider) }
                        if let e = v.ratesError ?? v.pricesError {
                            Text(e.hasPrefix("Current rates") ? "Güncel kurlar alınamadı; toplama yalnızca \(Bicim.homeShort) girdi." : "Bazı fon / hisse fiyatları alınamadı.")
                                .font(.caption).foregroundStyle(Renk.uyari)
                        }
                    }

                    Section("Varlığın seyri") { VarlikSeyriKarti() }

                    Section("Bakiyeler") {
                        ForEach(v.assets.filter { $0.balance != 0 || $0.asset == Bicim.home }, id: \.self) { a in
                            HStack {
                                Text(a.name)
                                Spacer()
                                VStack(alignment: .trailing) {
                                    Text(Bicim.amount(a.balance, asset: a.asset)).monospacedDigit()
                                        .foregroundStyle(a.balance < 0 ? Renk.gider : .primary)
                                    if a.asset != Bicim.home, let t = a.tryValue {
                                        Text(Bicim.tl(t)).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                        ForEach(v.holdings, id: \.self) { h in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(h.ticker)
                                    if let n = h.name { Text(n).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                                }
                                Spacer()
                                VStack(alignment: .trailing) {
                                    Text(h.tryValue.map { Bicim.tl($0) } ?? "fiyat yok").monospacedDigit()
                                    HStack(spacing: 4) {
                                        Text(Bicim.amount(h.units, asset: h.asset))
                                        if let p = h.profitPct { Text(Bicim.percent(p)).foregroundStyle(p >= 0 ? Renk.gelir : Renk.gider) }
                                    }
                                    .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }

                    if let r = v.rates {
                        let kodlar = v.assets.map(\.asset).filter { $0 != Bicim.home && r.values[$0] != nil }
                        if !kodlar.isEmpty {
                            Section("Kurlar") {
                                ForEach(kodlar, id: \.self) { k in
                                    Satir(title: v.assets.first { $0.asset == k }?.name ?? k, value: Bicim.tl(r.values[k] ?? 0))
                                }
                            }
                        }
                    }

                    Section("Hareketler") { HareketListesiBolumu() }
                }
            }
            .navigationTitle("Varlıklar")
            .yenilenebilir(model)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Hareket ekle")
                }
            }
            .sheet(isPresented: $adding) { HareketFormu() }
        }
    }
}

struct HareketListesiBolumu: View {
    @EnvironmentObject private var model: Model

    var body: some View {
        Okunan(tool: "list_entries", args: ["limit": 200]) { (l: HareketListesi) in
            if l.entries.isEmpty { Text("Hareket yok").foregroundStyle(.secondary) }
            ForEach(l.entries) { e in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.description.isEmpty ? e.asset : e.description).lineLimit(1)
                        Text([Bicim.day(e.date), e.repeat?.label, e.person].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text((e.direction == "in" ? "+" : "−") + Bicim.amount(e.amount, asset: e.asset))
                        .monospacedDigit()
                        .foregroundStyle(e.direction == "in" ? Renk.gelir : Renk.gider)
                }
            }
            .onDelete { idx in
                for i in idx { try? model.write("delete_entry", ["id": l.entries[i].id]) }
            }
        }
    }
}

// Yeni varlık hareketi (add_entry): maaş, döviz / altın alışı, fon / hisse alış ve satışı
struct HareketFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    @State private var kind = Bicim.home     // ana para birimi, diğer para birimleri, GAU, FON, BIST
    @State private var ticker = ""
    @State private var direction = "in"
    @State private var amount = ""
    @State private var desc = ""
    @State private var date = Date()
    @State private var monthly = false
    @State private var settle = false
    @State private var price = ""
    @State private var person = ""
    @State private var people: [Kisi] = []
    @State private var error: String?
    @State private var saving = false

    private var market: Bool { kind == "FON" || kind == "BIST" }
    private var asset: String { market ? "\(kind):\(ticker.trimmingCharacters(in: .whitespaces).uppercased())" : kind }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Varlık", selection: $kind) {
                        ForEach(model.constants?.assets ?? []) { a in Text(a.name).tag(a.code) }
                        if model.marketsAllowed {
                            Text("Fon (TEFAS)").tag("FON")
                            Text("Hisse (BIST)").tag("BIST")
                        }
                        Section("Diğer para birimleri") {
                            ForEach((model.constants?.currencies ?? []).filter { c in !(model.constants?.assets ?? []).contains { $0.code == c.code } }) { c in
                                Text(c.name).tag(c.code)
                            }
                        }
                    }
                    if market {
                        TextField(kind == "FON" ? "Fon kodu (ör. AFT)" : "İşlem kodu (ör. THYAO)", text: $ticker)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    }
                    Picker("Yön", selection: $direction) {
                        Text(market ? "Alış" : "Giriş").tag("in")
                        Text(market ? "Satış" : "Çıkış").tag("out")
                    }
                    .pickerStyle(.segmented)
                    TextField(market ? "Adet" : kind == "GAU" ? "Gram" : "Tutar (\(kind))", text: $amount).keyboardType(.decimalPad)
                    TextField(market ? "Açıklama (isteğe bağlı)" : "Açıklama (ör. Maaş)", text: $desc)
                    DatePicker("Tarih", selection: $date, displayedComponents: .date).environment(\.locale, Bicim.locale)
                    if people.count > 1 {
                        Picker("Kişi", selection: $person) { ForEach(people) { Text($0.name).tag($0.id) } }
                    }
                }
                if kind == Bicim.home || (!market && !settle) {
                    Section { Toggle("Her ay tekrarla", isOn: $monthly) }
                }
                if kind != Bicim.home {
                    Section {
                        if !market {
                            Toggle(direction == "in" ? "\(Bicim.homeShort) ile alındı" : "\(Bicim.homeShort) karşılığı satıldı", isOn: $settle)
                        }
                        if market || settle {
                            TextField(market ? "Birim fiyat (\(Bicim.homeSymbol), boşsa bugünkü)" : "Kur (\(Bicim.homeSymbol), boşsa bugünkü)", text: $price).keyboardType(.decimalPad)
                        }
                    } footer: {
                        Text(market
                             ? "Fiyat varsa tutar \(Bicim.homeShort) bakiyesinden düşer (alış) ya da ona eklenir (satış)."
                             : "\(Bicim.homeShort) ile alınan döviz ve altın gelir sayılmaz: tutar \(Bicim.homeShort) bakiyesinden düşer.")
                    }
                }
                HataMetni(text: error)
            }
            .navigationTitle("Hareket ekle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Kaydet") { Task { await save() } }.disabled(!valid || saving)
                }
            }
            .onAppear {
                people = (try? model.read("list_people") as KisiListesi)?.people ?? []
                if person.isEmpty { person = people.first?.id ?? "ben" }
            }
        }
    }

    private var valid: Bool {
        (Bicim.parse(amount) ?? 0) > 0 && (market ? !ticker.trimmingCharacters(in: .whitespaces).isEmpty : !desc.trimmingCharacters(in: .whitespaces).isEmpty || settle)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var a: [String: Any] = [
            "asset": asset, "direction": direction, "amount": Bicim.parse(amount) ?? 0,
            "description": desc.trimmingCharacters(in: .whitespaces), "date": Bicim.key(date), "person": person,
        ]
        if monthly && (kind == Bicim.home || (!market && !settle)) { a["repeat"] = 0 }
        if !market && kind != Bicim.home { a["settle"] = settle }
        if let p = Bicim.parse(price), p > 0, market || settle { a["price"] = p }
        // Fon / hisse kodu ve bugünkü fiyatı Worker'dan (add_entry kodu bunlarla doğrular)
        if market { await model.fetchPrices([asset]) }
        do {
            try model.write("add_entry", a)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

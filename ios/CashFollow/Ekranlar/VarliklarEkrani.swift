import SwiftUI

// Varlıklar: ana para birimi, döviz, gram altın, fon ve hisse (yalnızca Türkiye) bakiyeleri güncel kurla; hareketler
// (get_assets, list_entries; web'deki Varlıklar sekmesi)
struct VarliklarEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var adding = false

    var body: some View {
        NavigationStack {
            Okunan(tool: "get_assets") { (v: Varliklar) in
                Sayfa {
                    ustKart(v)
                    VarlikSeyriKarti()
                    let bakiyeler = v.assets.filter { $0.balance != 0 || $0.asset == Bicim.home }
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                        ForEach(bakiyeler, id: \.self) { a in varlikKutusu(a) }
                        if v.receivablesTry > 0.004 {
                            kutu(simge: "⇄", ad: "Alacak", deger: Bicim.tl(v.receivablesTry), alt: "kart payları · borç verdiklerin")
                        }
                    }
                    if model.marketsAllowed || !v.holdings.isEmpty {
                        BolumBasligi(baslik: "Fon ve hisse")
                        Kart(dolgu: 14) {
                            if v.holdings.isEmpty {
                                Text("TEFAS fonlarını ve Borsa İstanbul hisselerini adetiyle ekle; güncel fiyatla \(Bicim.homeShort) karşılığını görürsün.")
                                    .font(.subheadline).foregroundStyle(Tema.metin3)
                            }
                            SatirListesi(veri: v.holdings) { h in pozisyon(h) }
                        }
                    }
                    if let e = v.ratesError ?? v.pricesError {
                        Text(e.hasPrefix("Current rates") ? "Güncel kurlar alınamadı; toplama yalnızca \(Bicim.homeShort) girdi." : "Bazı fon / hisse fiyatları alınamadı.")
                            .font(.footnote).foregroundStyle(Tema.uyari)
                    }
                    BolumBasligi(baslik: "Hareketler")
                    HareketListesiBolumu()
                }
            }
            .navigationTitle("Varlıklar")
            .sayfaZemini()
            .yenilenebilir(model)
            .yuzenDugme("Hareket ekle") { adding = true }
            .sheet(isPresented: $adding) { HareketFormu() }
        }
    }

    // Varlık: büyük tutar, özvarlık + borç, öne çıkan kurlar
    private func ustKart(_ v: Varliklar) -> some View {
        Kart {
            HStack {
                Text("Varlık").font(.subheadline).foregroundStyle(Tema.metin2)
                Spacer()
                if let t = v.rates?.updatedAt, let d = ISO8601DateFormatter().date(from: t) {
                    Text("Kur \(d.formatted(Bicim.tarih.hour().minute()))").font(.footnote).foregroundStyle(Tema.metin3)
                }
            }
            BuyukTutar(deger: v.totalAssetsTry)
            Text("= Özvarlık \(Bicim.tl(v.netWorthTry, fraction: false)) + Borç \(Bicim.tl(v.debtsTry, fraction: false))"
                 + (v.receivablesTry > 0.004 ? " · \(Bicim.tl(v.receivablesTry, fraction: false)) alacak dahil" : ""))
                .font(.footnote).foregroundStyle(Tema.metin2).monospacedDigit()
            if let r = v.rates {
                let kodlar = ["USD", "EUR", "GAU", "GBP", "TRY"].filter { $0 != Bicim.home && r.values[$0] != nil }.prefix(3)
                if !kodlar.isEmpty {
                    Ayirici()
                    IstatistikSatiri(ogeler: kodlar.map { k in
                        Istatistik(etiket: ad(k, v), deger: Bicim.tl(r.values[k] ?? 0))
                    })
                }
            }
        }
    }

    private func ad(_ kod: String, _ v: Varliklar) -> String {
        if kod == "GAU" { return "Gram altın" }
        return model.constants?.currencies.first { $0.code == kod }?.name ?? v.assets.first { $0.asset == kod }?.name ?? kod
    }

    private func varlikKutusu(_ a: Varliklar.Bakiye) -> some View {
        let simge = a.asset == "GAU" ? "gr" : (model.constants?.currencies.first { $0.code == a.asset }?.symbol ?? String(a.asset.prefix(1)))
        return kutu(simge: simge, ad: a.name, deger: Bicim.amount(a.balance, asset: a.asset),
                    alt: a.asset != Bicim.home ? a.tryValue.map { "≈ " + Bicim.tl($0) } : nil,
                    renk: a.balance < 0 ? Tema.tehlike : Tema.metin)
    }

    private func kutu(simge: String, ad: String, deger: String, alt: String?, renk: Color = Tema.metin) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(simge).font(.footnote.weight(.bold)).foregroundStyle(Tema.metin2)
                    .frame(width: 28, height: 28)
                    .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text(ad).font(.subheadline.weight(.semibold)).lineLimit(1)
            }
            Text(deger).font(.system(size: 19, weight: .bold)).foregroundStyle(renk).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(alt ?? " ").font(.footnote).foregroundStyle(Tema.metin3).lineLimit(1).monospacedDigit()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.05), radius: 10, y: 6)
    }

    private func pozisyon(_ h: Varliklar.Pozisyon) -> some View {
        HStack(spacing: 12) {
            Text(String(h.ticker.prefix(3))).font(.caption.weight(.bold)).foregroundStyle(Tema.metin2)
                .frame(width: 36, height: 36)
                .background(Tema.yuzey2, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(h.ticker).font(.body.weight(.semibold))
                if let n = h.name { Text(n).font(.footnote).foregroundStyle(Tema.metin3).lineLimit(1) }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(h.tryValue.map { Bicim.tl($0) } ?? "fiyat yok").font(.body.weight(.semibold)).monospacedDigit()
                HStack(spacing: 4) {
                    Text(Bicim.amount(h.units, asset: h.asset))
                    if let p = h.profitPct { Text(Bicim.percent(p)).foregroundStyle(p >= 0 ? Tema.iyi : Tema.tehlike) }
                }
                .font(.footnote).foregroundStyle(Tema.metin3)
            }
        }
    }
}

// Hareketler: kişinin baş harfi, açıklama, varlık · tarih · tekrar, tutar (web'deki gibi)
struct HareketListesiBolumu: View {
    @EnvironmentObject private var model: Model
    @State private var silinecek: Hareket?

    var body: some View {
        Okunan(tool: "list_entries", args: ["limit": 200]) { (l: HareketListesi) in
            Kart(dolgu: 14) {
                if l.entries.isEmpty { Text("Hareket yok").foregroundStyle(Tema.metin3) }
                SatirListesi(veri: l.entries) { e in
                    HStack(alignment: .top, spacing: 12) {
                        Avatar(ad: e.person, renk: model.kisiRengi(e.person))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(e.description.isEmpty ? e.asset : e.description).font(.body.weight(.semibold)).lineLimit(1)
                            Text([Bicim.day(e.date), e.repeat?.label].compactMap { $0 }.joined(separator: " · "))
                                .font(.footnote).foregroundStyle(Tema.metin3)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            Text((e.direction == "in" ? "+" : "−") + Bicim.amount(e.amount, asset: e.asset) + (e.repeat != nil ? "/ay" : ""))
                                .font(.body.weight(.semibold)).monospacedDigit()
                                .foregroundStyle(e.direction == "in" ? Tema.iyi : Tema.tehlike)
                            if let n = e.repeat?.nextDate {
                                Text("sonraki \(Bicim.day(n))").font(.footnote).foregroundStyle(Tema.metin3)
                            }
                        }
                    }
                    .contentShape(Rectangle())
                    .contextMenu {
                        Button("Sil", systemImage: "trash", role: .destructive) { silinecek = e }
                    }
                }
            }
            .confirmationDialog(silinecek.map { "\($0.description.isEmpty ? $0.asset : $0.description) silinsin mi?" } ?? "",
                                isPresented: Binding(get: { silinecek != nil }, set: { if !$0 { silinecek = nil } }), titleVisibility: .visible) {
                Button("Sil", role: .destructive) {
                    if let e = silinecek { try? model.write("delete_entry", ["id": e.id]) }
                    silinecek = nil
                }
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

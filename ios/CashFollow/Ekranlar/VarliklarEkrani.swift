import SwiftUI

// Varlıklar: ana para birimi, döviz, gram altın, fon ve hisse (yalnızca Türkiye) bakiyeleri güncel kurla; hareketler
// (get_assets, list_entries; web'deki Varlıklar sekmesi)
struct VarliklarEkrani: View {
    @EnvironmentObject private var model: Model

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
                    if !v.holdings.isEmpty {
                        BolumBasligi(baslik: "Fon ve hisse")
                        Kart(dolgu: 14) {
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
            .ekleDugmesi(.varlik)
        }
    }

    // Varlıkların: büyük tutar, borçlar ve borçlar düşünce kalan, bugünkü kurlar
    private func ustKart(_ v: Varliklar) -> some View {
        Kart {
            HStack {
                Text("Varlıkların").font(.subheadline).foregroundStyle(Tema.metin2)
                Spacer()
                if let t = v.rates?.updatedAt, let d = ISO8601DateFormatter().date(from: t) {
                    Text("Kur \(d.formatted(Bicim.tarih.hour().minute()))").font(.footnote).foregroundStyle(Tema.metin3)
                }
            }
            BuyukTutar(deger: v.totalAssetsTry)
            Ayirici()
            IstatistikSatiri(ogeler: [
                Istatistik(etiket: "Borçların", deger: Bicim.tl(v.debtsTry, fraction: false), renk: v.debtsTry > 0 ? Tema.tehlike : Tema.metin),
                Istatistik(etiket: "Borçlar düşünce", deger: Bicim.tl(v.netWorthTry, fraction: false)),
            ])
            if let r = v.rates {
                let kodlar = ["USD", "EUR", "GAU", "GBP", "TRY"].filter { $0 != Bicim.home && r.values[$0] != nil }.prefix(3)
                if !kodlar.isEmpty {
                    Ayirici()
                    Text("Bugünkü kurlar").font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3)
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
    @State private var duzenle: Hareket?
    @State private var hepsi = false

    var body: some View {
        Okunan(tool: "list_entries", args: ["limit": hepsi ? 500 : 11], key: "\(hepsi)") { (l: HareketListesi) in
            Kart(dolgu: 14) {
                if l.entries.isEmpty { Text("Hareket yok").foregroundStyle(Tema.metin3) }
                SatirListesi(veri: hepsi ? l.entries : Array(l.entries.prefix(10))) { e in
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
                    .onTapGesture { duzenle = e }
                    .contextMenu {
                        Button("Düzenle", systemImage: "pencil") { duzenle = e }
                        Button("Sil", systemImage: "trash", role: .destructive) { silinecek = e }
                    }
                }
                if !hepsi && l.entries.count > 10 {
                    Ayirici()
                    Button("Tümünü göster") { hepsi = true }
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin2)
                        .frame(maxWidth: .infinity).padding(.top, 4)
                }
            }
            .sheet(item: $duzenle) { HareketFormu(duzenle: $0) }
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

// Varlık hareketinin türü: + düğmesinin menüsünden; her biri kendi sade formuyla
enum HareketTuru: String, Identifiable, CaseIterable {
    case gelir, gider, doviz, piyasa
    var id: String { rawValue }
    var baslik: String {
        switch self {
        case .gelir: return "Gelir"
        case .gider: return "Nakit gider"
        case .doviz: return "Döviz / altın"
        case .piyasa: return "Fon / hisse"
        }
    }
    var simge: String {
        switch self {
        case .gelir: return "arrow.down.circle"
        case .gider: return "arrow.up.circle"
        case .doviz: return "dollarsign.circle"
        case .piyasa: return "chart.line.uptrend.xyaxis"
        }
    }
}

// Varlık hareketi ekleme (add_entry) ve düzenleme (update_entry): gelir (maaş), nakit gider, döviz / altın alış-satış,
// fon / hisse alış-satış
struct HareketFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    var tur: HareketTuru = .gelir
    var duzenle: Hareket? = nil
    @State private var yuklendi = false
    @State private var kind = Bicim.home     // ana para birimi, diğer para birimleri, GAU, FON, BIST
    @State private var ticker = ""
    @State private var direction = "in"
    @State private var amount = ""
    @State private var desc = ""
    @State private var date = Date()
    @State private var monthly = false
    @State private var settle = true
    @State private var price = ""
    @State private var person = ""
    @State private var people: [Kisi] = []
    @State private var error: String?
    @State private var saving = false

    private var market: Bool { kind == "FON" || kind == "BIST" }
    private var asset: String { market ? "\(kind):\(ticker.trimmingCharacters(in: .whitespaces).uppercased())" : kind }
    private var gercekTur: HareketTuru {
        if market { return .piyasa }
        if kind != Bicim.home { return .doviz }
        return tur == .gider || (duzenle != nil && direction == "out") ? .gider : .gelir
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    switch gercekTur {
                    case .gelir, .gider:
                        TextField("Tutar (\(Bicim.homeSymbol))", text: $amount).keyboardType(.decimalPad)
                        TextField(gercekTur == .gelir ? "Ne geliri? (ör. Maaş)" : "Ne için? (ör. Kira)", text: $desc)
                    case .doviz:
                        Picker("Hangisi", selection: $kind) {
                            ForEach(dovizler) { a in Text(a.name).tag(a.code) }
                        }
                        Picker("İşlem", selection: $direction) {
                            Text("Aldım").tag("in")
                            Text("Sattım").tag("out")
                        }
                        .pickerStyle(.segmented)
                        TextField(kind == "GAU" ? "Kaç gram" : "Ne kadar (\(kind))", text: $amount).keyboardType(.decimalPad)
                        TextField("Açıklama (isteğe bağlı)", text: $desc)
                    case .piyasa:
                        Picker("Tür", selection: $kind) {
                            Text("Fon (TEFAS)").tag("FON")
                            Text("Hisse (BIST)").tag("BIST")
                        }
                        .pickerStyle(.segmented)
                        TextField(kind == "FON" ? "Fon kodu (ör. AFT)" : "İşlem kodu (ör. THYAO)", text: $ticker)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        Picker("İşlem", selection: $direction) {
                            Text("Alış").tag("in")
                            Text("Satış").tag("out")
                        }
                        .pickerStyle(.segmented)
                        TextField("Adet", text: $amount).keyboardType(.decimalPad)
                        TextField("Birim fiyat (\(Bicim.homeSymbol), boşsa bugünkü)", text: $price).keyboardType(.decimalPad)
                    }
                    DatePicker("Tarih", selection: $date, displayedComponents: .date).environment(\.locale, Bicim.locale)
                    if people.count > 1 {
                        Picker("Kimin", selection: $person) { ForEach(people) { Text($0.name).tag($0.id) } }
                    }
                }
                if (gercekTur == .gelir || gercekTur == .gider) && duzenle?.repeat == nil {
                    Section {
                        Toggle("Her ay tekrarla", isOn: $monthly)
                    } footer: {
                        Text(gercekTur == .gelir ? "Maaş gibi düzenli gelirler her ay Nakit grafiğine girer." : "Kartla ödenen harcamaları Harcamalar'dan ekle; burası nakit ödemeler için.")
                    }
                }
                if gercekTur == .doviz {
                    Section {
                        Toggle(direction == "in" ? "Parasını \(Bicim.homeShort) bakiyemden ödedim" : "Karşılığı \(Bicim.homeShort) bakiyeme geçti", isOn: $settle)
                        if settle {
                            TextField("Kur (\(Bicim.homeSymbol), boşsa bugünkü)", text: $price).keyboardType(.decimalPad)
                        }
                    } footer: {
                        Text(settle
                             ? (direction == "in" ? "Gelir sayılmaz; paran \(Bicim.homeShort)'den dövize / altına geçer." : "Gelir sayılmaz; paran dövizden / altından \(Bicim.homeShort)'ye geçer.")
                             : "Kapalıysa \(Bicim.homeShort) ödemeden gelen ya da giden miktar (hediye, döviz maaş).")
                    }
                }
                HataMetni(text: error)
                Section {
                    AltKaydet(eksik: eksik) { Task { await save() } }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
            }
            .tint(Tema.metin)
            .navigationTitle(duzenle == nil ? gercekTur.baslik : "Hareketi düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Kaydet") { Task { await save() } }.fontWeight(.semibold).disabled(!valid || saving)
                }
            }
            .onAppear(perform: hazirla)
        }
    }

    private var dovizler: [Sabitler.Varlik] {
        let tum = (model.constants?.assets ?? []) + (model.constants?.currencies ?? [])
        var seen = Set<String>()
        return tum.filter { $0.code != Bicim.home && seen.insert($0.code).inserted }
    }

    private func hazirla() {
        people = (try? model.read("list_people") as KisiListesi)?.people ?? []
        if person.isEmpty { person = people.first?.id ?? "ben" }
        guard !yuklendi else { return }
        yuklendi = true
        if let e = duzenle {
            if e.asset.hasPrefix("FON:") || e.asset.hasPrefix("BIST:") {
                kind = String(e.asset.split(separator: ":")[0])
                ticker = String(e.asset.split(separator: ":").last ?? "")
            } else {
                kind = e.asset
            }
            direction = e.direction
            amount = e.amount.formatted(.number.locale(Bicim.locale).grouping(.never).precision(.fractionLength(0...4)))
            desc = e.description
            date = Bicim.date(e.date) ?? Date()
            monthly = e.repeat != nil
            settle = e.settledInTry ?? false
            if let p = e.price { price = p.formatted(.number.locale(Bicim.locale).grouping(.never).precision(.fractionLength(0...4))) }
            if let p = people.first(where: { $0.name == e.person }) { person = p.id }
            return
        }
        switch tur {
        case .gelir: direction = "in"
        case .gider: direction = "out"
        case .doviz: kind = dovizler.first?.code ?? "USD"
        case .piyasa: kind = "FON"
        }
    }

    private var valid: Bool { eksik == nil }

    // Kaydetmek için ne eksik (alttaki düğmede yazar)
    private var eksik: String? {
        if gercekTur == .piyasa && ticker.trimmingCharacters(in: .whitespaces).isEmpty { return kind == "FON" ? "Fon kodunu yaz" : "Hisse kodunu yaz" }
        if (Bicim.parse(amount) ?? 0) <= 0 { return gercekTur == .piyasa ? "Adedi yaz" : "Tutarı yaz" }
        if (gercekTur == .gelir || gercekTur == .gider) && desc.trimmingCharacters(in: .whitespaces).isEmpty { return "Açıklamayı yaz" }
        return nil
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var a: [String: Any] = [
            "asset": asset, "direction": direction, "amount": Bicim.parse(amount) ?? 0,
            "description": desc.trimmingCharacters(in: .whitespaces), "date": Bicim.key(date), "person": person,
        ]
        let tekrarlanabilir = gercekTur == .gelir || gercekTur == .gider
        if tekrarlanabilir && monthly && duzenle?.repeat == nil { a["repeat"] = 0 }
        if gercekTur == .doviz { a["settle"] = settle }
        if let p = Bicim.parse(price), p > 0, market || (gercekTur == .doviz && settle) { a["price"] = p }
        // Fon / hisse kodu ve bugünkü fiyatı Worker'dan (add_entry kodu bunlarla doğrular)
        if market { await model.fetchPrices([asset]) }
        do {
            if let e = duzenle { a["id"] = e.id; try model.write("update_entry", a) } else { try model.write("add_entry", a) }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

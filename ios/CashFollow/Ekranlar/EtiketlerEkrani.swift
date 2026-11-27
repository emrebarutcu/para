import SwiftUI
import UniformTypeIdentifiers

// Etiketler (Harcamalar → Etiketler; list_tags): her etiketin harcama sayısı, tarih aralığı ve toplam maliyeti
// (taksitlerin hepsi, gelecektekiler dahil; döviz bugünkü kurla). Dokununca etiket raporu (tag_summary): toplam ve
// harcamalar herkese açık; ödenen / kalan, son ödeme ve kategoriye, kişiye, karta göre dağılım Premium (tag_report
// kilidi). Ücretsiz sürümde en fazla Abonelik.ucretsizEtiket farklı etiket (formda, tags kilidi). Web: Harcamalar →
// Etiketler; kurallar icgoru.js tagList / tagSummary, ad ve kimlik tablo.js tags / tagKey.

// Etiketin adı ve kimliği (tablo.js tagName / tagKey ile aynı kural): baştaki # ve virgül atılır, boşluklar teke iner,
// en fazla 40 harf; büyük / küçük harf ve Türkçe İ / ı ile İngilizce I / i farkı aynı etiket sayılır
enum Etiket {
    static let enFazla = 10     // harcama başına (tablo.js MAX_TAGS)
    static let uzunluk = 40     // tablo.js TAG_LEN

    static func ad(_ s: String) -> String? {
        var t = s.replacingOccurrences(of: "[,\\n\\r\\t]+", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        while t.hasPrefix("#") { t.removeFirst() }
        t = t.trimmingCharacters(in: .whitespaces)
        if t.count > uzunluk { t = String(t.prefix(uzunluk)).trimmingCharacters(in: .whitespaces) }
        return t.isEmpty ? nil : t
    }

    static func anahtar(_ s: String) -> String {
        (ad(s) ?? "").lowercased(with: Locale(identifier: "tr_TR"))
            .replacingOccurrences(of: "ı", with: "i").replacingOccurrences(of: "\u{0307}", with: "")
    }

    // "3–10 Mar 2026"; tek gün ya da yoksa o gün / nil
    static func tarihler(_ ilk: String?, _ son: String?) -> String? {
        guard let ilk else { return nil }
        guard let son, son != ilk else { return Bicim.day(ilk) }
        return "\(Bicim.day(ilk)) – \(Bicim.day(son))"
    }
}

// Harcamalar'ın Etiketler görünümünden rapora gidiş
struct EtiketHedefi: Hashable { let ad: String }

struct EtiketlerKarti: View {
    let etiketler: [EtiketListesi.Etiket]

    var body: some View {
        if etiketler.isEmpty {
            Kart {
                KartBasligi(L("Etiketler"))
                Text(L("Bir gezinin, düğünün ya da tadilatın harcamalarını bir arada görmek için harcamaya etiket ekle (harcama formunda Etiketler). Sonra burada toplam maliyetini görürsün."))
                    .font(.subheadline).foregroundStyle(Tema.metin3)
            }
        } else {
            Kart(dolgu: 14) {
                SatirListesi(veri: etiketler) { t in
                    NavigationLink(value: EtiketHedefi(ad: t.tag)) { satir(t) }.buttonStyle(.plain)
                }
            }
        }
    }

    private func satir(_ t: EtiketListesi.Etiket) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "tag").font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin2)
                .frame(width: 36, height: 36).background(Tema.yuzey2, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text("#" + t.tag).font(.body.weight(.semibold)).foregroundStyle(Tema.metin).lineLimit(1)
                Text([L("{0} harcama", t.purchases), Etiket.tarihler(t.firstPurchase, t.lastPurchase)].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(Tema.metin3).lineLimit(1)
                if let g = t.travelMode, g.on {
                    Label(L("Gezi modu · {0}", Bicim.day(g.until)), systemImage: "airplane").font(.caption.weight(.semibold)).foregroundStyle(Tema.metin2)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(Bicim.tl(t.total)).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(Tema.metin)
                if let b = t.budget {
                    Text(L("bütçe {0}", Bicim.tl(b))).font(.caption).monospacedDigit().foregroundStyle(t.total > b + 0.004 ? Tema.tehlike : Tema.metin3)
                }
            }
        }
        .contentShape(Rectangle())
    }
}

// Bir etiketin raporu: "Maldivler bize kaça mal oldu?" Sağ üstteki menü (Aşama 2–3): tarih aralığından harcama
// ekleme, bütçe, gezi modu, yeniden adlandırma / birleştirme, CSV paylaşma (Premium; kilitliyse ödeme ekranı) ve silme
// (herkese açık: etiket kalkar, harcamalar kalır). Araçlar asistanınkilerle aynı: tag_purchases, set_tag, rename_tag,
// delete_tag.
struct EtiketRaporuEkrani: View {
    @EnvironmentObject private var model: Model
    @EnvironmentObject private var abonelik: Abonelik
    @Environment(\.dismiss) private var dismiss
    @State private var ad: String                 // yeniden adlandırılınca yeni adla okunur
    @State private var odeme: String?              // kilitli araçtan açılan ödeme ekranının nedeni
    @State private var toplu = false
    @State private var gezi = false
    @State private var butceAcik = false
    @State private var butceMetni = ""
    @State private var adAcik = false
    @State private var yeniAd = ""
    @State private var silinsin = false
    @State private var hata: String?

    init(etiket: String) { _ad = State(initialValue: etiket) }

    var body: some View {
        Okunan(tool: "tag_summary", args: ["tag": ad], key: ad) { (r: EtiketRaporu) in
            Sayfa {
                Kart {
                    Text(L("Toplam maliyet")).font(.subheadline.weight(.medium)).foregroundStyle(Tema.metin2)
                    BuyukTutar(deger: r.total, boyut: 40)
                    Text([L("{0} harcama", r.purchases), Etiket.tarihler(r.firstPurchase, r.lastPurchase)].compactMap { $0 }.joined(separator: " · "))
                        .font(.footnote).foregroundStyle(Tema.metin3)
                    if r.byCurrency.contains(where: { $0.asset != Bicim.home }) {
                        Text(r.byCurrency.map { Bicim.amount($0.amount, asset: $0.asset) }.joined(separator: " + ") + " · " + L("döviz ve altın bugünkü kurla"))
                            .font(.footnote).foregroundStyle(Tema.metin3)
                    }
                    if let m = r.missingRates, m > 0 {
                        Text(L("Kuru alınamayan {0} harcama toplama girmedi.", m)).font(.footnote).foregroundStyle(Tema.metin3)
                    }
                }
                if abonelik.premium, r.budget != nil || r.travelMode != nil { planKarti(r) }
                if abonelik.premium {
                    if r.purchases > 0 {
                        Kart {
                            Doluluk(used: r.paid, limit: max(r.total, 0.01), renk: Tema.metin, erisim: L("Ödenen {0}", Bicim.tl(r.paid)))
                            HStack {
                                Text(L("Ödenen {0}", Bicim.tl(r.paid)))
                                Spacer(minLength: 8)
                                Text(L("Kalan {0}", Bicim.tl(r.left)))
                            }
                            .font(.subheadline.weight(.semibold)).monospacedDigit()
                            if r.left > 0.004, let s = r.lastPayment {
                                Text(L("Son ödeme: {0}", Bicim.month(String(s.prefix(7))))).font(.footnote).foregroundStyle(Tema.metin3)
                            }
                            if let g = r.perDay, let d = r.days, d > 1 {
                                Text(L("Günde ortalama {0} ({1} gün)", Bicim.tl(g), d)).font(.footnote).foregroundStyle(Tema.metin3)
                            }
                        }
                        dagilim(L("Kategoriye göre"), r.byCategory)
                        if r.byPerson.count > 1 { dagilim(L("Kişiye göre"), r.byPerson) }
                        dagilim(L("Karta göre"), r.byCard)
                    }
                } else {
                    PremiumKilidi(baslik: L("Etiketin raporu"),
                                  aciklama: L("Ne kadarı ödendi, ne kadar kaldı, son taksit hangi ay; kategoriye, kişiye ve karta göre dağılım."),
                                  neden: "tag_report")
                }
                if !r.list.isEmpty {
                    BolumBasligi(baslik: L("Harcamalar"))
                    Kart(dolgu: 14) {
                        SatirListesi(veri: r.list) { p in
                            NavigationLink(value: p.id) { satir(p) }.buttonStyle(.plain)
                        }
                    }
                }
                HataMetni(text: hata)
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { menu(r) } }
            .sheet(isPresented: $toplu) { EtiketTopluEkle(etiket: r.tag, ilk: r.firstPurchase, son: r.lastPurchase) }
            .sheet(isPresented: $gezi) { GeziModuFormu(etiket: r.tag, mod: r.travelMode) }
        }
        .navigationTitle("#" + ad)
        .navigationBarTitleDisplayMode(.inline)
        .sayfaZemini()
        .onAppear { Analitik.olay("tag_report_viewed", ["locked": !abonelik.premium]) }
        .sheet(item: Binding(get: { odeme.map(OdemeNedeni.init) }, set: { odeme = $0?.id })) { PremiumEkrani(neden: $0.id) }
        .alert(L("Bütçe"), isPresented: $butceAcik) {
            TextField(L("ör. {0}", Bicim.tl(150000, fraction: false)), text: $butceMetni).keyboardType(.decimalPad)
            Button(L("Kaydet")) { ayarla(["budget": Bicim.parse(butceMetni).map { $0 as Any } ?? NSNull()]) }
            Button(L("Bütçeyi kaldır"), role: .destructive) { ayarla(["budget": NSNull()]) }
            Button(L("Vazgeç"), role: .cancel) {}
        } message: {
            Text(L("Etiketin harcamaları (bütün taksitler) bu tutarla karşılaştırılır; yaklaşınca ve aşılınca uyarılırsın."))
        }
        .alert(L("Yeniden adlandır"), isPresented: $adAcik) {
            TextField(L("Yeni ad"), text: $yeniAd)
            Button(L("Kaydet")) { yenidenAdlandir() }
            Button(L("Vazgeç"), role: .cancel) {}
        } message: {
            Text(L("Başka bir etiketin adını yazarsan ikisi birleşir."))
        }
        .confirmationDialog(L("#{0} etiketi silinsin mi?", ad), isPresented: $silinsin, titleVisibility: .visible) {
            Button(L("Etiketi sil"), role: .destructive) { sil() }
        } message: {
            Text(L("Etiket bütün harcamalardan kalkar; harcamalar durur."))
        }
    }

    // Ödeme ekranını açan kilit (sheet(item:) için)
    private struct OdemeNedeni: Identifiable { let id: String }

    private func menu(_ r: EtiketRaporu) -> some View {
        Menu {
            Button(L("Harcama ekle"), systemImage: "plus.circle") { premium("tag_manage") { toplu = true } }
            Button(L("Bütçe"), systemImage: "target") {
                premium("tag_budget") {
                    butceMetni = r.budget.map { $0.formatted(.number.locale(Bicim.locale).grouping(.never).precision(.fractionLength(0...2))) } ?? ""
                    butceAcik = true
                }
            }
            Button(L("Gezi modu"), systemImage: "airplane") { premium("tag_active") { gezi = true } }
            Button(L("Yeniden adlandır"), systemImage: "pencil") { premium("tag_manage") { yeniAd = r.tag; adAcik = true } }
            if abonelik.premium, !r.list.isEmpty {
                ShareLink(item: EtiketCSV(ad: r.tag, metin: csv(r)), preview: SharePreview("\(r.tag).csv")) {
                    Label(L("CSV olarak paylaş"), systemImage: "square.and.arrow.up")
                }
            } else if !r.list.isEmpty {
                Button(L("CSV olarak paylaş"), systemImage: "square.and.arrow.up") { odeme = "tag_manage" }
            }
            Divider()
            Button(L("Etiketi sil"), systemImage: "trash", role: .destructive) { silinsin = true }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel(L("Etiketi yönet"))
    }

    // Premium'da işi yapar; değilse o kilidin ödeme ekranı
    private func premium(_ neden: String, _ isi: () -> Void) {
        if abonelik.premium { isi() } else { odeme = neden }
    }

    // Bütçe ve gezi modu
    private func planKarti(_ r: EtiketRaporu) -> some View {
        Kart {
            if let b = r.budget {
                let asildi = (r.budgetLeft ?? 0) < -0.004
                Doluluk(used: min(r.total, b), limit: b, renk: asildi ? Tema.tehlike : Tema.metin, erisim: L("Bütçe {0}", Bicim.tl(b)))
                HStack {
                    Text(L("Bütçe {0}", Bicim.tl(b)))
                    Spacer(minLength: 8)
                    Text(asildi ? L("{0} aşıldı", Bicim.tl(-(r.budgetLeft ?? 0))) : L("Kalan {0}", Bicim.tl(r.budgetLeft ?? 0)))
                        .foregroundStyle(asildi ? Tema.tehlike : Tema.metin)
                }
                .font(.subheadline.weight(.semibold)).monospacedDigit()
            }
            if let g = r.travelMode, g.until >= Bicim.key(Date()) {
                Label(g.on ? L("Gezi modu açık: {0} tarihine kadar eklenen harcamalar #{1} etiketini kendiliğinden alır.", Bicim.day(g.until), r.tag)
                           : L("Gezi modu {0} – {1}: bu günlerdeki yeni harcamalar #{2} etiketini kendiliğinden alır.", Bicim.day(g.from ?? g.until), Bicim.day(g.until), r.tag),
                      systemImage: "airplane")
                    .font(.footnote).foregroundStyle(Tema.metin2)
            }
        }
    }

    private func ayarla(_ a: [String: Any]) {
        do {
            try model.write("set_tag", a.merging(["tag": ad]) { x, _ in x })
            hata = nil
        } catch { hata = error.localizedDescription }
    }

    private func yenidenAdlandir() {
        struct Sonuc: Decodable { let tag: String; let merged: Bool }
        do {
            let s = try model.write("rename_tag", ["tag": ad, "new_name": yeniAd], as: Sonuc.self)
            ad = s.tag
            hata = nil
            Bant.goster(Bant.Mesaj(baslik: s.merged ? L("#{0} etiketine birleştirildi", s.tag) : L("Etiket #{0} oldu", s.tag), alt: nil))
        } catch { hata = error.localizedDescription }
    }

    private func sil() {
        do {
            try model.write("delete_tag", ["tag": ad])
            Bant.goster(Bant.Mesaj(baslik: L("#{0} etiketi kaldırıldı; harcamalar duruyor", ad), alt: nil))
            dismiss()
        } catch { hata = error.localizedDescription }
    }

    // CSV: etiketin harcamaları (Excel açabilsin diye virgüllü dillerde ; ayırıcı)
    private func csv(_ r: EtiketRaporu) -> String {
        let sep = Bicim.locale.decimalSeparator == "," ? ";" : ","
        func q(_ s: String) -> String { s.contains(where: { $0 == "\"" || $0 == ";" || $0 == "," || $0 == "\n" }) ? "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : s }
        func n(_ v: Double) -> String { v.formatted(.number.locale(Bicim.locale).grouping(.never).precision(.fractionLength(0...2))) }
        let kategori = { (id: String?) in id.flatMap { k in model.constants?.categories.first { $0.id == k }?.name } ?? "" }
        var satirlar = [[L("Tarih"), L("Açıklama"), L("Kart"), L("Kişi"), L("Kategori"), L("Tutar"), L("Birim"), L("Tutar ({0})", Bicim.home), L("Kalan ({0})", Bicim.home)].map(q).joined(separator: sep)]
        for x in r.list {
            satirlar.append([x.date ?? "", x.description, Bicim.kartAdi(x.card), x.person, kategori(x.category), n(x.amount), x.asset, n(x.value), n(x.left)].map(q).joined(separator: sep))
        }
        return "\u{FEFF}" + satirlar.joined(separator: "\r\n")
    }

    // Dağılım: ad, tutar, oran çubuğu (Kategoriler kartıyla aynı biçim)
    private func dagilim(_ baslik: String, _ satirlar: [EtiketRaporu.Pay]) -> some View {
        Kart {
            KartBasligi(baslik)
            ForEach(satirlar, id: \.self) { k in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(Bicim.kartAdi(k.name)).font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(Bicim.tl(k.amount)).font(.subheadline.weight(.semibold)).monospacedDigit()
                    }
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Tema.yuzey3)
                            Capsule().fill(Tema.metin2).frame(width: max(4, g.size.width * min(max(k.share, 0), 1)))
                        }
                    }
                    .frame(height: 6)
                    Text(Bicim.yuzde(Int((k.share * 100).rounded()))).font(.caption).foregroundStyle(Tema.metin3).monospacedDigit()
                }
            }
        }
    }

    private func satir(_ p: EtiketRaporu.Kalem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(p.description).font(.body.weight(.semibold)).foregroundStyle(Tema.metin).lineLimit(1)
                Text([Bicim.kartAdi(p.card), p.date.map { Bicim.day($0) }].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(Tema.metin3).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(Bicim.amount(p.amount, asset: p.asset)).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(Tema.metin)
                if p.left > 0.004 { Text(L("kalan {0}", Bicim.tl(p.left))).font(.footnote).monospacedDigit().foregroundStyle(Tema.metin3) }
            }
        }
        .contentShape(Rectangle())
    }
}

// CSV dosyası (paylaşma sayfasına; dosya adı etiketin adı)
struct EtiketCSV: Transferable {
    let ad: String
    let metin: String
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .commaSeparatedText) { csv in
            let ad = csv.ad.replacingOccurrences(of: "/", with: "-")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(ad).csv")
            try Data(csv.metin.utf8).write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }
}

// Tarih aralığından ekleme: aralıktaki, etiketi olmayan harcamalar işaretli gelir, istenmeyen çıkarılır (tag_purchases)
struct EtiketTopluEkle: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let etiket: String
    @State private var bas: Date
    @State private var bit: Date
    @State private var atla: Set<String> = []
    @State private var liste: [Harcama] = []
    @State private var hata: String?

    init(etiket: String, ilk: String?, son: String?) {
        self.etiket = etiket
        let bugun = Date()
        _bas = State(initialValue: ilk.flatMap(Bicim.date) ?? Calendar.current.date(byAdding: .day, value: -7, to: bugun) ?? bugun)
        _bit = State(initialValue: max(son.flatMap(Bicim.date) ?? bugun, ilk.flatMap(Bicim.date) ?? bugun))
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    DatePicker(L("Başlangıç"), selection: $bas, displayedComponents: .date)
                    DatePicker(L("Bitiş"), selection: $bit, in: bas..., displayedComponents: .date)
                } footer: {
                    Text(L("Bu günlerdeki harcamalar #{0} etiketini alır; istemediklerinin işaretini kaldır.", etiket))
                }
                .environment(\.locale, Bicim.locale)
                Section {
                    if liste.isEmpty {
                        Text(L("Bu günlerde etiketlenecek harcama yok.")).foregroundStyle(Tema.metin3)
                    }
                    ForEach(liste) { p in
                        Button {
                            if atla.contains(p.id) { atla.remove(p.id) } else { atla.insert(p.id) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: atla.contains(p.id) ? "circle" : "checkmark.circle.fill")
                                    .foregroundStyle(atla.contains(p.id) ? Tema.metin3 : Tema.metin)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.description).font(.subheadline.weight(.semibold)).lineLimit(1)
                                    Text([Bicim.kartAdi(p.card), p.date.map { Bicim.day($0) }].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(Tema.metin3)
                                }
                                Spacer()
                                Text(Bicim.amount(p.total, asset: p.asset)).font(.subheadline).monospacedDigit()
                            }
                            .foregroundStyle(Tema.metin)
                        }
                    }
                }
                if let hata { Section { Text(hata).foregroundStyle(Tema.tehlike) } }
            }
            .navigationTitle("#" + etiket)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Vazgeç")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Etiketle")) { ekle() }.fontWeight(.semibold).disabled(secili.isEmpty)
                }
            }
            .task(id: "\(Bicim.key(bas))|\(Bicim.key(bit))") { yukle() }
        }
    }

    private var secili: [String] { liste.map(\.id).filter { !atla.contains($0) } }

    private func yukle() {
        let anahtar = Etiket.anahtar(etiket)
        let l = (try? model.read("list_purchases", ["status": "all", "limit": 1000, "from": Bicim.key(bas), "to": Bicim.key(max(bas, bit)), "sort": "date", "order": "asc"]) as HarcamaListesi)?.purchases ?? []
        liste = l.filter { !($0.tags ?? []).contains { Etiket.anahtar($0) == anahtar } }
    }

    private func ekle() {
        struct Sonuc: Decodable { let changed: [Degisen]; struct Degisen: Decodable { let id: String } }
        do {
            let s = try model.write("tag_purchases", ["tag": etiket, "add": secili], as: Sonuc.self)
            Analitik.olay("tag_added", ["count": s.changed.count, "source": "bulk"])
            Bant.goster(Bant.Mesaj(baslik: L("{0} harcama #{1} etiketini aldı", s.changed.count, etiket), alt: nil))
            dismiss()
        } catch { hata = error.localizedDescription }
    }
}

// Gezi modu: başlangıçtan bitişe kadar yeni harcamalar etiketi kendiliğinden alır (set_tag active_from / active_until)
struct GeziModuFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let etiket: String
    let mod: GeziModu?
    @State private var bas = Date()
    @State private var bit = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var hata: String?

    private var acik: Bool { (mod?.until ?? "") >= Bicim.key(Date()) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    DatePicker(L("Başlangıç"), selection: $bas, displayedComponents: .date)
                    DatePicker(L("Bitiş"), selection: $bit, in: max(bas, Calendar.current.startOfDay(for: Date()))..., displayedComponents: .date)
                } footer: {
                    Text(L("Bu günlerde formdan, banka e-postasından, SMS'ten ya da asistandan eklenen her harcama #{0} etiketini kendiliğinden alır.", etiket))
                }
                .environment(\.locale, Bicim.locale)
                if acik {
                    Section {
                        Button(L("Gezi modunu kapat"), role: .destructive) { yaz(["active_until": NSNull()]) }
                    }
                }
                if let hata { Section { Text(hata).foregroundStyle(Tema.tehlike) } }
            }
            .navigationTitle(L("Gezi modu"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Vazgeç")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(acik ? L("Kaydet") : L("Aç")) {
                        yaz(["active_from": Bicim.key(bas), "active_until": Bicim.key(max(bas, bit))])
                        Analitik.olay("tag_active_set", ["days": (Calendar.current.dateComponents([.day], from: bas, to: max(bas, bit)).day ?? 0) + 1])
                    }
                    .fontWeight(.semibold)
                }
            }
            .onAppear {
                if acik, let m = mod {
                    bas = m.from.flatMap(Bicim.date) ?? Date()
                    bit = Bicim.date(m.until) ?? bit
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func yaz(_ a: [String: Any]) {
        do {
            try model.write("set_tag", a.merging(["tag": etiket]) { x, _ in x })
            dismiss()
        } catch { hata = error.localizedDescription }
    }
}

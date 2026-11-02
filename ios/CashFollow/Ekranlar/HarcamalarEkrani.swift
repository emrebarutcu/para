import SwiftUI

// Harcamalar: kişiye göre süzme, süren / biten taksitler, arama, ekleme ve silme (list_purchases, add_purchase,
// delete_purchase; web'deki Harcamalar sekmesi)
struct HarcamalarEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var search = ""
    @State private var kisi = ""                 // "" hepsi, yoksa kişinin kimliği
    @State private var kategori: KategoriSecimi? // kategoriye dokununca liste süzülür
    @State private var bitenler = false
    @State private var gorunum = "liste"           // liste | kategori
    @State private var silinecek: Harcama?

    var body: some View {
        NavigationStack {
            Sayfa {
                Okunan(tool: "list_people") { (k: KisiListesi) in
                    if k.people.count > 1 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                Cip(ad: L("Tümü"), sayi: k.people.reduce(0) { $0 + $1.purchaseCount }, secili: kisi.isEmpty) { kisi = "" }
                                ForEach(k.people) { p in
                                    Cip(ad: p.name, sayi: p.purchaseCount, renk: model.kisiRengi(p.id), secili: kisi == p.id) { kisi = p.id }
                                }
                            }
                        }
                    }
                }
                if search.isEmpty {
                    Secici(secim: $gorunum, ogeler: [("liste", L("Liste")), ("kategori", L("Kategoriler"))])
                }
                if gorunum == "kategori" && search.isEmpty {
                    Okunan(tool: "spending_by_category", args: ["months": 3]) { (k: KategoriHarcamasi) in
                        KategoriKarti(months: k.months, secili: kategori.map { $0.id }) { k in
                            withAnimation { kategori = k; gorunum = "liste" }
                        }
                    }
                } else {
                    if let k = kategori {
                        HStack {
                            Text(L("Kategori: {0}", k.ad)).font(.subheadline.weight(.semibold))
                            Spacer()
                            Button { withAnimation { kategori = nil } } label: {
                                Label(L("Hepsini göster"), systemImage: "xmark.circle.fill").font(.subheadline)
                            }
                            .foregroundStyle(Tema.metin2)
                        }
                        .padding(.horizontal, 4)
                    }
                    liste(durum: "active", bos: search.isEmpty ? L("Süren harcama yok") : L("Bulunamadı"))
                    Button { withAnimation { bitenler.toggle() } } label: {
                        HStack {
                            Text(L("Biten harcamalar")).font(.subheadline.weight(.semibold))
                            Image(systemName: "chevron.down").font(.caption.weight(.semibold)).rotationEffect(.degrees(bitenler ? 180 : 0))
                            Spacer()
                        }
                        .foregroundStyle(Tema.metin2).padding(.horizontal, 4).padding(.top, 4)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if bitenler { liste(durum: "done", bos: L("Biten harcama yok")) }
                }
            }
            .navigationTitle(L("Harcamalar"))
            .sayfaZemini()
            .navigationDestination(for: String.self) { id in HarcamaDetayi(id: id) }
            .searchable(text: $search, prompt: Text(L("Ara")))
            .yenilenebilir(model)
            .ekleDugmesi(.harcama)
            .confirmationDialog(silinecek.map { L("{0} ve bütün taksitleri silinsin mi?", $0.description) } ?? "",
                                isPresented: Binding(get: { silinecek != nil }, set: { if !$0 { silinecek = nil } }), titleVisibility: .visible) {
                Button(L("Sil"), role: .destructive) {
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
                                Button(L("Sil"), systemImage: "trash", role: .destructive) { silinecek = p }
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
                    Text([Bicim.kartAdi(p.card), p.date.map { Bicim.day($0) }].compactMap { $0 }.joined(separator: " · ")).lineLimit(1)
                    Spacer(minLength: 6)
                    if let sag = sagAlt { Text(sag).monospacedDigit() }
                }
                .font(.footnote).foregroundStyle(Tema.metin3)
                let plan = p.bnpl.map { "\($0.name) · Pay in \($0.payments)" } ?? p.repeat?.label ?? (p.installments > 1 ? L("{0} taksit", p.installments) : L("Peşin"))
                Text([plan, p.categoryName].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(Tema.metin3)
                if p.installments > 1, p.repeat == nil {
                    let odenen = p.bnpl?.paid ?? p.paidInstallments   // Pay in 4: çekilen ödemeler
                    HStack(spacing: 8) {
                        Doluluk(used: Double(odenen), limit: Double(p.installments), renk: Tema.metin2)
                            .frame(width: 90)
                        Text(L("{0}/{1} ödendi", odenen, p.installments)).font(.caption).foregroundStyle(Tema.metin3)
                    }
                }
            }
        }
        .contentShape(Rectangle())
    }

    private var tutar: String {
        if p.bnpl != nil { return Bicim.amount(p.total, asset: p.asset) }   // Pay in 4: fiyat (ödemeler aylık değil)
        if p.repeat != nil || p.installments > 1 { return Bicim.amount(p.perInstallment, asset: p.asset) + L("/ay") }
        return Bicim.amount(p.total, asset: p.asset)
    }

    private var sagAlt: String? {
        if p.status == "done" { return "bitti" }
        if p.repeat != nil, let n = p.repeat?.nextDate { return L("sonraki {0}", Bicim.day(n)) }
        if let b = p.bnpl { return b.owedToProvider > 0.004 ? L("kalan {0}", Bicim.amount(b.owedToProvider, asset: p.asset)) : nil }
        if p.installments > 1 { return L("kalan {0}", Bicim.amount(p.remainingAmount, asset: p.asset)) }
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
                            Text([p.person, Bicim.kartAdi(p.card)].joined(separator: " · ")).font(.subheadline).foregroundStyle(Tema.metin3)
                        }
                    }
                    BuyukTutar(deger: p.total, boyut: 40)
                    Ayirici()
                    if let b = p.bnpl {
                        IstatistikSatiri(ogeler: [
                            Istatistik(etiket: L("2 haftada bir"), deger: Bicim.amount(b.perPayment, asset: p.asset)),
                            Istatistik(etiket: L("Ödenen"), deger: "\(b.paid)/\(b.payments)"),
                            Istatistik(etiket: L("{0} kalan", b.name), deger: Bicim.amount(b.owedToProvider, asset: p.asset)),
                        ])
                    } else {
                        IstatistikSatiri(ogeler: [
                            Istatistik(etiket: p.repeat != nil ? L("Her ay") : L("Taksit"), deger: p.installments > 1 || p.repeat != nil ? Bicim.amount(p.perInstallment, asset: p.asset) : L("Peşin")),
                            Istatistik(etiket: L("Ödenen"), deger: p.repeat != nil ? "—" : "\(p.paidInstallments)/\(p.installments)"),
                            Istatistik(etiket: L("Kalan"), deger: Bicim.amount(p.remainingAmount, asset: p.asset)),
                        ])
                    }
                }
                Kart {
                    VStack(spacing: 10) {
                        if let d = p.date { Satir(title: L("Tarih"), value: Bicim.day(d)) }
                        if let c = p.categoryName { Satir(title: L("Kategori"), value: c) }
                        if let cut = p.statementCutoff { Satir(title: L("Ekstre kesimi"), value: Bicim.day(cut)) }
                        if let r = p.repeat?.label { Satir(title: L("Tekrar"), value: r) }
                        if let b = p.bnpl {
                            Satir(title: L("Şimdi al sonra öde"), value: "\(b.name) · Pay in \(b.payments)")
                            if let n = b.nextCharge { Satir(title: L("Sıradaki çekim"), value: "\(Bicim.day(n.date)) · \(Bicim.amount(n.amount, asset: p.asset))") }
                        }
                    }
                    .font(.subheadline)
                }
                if let odemeler = p.payments, !odemeler.isEmpty {
                    Kart(dolgu: 14) {
                        KartBasligi(L("Ödemeler"))
                        SatirListesi(veri: odemeler) { x in
                            HStack(spacing: 12) {
                                TarihRozeti(tarih: x.date)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.bnpl != nil ? L("{0}. ödeme", x.no) : L("{0}. taksit", x.no)).font(.body.weight(.semibold))
                                    Text(x.paid ? L("ödendi") : Bicim.relative(x.date)).font(.footnote).foregroundStyle(Tema.metin3)
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
                    Text(L("Harcamayı sil")).font(.body.weight(.semibold)).foregroundStyle(Tema.tehlike)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .navigationTitle(p.description)
            .toolbar {
                // Excel'den gelen tarihsiz kayıt web'de düzenlenir (kalan taksitler ve ilk ödeme ayı)
                if p.date != nil {
                    ToolbarItem(placement: .primaryAction) { Button(L("Düzenle")) { duzenle = p } }
                }
            }
            .sheet(item: $duzenle) { HarcamaFormu(duzenle: $0) }
            .confirmationDialog(L("{0} ve bütün taksitleri silinsin mi?", p.description), isPresented: $confirm, titleVisibility: .visible) {
                Button(L("Sil"), role: .destructive) {
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
    @AppStorage("harcama.sonBnpl") private var sonBnpl = "klarna"
    @State private var bnpl = false            // Pay in 4 (ABD): 4 ödeme, 2 haftada bir
    @State private var saglayici = "klarna"
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
                            TextField(L("0"), text: $amount)
                                .font(.system(size: 40, weight: .bold)).monospacedDigit()
                                .keyboardType(.decimalPad)
                                .focused($tutarOdak)
                        }
                        Ayirici()
                        TextField(L("Ne alındı? (ör. Migros)"), text: $desc).font(.title3)
                    }

                    Kart {
                        etiket(L("Nasıl ödendi"))
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(cards) { c in
                                    Cip(ad: c.name, renk: model.kartRengi(c.id), secili: card == c.id) { card = c.id }
                                }
                                Cip(ad: L("Nakit"), renk: Tema.nakit, secili: card == "nakit") { card = "nakit" }
                            }
                        }
                        if model.bnplAllowed, !tekrar {
                            Toggle(L("Pay in 4 (şimdi al sonra öde)"), isOn: $bnpl.animation())
                                .font(.subheadline).tint(Tema.metin)
                            if bnpl {
                                HStack {
                                    Text(L("Sağlayıcı"))
                                    Spacer()
                                    Picker(L("Sağlayıcı"), selection: $saglayici) {
                                        ForEach(model.constants?.bnplProviders ?? []) { s in Text(s.name).tag(s.id) }
                                    }
                                    .labelsHidden()
                                }
                                .font(.subheadline)
                                if let t = Bicim.parse(amount), t > 0 {
                                    Text(L("Bugün {0}, sonra 2 haftada bir 3 × {1}", Bicim.tl(ilkOdeme(t)), Bicim.tl(floor(t * 100 / 4) / 100)))
                                        .font(.footnote).foregroundStyle(Tema.metin3)
                                }
                            }
                        }
                        if !tekrar, !bnpl {
                            etiket(L("Taksit"))
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(taksitler, id: \.self) { n in
                                        Cip(ad: n == 1 ? L("Peşin") : "\(n)", secili: count == n) { count = n }
                                    }
                                    Menu {
                                        Picker(L("Taksit"), selection: $count) {
                                            ForEach(2...60, id: \.self) { Text(L("{0} taksit", $0)).tag($0) }
                                        }
                                    } label: {
                                        Text(taksitler.contains(count) ? L("Diğer") : L("{0} taksit", count))
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(taksitler.contains(count) ? Tema.metin : Tema.ustMetin)
                                            .padding(.horizontal, 14).padding(.vertical, 8)
                                            .background(taksitler.contains(count) ? Tema.yuzey : Tema.metin, in: Capsule())
                                            .overlay(Capsule().strokeBorder(Tema.cizgi2, lineWidth: taksitler.contains(count) ? 1 : 0))
                                    }
                                }
                            }
                        }
                        if duzenle == nil, !bnpl {
                            Toggle(L("Her ay tekrarlar (abonelik, kira)"), isOn: $tekrar.animation())
                                .font(.subheadline).tint(Tema.metin)
                        }
                    }

                    if duzenle == nil, let sim { AlabilirMiyim(sim: sim, secili: card, tekrar: tekrar, cards: cards) { card = $0 } }
                    else if let p = preview { duzenlemeOnizlemesi(p) }
                    Kart {
                        DatePicker(L("Tarih"), selection: $date, displayedComponents: .date)
                            .environment(\.locale, Bicim.locale)
                        if people.count > 1 {
                            Ayirici()
                            HStack {
                                Text(L("Kimin"))
                                Spacer()
                                Picker(L("Kimin"), selection: $person) {
                                    ForEach(people) { p in Text(p.name).tag(p.id) }
                                }
                                .labelsHidden()
                            }
                        }
                        Ayirici()
                        HStack {
                            Text(L("Kategori"))
                            Spacer()
                            Picker(L("Kategori"), selection: $category) {
                                Text(L("Otomatik")).tag("")
                                ForEach(model.constants?.categories ?? []) { c in Text(c.name).tag(c.id) }
                            }
                            .labelsHidden()
                        }
                    }
                    .font(.subheadline)
                    .tint(Tema.metin)

                    HataMetni(text: error)
                    AltKaydet(eksik: eksik, eylem: save)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Tema.zemin)
            .navigationTitle(duzenle == nil ? L("Harcama ekle") : L("Harcamayı düzenle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Vazgeç")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Kaydet"), action: save).fontWeight(.semibold).disabled(!valid) }
            }
            .task { load() }
            .task(id: "\(desc)|\(amount)|\(count)|\(tekrar)|\(bnpl)|\(saglayici)|\(Bicim.key(date))|\(card)|\(person)") { dryRun() }
        }
    }

    // Pay in 4'ün ilk ödemesi: kuruş artığı ilk ödemede (taksit.js bnplAmounts)
    private func ilkOdeme(_ t: Double) -> Double {
        let kurus = (t * 100).rounded(), taban = floor(kurus / 4)
        return (kurus - taban * 3) / 100
    }

    private func etiket(_ s: String) -> some View {
        Text(s).font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3)
    }

    private func duzenlemeOnizlemesi(_ p: HarcamaSonucu) -> some View {
        Kart {
            KartBasligi(L("Ödeme planı"))
            VStack(spacing: 8) {
                if let cut = p.preview?.statementCutoff { Satir(title: L("Ekstre kesimi"), value: Bicim.day(cut)) }
                Satir(title: L("İlk ödeme"), value: Bicim.day(p.preview?.firstPayment ?? p.purchase.nextPayment?.date))
                if count > 1 {
                    Satir(title: L("Son ödeme"), value: Bicim.day(p.preview?.lastPayment ?? p.purchase.lastPaymentDate))
                    Satir(title: L("Taksit tutarı"), value: Bicim.tl(p.purchase.perInstallment))
                }
            }
            .font(.subheadline)
        }
    }

    private var valid: Bool { eksik == nil }

    // Kaydetmek için ne eksik (alttaki düğmede yazar)
    private var eksik: String? {
        if (Bicim.parse(amount) ?? 0) <= 0 { return L("Tutarı yaz") }
        if desc.trimmingCharacters(in: .whitespaces).isEmpty { return L("Ne alındığını yaz") }
        return nil
    }

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
            if let b = p.bnpl { bnpl = true; saglayici = b.provider }
        } else if !yuklendi, card == "nakit" {
            saglayici = sonBnpl
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
            "installments": tekrar ? 1 : bnpl ? 4 : count, "date": Bicim.key(date), "card": card, "person": person,
        ]
        if tekrar { a["repeat"] = 0 }
        if bnpl { a["bnpl"] = saglayici } else if duzenle?.bnpl != nil { a["bnpl"] = NSNull() }
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
            if bnpl { sonBnpl = saglayici }
            Analitik.olay(duzenle == nil ? "purchase_added" : "purchase_edited",
                          ["installments": tekrar ? 1 : bnpl ? 4 : count, "repeat": tekrar, "bnpl": bnpl, "cash": card == "nakit", "afford_shown": sim != nil])
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
        let limitYok = (sim.card?.availableAfter ?? 0) < 0 && (sim.card?.limit ?? 0) > 0
        Kart {
            KartBasligi(baslik: L("Alabilir miyim?")) {
                if let n = p.nextPayment { Text(Bicim.relative(n.date)).font(.footnote).foregroundStyle(Tema.metin3) }
            }
            VStack(spacing: 8) {
                Satir(title: L("İlk ödeme"), value: Bicim.day(p.nextPayment?.date ?? p.payments?.first?.date))
                if !tekrar, p.installments > 1 {
                    Satir(title: L("Taksit"), value: "\(Bicim.tl(p.perInstallment)) × \(p.installments)")
                    Satir(title: L("Son ödeme"), value: Bicim.day(p.lastPaymentDate))
                }
                if let ilk {
                    Satir(title: L("{0} ödemesi", Bicim.month(ilk.month)), value: "\(Bicim.tl(ilk.paymentsBefore, fraction: false)) → \(Bicim.tl(ilk.paymentsAfter, fraction: false))")
                }
                if let c = sim.card, c.limit > 0, let kalan = c.availableAfter {
                    Satir(title: L("Kalan limit"), value: Bicim.tl(kalan, fraction: false), color: kalan < 0 ? Tema.tehlike : Tema.metin)
                }
            }
            .font(.subheadline)
            if nakitVar, let d = enDusuk {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: d.freeCashAfter < 0 ? "exclamationmark.triangle" : "checkmark.circle")
                    Text(d.freeCashAfter < 0
                         ? L("Gelirin ödemeleri karşılamıyor. En sıkışık ay {0}: {1}", Bicim.month(d.month), Bicim.tl(d.freeCashAfter, fraction: false))
                         : L("Her ay gelirin ödemeleri karşılıyor; en sıkışık ay {0}, boşta {1} kalıyor.", Bicim.month(d.month), Bicim.tl(d.freeCashAfter, fraction: false)))
                }
                .font(.footnote)
                .foregroundStyle(d.freeCashAfter < 0 ? Tema.tehlike : Tema.iyi)
            }
            if !tekrar, let o = oneri, o.card != seciliAd, let id = cards.first(where: { $0.name == o.card })?.id,
               limitYok || (sim.cardsCompared.first(where: { $0.card == seciliAd }).map { o.daysUntilFirstPayment - $0.daysUntilFirstPayment >= 10 } ?? false) {
                Button { sec(id); Analitik.olay("afford_card_suggestion_used") } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "lightbulb")
                        Text((limitYok ? L("Limit yetmiyor.") + " " : "") + L("{0} ile alırsan ilk ödeme {1} ({2} gün sonra)", o.card, Bicim.day(o.firstPayment), o.daysUntilFirstPayment))
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 4)
                        Text(L("Seç")).fontWeight(.semibold)
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

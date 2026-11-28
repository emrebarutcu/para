import SwiftUI

// Etiketler (Harcamalar → Etiketler; tag_summary etiketsiz): her etiketin harcama sayısı, tarih aralığı ve toplam
// maliyeti (taksitlerin hepsi, gelecektekiler dahil; döviz bugünkü kurla). Dokununca etiket raporu (tag_summary):
// toplam ve harcamalar herkese açık; ödenen / kalan, son ödeme ve kategoriye, kişiye göre dağılım Premium (tag_report
// kilidi). Raporun menüsünde üç iş, hepsi ücretsiz: eski harcamaları etiketle, yeniden adlandır / birleştir, sil.
// Ücretsiz sürümde en fazla Abonelik.ucretsizEtiket farklı etiket (formda, tags kilidi). Web: Harcamalar → Etiketler;
// kurallar icgoru.js tagList / tagSummary, ad ve kimlik tablo.js tags / tagKey.

// Etiketin adı ve kimliği (tablo.js tagName / tagKey ile aynı kural): baştaki # ve virgül atılır, boşluklar teke iner,
// en fazla 40 harf; büyük / küçük harf ve Türkçe İ / ı ile İngilizce I / i farkı aynı etiket sayılır. Formda aynı
// etiketin iki kez eklenmemesi için; kaydedilen ad yine tablo.js'ten geçer.
enum Etiket {
    static let enFazla = 10     // harcama başına (tablo.js MAX_TAGS)
    static let uzunluk = 40     // tablo.js TAG_LEN

    static func ad(_ s: String) -> String? {
        var t = s.precomposedStringWithCanonicalMapping
            .replacingOccurrences(of: "[,\\n\\r\\t]+", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        while t.hasPrefix("#") { t.removeFirst() }
        t = t.trimmingCharacters(in: .whitespaces)
        if t.unicodeScalars.count > uzunluk { t = String(String.UnicodeScalarView(t.unicodeScalars.prefix(uzunluk))).trimmingCharacters(in: .whitespaces) }
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

// Etiketin raporuna gidiş (Etiketler görünümü, harcama ayrıntısındaki etiket)
struct EtiketHedefi: Hashable { let ad: String }

struct EtiketlerKarti: View {
    let etiketler: [EtiketListesi.Etiket]

    var body: some View {
        if etiketler.isEmpty {
            Kart {
                Text(L("Henüz etiket yok. Harcama eklerken etiket yaz.")).font(.subheadline).foregroundStyle(Tema.metin3)
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
            }
            Spacer(minLength: 8)
            Text(Bicim.tl(t.total)).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(Tema.metin)
        }
        .contentShape(Rectangle())
    }
}

// Bir etiketin raporu: "Maldivler bize kaça mal oldu?" Sağ üstteki menüde üç iş (araçlar asistanınkilerle aynı:
// tag_purchases, rename_tag; boş ad siler).
struct EtiketRaporuEkrani: View {
    @EnvironmentObject private var model: Model
    @EnvironmentObject private var abonelik: Abonelik
    @Environment(\.dismiss) private var dismiss
    @State private var ad: String                 // yeniden adlandırılınca yeni adla okunur
    @State private var toplu = false
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
                        Text(r.byCurrency.map { Bicim.amount($0.amount, asset: $0.asset) }.joined(separator: " + "))
                            .font(.footnote).foregroundStyle(Tema.metin3)
                    }
                    if let m = r.missingRates, m > 0 {
                        Text(L("Kuru alınamayan {0} harcama toplama girmedi.", m)).font(.footnote).foregroundStyle(Tema.metin3)
                    }
                }
                if abonelik.premium {
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
                    }
                    dagilim(L("Kategoriye göre"), r.byCategory)
                    if r.byPerson.count > 1 { dagilim(L("Kişiye göre"), r.byPerson) }
                } else {
                    PremiumKilidi(baslik: L("Etiketin raporu"), aciklama: L("Ödenen, kalan ve dağılım Premium'da."), neden: "tag_report")
                }
                BolumBasligi(baslik: L("Harcamalar"))
                Kart(dolgu: 14) {
                    SatirListesi(veri: r.list) { p in
                        NavigationLink(value: p.id) { satir(p) }.buttonStyle(.plain)
                    }
                }
                HataMetni(text: hata)
            }
            .sheet(isPresented: $toplu) { EtiketTopluEkle(etiket: r.tag, ilk: r.firstPurchase, son: r.lastPurchase) }
        }
        .navigationTitle("#" + ad)
        .navigationBarTitleDisplayMode(.inline)
        .sayfaZemini()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(L("Eski harcamaları etiketle"), systemImage: "plus.circle") { toplu = true }
                    Button(L("Yeniden adlandır"), systemImage: "pencil") { yeniAd = ad; adAcik = true }
                    Divider()
                    Button(L("Etiketi sil"), systemImage: "trash", role: .destructive) { silinsin = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel(L("Etiketi yönet"))
            }
        }
        .onAppear { Analitik.olay("tag_report_viewed", ["locked": !abonelik.premium]) }
        .alert(L("Yeniden adlandır"), isPresented: $adAcik) {
            TextField(L("Yeni ad"), text: $yeniAd)
            Button(L("Kaydet")) { if Etiket.ad(yeniAd) != nil { degistir(yeniAd) } }
            Button(L("Vazgeç"), role: .cancel) {}
        }
        .confirmationDialog(L("#{0} etiketi silinsin mi?", ad), isPresented: $silinsin, titleVisibility: .visible) {
            Button(L("Etiketi sil"), role: .destructive) { degistir("") }
        } message: {
            Text(L("Harcamalar silinmez."))
        }
    }

    // Yeniden adlandırır ya da (boş adla) siler: rename_tag
    private func degistir(_ yeni: String) {
        struct Sonuc: Decodable { let tag: String?; let merged: Bool?; let deleted: Bool? }
        do {
            let s = try model.write("rename_tag", ["tag": ad, "new_name": yeni], as: Sonuc.self)
            hata = nil
            if s.deleted == true {
                Bant.goster(Bant.Mesaj(baslik: L("#{0} silindi", ad)))
                dismiss()
            } else if let t = s.tag {
                ad = t
                Bant.goster(Bant.Mesaj(baslik: s.merged == true ? L("#{0} etiketine birleştirildi", t) : L("Kaydedildi")))
            }
        } catch { hata = error.localizedDescription }
    }

    // Dağılım: ad, tutar, oran çubuğu (Kategoriler kartıyla aynı biçim)
    private func dagilim(_ baslik: String, _ satirlar: [EtiketRaporu.Pay]) -> some View {
        Kart {
            KartBasligi(baslik)
            ForEach(satirlar, id: \.self) { k in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(k.name).font(.subheadline.weight(.semibold))
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

// Eski harcamaları etiketle: seçilen günlerdeki, etiketi olmayan harcamalar listelenir; hiçbiri işaretli gelmez
// (alakasız harcama yanlışlıkla etiket almasın), kullanıcı istediklerini işaretler (tag_purchases)
struct EtiketTopluEkle: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let etiket: String
    @State private var bas: Date
    @State private var bit: Date
    @State private var secili: Set<String> = []
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
                }
                .environment(\.locale, Bicim.locale)
                Section {
                    if liste.isEmpty {
                        Text(L("Bu günlerde etiketlenecek harcama yok.")).foregroundStyle(Tema.metin3)
                    }
                    ForEach(liste) { p in
                        Button {
                            if secili.contains(p.id) { secili.remove(p.id) } else { secili.insert(p.id) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: secili.contains(p.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(secili.contains(p.id) ? Tema.metin : Tema.metin3)
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

    private func yukle() {
        let anahtar = Etiket.anahtar(etiket)
        let l = (try? model.read("list_purchases", ["status": "all", "limit": 1000, "from": Bicim.key(bas), "to": Bicim.key(max(bas, bit)), "sort": "date", "order": "asc"]) as HarcamaListesi)?.purchases ?? []
        liste = l.filter { !($0.tags ?? []).contains { Etiket.anahtar($0) == anahtar } }
        secili = secili.intersection(liste.map(\.id))
    }

    private func ekle() {
        struct Sonuc: Decodable { let added: [Degisen]; struct Degisen: Decodable { let id: String } }
        do {
            let s = try model.write("tag_purchases", ["tag": etiket, "add": Array(secili)], as: Sonuc.self)
            Analitik.olay("tag_added", ["count": s.added.count, "source": "bulk"])
            Bant.goster(Bant.Mesaj(baslik: L("{0} harcama etiketlendi", s.added.count)))
            dismiss()
        } catch { hata = error.localizedDescription }
    }
}

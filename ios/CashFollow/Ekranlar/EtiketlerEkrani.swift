import SwiftUI

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
            }
            Spacer(minLength: 8)
            Text(Bicim.tl(t.total)).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(Tema.metin)
        }
        .contentShape(Rectangle())
    }
}

// Bir etiketin raporu: "Maldivler bize kaça mal oldu?"
struct EtiketRaporuEkrani: View {
    @EnvironmentObject private var abonelik: Abonelik
    let etiket: String

    var body: some View {
        Okunan(tool: "tag_summary", args: ["tag": etiket], key: etiket) { (r: EtiketRaporu) in
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
                        if let g = r.perDay, let d = r.days, d > 1 {
                            Text(L("Günde ortalama {0} ({1} gün)", Bicim.tl(g), d)).font(.footnote).foregroundStyle(Tema.metin3)
                        }
                    }
                    dagilim(L("Kategoriye göre"), r.byCategory)
                    if r.byPerson.count > 1 { dagilim(L("Kişiye göre"), r.byPerson) }
                    dagilim(L("Karta göre"), r.byCard)
                } else {
                    PremiumKilidi(baslik: L("Etiketin raporu"),
                                  aciklama: L("Ne kadarı ödendi, ne kadar kaldı, son taksit hangi ay; kategoriye, kişiye ve karta göre dağılım."),
                                  neden: "tag_report")
                }
                BolumBasligi(baslik: L("Harcamalar"))
                Kart(dolgu: 14) {
                    SatirListesi(veri: r.list) { p in
                        NavigationLink(value: p.id) { satir(p) }.buttonStyle(.plain)
                    }
                }
            }
        }
        .navigationTitle("#" + etiket)
        .navigationBarTitleDisplayMode(.inline)
        .sayfaZemini()
        .onAppear { Analitik.olay("tag_report_viewed", ["locked": !abonelik.premium]) }
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

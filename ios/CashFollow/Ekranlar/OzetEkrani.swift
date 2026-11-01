import SwiftUI

// Özet: yalnızca "bu ay ve yakında" — bu ay ödenecek, sıradaki ödemeler, en önemli içgörüler, nakit (ios/UX.md).
// Kişilerin payı Akış'ta, kategoriler Harcamalar'da, aylık grafik Akış'ta.
struct OzetEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var ayarlar = false
    @State private var odeme: OdemeHedefi?

    var body: some View {
        NavigationStack {
            Sayfa {
                CevrimdisiNotu()
                Okunan(tool: "get_overview") { (o: Ozet) in
                    VStack(alignment: .leading, spacing: 14) {
                        ustKart(o)
                        siradakiler(o)
                        IcgoruBolumu()
                        NakitKarti()
                    }
                }
            }
            .navigationTitle("Özet")
            .sayfaZemini()
            .yenilenebilir(model)
            .ekleDugmesi()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EsitlemeDurumu() }
                ToolbarItem(placement: .primaryAction) {
                    Button { ayarlar = true } label: { Image(systemName: "slider.horizontal.3") }.accessibilityLabel("Ayarlar")
                }
            }
            .sheet(isPresented: $ayarlar) { AyarlarEkrani() }
            .sheet(item: $odeme) { OdemeFormu(hedef: $0) }
        }
    }

    // Bu ay ödenecek: büyük tutar, borç ödemeleri, gelecek ay / kalan / son taksit
    private func ustKart(_ o: Ozet) -> some View {
        Kart {
            HStack {
                Text("Bu ay ödenecek").font(.subheadline).foregroundStyle(Tema.metin2)
                Spacer()
                Text(Bicim.month(o.month)).font(.subheadline.weight(.semibold))
            }
            BuyukTutar(deger: o.dueThisMonth)
            if let d = o.debts?.dueThisMonth, d > 0.004 {
                Text("+ \(Bicim.tl(d)) borç ödemesi").font(.subheadline).foregroundStyle(Tema.metin2).monospacedDigit()
            }
            Ayirici()
            IstatistikSatiri(ogeler: [
                Istatistik(etiket: ayAdi(o.nextMonth.month), deger: Bicim.tl(o.nextMonth.total)),
                Istatistik(etiket: "Kalan ödeme", deger: Bicim.tl(o.remainingTotal)),
                Istatistik(etiket: "Son taksit", deger: o.endless == true ? "Süresiz" : Bicim.month(o.lastPaymentMonth)),
            ])
        }
    }

    private func ayAdi(_ ym: String) -> String {
        String(Bicim.month(ym).split(separator: " ").first ?? "")
    }

    // Sıradaki ödemeler: tarih rozeti, kart / nakit, ne zaman, tutar; gecikmiş ekstrede "Ödendi"
    private func siradakiler(_ o: Ozet) -> some View {
        Kart {
            KartBasligi("Sıradaki ödemeler")
            if o.upcomingPayments.isEmpty {
                Text("Ödenecek taksit yok").font(.subheadline).foregroundStyle(Tema.metin3)
            }
            SatirListesi(veri: Array(o.upcomingPayments.prefix(5))) { p in
                HStack(spacing: 12) {
                    TarihRozeti(tarih: p.date, gec: p.late == true)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Image(systemName: p.card == "Nakit" ? "banknote" : "creditcard")
                                .font(.footnote).foregroundStyle(model.kartRengi(p.card))
                            Text(p.card).font(.body.weight(.semibold)).lineLimit(1)
                        }
                        Text(p.late == true ? "gecikti · \(Bicim.day(p.date))" : "\(Bicim.relative(p.date)) · \(Bicim.day(p.date))")
                            .font(.footnote).foregroundStyle(p.late == true ? Tema.tehlike : Tema.metin3)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(Bicim.tl(p.total)).font(.body.weight(.semibold)).monospacedDigit().fixedSize()
                        if p.late == true, p.card != "Nakit" {
                            Button("Ödendi") { odendi(p) }
                                .font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(Tema.yuzey2, in: Capsule())
                                .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private func odendi(_ p: Ozet.Yaklasan) {
        guard let c = (try? model.read("list_cards") as KartListesi)?.cards.first(where: { $0.name == p.card }) else { return }
        odeme = .kart(id: c.id, ad: c.name, tutar: c.tracking?.unpaid ?? p.total)
    }

}

// İçgörüler: en önemlileri, "Tümü" ile hepsi (get_insights)
struct IcgoruBolumu: View {
    @State private var hepsi = false

    var body: some View {
        Okunan(tool: "get_insights") { (i: Icgoruler) in
            if !i.insights.isEmpty {
                Kart {
                    KartBasligi(baslik: "İçgörüler") {
                        if i.insights.count > 2 {
                            Button(hepsi ? "Daha az" : "Tümü (\(i.insights.count))") { withAnimation { hepsi.toggle() } }
                                .font(.subheadline).foregroundStyle(Tema.metin2)
                        }
                    }
                    SatirListesi(veri: hepsi ? i.insights : Array(i.insights.prefix(2))) { IcgoruSatiri(i: $0) }
                }
            }
        }
    }
}

// Eşitleniyor / hata simgesi
struct EsitlemeDurumu: View {
    @EnvironmentObject private var model: Model
    var body: some View {
        if model.session != nil {
            if model.syncing {
                ProgressView()
            } else if model.syncError != nil {
                Image(systemName: "exclamationmark.icloud").foregroundStyle(Renk.gider).accessibilityLabel("Eşitlenemedi")
            } else {
                Image(systemName: "checkmark.icloud").foregroundStyle(Tema.metin3).accessibilityLabel("Eşitlendi")
            }
        }
    }
}

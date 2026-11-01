import SwiftUI

// Özet: bu ay ödenecek, içgörüler, nakit, sıradaki ödemeler, kişiler, kategoriler ve aylık ödemeler (web'deki Özet sekmesi,
// aynı sıra ve görünüm)
struct OzetEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var adding = false
    @State private var ayarlar = false

    var body: some View {
        NavigationStack {
            Sayfa {
                CevrimdisiNotu()
                Okunan(tool: "get_overview") { (o: Ozet) in
                    VStack(alignment: .leading, spacing: 14) {
                        ustKart(o)
                        IcgoruBolumu()
                        NakitKarti()
                        siradakiler(o)
                        if o.people.count > 1 { kisiler(o) }
                    }
                }
                Okunan(tool: "spending_by_category", args: ["months": 3]) { (k: KategoriHarcamasi) in
                    KategoriKarti(months: k.months)
                }
                Okunan(tool: "get_cashflow", args: ["months": 12, "include_items": false]) { (a: Akis) in
                    AylikOdemeGrafigi(months: a.months)
                }
            }
            .navigationTitle("Özet")
            .sayfaZemini()
            .yenilenebilir(model)
            .yuzenDugme("Harcama ekle") { adding = true }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EsitlemeDurumu() }
                ToolbarItem(placement: .primaryAction) {
                    Button { ayarlar = true } label: { Image(systemName: "slider.horizontal.3") }.accessibilityLabel("Ayarlar")
                }
            }
            .sheet(isPresented: $adding) { HarcamaFormu() }
            .sheet(isPresented: $ayarlar) { AyarlarEkrani() }
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

    // Sıradaki ödemeler: tarih rozeti, kart / nakit, ne zaman, tutar
    private func siradakiler(_ o: Ozet) -> some View {
        Kart {
            KartBasligi("Sıradaki ödemeler")
            if o.upcomingPayments.isEmpty {
                Text("Ödenecek taksit yok").font(.subheadline).foregroundStyle(Tema.metin3)
            }
            SatirListesi(veri: o.upcomingPayments) { p in
                HStack(spacing: 12) {
                    TarihRozeti(tarih: p.date, gec: p.late == true)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Image(systemName: p.card == "Nakit" ? "banknote" : "creditcard")
                                .font(.footnote).foregroundStyle(model.kartRengi(p.card))
                            Text(p.card).font(.body.weight(.semibold))
                        }
                        Text("\(Bicim.relative(p.date)) · \(Bicim.day(p.date))")
                            .font(.footnote).foregroundStyle(p.late == true ? Tema.tehlike : Tema.metin3)
                    }
                    Spacer()
                    Text(Bicim.tl(p.total)).font(.body.weight(.semibold)).monospacedDigit()
                }
            }
        }
    }

    // Kişiler: bu ay payı ve kalan
    private func kisiler(_ o: Ozet) -> some View {
        Kart {
            KartBasligi(baslik: "Kişiler") {
                Text(Bicim.month(o.month)).font(.subheadline).foregroundStyle(Tema.metin3)
            }
            SatirListesi(veri: o.people) { p in
                HStack(spacing: 12) {
                    Avatar(ad: p.name, renk: model.kisiRengi(p.name))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name).font(.body.weight(.semibold))
                        Text("kalan \(Bicim.tl(p.remaining))").font(.footnote).foregroundStyle(Tema.metin3).monospacedDigit()
                    }
                    Spacer()
                    Text(Bicim.tl(p.dueThisMonth)).font(.body.weight(.semibold)).monospacedDigit()
                }
            }
        }
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
                        if i.insights.count > 3 {
                            Button(hepsi ? "Daha az" : "Tümü (\(i.insights.count))") { withAnimation { hepsi.toggle() } }
                                .font(.subheadline).foregroundStyle(Tema.metin2)
                        }
                    }
                    SatirListesi(veri: hepsi ? i.insights : Array(i.insights.prefix(3))) { IcgoruSatiri(i: $0) }
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

import SwiftUI

// Özet: yalnızca "bu ay ve yakında" — bu ay ödenecek, sıradaki ödemeler, en önemli içgörüler, nakit (ios/UX.md).
// Kişilerin payı Akış'ta, kategoriler Harcamalar'da, aylık grafik Akış'ta.
struct OzetEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var ayarlar = false
    @State private var odeme: OdemeHedefi?
    @State private var baslarken: BaslarkenDurumu?
    @AppStorage("baslarken.gizli") private var baslarkenGizli = false

    var body: some View {
        NavigationStack {
            Sayfa {
                CevrimdisiNotu()
                if !baslarkenGizli, let d = baslarken, !d.bitti { BaslarkenKarti(durum: d) }
                Okunan(tool: "get_overview") { (o: Ozet) in
                    // Hiç ödeme yoksa (yeni kullanıcı) sıfırlarla dolu kartlar gösterilmez; Başlarken yeter
                    let bos = o.remainingTotal < 0.004 && o.upcomingPayments.isEmpty && o.dueThisMonth < 0.004
                    VStack(alignment: .leading, spacing: 14) {
                        if !bos {
                            ustKart(o)
                            siradakiler(o)
                        }
                        IcgoruBolumu()
                        if !bos || baslarken?.gelir == true { NakitKarti() }
                    }
                }
            }
            .navigationTitle(L("Özet"))
            .sayfaZemini()
            .yenilenebilir(model)
            .ekleDugmesi(.harcama)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EsitlemeDurumu() }
                ToolbarItem(placement: .primaryAction) {
                    Button { ayarlar = true } label: { Image(systemName: "gearshape") }.accessibilityLabel(L("Ayarlar"))
                }
            }
            .sheet(isPresented: $ayarlar) { AyarlarEkrani() }
            .sheet(item: $odeme) { OdemeFormu(hedef: $0) }
            .task(id: model.revision) { baslarken = BaslarkenDurumu.oku(model) }
        }
    }

    // Bu ay ödenecek: büyük tutar, borç ödemeleri, gelecek ay ve kalan toplam
    private func ustKart(_ o: Ozet) -> some View {
        Kart {
            HStack {
                Text(L("Bu ay ödenecek")).font(.subheadline).foregroundStyle(Tema.metin2)
                Spacer()
                Text(Bicim.month(o.month)).font(.subheadline.weight(.semibold))
            }
            BuyukTutar(deger: o.dueThisMonth)
            if let d = o.debts?.dueThisMonth, d > 0.004 {
                Text(L("+ {0} borç ödemesi", Bicim.tl(d))).font(.subheadline).foregroundStyle(Tema.metin2).monospacedDigit()
            }
            Ayirici()
            IstatistikSatiri(ogeler: [
                Istatistik(etiket: L("Gelecek ay ({0})", ayAdi(o.nextMonth.month)), deger: Bicim.tl(o.nextMonth.total)),
                Istatistik(etiket: L("Kalan bütün taksitler"), deger: Bicim.tl(o.remainingTotal)),
            ])
        }
    }

    private func ayAdi(_ ym: String) -> String {
        String(Bicim.month(ym).split(separator: " ").first ?? "")
    }

    // Sıradaki ödemeler: tarih rozeti, kart / nakit, ne zaman, tutar; gecikmiş ekstrede "Ödendi"
    private func siradakiler(_ o: Ozet) -> some View {
        Kart {
            KartBasligi(L("Sıradaki ödemeler"))
            if o.upcomingPayments.isEmpty {
                Text(L("Ödenecek taksit yok")).font(.subheadline).foregroundStyle(Tema.metin3)
            }
            SatirListesi(veri: Array(o.upcomingPayments.prefix(5))) { p in
                HStack(spacing: 12) {
                    TarihRozeti(tarih: p.date, gec: p.late == true)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Image(systemName: p.card == "Nakit" ? "banknote" : "creditcard")
                                .font(.footnote).foregroundStyle(model.kartRengi(p.card))
                            Text(Bicim.kartAdi(p.card)).font(.body.weight(.semibold)).lineLimit(1)
                        }
                        Text(p.late == true ? L("gecikti · {0}", Bicim.day(p.date)) : "\(Bicim.relative(p.date)) · \(Bicim.day(p.date))")
                            .font(.footnote).foregroundStyle(p.late == true ? Tema.tehlike : Tema.metin3)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(Bicim.tl(p.total)).font(.body.weight(.semibold)).monospacedDigit().fixedSize()
                        if p.late == true, p.card != "Nakit" {
                            Button(L("Ödendi")) { odendi(p) }
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
        odeme = .kart(id: c.id, ad: c.name, tutar: c.tracking?.unpaid ?? p.total, asgari: c.tracking?.revolving?.minimumDue)
    }

}

// İçgörüler: en önemlileri, "Tümü" ile hepsi (get_insights)
struct IcgoruBolumu: View {
    @EnvironmentObject private var abonelik: Abonelik
    @State private var hepsi = false

    var body: some View {
        Okunan(tool: "get_insights") { (i: Icgoruler) in
            if !i.insights.isEmpty, !abonelik.premium {
                PremiumKilidi(baslik: L("İçgörüler"), aciklama: L("{0} içgörü hazır: harcama alışkanlıkların, yaklaşan yükler ve öneriler.", i.insights.count), neden: "insights")
            } else if !i.insights.isEmpty {
                Kart {
                    KartBasligi(baslik: L("İçgörüler")) {
                        if i.insights.count > 2 {
                            Button(hepsi ? L("Daha az") : L("Tümü ({0})", i.insights.count)) { withAnimation { hepsi.toggle() } }
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
                Image(systemName: "exclamationmark.icloud").foregroundStyle(Renk.gider).accessibilityLabel(L("Eşitlenemedi"))
            } else {
                Image(systemName: "checkmark.icloud").foregroundStyle(Tema.metin3).accessibilityLabel(L("Eşitlendi"))
            }
        }
    }
}

// Yeni kullanıcı için üç adım: kart, harcama, gelir. Her adım yapılınca işaretlenir; üçü bitince ya da "Gizle" ile
// kaybolur.
struct BaslarkenDurumu: Equatable {
    let kart: Bool, harcama: Bool, gelir: Bool
    var bitti: Bool { kart && harcama && gelir }

    @MainActor static func oku(_ model: Model) -> BaslarkenDurumu {
        BaslarkenDurumu(
            kart: (try? model.read("list_cards") as KartListesi)?.cards.isEmpty == false,
            harcama: ((try? model.read("list_purchases", ["status": "all", "limit": 1]) as HarcamaListesi)?.count ?? 0) > 0,
            gelir: ((try? model.read("list_entries", ["limit": 1]) as HareketListesi)?.count ?? 0) > 0)
    }
}

struct BaslarkenKarti: View {
    let durum: BaslarkenDurumu
    @AppStorage("baslarken.gizli") private var gizli = false
    @State private var form: EkleSecim?

    var body: some View {
        let d = durum
        Kart {
            KartBasligi(baslik: L("Başlarken")) {
                Button(L("Gizle")) { gizli = true; Analitik.olay("onboarding_hidden") }.font(.subheadline).foregroundStyle(Tema.metin3)
            }
            Text(L("Üç adımda bu ay ne ödeyeceğini ve paranın yetip yetmeyeceğini görürsün."))
                .font(.subheadline).foregroundStyle(Tema.metin2)
            VStack(spacing: 0) {
                adim(1, L("Kredi kartını ekle"), L("Kesim ve son ödeme günüyle"), d.kart) { form = .kart }
                Ayirici()
                adim(2, L("Bir harcama ekle"), L("Taksitliyse taksit sayısıyla"), d.harcama) { form = .harcama }
                Ayirici()
                adim(3, L("Maaşını ekle"), L("Her ay tekrarlanır; nakdin hesaplanır"), d.gelir) { form = .hareket(.gelir) }
            }
        }
        .sheet(item: $form) { EkleFormu(secim: $0) }
        .onChange(of: form) { _, s in
            if let s { Analitik.olay("onboarding_step_opened", ["item": s.id]) }
        }
    }
    private func adim(_ no: Int, _ baslik: String, _ alt: String, _ tamam: Bool, _ eylem: @escaping () -> Void) -> some View {
        Button(action: eylem) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(tamam ? Tema.iyi : Tema.yuzey2).frame(width: 30, height: 30)
                    if tamam {
                        Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(.white)
                    } else {
                        Text("\(no)").font(.subheadline.weight(.bold)).foregroundStyle(Tema.metin)
                    }
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(baslik).font(.body.weight(.semibold)).foregroundStyle(tamam ? Tema.metin3 : Tema.metin)
                        .strikethrough(tamam, color: Tema.metin3)
                    Text(alt).font(.footnote).foregroundStyle(Tema.metin3)
                }
                Spacer()
                if !tamam { Image(systemName: "chevron.forward").font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3) }
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(tamam)
    }
}

import Combine
import SwiftUI

// Özet: yalnızca "bu ay ve yakında" — bu ay ödenecek (ilerlemesiyle), sıradaki ödemeler, en önemli içgörüler, nakit
// (ios/UX.md). Kişilerin payı Akış'ta, kategoriler Harcamalar'da, aylık grafik Akış'ta. Yeri gelince iki kısa kart:
// biten taksidin kutlaması (en üstte) ve ayın ilk günlerinde geçen ayın özeti.
struct OzetEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var ayarlar = false
    @State private var odeme: OdemeHedefi?
    @State private var baslarken: BaslarkenDurumu?
    @State private var teklif = false   // "Ödeme günlerini hatırlatayım mı?"
    @AppStorage("baslarken.gizli") private var baslarkenGizli = false
    @State private var bitenler: [BitenTaksit] = []   // son iki haftada biten, kapatılmamış taksitler (kutlama kartı)
    @State private var kutla = 0                        // yeni bir kutlama ilk kez göründü: titreşim
    @State private var aySonu: AyOzeti?                 // ayın ilk on gününde geçen ayın özeti (kart)
    @State private var acikOzet: AyOzeti?               // açık ay özeti sayfası
    @AppStorage("aykapanisi.kapatilan") private var ozetKapatilan = ""   // kapatılan özetin ayı ("2026-10")

    var body: some View {
        NavigationStack {
            Sayfa {
                CevrimdisiNotu()
                if !model.epostalar.isEmpty { EpostaOnayNotu(sayi: model.epostalar.count) }
                if !baslarkenGizli, let d = baslarken, !d.bitti { BaslarkenKarti(durum: d) }
                Okunan(tool: "get_overview") { (o: Ozet) in
                    // Hiç ödeme yoksa (yeni kullanıcı) sıfırlarla dolu kartlar gösterilmez; Başlarken yeter
                    let bos = o.remainingTotal < 0.004 && o.upcomingPayments.isEmpty && o.dueThisMonth < 0.004
                    VStack(alignment: .leading, spacing: 14) {
                        if !bos {
                            if !bitenler.isEmpty { BitenTaksitKarti(bitenler: bitenler, kapat: kutlamayiKapat) }
                            BuAyKarti(o: o)
                            IcgoruTepesi()
                            siradakiler(o)
                            if teklif, !o.upcomingPayments.isEmpty { HatirlatmaTeklifi(goster: $teklif) }
                            if let a = aySonu, ozetKapatilan != a.month {
                                AyKapanisiKarti(ozet: a, ac: {
                                    acikOzet = a
                                    Analitik.olay("month_summary_opened", ["source": "overview"])
                                }, kapat: { withAnimation { ozetKapatilan = a.month } })
                            }
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
            .sheet(item: $acikOzet) { o in AyOzetiEkrani(ozet: o) { withAnimation { ozetKapatilan = o.month } } }
            .sensoryFeedback(.success, trigger: kutla)
            // Ay özeti bildirimine dokunuldu: özet doğrudan açılır
            .onReceive(Yonlendirici.shared.$ayOzeti) { iste in
                guard iste else { return }
                Yonlendirici.shared.ayOzeti = false
                guard let o = model.motor?.monthSummary(), o.paid > 0.004 else { return }
                acikOzet = o
                Analitik.olay("month_summary_opened", ["source": "notification"])
            }
            .task(id: model.revision) {
                baslarken = BaslarkenDurumu.oku(model)
                kutlamalariOku()
                Karsilama.etkinlesmeyiDenetle(model)
                if !Hatirlatma.acik, !Hatirlatma.teklifBitti, !Hatirlatma.ertelendi, Ornek.tur == nil {
                    teklif = await Hatirlatma.izinDurumu() != .denied
                }
            }
        }
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

    // Kutlama kartı ve ay kapanışı: biten taksitler son iki haftadan (dün dahil; bugünkü ödeme henüz ödenmedi sayılır),
    // geçen ayın özeti ayın ilk on gününde. Ekran görüntüsü turlarında yok.
    private static let kapatilan = "kutlama.kapatilan", gosterilen = "kutlama.gosterilen"
    private func kutlamalariOku() {
        guard Ornek.tur == nil, Ornek.galeri == nil, let motor = model.motor else { return }
        let d = UserDefaults.standard, cal = Calendar.current, bugun = Date()
        if let ilk = cal.date(byAdding: .day, value: -14, to: bugun), let dun = cal.date(byAdding: .day, value: -1, to: bugun) {
            let kapali = Set(d.stringArray(forKey: Self.kapatilan) ?? [])
            let yeni = motor.finishing(from: Bicim.key(ilk), to: Bicim.key(dun)).filter { !kapali.contains($0.id) }
            if yeni != bitenler { withAnimation { bitenler = yeni } }
            // İlk kez görünen kutlama: bir titreşim ve ölçüm (aynı taksit için bir kez)
            var gorulen = d.stringArray(forKey: Self.gosterilen) ?? []
            let ilkKez = yeni.filter { !gorulen.contains($0.id) }
            if !ilkKez.isEmpty {
                gorulen.append(contentsOf: ilkKez.map(\.id))
                d.set(Array(gorulen.suffix(200)), forKey: Self.gosterilen)
                kutla += 1
                Analitik.olay("installment_finished_shown", ["count": ilkKez.count])
            }
        }
        let o = Bicim.takvim.component(.day, from: bugun) <= 10 ? motor.monthSummary() : nil
        aySonu = (o?.paid ?? 0) > 0.004 ? o : nil
    }

    private func kutlamayiKapat() {
        let d = UserDefaults.standard
        var kapali = d.stringArray(forKey: Self.kapatilan) ?? []
        kapali.append(contentsOf: bitenler.map(\.id))
        d.set(Array(kapali.suffix(200)), forKey: Self.kapatilan)
        withAnimation { bitenler = [] }
    }

    private func odendi(_ p: Ozet.Yaklasan) {
        guard let c = (try? model.read("list_cards") as KartListesi)?.cards.first(where: { $0.name == p.card }) else { return }
        odeme = .kart(id: c.id, ad: c.name, tutar: c.tracking?.unpaid ?? p.total, asgari: c.tracking?.revolving?.minimumDue)
    }

}

// Banka e-postalarından onay bekleyenler: Özet'te açan da görsün (bekleyenler Harcamalar'ın üstünde; dokununca oraya)
struct EpostaOnayNotu: View {
    let sayi: Int

    var body: some View {
        Button { Yonlendirici.shared.sekme = 2 } label: {
            HStack(spacing: 12) {
                Image(systemName: "envelope.badge").font(.system(size: 18)).foregroundStyle(Tema.metin2)
                Text(sayi == 1 ? L("Bir e-posta onay bekliyor") : L("{0} e-posta onay bekliyor", sayi))
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin)
                Spacer(minLength: 4)
                Image(systemName: "chevron.forward").font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3)
            }
            .padding(14)
            .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Tema.cizgi, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// Bu ay ödenecek: büyük tutar ve ayın ilerlemesi (ödenen / kalan, sıradaki gün), borç ödemeleri; altında gelecek ay
// (bu aya göre hafifliyor mu) ve taksitlerin bittiği ay (Özet'in üstü; ilk açılışta "Planın hazır"). Döküm değil yön:
// kalan borcun toplamı yerine ayın neresinde olunduğu ve işlerin nereye gittiği (get_overview progress,
// lastInstallmentMonth; icgoru.js).
struct BuAyKarti: View {
    let o: Ozet

    var body: some View {
        Kart {
            HStack {
                Text(L("Bu ay ödenecek")).font(.subheadline).foregroundStyle(Tema.metin2)
                Spacer()
                Text(Bicim.month(o.month)).font(.subheadline.weight(.semibold))
            }
            BuyukTutar(deger: o.dueThisMonth)
                .contentTransition(.numericText(value: o.dueThisMonth))   // değişen tutar eski değerden yenisine sayar
                .animation(.snappy(duration: 0.5), value: o.dueThisMonth)
            // İlerleme büyük tutarın hemen altında (çubuk onun ne kadarının ödendiğini gösterir); borç ödemeleri ayrı satır
            if let p = o.progress, o.dueThisMonth > 0.004 { ilerleme(p) }
            if let d = o.debts?.dueThisMonth, d > 0.004 {
                Text(L("+ {0} borç ödemesi", Bicim.tl(d))).font(.subheadline).foregroundStyle(Tema.metin2).monospacedDigit()
            }
            Ayirici()
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(L("Gelecek ay ({0})", ayAdi(o.nextMonth.month))).font(.footnote).foregroundStyle(Tema.metin3).lineLimit(1)
                    Text(Bicim.tl(o.nextMonth.total)).font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.7)
                    fark
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Rectangle().fill(Tema.cizgi).frame(width: 1).padding(.horizontal, 10)
                VStack(alignment: .leading, spacing: 3) {
                    // Taksitlerin bittiği ay belliyse o; değilse (taksit yok, yalnızca süresiz tekrarlar) kalan toplam
                    Text(o.lastInstallmentMonth != nil ? L("Son taksit") : L("Kalan bütün taksitler")).font(.footnote).foregroundStyle(Tema.metin3).lineLimit(1)
                    Text(o.lastInstallmentMonth.map { Bicim.month($0) } ?? Bicim.tl(o.remainingTotal))
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    // Ödenen kısım yeşil çubukta; altında "₺33.175 ödendi" ve "kalan ₺16.780 · 20 Kasım"
    private func ilerleme(_ p: Ozet.Ilerleme) -> some View {
        let oran = Int((min(max(p.paid / o.dueThisMonth, 0), 1) * 100).rounded())
        return VStack(alignment: .leading, spacing: 6) {
            Doluluk(used: p.paid, limit: o.dueThisMonth, renk: Tema.iyi, erisim: L("Bu ayın yüzde {0} kadarı ödendi", oran))
            HStack(spacing: 8) {
                if p.left < 0.004 {
                    Label(L("Hepsi ödendi"), systemImage: "checkmark.circle.fill").fontWeight(.semibold).foregroundStyle(Tema.iyi)
                } else {
                    if p.paid > 0.004 {
                        Text(L("{0} ödendi", Bicim.tl(p.paid, fraction: false))).fontWeight(.semibold).foregroundStyle(Tema.metin)
                        Spacer(minLength: 8)
                    }
                    Text(p.next.map { L("kalan {0} · {1}", Bicim.tl(p.left, fraction: false), Bicim.day($0)) } ?? L("kalan {0}", Bicim.tl(p.left, fraction: false)))
                        .foregroundStyle(Tema.metin2)
                }
            }
            .font(.footnote).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(.top, 2)
    }

    // Gelecek ay bu aydan hafifse yeşil "↓ ₺7.880 hafifliyor", ağırsa sakin "↑ ₺2.000 artıyor"
    @ViewBuilder private var fark: some View {
        let d = o.nextMonth.total - o.dueThisMonth
        if o.progress != nil, abs(d) >= 1 {
            Label(d < 0 ? L("{0} hafifliyor", Bicim.tl(-d, fraction: false)) : L("{0} artıyor", Bicim.tl(d, fraction: false)),
                  systemImage: d < 0 ? "arrow.down" : "arrow.up")
                .labelStyle(.titleAndIcon)
                .font(.caption.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                .foregroundStyle(d < 0 ? Tema.iyi : Tema.metin3)
        }
    }

    private func ayAdi(_ ym: String) -> String { AyOzetiEkrani.ayAdi(ym) }
}

// Son iki haftada son taksidi ödenen harcamalar: "Koltuk takımı bitti · Eylül ayından itibaren ayda ₺3.500 boşta".
// Taksit takibinin doğal ödülü; "Tamam" ile kapanır (OzetEkrani okur ve kapatılanları cihazda saklar).
struct BitenTaksitKarti: View {
    let bitenler: [BitenTaksit]
    let kapat: () -> Void

    var body: some View {
        Kart {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "checkmark.seal.fill").font(.title2).foregroundStyle(Tema.iyi)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(bitenler.prefix(3)) { b in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("{0} bitti", b.desc)).font(.body.weight(.semibold)).foregroundStyle(Tema.metin).lineLimit(2)
                            Text(L("{0} ayından itibaren ayda {1} boşta.", AyOzetiEkrani.ayAdi(b.freeFrom), Bicim.tl(b.monthly, fraction: false)))
                                .font(.footnote).foregroundStyle(Tema.metin2).monospacedDigit()
                        }
                    }
                    if bitenler.count > 3 {
                        Text(L("ve {0} taksit daha", bitenler.count - 3)).font(.footnote).foregroundStyle(Tema.metin3)
                    }
                }
                Spacer(minLength: 4)
                Button(L("Tamam"), action: kapat)
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Tema.yuzey2, in: Capsule())
                    .buttonStyle(.plain)
            }
        }
    }
}

// Ay kapanışı: ayın ilk on gününde geçen ayın özeti hazır ("Ekim özeti hazır"); dokununca AyOzetiEkrani, basılı tutunca
// "Kapat" (OzetEkrani okur; geçen ay ödeme yoksa kart yoktur).
struct AyKapanisiKarti: View {
    let ozet: AyOzeti
    let ac: () -> Void
    let kapat: () -> Void

    var body: some View {
        Button(action: ac) {
            Kart {
                HStack(alignment: .center, spacing: 12) {
                    Image(systemName: "calendar.badge.checkmark").font(.title2).foregroundStyle(Tema.metin2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("{0} özeti hazır", AyOzetiEkrani.ayAdi(ozet.month))).font(.body.weight(.semibold)).foregroundStyle(Tema.metin)
                        Text(AyOzetiEkrani.tekSatir(ozet)).font(.footnote).foregroundStyle(Tema.metin2).monospacedDigit().lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.forward").font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3)
                }
            }
        }
        .buttonStyle(.plain)
        .contextMenu { Button(L("Kapat"), systemImage: "xmark", action: kapat) }
    }
}

// İyi haber, Özet'in tepesinde tek satır (get_insights → headline): ay sonunda kalan serbest nakit ya da bugünün kartı.
// Premium istemez; dokununca açıklaması açılır.
struct IcgoruTepesi: View {
    @State private var acik = false

    var body: some View {
        Okunan(tool: "get_insights") { (i: Icgoruler) in
            if let t = i.headline {
                Button {
                    withAnimation { acik.toggle() }
                    if acik { Analitik.olay("insight_headline_opened", ["id": t.id]) }
                } label: {
                    Kart {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: t.id == "kart" ? "creditcard" : "checkmark.circle.fill").foregroundStyle(Tema.iyi)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(t.title).font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin)
                                    .multilineTextAlignment(.leading)
                                if acik {
                                    Text(t.text).font(.footnote).foregroundStyle(Tema.metin2).multilineTextAlignment(.leading)
                                }
                            }
                            Spacer(minLength: 4)
                            Image(systemName: acik ? "chevron.up" : "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// İçgörüler (get_insights): tepedeki satırın (IcgoruTepesi) dışındakiler; en önemlileri, "Tümü" ile hepsi.
// Ücretsiz sürümde iyi haberler (free) açık, gerisi için kilit.
struct IcgoruBolumu: View {
    @EnvironmentObject private var abonelik: Abonelik
    @State private var hepsi = false

    var body: some View {
        Okunan(tool: "get_insights") { (i: Icgoruler) in
            let kalan = i.insights.filter { $0.id != i.headline?.id }
            let gorunen = abonelik.premium ? kalan : kalan.filter { $0.free == true }
            let kilitli = kalan.count - gorunen.count
            if !gorunen.isEmpty {
                Kart {
                    KartBasligi(baslik: L("İçgörüler")) {
                        if gorunen.count > 2 {
                            Button(hepsi ? L("Daha az") : L("Tümü ({0})", gorunen.count)) { withAnimation { hepsi.toggle() } }
                                .font(.subheadline).foregroundStyle(Tema.metin2)
                        }
                    }
                    SatirListesi(veri: hepsi ? gorunen : Array(gorunen.prefix(2))) { IcgoruSatiri(i: $0) }
                }
            }
            if kilitli > 0 {
                PremiumKilidi(baslik: L("İçgörüler"), aciklama: L("{0} içgörü hazır: harcama alışkanlıkların, yaklaşan yükler ve öneriler.", kilitli), neden: "insights")
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
            gelir: gelirVar(model))
    }

    // Gelir: bir giriş (ana para biriminde ya da karşılığı ödenmeden gelen döviz; döviz / altın alışı gelir sayılmaz).
    // Daha önce kurulmuş uygulamada eski kural (herhangi bir hareket): bitmiş Başlarken geri gelmesin
    @MainActor private static func gelirVar(_ model: Model) -> Bool {
        guard let l = try? model.read("list_entries", ["limit": 1000]) as HareketListesi else { return false }
        if !Karsilama.yeniKurulum { return l.count > 0 }
        return l.entries.contains { $0.direction == "in" && ($0.asset == Bicim.home || $0.settledInTry != true) }
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
                Button(L("Gizle")) { gizli = true; Analitik.olay("onboarding_hidden", ["surface": "checklist"]) }.font(.subheadline).foregroundStyle(Tema.metin3)
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
        // Maaş adımı: "Maaş" yazılı ve "Her ay tekrarla" açık gelir (kartta söz verildiği gibi)
        .sheet(item: $form) { s in
            if s == .hareket(.gelir) { HareketFormu(tur: .gelir, maas: true) } else { EkleFormu(secim: s) }
        }
        .onChange(of: form) { _, s in
            if let s { Analitik.olay("onboarding_step_opened", ["item": s.id, "surface": "checklist"]) }
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

// Sıradaki ödemelerin altında bir kez: "Ödeme günlerini hatırlatayım mı?" (Aç ya da kapat; sonra Ayarlar'da)
struct HatirlatmaTeklifi: View {
    @EnvironmentObject private var model: Model
    @Binding var goster: Bool

    var body: some View {
        Kart {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "bell.badge").font(.title3).foregroundStyle(Tema.metin2)
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("Ödeme günlerini hatırlatayım mı?")).font(.body.weight(.semibold))
                    Text(L("Son ödeme gününden bir gün önce bildirim gelir. Ayarlar'dan değiştirebilirsin."))
                        .font(.footnote).foregroundStyle(Tema.metin2)
                }
            }
            HStack(spacing: 10) {
                Button {
                    Task { _ = await Hatirlatma.ac(model); withAnimation { goster = false } }
                } label: {
                    Text(L("Hatırlat")).font(.subheadline.weight(.semibold)).foregroundStyle(Tema.ustMetin)
                        .padding(.horizontal, 16).padding(.vertical, 8).background(Tema.metin, in: Capsule())
                }
                Button {
                    Hatirlatma.teklifBitti = true
                    Analitik.olay("reminders_offer_dismissed", ["source": "overview_offer"])
                    withAnimation { goster = false }
                } label: {
                    Text(L("Şimdi değil")).font(.subheadline).foregroundStyle(Tema.metin2)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                }
            }
            .buttonStyle(.plain)
        }
    }
}

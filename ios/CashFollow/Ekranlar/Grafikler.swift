import Charts
import SwiftUI

// Grafikler (Swift Charts), web'deki gibi: çizgiler tek renk (metin rengi), çubuklar kişi / kart renginde. Rakamlar
// web'dekiyle aynı hesaptan gelir: Nakit ve Varlığın seyri nakit.js'ten, aylık ödemeler get_cashflow'dan,
// kategoriler spending_by_category'den. Her biri kendi kartıdır (Kart).

// ── Nakit (Özet) ──────────────────────────────────────────────────────────────
// Dönemin gün gün nakit bakiyesi (ya da dönem başından beri net), bugün çizgisi, dokununca günün hareketleri

struct NakitKarti: View {
    @EnvironmentObject private var model: Model
    @AppStorage("nakit.baslangic") private var start = "today"
    @AppStorage("nakit.mod") private var mode = "balance"
    @State private var shift = 0
    @State private var seri: NakitSerisi?
    @State private var hata: String?
    @State private var secili: Date?

    private struct Nokta { let d: Date; let v: Double }

    var body: some View {
        Kart {
            HStack(spacing: 6) {
                Text("Nakit").font(.system(size: 17, weight: .semibold))
                Spacer()
                Button { shift -= 1 } label: { Image(systemName: "chevron.left").frame(width: 28, height: 28) }
                    .accessibilityLabel("Önceki dönem")
                Button { shift = 0 } label: {
                    Text(seri.map { "\(Bicim.day($0.from)) – \(Bicim.day($0.to))" } ?? "…")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin)
                }
                Button { shift += 1 } label: { Image(systemName: "chevron.right").frame(width: 28, height: 28) }
                    .accessibilityLabel("Sonraki dönem")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tema.metin2)

            HStack(spacing: 8) {
                Menu {
                    Picker("Dönem başlangıcı", selection: $start) {
                        Text("Bugünden").tag("today")
                        ForEach(1...31, id: \.self) { Text("Ayın \(Bicim.gunEki($0))").tag(String($0)) }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(start == "today" ? "Bugün" : "Ayın \(Bicim.gunEki(Int(start) ?? 1))")
                        Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Tema.metin)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                Secici(secim: $mode, ogeler: [("balance", "Bakiye"), ("net", "Dönem net")])
            }

            if let s = seri {
                HStack(alignment: .top, spacing: 8) {
                    if mode == "net" {
                        Kutucuk(etiket: "Giren", deger: Bicim.tl(s.inSum), renk: Tema.iyi)
                        Kutucuk(etiket: "Çıkan", deger: Bicim.tl(-s.outSum), renk: Tema.tehlike)
                        Kutucuk(etiket: "Net", deger: Bicim.tl(s.days.last?.net ?? 0))
                    } else {
                        let bugun = s.days.first { $0.date == s.today } ?? s.days.first
                        let enDusuk = s.days.min { $0.balance < $1.balance }
                        Kutucuk(etiket: bugun?.date == s.today ? "Bugün" : Bicim.day(bugun?.date), deger: Bicim.tl(bugun?.balance ?? 0))
                        Kutucuk(etiket: "\(Bicim.day(s.to)) sonunda", deger: Bicim.tl(s.days.last?.balance ?? 0))
                        Kutucuk(etiket: "En düşük · \(Bicim.day(enDusuk?.date))", deger: Bicim.tl(enDusuk?.balance ?? 0),
                                renk: (enDusuk?.balance ?? 0) < 0 ? Tema.tehlike : Tema.metin)
                    }
                }
                if s.any {
                    grafik(s)
                    if let gun = seciliGun(s) { hareketler(gun) }
                } else {
                    Text("Nakit hareketi yok. Varlıklar'dan maaş gibi bir giriş ekleyince burada görünür.")
                        .font(.footnote).foregroundStyle(Tema.metin3)
                }
                if !s.missing.isEmpty {
                    Text("Kuru alınamayan varlıklar sayılmadı: \(s.missing.joined(separator: ", "))")
                        .font(.caption).foregroundStyle(Tema.uyari)
                }
            } else if let hata {
                HataMetni(text: hata)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 180)
            }
        }
        .task(id: "\(model.revision)|\(start)|\(shift)") { yukle() }
    }

    private func yukle() {
        do { seri = try model.cash(start: start, shift: shift); hata = nil } catch { hata = error.localizedDescription }
    }

    private func deger(_ g: NakitSerisi.Gun) -> Double { mode == "net" ? g.net : g.balance }

    private func grafik(_ s: NakitSerisi) -> some View {
        let gunler = s.days.compactMap { g in Bicim.date(g.date).map { Nokta(d: $0, v: deger(g)) } }
        let alan = yAlani(gunler.map(\.v), sifirDahil: mode == "net")
        let bas = Bicim.date(s.from) ?? gunler.first?.d ?? Date()
        let son = Bicim.date(s.to) ?? gunler.last?.d ?? bas
        let today = Bicim.date(s.today)
        return Chart {
            ForEach(gunler, id: \.d) { g in
                AreaMark(x: .value("Gün", g.d), yStart: .value("Taban", alan.lowerBound), yEnd: .value("Tutar", g.v))
                    .foregroundStyle(Tema.metin.opacity(0.07))
                    .interpolationMethod(.stepEnd)
                LineMark(x: .value("Gün", g.d), y: .value("Tutar", g.v))
                    .foregroundStyle(Tema.metin)
                    .lineStyle(StrokeStyle(lineWidth: 2))
                    .interpolationMethod(.stepEnd)
            }
            if let last = gunler.last {
                PointMark(x: .value("Gün", last.d), y: .value("Tutar", last.v))
                    .foregroundStyle(Tema.metin)
                    .symbolSize(30)
                    .annotation(position: .top, alignment: .trailing, spacing: 4) {
                        Text(kisa(last.v)).font(.caption.weight(.semibold)).foregroundStyle(Tema.metin)
                    }
            }
            if mode == "net", alan.lowerBound < 0 {
                RuleMark(y: .value("Sıfır", 0)).foregroundStyle(Tema.cizgi2)
            }
            // Bugün dönemin içindeyse kesikli çizgi (dönem bugünden başlıyorsa sol kenar zaten bugündür)
            if let today, today > bas, today <= son {
                RuleMark(x: .value("Bugün", today))
                    .foregroundStyle(Tema.metin3)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
            if let secili {
                RuleMark(x: .value("Seçili", secili)).foregroundStyle(Tema.metin.opacity(0.3))
            }
        }
        .chartXSelection(value: $secili)
        .chartXScale(domain: bas...max(son, bas.addingTimeInterval(86_400)))
        .chartYScale(domain: alan)
        .chartYAxis { tutarEkseni() }
        .chartXAxis {
            AxisMarks(values: haftalik(bas, son)) { v in
                AxisGridLine().foregroundStyle(Tema.cizgi)
                AxisValueLabel(anchor: v.index == 0 ? .topLeading : .top) {
                    if let d = v.as(Date.self) {
                        Text(d, format: Bicim.tarih.day().month(.abbreviated)).foregroundStyle(Tema.metin3)
                    }
                }
            }
        }
        .frame(height: 190)
        .grafikTakvimi()
    }

    // Dönem başından haftada bir; sona 3 günden yakın olan yazılmaz (kesilmesin)
    private func haftalik(_ bas: Date, _ son: Date) -> [Date] {
        var out: [Date] = [], d = bas
        while d <= son.addingTimeInterval(-3 * 86_400) || out.isEmpty {
            out.append(d)
            guard let n = Bicim.takvim.date(byAdding: .day, value: 7, to: d) else { break }
            d = n
        }
        return out
    }

    private func seciliGun(_ s: NakitSerisi) -> NakitSerisi.Gun? {
        guard let secili else { return nil }
        let key = Bicim.key(secili)
        return s.days.first { $0.date == key }
    }

    private func hareketler(_ g: NakitSerisi.Gun) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(Bicim.day(g.date)).font(.caption.weight(.semibold))
                Spacer()
                Text("\(mode == "net" ? "Net" : "Bakiye") \(Bicim.tl(deger(g)))").font(.caption).monospacedDigit()
            }
            if g.moves.isEmpty { Text("Hareket yok").font(.caption).foregroundStyle(Tema.metin3) }
            ForEach(Array(g.moves.enumerated()), id: \.offset) { _, m in
                HStack {
                    Text(m.desc).font(.caption).lineLimit(1)
                    Spacer()
                    Text((m.value >= 0 ? "+" : "") + Bicim.tl(m.value)).font(.caption).monospacedDigit()
                        .foregroundStyle(m.value >= 0 ? Tema.iyi : Tema.tehlike)
                }
            }
        }
        .padding(10)
        .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// Tutar ekseni: sağda kısa tutarlar, ince ızgara
func tutarEkseni() -> some AxisContent {
    AxisMarks(values: .automatic(desiredCount: 4)) { v in
        AxisGridLine().foregroundStyle(Tema.cizgi)
        AxisValueLabel { if let x = v.as(Double.self) { Text(kisa(x)).foregroundStyle(Tema.metin3) } }
    }
}

extension View {
    // Grafik eksenleri gün anahtarlarıyla aynı saat diliminde (yoksa cihaz başka dilimdeyse ay / gün kayar)
    func grafikTakvimi() -> some View {
        environment(\.calendar, Bicim.takvim).environment(\.timeZone, Yapilandirma.timeZone)
    }
}

// Eksen için kısa tutar: 12,5 B, 1,2 Mn
func kisa(_ v: Double) -> String {
    let a = abs(v), s = v < 0 ? "−" : ""
    if a >= 1_000_000 { return s + (a / 1_000_000).formatted(.number.locale(Bicim.locale).precision(.fractionLength(0...1))) + " Mn" }
    if a >= 1_000 { return s + (a / 1_000).formatted(.number.locale(Bicim.locale).precision(.fractionLength(0...1))) + " B" }
    return s + a.formatted(.number.locale(Bicim.locale).precision(.fractionLength(0)))
}

// Y ekseni: değerlerin çevresine biraz pay; bakiye sıfırdan uzaksa eksen sıfırdan başlamaz (değişim görünsün)
func yAlani(_ vals: [Double], sifirDahil: Bool = false) -> ClosedRange<Double> {
    guard var lo = vals.min(), var hi = vals.max() else { return 0...1 }
    if sifirDahil { lo = min(lo, 0); hi = max(hi, 0) }
    let pay = max((hi - lo) * 0.12, max(abs(hi), abs(lo)) * 0.03, 1)
    var a = lo - pay
    if lo >= 0, a < 0 { a = 0 }                               // pozitif seride negatif eksen olmasın
    if !sifirDahil, lo >= 0, lo < (hi - lo) * 0.5 { a = 0 }   // sıfıra yakın seri sıfırdan başlasın
    return a...(hi + pay)
}

// ── Aylık ödemeler (Özet ve Akış) ─────────────────────────────────────────────

struct AylikOdemeGrafigi: View {
    @EnvironmentObject private var model: Model
    let months: [Akis.Ay]
    var baslik = "Aylık ödemeler"
    @AppStorage("grafik.grup") private var by = "person"

    // x ekseni ay anahtarına göre (kategorik): her ay bir bant, etiket kendi çubuğunun altında
    private struct Parca: Identifiable { let id = UUID(); let ay: String; let ad: String; let tutar: Double }

    private var parcalar: [Parca] {
        months.flatMap { m -> [Parca] in
            let map = by == "person" ? m.byPerson : m.byCard
            return map.filter { $0.value > 0.004 }.sorted { $0.key < $1.key }.map { Parca(ay: m.month, ad: $0.key, tutar: $0.value) }
        }
    }

    private var adlar: [String] {
        var out: [String] = []
        for p in parcalar where !out.contains(p.ad) { out.append(p.ad) }
        return out
    }

    private func renk(_ ad: String) -> Color { by == "person" ? model.kisiRengi(ad) : model.kartRengi(ad) }

    // Etiketler sığsın: en çok ~6 ay adı, ilk aydan başlayarak
    private var adim: Int { max(1, Int((Double(months.count) / 6).rounded(.up))) }
    private var etiketler: [String] { months.enumerated().compactMap { i, m in i % adim == 0 ? m.month : nil } }

    private func ayEtiketi(_ ym: String) -> String {
        guard let d = Bicim.date(ym + "-01") else { return ym }
        if months.count > 12 || ym.hasSuffix("-01") {   // yıl yalnızca Ocak'ta (ilk etikette sığmıyordu)
            return d.formatted(Bicim.tarih.month(.abbreviated)) + " ’" + String(ym.prefix(4).suffix(2))
        }
        return d.formatted(Bicim.tarih.month(.abbreviated))
    }

    var body: some View {
        let parcalar = self.parcalar, adlar = self.adlar
        Kart {
            HStack {
                Text(baslik).font(.system(size: 17, weight: .semibold))
                Spacer()
                Secici(secim: $by, ogeler: [("person", "Kişi"), ("card", "Kart")], tamGenislik: false)
            }
            if parcalar.isEmpty {
                Text("Önümüzdeki aylarda ödenecek taksit yok.").font(.footnote).foregroundStyle(Tema.metin3)
            } else {
                if adlar.count > 1 {
                    Akan { ForEach(adlar, id: \.self) { RenkliAd(ad: $0, renk: renk($0)) } }
                }
                Chart(parcalar) { p in
                    BarMark(x: .value("Ay", p.ay), y: .value("Tutar", p.tutar), width: .ratio(0.62))
                        .foregroundStyle(by: .value("Grup", p.ad))
                        .cornerRadius(3)
                }
                .chartForegroundStyleScale(domain: adlar, range: adlar.map(renk))
                .chartLegend(.hidden)
                .chartYAxis { tutarEkseni() }
                .chartXAxis {
                    AxisMarks(values: etiketler) { v in
                        AxisValueLabel { if let ym = v.as(String.self) { Text(ayEtiketi(ym)).foregroundStyle(Tema.metin3) } }
                    }
                }
                .chartXScale(domain: months.map(\.month))
                .frame(height: 190)
            }
        }
    }
}

// ── Kategoriler (Özet) ────────────────────────────────────────────────────────
// Web'deki gibi: kategori başına tutar, payı gösteren çubuk ve son 3 ayın ortalamasıyla karşılaştırma

struct KategoriKarti: View {
    let months: [KategoriHarcamasi.Ay]
    var secili: String?? = nil                        // süzülen kategori (Harcamalar)
    var sec: ((KategoriSecimi) -> Void)? = nil        // varsa satıra dokununca çağrılır
    @State private var secim: String?

    var body: some View {
        let i = months.firstIndex { $0.month == secim } ?? (months.count - 1)
        let ay = months.indices.contains(i) ? months[i] : nil
        Kart {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(sec == nil ? "Harcamalar · kategoriye göre" : "Kategoriler").font(.system(size: 17, weight: .semibold))
                    HStack(spacing: 4) {
                        Button { if i > 0 { secim = months[i - 1].month } } label: { Image(systemName: "chevron.left") }
                            .disabled(i <= 0).accessibilityLabel("Önceki ay")
                        Text(Bicim.month(ay?.month)).font(.subheadline).foregroundStyle(Tema.metin3)
                        Button { if i < months.count - 1 { secim = months[i + 1].month } } label: { Image(systemName: "chevron.right") }
                            .disabled(i >= months.count - 1).accessibilityLabel("Sonraki ay")
                    }
                    .buttonStyle(.plain)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Tema.metin2)
                }
                Spacer()
                if let ay { Text(Bicim.tl(ay.total)).font(.subheadline).foregroundStyle(Tema.metin3).monospacedDigit() }
            }
            if let ay {
                let liste = ay.categories.filter { $0.amount > 0 }
                if liste.isEmpty {
                    Text("Bu ayda kategorili harcama yok.").font(.footnote).foregroundStyle(Tema.metin3)
                }
                ForEach(liste, id: \.self) { k in
                    if let sec {
                        Button { sec(KategoriSecimi(id: k.category, ad: k.name)) } label: { satir(k).contentShape(Rectangle()) }
                            .buttonStyle(.plain)
                            .opacity(secili == nil || secili! == k.category ? 1 : 0.4)
                    } else {
                        satir(k)
                    }
                }
                Text(sec == nil ? "Taksitli alışveriş tamamıyla alındığı aya yazılır." : "Kategoriye dokununca harcamalar süzülür. Taksitli alışveriş tamamıyla alındığı aya yazılır.")
                    .font(.footnote).foregroundStyle(Tema.metin3)
            }
        }
    }

    private func satir(_ k: KategoriHarcamasi.Kategori) -> some View {
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
            HStack(spacing: 6) {
                Text("%\(Int((k.share * 100).rounded()))").foregroundStyle(Tema.metin3)
                if let ort = k.previous3MonthAverage, ort > 0.004 {
                    let fark = (k.amount - ort) / ort
                    if abs(fark) >= 0.05 {
                        Text("\(fark > 0 ? "↑" : "↓") 3 ay ortalamasından %\(Int((abs(fark) * 100).rounded())) \(fark > 0 ? "fazla" : "az")")
                            .foregroundStyle(fark > 0 ? Tema.tehlike : Tema.iyi)
                    }
                }
            }
            .font(.footnote).monospacedDigit()
        }
    }
}

// ── Varlığın seyri (Varlıklar) ────────────────────────────────────────────────

struct VarlikSeyriKarti: View {
    @EnvironmentObject private var model: Model
    @AppStorage("varlik.donem") private var range = "3m"
    @State private var seri: VarlikSerisi?
    @State private var yok = false
    @State private var hata: String?
    @State private var secili: Date?

    var body: some View {
        Kart {
            Text("Varlığın seyri").font(.system(size: 17, weight: .semibold))
            Secici(secim: $range, ogeler: [("1m", "1A"), ("3m", "3A"), ("6m", "6A"), ("1y", "1Y"), ("all", "Tümü")])
            if let s = seri, let ilk = s.points.first, let son = s.points.last {
                let n = nokta(s)
                let simdi = n ?? son
                let fark = simdi.value - ilk.value
                HStack(alignment: .top, spacing: 8) {
                    Kutucuk(etiket: Bicim.day(ilk.date), deger: Bicim.tl(ilk.value))
                    Kutucuk(etiket: n == nil ? "Bugün" : Bicim.day(simdi.date), deger: Bicim.tl(simdi.value))
                    Kutucuk(etiket: "Değişim", deger: (fark >= 0 ? "+" : "") + Bicim.tl(fark, fraction: false),
                            renk: fark >= 0 ? Tema.iyi : Tema.tehlike)
                }
                let alan = yAlani(s.points.map(\.value))
                Chart {
                    ForEach(s.points) { p in
                        if let d = Bicim.date(p.date) {
                            AreaMark(x: .value("Gün", d, unit: .day), yStart: .value("Taban", alan.lowerBound), yEnd: .value("Varlık", p.value))
                                .foregroundStyle(Tema.metin.opacity(0.07))
                            LineMark(x: .value("Gün", d, unit: .day), y: .value("Varlık", p.value))
                                .foregroundStyle(Tema.metin)
                                .lineStyle(StrokeStyle(lineWidth: 2))
                        }
                    }
                    if let d = Bicim.date(son.date) {
                        PointMark(x: .value("Gün", d, unit: .day), y: .value("Varlık", son.value))
                            .foregroundStyle(Tema.metin)
                            .symbolSize(30)
                            .annotation(position: .top, alignment: .trailing, spacing: 4) {
                                Text(kisa(son.value)).font(.caption.weight(.semibold)).foregroundStyle(Tema.metin)
                            }
                    }
                    if let secili {
                        RuleMark(x: .value("Seçili", secili, unit: .day)).foregroundStyle(Tema.metin.opacity(0.3))
                    }
                }
                .chartXSelection(value: $secili)
                .chartYScale(domain: alan)
                .chartYAxis { tutarEkseni() }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine().foregroundStyle(Tema.cizgi)
                        AxisValueLabel(format: Bicim.tarih.day().month(.abbreviated))
                    }
                }
                .frame(height: 190)
                .grafikTakvimi()
                HStack(alignment: .top, spacing: 8) {
                    parca(Bicim.homeShort, simdi.parts.lira)
                    parca("Döviz / altın", simdi.parts.fx)
                    parca("Fon / hisse", simdi.parts.market)
                    parca("Alacak", simdi.parts.receivable)
                }
                Text("Her gün o güne kadarki kayıtlarla ve o günün kur ve fiyatlarıyla.")
                    .font(.footnote).foregroundStyle(Tema.metin3)
                if !s.approx.isEmpty {
                    Text("Geçmiş fiyatı alınamayanlar bugünkü fiyatla: \(s.approx.joined(separator: ", "))")
                        .font(.footnote).foregroundStyle(Tema.metin3)
                }
            } else if yok {
                Text("Henüz kayıt yok.").font(.footnote).foregroundStyle(Tema.metin3)
            } else if let hata {
                HataMetni(text: hata)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 200)
            }
        }
        .task(id: "\(model.revision)|\(range)") { await yukle() }
    }

    private func yukle() async {
        do {
            let s = try await model.assetSeries(range: range)
            seri = s
            yok = s == nil
            hata = nil
        } catch {
            hata = error.localizedDescription
        }
    }

    private func nokta(_ s: VarlikSerisi) -> VarlikSerisi.Nokta? {
        guard let secili else { return nil }
        let key = Bicim.key(secili)
        return s.points.last { $0.date <= key } ?? s.points.first
    }

    private func parca(_ ad: String, _ v: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(ad).font(.caption2).foregroundStyle(Tema.metin3).lineLimit(1)
            Text(kisa(v)).font(.caption.weight(.semibold)).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// ── İçgörü satırı ────────────────────────────────────────────────────────────
// Web'deki gibi: ince çizgili simge (uyarı turuncu, kötü kırmızı, diğerleri metin renginde)

struct IcgoruSatiri: View {
    let i: Icgoruler.Icgoru

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: simge).font(.system(size: 17)).foregroundStyle(renk).frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(i.title).font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin)
                Text(i.text).font(.subheadline).foregroundStyle(Tema.metin2)
            }
        }
    }

    private var renk: Color {
        switch i.tone {
        case "good": return Tema.iyi
        case "warn": return Tema.uyari
        case "bad": return Tema.tehlike
        default: return Tema.metin2
        }
    }

    private var simge: String {
        switch i.tone {
        case "good": return "checkmark.circle"
        case "warn": return "exclamationmark.triangle"
        case "bad": return "exclamationmark.octagon"
        default: return "lightbulb"
        }
    }
}

import Charts
import SwiftUI

// Grafikler (Swift Charts). Rakamlar web'dekiyle aynı hesaptan gelir: Nakit ve Varlığın seyri nakit.js'ten, aylık
// ödemeler get_cashflow'dan, kategoriler spending_by_category'den.

// Seri renkleri: adlar sırasıyla web'in --s1…--s8 renklerini alır, "Nakit" gri
func seriRenkleri(_ adlar: [String]) -> [Color] {
    var i = 0
    return adlar.map { ad in
        if ad == "Nakit" { return Color.gray }
        defer { i += 1 }
        return Renk.seri[i % Renk.seri.count]
    }
}

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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button { shift -= 1 } label: { Image(systemName: "chevron.left") }
                    .buttonStyle(.borderless).accessibilityLabel("Önceki dönem")
                Spacer()
                Button { shift = 0 } label: {
                    Text(seri.map { "\(Bicim.day($0.from)) – \(Bicim.day($0.to))" } ?? "…").font(.subheadline.weight(.medium))
                }
                .buttonStyle(.borderless).foregroundStyle(.primary)
                Spacer()
                Button { shift += 1 } label: { Image(systemName: "chevron.right") }
                    .buttonStyle(.borderless).accessibilityLabel("Sonraki dönem")
            }
            Picker("Grafik", selection: $mode) {
                Text("Bakiye").tag("balance")
                Text("Dönem net").tag("net")
            }
            .pickerStyle(.segmented)

            if let s = seri {
                HStack {
                    ozet("Giren", s.inSum, Renk.gelir)
                    ozet("Çıkan", -s.outSum, Renk.gider)
                    ozet("Dönem sonu", s.days.last?.balance ?? 0, .primary)
                }
                if s.any {
                    grafik(s)
                    if let gun = seciliGun(s) { hareketler(gun) }
                } else {
                    Text("Nakit hareketi yok. Varlıklar'dan maaş gibi bir giriş ekleyince burada görünür.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if !s.missing.isEmpty {
                    Text("Kuru alınamayan varlıklar sayılmadı: \(s.missing.joined(separator: ", "))")
                        .font(.caption).foregroundStyle(Renk.uyari)
                }
            } else if let hata {
                HataMetni(text: hata)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 180)
            }

            Menu {
                Picker("Dönem başlangıcı", selection: $start) {
                    Text("Bugünden").tag("today")
                    ForEach(1...31, id: \.self) { Text("Ayın \(Bicim.gunEki($0))").tag(String($0)) }
                }
            } label: {
                Label(start == "today" ? "Dönem başı: bugün" : "Dönem başı: ayın \(Bicim.gunEki(Int(start) ?? 1))", systemImage: "calendar")
                    .font(.caption)
            }
        }
        .task(id: "\(model.revision)|\(start)|\(shift)") { yukle() }
    }

    private func yukle() {
        do { seri = try model.cash(start: start, shift: shift); hata = nil } catch { hata = error.localizedDescription }
    }

    private func ozet(_ baslik: String, _ deger: Double, _ renk: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(baslik).font(.caption).foregroundStyle(.secondary)
            Text(Bicim.tl(deger, fraction: false)).font(.subheadline.weight(.semibold)).foregroundStyle(renk).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func deger(_ g: NakitSerisi.Gun) -> Double { mode == "net" ? g.net : g.balance }

    private func grafik(_ s: NakitSerisi) -> some View {
        let today = Bicim.date(s.today)
        return Chart {
            ForEach(s.days) { g in
                if let d = Bicim.date(g.date) {
                    AreaMark(x: .value("Gün", d, unit: .day), y: .value("Tutar", deger(g)))
                        .foregroundStyle(LinearGradient(colors: [Renk.vurgu.opacity(0.35), Renk.vurgu.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.stepEnd)
                    LineMark(x: .value("Gün", d, unit: .day), y: .value("Tutar", deger(g)))
                        .foregroundStyle(Renk.vurgu)
                        .interpolationMethod(.stepEnd)
                }
            }
            if let today, s.days.contains(where: { $0.date == s.today }) {
                RuleMark(x: .value("Bugün", today, unit: .day))
                    .foregroundStyle(.secondary.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .top, alignment: .leading) { Text("bugün").font(.caption2).foregroundStyle(.secondary) }
            }
            if let secili {
                RuleMark(x: .value("Seçili", secili, unit: .day)).foregroundStyle(.primary.opacity(0.3))
            }
        }
        .chartXSelection(value: $secili)
        .chartYAxis { AxisMarks { v in AxisGridLine(); AxisValueLabel { if let x = v.as(Double.self) { Text(kisa(x)) } } } }
        .chartXAxis { AxisMarks(values: .stride(by: .day, count: 7)) { _ in AxisGridLine(); AxisValueLabel(format: .dateTime.day().month(.abbreviated).locale(Bicim.locale)) } }
        .frame(height: 200)
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
            if g.moves.isEmpty { Text("Hareket yok").font(.caption).foregroundStyle(.secondary) }
            ForEach(Array(g.moves.enumerated()), id: \.offset) { _, m in
                HStack {
                    Text(m.desc).font(.caption).lineLimit(1)
                    Spacer()
                    Text((m.value >= 0 ? "+" : "") + Bicim.tl(m.value)).font(.caption).monospacedDigit()
                        .foregroundStyle(m.value >= 0 ? Renk.gelir : Renk.gider)
                }
            }
        }
        .padding(8)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }
}

// Eksen için kısa tutar: 12,5 B, 1,2 Mn
func kisa(_ v: Double) -> String {
    let a = abs(v), s = v < 0 ? "−" : ""
    if a >= 1_000_000 { return s + (a / 1_000_000).formatted(.number.locale(Bicim.locale).precision(.fractionLength(0...1))) + " Mn" }
    if a >= 1_000 { return s + (a / 1_000).formatted(.number.locale(Bicim.locale).precision(.fractionLength(0...1))) + " B" }
    return s + a.formatted(.number.locale(Bicim.locale).precision(.fractionLength(0)))
}

// ── Aylık ödemeler (Özet ve Akış) ─────────────────────────────────────────────

struct AylikOdemeGrafigi: View {
    let months: [Akis.Ay]
    @AppStorage("grafik.grup") private var by = "person"

    private struct Parca: Identifiable { let id = UUID(); let ay: Date; let ad: String; let tutar: Double }

    private var parcalar: [Parca] {
        months.flatMap { m -> [Parca] in
            guard let d = Bicim.date(m.month + "-01") else { return [] }
            let map = by == "person" ? m.byPerson : m.byCard
            return map.filter { $0.value > 0.004 }.sorted { $0.key < $1.key }.map { Parca(ay: d, ad: $0.key, tutar: $0.value) }
        }
    }

    private var adlar: [String] {
        var out: [String] = []
        for p in parcalar where !out.contains(p.ad) { out.append(p.ad) }
        return out
    }

    var body: some View {
        let parcalar = self.parcalar, adlar = self.adlar
        VStack(alignment: .leading, spacing: 10) {
            Picker("Grupla", selection: $by) {
                Text("Kişi").tag("person")
                Text("Kart").tag("card")
            }
            .pickerStyle(.segmented)
            if parcalar.isEmpty {
                Text("Önümüzdeki aylarda ödenecek taksit yok.").font(.footnote).foregroundStyle(.secondary)
            } else {
                Chart(parcalar) { p in
                    BarMark(x: .value("Ay", p.ay, unit: .month), y: .value("Tutar", p.tutar))
                        .foregroundStyle(by: .value("Grup", p.ad))
                }
                .chartForegroundStyleScale(domain: adlar, range: seriRenkleri(adlar))
                .chartLegend(position: .bottom)
                .chartYAxis { AxisMarks { v in AxisGridLine(); AxisValueLabel { if let x = v.as(Double.self) { Text(kisa(x)) } } } }
                .chartXAxis { AxisMarks(values: .stride(by: .month)) { _ in AxisValueLabel(format: .dateTime.month(.narrow).locale(Bicim.locale)) } }
                .frame(height: 200)
            }
        }
    }
}

// ── Kategoriler (Özet) ────────────────────────────────────────────────────────

struct KategoriKarti: View {
    let ay: KategoriHarcamasi.Ay

    var body: some View {
        let liste = ay.categories.filter { $0.amount > 0 }
        let adlar = liste.map(\.name)
        VStack(alignment: .leading, spacing: 10) {
            if liste.isEmpty {
                Text("Bu ay kategorili harcama yok.").font(.footnote).foregroundStyle(.secondary)
            } else {
                HStack(alignment: .center, spacing: 16) {
                    Chart(liste, id: \.name) { k in
                        SectorMark(angle: .value("Tutar", k.amount), innerRadius: .ratio(0.62), angularInset: 1.5)
                            .foregroundStyle(by: .value("Kategori", k.name))
                            .cornerRadius(3)
                    }
                    .chartForegroundStyleScale(domain: adlar, range: seriRenkleri(adlar))
                    .chartLegend(.hidden)
                    .frame(width: 120, height: 120)
                    .overlay {
                        VStack(spacing: 0) {
                            Text("Toplam").font(.caption2).foregroundStyle(.secondary)
                            Text(Bicim.tl(ay.total, fraction: false)).font(.caption.weight(.semibold)).monospacedDigit()
                        }
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(liste.prefix(6).enumerated()), id: \.offset) { i, k in
                            HStack(spacing: 6) {
                                Circle().fill(seriRenkleri(adlar)[i]).frame(width: 8, height: 8)
                                Text(k.name).font(.caption).lineLimit(1)
                                Spacer()
                                Text("%\(Int((k.share * 100).rounded()))").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                            }
                        }
                    }
                }
            }
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
        VStack(alignment: .leading, spacing: 10) {
            Picker("Dönem", selection: $range) {
                Text("1A").tag("1m")
                Text("3A").tag("3m")
                Text("6A").tag("6m")
                Text("1Y").tag("1y")
                Text("Tümü").tag("all")
            }
            .pickerStyle(.segmented)
            if let s = seri, let ilk = s.points.first, let son = s.points.last {
                let fark = son.value - ilk.value
                HStack(alignment: .firstTextBaseline) {
                    Text(Bicim.tl(nokta(s)?.value ?? son.value, fraction: false)).font(.title3.weight(.semibold)).monospacedDigit()
                    Text((fark >= 0 ? "+" : "") + Bicim.tl(fark, fraction: false))
                        .font(.subheadline).foregroundStyle(fark >= 0 ? Renk.gelir : Renk.gider).monospacedDigit()
                    Spacer()
                    if let n = nokta(s) { Text(Bicim.day(n.date)).font(.caption).foregroundStyle(.secondary) }
                }
                Chart {
                    ForEach(s.points) { p in
                        if let d = Bicim.date(p.date) {
                            AreaMark(x: .value("Gün", d, unit: .day), y: .value("Varlık", p.value))
                                .foregroundStyle(LinearGradient(colors: [Renk.vurgu.opacity(0.35), Renk.vurgu.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                            LineMark(x: .value("Gün", d, unit: .day), y: .value("Varlık", p.value))
                                .foregroundStyle(Renk.vurgu)
                        }
                    }
                    if let secili {
                        RuleMark(x: .value("Seçili", secili, unit: .day)).foregroundStyle(.primary.opacity(0.3))
                    }
                }
                .chartXSelection(value: $secili)
                .chartYScale(domain: .automatic(includesZero: false))
                .chartYAxis { AxisMarks { v in AxisGridLine(); AxisValueLabel { if let x = v.as(Double.self) { Text(kisa(x)) } } } }
                .chartXAxis { AxisMarks { _ in AxisGridLine(); AxisValueLabel(format: .dateTime.day().month(.abbreviated).locale(Bicim.locale)) } }
                .frame(height: 200)
                if let n = nokta(s) {
                    HStack {
                        parca("TL", n.parts.lira)
                        parca("Döviz / altın", n.parts.fx)
                        parca("Fon / hisse", n.parts.market)
                        parca("Alacak", n.parts.receivable)
                    }
                }
                if !s.approx.isEmpty {
                    Text("Geçmiş fiyatı alınamayanlar bugünkü fiyatla: \(s.approx.joined(separator: ", "))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else if yok {
                Text("Henüz kayıt yok.").font(.footnote).foregroundStyle(.secondary)
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
            Text(ad).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            Text(kisa(v)).font(.caption.weight(.medium)).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// ── İçgörü satırı ────────────────────────────────────────────────────────────

struct IcgoruSatiri: View {
    let i: Icgoruler.Icgoru

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: simge).foregroundStyle(renk).frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(i.title).font(.subheadline.weight(.semibold))
                Text(i.text).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private var renk: Color {
        switch i.tone {
        case "good": return Renk.gelir
        case "warn": return Renk.uyari
        case "bad": return Renk.gider
        default: return Renk.vurgu
        }
    }

    private var simge: String {
        switch i.tone {
        case "good": return "checkmark.circle.fill"
        case "warn": return "exclamationmark.triangle.fill"
        case "bad": return "exclamationmark.octagon.fill"
        default: return "lightbulb.fill"
        }
    }
}

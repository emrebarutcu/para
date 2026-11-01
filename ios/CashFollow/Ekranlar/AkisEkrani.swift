import SwiftUI

// Akış: ay ay ödeme planı; her ödeme günü (kart ya da nakit), içindeki taksitler (get_cashflow; web'deki Akış sekmesi).
// Hesaba katılmayan kartın (ör. eşin kartı) ekstreleri "sayılmıyor" diye görünür, toplamlara girmez.
struct AkisEkrani: View {
    @EnvironmentObject private var model: Model
    @AppStorage("akis.ay") private var ayCount = 12
    @State private var acik: Set<String> = []
    @State private var adding = false

    var body: some View {
        NavigationStack {
            Sayfa {
                Okunan(tool: "get_cashflow", args: ["months": ayCount], key: "\(ayCount)") { (a: Akis) in
                    VStack(alignment: .leading, spacing: 14) {
                        AylikOdemeGrafigi(months: a.months, baslik: "\(a.months.count) ayda \(kisa(a.months.reduce(0) { $0 + $1.total }))")
                        if a.months.allSatisfy({ $0.payments.isEmpty }) {
                            Kart { Text("Önümüzdeki aylarda ödenecek taksit yok.").foregroundStyle(Tema.metin3) }
                        }
                        ForEach(a.months.filter { !$0.payments.isEmpty }) { m in ay(m) }
                    }
                }
            }
            .navigationTitle("Nakit akışı")
            .sayfaZemini()
            .yenilenebilir(model)
            .yuzenDugme("Harcama ekle") { adding = true }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("Kaç ay", selection: $ayCount) {
                            Text("6 ay").tag(6)
                            Text("12 ay").tag(12)
                            Text("24 ay").tag(24)
                            Text("60 ay").tag(60)
                        }
                    } label: { Image(systemName: "calendar") }
                    .accessibilityLabel("Kaç ay")
                }
            }
            .sheet(isPresented: $adding) { HarcamaFormu() }
        }
    }

    // Ay başlığı, kişilerin payı, ödeme günleri
    private func ay(_ m: Akis.Ay) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(Bicim.month(m.month)).font(.system(size: 19, weight: .bold))
                Spacer()
                Text(Bicim.tl(m.total)).font(.system(size: 17, weight: .bold)).monospacedDigit()
            }
            .padding(.horizontal, 4)
            .padding(.top, 8)
            let kisiler = m.byPerson.filter { $0.value > 0.004 }.sorted { $0.key < $1.key }
            if kisiler.count > 1 {
                HStack(spacing: 12) {
                    ForEach(Array(kisiler.enumerated()), id: \.offset) { _, k in RenkliAd(ad: "\(k.key) \(Bicim.tl(k.value))", renk: model.kisiRengi(k.key)) }
                }
                .padding(.horizontal, 4)
            }
            Kart(dolgu: 14) {
                SatirListesi(veri: Array(m.payments.enumerated()).map { OdemeAnahtari(ay: m.month, i: $0.offset, p: $0.element) }) { x in
                    OdemeSatiri(p: x.p, acik: binding("\(x.ay)|\(x.i)"))
                }
            }
        }
    }

    private func binding(_ key: String) -> Binding<Bool> {
        Binding(get: { acik.contains(key) }, set: { if $0 { acik.insert(key) } else { acik.remove(key) } })
    }
}

private struct OdemeAnahtari: Hashable { let ay: String; let i: Int; let p: Akis.Odeme }

// Bir ödeme günü: tarih rozeti, kart, kişiler, tutar; dokununca taksitler
struct OdemeSatiri: View {
    @EnvironmentObject private var model: Model
    let p: Akis.Odeme
    @Binding var acik: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { withAnimation(.snappy(duration: 0.25)) { acik.toggle() } } label: {
                HStack(spacing: 12) {
                    TarihRozeti(tarih: p.date)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Image(systemName: p.card == "Nakit" ? "banknote" : "creditcard")
                                .font(.footnote).foregroundStyle(model.kartRengi(p.card))
                            Text(p.card).font(.body.weight(.semibold)).foregroundStyle(Tema.metin)
                        }
                        if p.notCounted == true {
                            Text("sayılmıyor").font(.footnote).foregroundStyle(Tema.metin3)
                        } else if let by = p.byPerson, !by.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {   // web'deki gibi kişiler alt alta
                                ForEach(Array(by.sorted { $0.key < $1.key }.enumerated()), id: \.offset) { _, k in
                                    RenkliAd(ad: "\(k.key) \(Bicim.tl(k.value, fraction: false))", renk: model.kisiRengi(k.key))
                                }
                            }
                        }
                    }
                    Spacer()
                    Text(Bicim.tl(p.total)).font(.body.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(p.notCounted == true ? Tema.metin3 : Tema.metin)
                        .layoutPriority(1)
                    if !(p.items ?? []).isEmpty {
                        Image(systemName: "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(Tema.metin3)
                            .rotationEffect(.degrees(acik ? 180 : 0))
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if acik {
                VStack(spacing: 8) {
                    ForEach(p.items ?? [], id: \.self) { x in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(x.description).font(.subheadline).lineLimit(1)
                                Text("\(x.person) · \(x.installment)").font(.footnote).foregroundStyle(Tema.metin3)
                            }
                            Spacer()
                            Text(Bicim.tl(x.amount)).font(.subheadline).monospacedDigit()
                        }
                    }
                }
                .padding(12)
                .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }
}

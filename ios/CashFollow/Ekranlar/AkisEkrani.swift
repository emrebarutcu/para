import SwiftUI

// Akış: ay ay ödeme planı; her ödeme günü (kart ya da nakit), içindeki taksitler (get_cashflow; web'deki Akış sekmesi).
// Hesaba katılmayan kartın (ör. eşin kartı) ekstreleri "sayılmıyor" diye görünür, toplamlara girmez.
struct AkisEkrani: View {
    @EnvironmentObject private var model: Model
    @AppStorage("akis.ay") private var ayCount = 12
    @State private var acik: Set<String> = []

    var body: some View {
        NavigationStack {
            Okunan(tool: "get_cashflow", args: ["months": ayCount], key: "\(ayCount)") { (a: Akis) in
                List {
                    Section {
                        AylikOdemeGrafigi(months: a.months)
                        Satir(title: "\(a.months.count) ayda toplam", value: Bicim.tl(a.months.reduce(0) { $0 + $1.total }))
                    }
                    if a.months.allSatisfy({ $0.payments.isEmpty }) {
                        Text("Önümüzdeki aylarda ödenecek taksit yok.").foregroundStyle(.secondary)
                    }
                    ForEach(a.months.filter { !$0.payments.isEmpty }) { m in
                        Section {
                            ForEach(Array(m.payments.enumerated()), id: \.offset) { i, p in
                                OdemeSatiri(p: p, acik: binding("\(m.month)|\(i)"))
                            }
                        } header: {
                            HStack {
                                Text(Bicim.month(m.month))
                                Spacer()
                                Text(Bicim.tl(m.total)).monospacedDigit()
                            }
                        }
                    }
                }
            }
            .navigationTitle("Akış")
            .yenilenebilir(model)
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
        }
    }

    private func binding(_ key: String) -> Binding<Bool> {
        Binding(get: { acik.contains(key) }, set: { if $0 { acik.insert(key) } else { acik.remove(key) } })
    }
}

// Bir ödeme günü: kart, tutar, kişiler; açınca taksitler
struct OdemeSatiri: View {
    let p: Akis.Odeme
    @Binding var acik: Bool

    var body: some View {
        DisclosureGroup(isExpanded: $acik) {
            ForEach(p.items ?? [], id: \.self) { x in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(x.description).font(.subheadline).lineLimit(1)
                        Text("\(x.person) · \(x.installment)").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(Bicim.tl(x.amount)).font(.subheadline).monospacedDigit()
                }
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.card)
                    Text("\(Bicim.day(p.date)) · \(Bicim.relative(p.date))").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Bicim.tl(p.total)).monospacedDigit()
                        .foregroundStyle(p.notCounted == true ? .secondary : .primary)
                    if p.notCounted == true {
                        Text("sayılmıyor").font(.caption2).foregroundStyle(.secondary)
                    } else if let by = p.byPerson, by.count > 1 {
                        Text(by.sorted { $0.key < $1.key }.map { "\($0.key) \(kisa($0.value))" }.joined(separator: " · "))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

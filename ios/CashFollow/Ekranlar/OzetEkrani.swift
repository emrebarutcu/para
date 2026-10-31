import SwiftUI

// Özet: bu ay ve gelecek ay ödenecekler, sıradaki ödemeler, kartlar ve kişiler (get_overview; web'deki Özet sekmesi)
struct OzetEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var adding = false

    var body: some View {
        NavigationStack {
            Okunan(tool: "get_overview") { (o: Ozet) in
                List {
                    CevrimdisiNotu()
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(Bicim.month(o.month)) ödemeleri").font(.subheadline).foregroundStyle(.secondary)
                            Text(Bicim.tl(o.dueThisMonth)).font(.largeTitle.weight(.semibold)).monospacedDigit()
                        }
                        .padding(.vertical, 4)
                        Satir(title: "Gelecek ay (\(Bicim.month(o.nextMonth.month)))", value: Bicim.tl(o.nextMonth.total))
                        Satir(title: "Kalan toplam", value: Bicim.tl(o.remainingTotal))
                        Satir(title: "Son ödeme", value: o.endless == true ? "Süresiz" : Bicim.month(o.lastPaymentMonth))
                        if let d = o.debts, (d.dueThisMonth ?? 0) > 0 || (d.nextMonth ?? 0) > 0 {
                            Satir(title: "Borç ve kredi ödemeleri (bu ay)", value: Bicim.tl(d.dueThisMonth ?? 0))
                        }
                    }

                    Section("Sıradaki ödemeler") {
                        if o.upcomingPayments.isEmpty {
                            Text("Ödenecek taksit yok").foregroundStyle(.secondary)
                        }
                        ForEach(o.upcomingPayments, id: \.self) { p in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.card)
                                    Text("\(Bicim.day(p.date)) · \(Bicim.relative(p.date))")
                                        .font(.caption)
                                        .foregroundStyle(p.late == true ? Renk.gider : .secondary)
                                }
                                Spacer()
                                Text(Bicim.tl(p.total)).monospacedDigit()
                            }
                        }
                    }

                    if !o.cards.isEmpty {
                        Section("Kartlar") {
                            ForEach(o.cards, id: \.self) { c in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(c.name)
                                        Spacer()
                                        if let n = c.nextPayment {
                                            Text("\(Bicim.day(n.date)): \(Bicim.tl(n.amount))").font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                    if let available = c.available {
                                        Doluluk(used: c.used, limit: c.used + available)
                                        Text("Kullanılabilir \(Bicim.tl(available))").font(.caption).foregroundStyle(.secondary)
                                    } else {
                                        Text("Kullanılan \(Bicim.tl(c.used))").font(.caption).foregroundStyle(.secondary)
                                    }
                                    if let overdue = c.overdue, overdue > 0 {
                                        Text("Geciken ekstre: \(Bicim.tl(overdue))").font(.caption).foregroundStyle(Renk.gider)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }

                    if o.people.count > 1 {
                        Section("Kişiler") {
                            ForEach(o.people, id: \.self) { p in
                                HStack {
                                    Text(p.name)
                                    Spacer()
                                    VStack(alignment: .trailing) {
                                        Text(Bicim.tl(p.dueThisMonth)).monospacedDigit()
                                        Text("kalan \(Bicim.tl(p.remaining))").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Özet")
            .yenilenebilir(model)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EsitlemeDurumu() }
                ToolbarItem(placement: .primaryAction) {
                    Button { adding = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Harcama ekle")
                }
            }
            .sheet(isPresented: $adding) { HarcamaFormu() }
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
                Image(systemName: "checkmark.icloud").foregroundStyle(.secondary).accessibilityLabel("Eşitlendi")
            }
        }
    }
}
